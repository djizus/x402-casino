import type { AgentRuntime } from '@lucid-agents/types/core';
import type { AgentCard, A2ARuntime } from '@lucid-agents/types/a2a';
import { randomUUID } from 'crypto';

import {
  Card,
  BettingRound,
  RegisterPlayerInput,
  RegisterPlayerResult,
  RoomSummary,
  StartGameInput,
  ConfigureRoomInput,
  RoomConfig,
  actionRequestSchema,
  actionResponseSchema,
  registerPlayerResultSchema,
  roomSummarySchema,
  RoomEvent,
} from './protocol';
import { cardToString, createDeck, drawCards, shuffleDeck } from './cards';
import { compareHandScores, describeHand, evaluateBestHand } from './hand-evaluator';

type RoomStatus = 'waiting' | 'running' | 'idle' | 'error';
const CHIP_EPSILON = 1e-6;

interface RegisteredPlayer {
  id: string;
  seatNumber: number;
  displayName: string;
  actionSkill: string;
  agentCardUrl: string;
  stack: number;
  card: AgentCard;
}

export type RoomRuntime = AgentRuntime & {
  a2a?: A2ARuntime;
};

export class PokerRoom {
  private readonly runtime: RoomRuntime;
  private roomId: string;
  private roomConfig?: RoomConfig;
  private casinoCallback?: { card: AgentCard; eventSkill: string };
  private casinoName = 'casino-agent';
  private status: RoomStatus = 'waiting';
  private players = new Map<string, RegisteredPlayer>();
  private handCount = 0;
  private lastMessage?: string;
  private readonly eventLog: RoomEvent[] = [];

  constructor(runtime: RoomRuntime, roomId: string) {
    this.runtime = runtime;
    this.roomId = roomId;
  }

  public async configure(input: ConfigureRoomInput): Promise<RoomSummary> {
    this.roomId = input.roomId;
    this.roomConfig = input.config;
    this.casinoName = input.casinoName;
    const a2a = this.requireA2ARuntime();
    const casinoCard = await a2a.fetchCard(input.casinoCallback.agentCardUrl);
    this.casinoCallback = { card: casinoCard, eventSkill: input.casinoCallback.eventSkill };
    this.status = 'waiting';
    this.players.clear();
    this.handCount = 0;
    this.lastMessage = undefined;
    this.eventLog.length = 0;

    await this.publishEvent('room_status', `Room ${this.roomId} configured.`, {
      casinoName: this.casinoName,
      config: this.roomConfig,
    });
    return this.getSummary();
  }

  public getSummary(): RoomSummary {
    const summary: RoomSummary = {
      roomId: this.roomId,
      status: this.status,
      players: Array.from(this.players.values())
        .sort((a, b) => a.seatNumber - b.seatNumber)
        .map((player) => ({
          playerId: player.id,
          seatNumber: player.seatNumber,
          displayName: player.displayName,
          stack: player.stack,
        })),
      handCount: this.handCount,
      message: this.lastMessage,
    };

    return roomSummarySchema.parse(summary);
  }

  public getEvents(): RoomEvent[] {
    return [...this.eventLog];
  }

  public async registerPlayer(input: RegisterPlayerInput): Promise<RegisterPlayerResult> {
    if (!this.roomConfig) {
      throw new Error('Room is not configured.');
    }

    if (this.players.size >= this.roomConfig.maxSeats) {
      throw new Error(`Room ${this.roomId} is full (${this.roomConfig.maxSeats} seats).`);
    }

    const seatNumber = this.findSeat(input.preferredSeat);
    const a2a = this.requireA2ARuntime();
    const card = await a2a.fetchCard(input.agentCardUrl);

    if (
      this.players.has(input.playerId) ||
      Array.from(this.players.values()).some((p) => p.agentCardUrl === input.agentCardUrl)
    ) {
      throw new Error(`Player ${input.displayName} is already registered in this room.`);
    }

    const player: RegisteredPlayer = {
      id: input.playerId || randomUUID(),
      seatNumber,
      displayName: input.displayName,
      actionSkill: input.actionSkill,
      agentCardUrl: input.agentCardUrl,
      stack: input.startingStack,
      card,
    };

    this.players.set(player.id, player);

    const result: RegisterPlayerResult = {
      playerId: player.id,
      seatNumber,
      displayName: player.displayName,
      stack: player.stack,
    };

    await this.publishEvent('player_registered', `${player.displayName} seated at ${seatNumber}.`, {
      playerId: player.id,
      seatNumber,
      stack: player.stack,
    });

    return registerPlayerResultSchema.parse(result);
  }

  public async startGame(overrides?: StartGameInput): Promise<RoomSummary> {
    if (!this.roomConfig) {
      throw new Error('Room is not configured.');
    }
    if (this.players.size < 2) {
      throw new Error('At least two players are required to start a hand.');
    }
    if (this.status === 'running') {
      throw new Error('A hand is already running.');
    }

    const config: RoomConfig = {
      ...this.roomConfig,
      ...(overrides ?? {}),
    } as RoomConfig;

    this.status = 'running';
    this.lastMessage = undefined;
    await this.publishEvent('hand_started', `Starting session of ${config.maxHands} hand${config.maxHands === 1 ? '' : 's'} at ${this.roomId}.`, {
      maxHands: config.maxHands,
    });

    const initialHandCount = this.handCount;
    let bustedSeat: RegisteredPlayer | undefined;

    try {
      for (let handIndex = 0; handIndex < config.maxHands; handIndex += 1) {
        await this.playHand(config);
        this.handCount += 1;
        bustedSeat = this.findBankruptSeat();
        if (bustedSeat) {
          await this.publishEvent('player_busted', `${bustedSeat.displayName} is out of chips.`, {
            playerId: bustedSeat.id,
          });
          break;
        }
      }

      const handsPlayed = this.handCount - initialHandCount;
      this.status = 'idle';
      this.lastMessage = bustedSeat
        ? `Session stopped after ${handsPlayed} hand${handsPlayed === 1 ? '' : 's'} (${bustedSeat.displayName} busted).`
        : `Completed ${handsPlayed} hand${handsPlayed === 1 ? '' : 's'}.`;
      await this.publishEvent('hand_completed', this.lastMessage, { handsPlayed });
    } catch (error) {
      this.status = 'error';
      this.lastMessage = error instanceof Error ? error.message : 'Unknown error occurred.';
      await this.publishEvent('room_error', this.lastMessage ?? 'Room error.');
      throw error;
    } finally {
      if (this.status === 'running') {
        this.status = 'idle';
      }
    }

    return this.getSummary();
  }

  private findSeat(preferredSeat?: number): number {
    if (
      typeof preferredSeat === 'number' &&
      preferredSeat >= 0 &&
      !Array.from(this.players.values()).some((player) => player.seatNumber === preferredSeat)
    ) {
      return preferredSeat;
    }

    let seat = 0;
    while (Array.from(this.players.values()).some((player) => player.seatNumber === seat)) {
      seat += 1;
    }
    return seat;
  }

  private async playHand(config: RoomConfig): Promise<void> {
    const deck = shuffleDeck(createDeck());
    const seats = Array.from(this.players.values()).sort((a, b) => a.seatNumber - b.seatNumber);

    const holeCards = new Map<string, Card[]>();
    for (const seat of seats) {
      holeCards.set(seat.id, drawCards(deck, 2));
    }

    const communityCards: Card[] = [];
    const bettingState = {
      pot: 0,
      contributions: new Map<string, number>(),
      folded: new Set<string>(),
      roundBets: new Map<string, number>(),
      currentBet: 0,
    };

    await this.playBettingRound('preflop', seats, holeCards, communityCards, config, bettingState);

    communityCards.push(...drawCards(deck, 3));
    await this.playBettingRound('flop', seats, holeCards, communityCards, config, bettingState);

    communityCards.push(...drawCards(deck, 1));
    await this.playBettingRound('turn', seats, holeCards, communityCards, config, bettingState);

    communityCards.push(...drawCards(deck, 1));
    await this.playBettingRound('river', seats, holeCards, communityCards, config, bettingState);

    await this.settlePot(seats, holeCards, communityCards, bettingState);

    this.lastMessage = `Hand #${this.handCount + 1} completed. Community cards: ${communityCards
      .map(cardToString)
      .join(' ')}`;
    await this.publishEvent('hand_completed', this.lastMessage, {
      communityCards: communityCards.map(cardToString),
      handNumber: this.handCount + 1,
    });
  }

  private async playBettingRound(
    bettingRound: BettingRound,
    seats: RegisteredPlayer[],
    holeCards: Map<string, Card[]>,
    communityCards: Card[],
    config: RoomConfig,
    state: {
      pot: number;
      contributions: Map<string, number>;
      folded: Set<string>;
      roundBets: Map<string, number>;
      currentBet: number;
    },
  ): Promise<void> {
    state.roundBets.clear();
    state.currentBet = 0;

    const activeOrder = seats.filter(
      (seat) => !state.folded.has(seat.id) && (holeCards.get(seat.id)?.length ?? 0) > 0,
    );
    if (activeOrder.length === 0) {
      return;
    }

    let actionsSinceRaise = 0;
    let index = 0;

    while (activeOrder.length > 0 && actionsSinceRaise < activeOrder.length) {
      const seat = activeOrder[index % activeOrder.length];

      if (state.folded.has(seat.id)) {
        activeOrder.splice(index % activeOrder.length, 1);
        actionsSinceRaise = Math.min(actionsSinceRaise, activeOrder.length);
        continue;
      }

      if ((holeCards.get(seat.id)?.length ?? 0) === 0) {
        activeOrder.splice(index % activeOrder.length, 1);
        actionsSinceRaise = Math.min(actionsSinceRaise, activeOrder.length);
        continue;
      }

      if (seat.stack <= 0) {
        await this.publishEvent('action_taken', `${seat.displayName} is all-in and skips ${bettingRound}.`, {
          playerId: seat.id,
          bettingRound,
        });
        activeOrder.splice(index % activeOrder.length, 1);
        actionsSinceRaise = Math.min(actionsSinceRaise, activeOrder.length);
        if (activeOrder.length <= 1) {
          break;
        }
        continue;
      }

      const cards = holeCards.get(seat.id);
      if (!cards) {
        continue;
      }

      const roundContribution = state.roundBets.get(seat.id) ?? 0;
      const amountToCall = Math.max(0, state.currentBet - roundContribution);

      const legalActions =
        amountToCall > 0
          ? seat.stack > amountToCall
            ? ['call', 'raise', 'fold']
            : ['call', 'fold']
          : seat.stack > 0
          ? ['check', 'bet', 'fold']
          : ['check', 'fold'];

      const actionRequest = actionRequestSchema.parse({
        roomId: this.roomId,
        bettingRound,
        communityCards,
        holeCards: cards,
        pot: state.pot,
        minimumRaise: config.smallBlind,
        currentBet: amountToCall,
        playerStack: seat.stack,
        legalActions,
      });

      const result = await this.requireA2ARuntime().client.invoke(seat.card, seat.actionSkill, actionRequest);
      const action = actionResponseSchema.parse(result.output ?? {});
      const resolved = await this.applyAction(seat, action, bettingRound, state, legalActions);

      if (resolved === 'fold') {
        activeOrder.splice(index % activeOrder.length, 1);
        actionsSinceRaise = Math.min(actionsSinceRaise, activeOrder.length);
        if (activeOrder.length <= 1) {
          break;
        }
        continue;
      }

      if (resolved === 'bet' || resolved === 'raise') {
        actionsSinceRaise = 1;
      } else {
        actionsSinceRaise += 1;
      }

      index += 1;
    }
  }

  private async applyAction(
    seat: RegisteredPlayer,
    action: { action: string; amount?: number },
    round: BettingRound,
    state: {
      pot: number;
      contributions: Map<string, number>;
      folded: Set<string>;
      roundBets: Map<string, number>;
      currentBet: number;
    },
    allowedActions: string[],
  ): Promise<'fold' | 'call' | 'check' | 'bet' | 'raise'> {
    const notify = async (message: string, payload?: Record<string, unknown>) => {
      this.lastMessage = message;
      await this.publishEvent('action_taken', message, {
        playerId: seat.id,
        bettingRound: round,
        ...payload,
      });
    };

    const request = action.action;
    const allow = (name: string) => allowedActions.includes(name);

    let normalizedAction = request;
    if (!allow(request)) {
      if ((request === 'check' || request === 'bet' || request === 'raise') && allow('call')) {
        normalizedAction = 'call';
      } else if (allow('check')) {
        normalizedAction = 'check';
      } else if (allow('call')) {
        normalizedAction = 'call';
      } else if (allow('fold')) {
        normalizedAction = 'fold';
      }
    }

    switch (normalizedAction) {
      case 'fold':
        state.folded.add(seat.id);
        await notify(`${seat.displayName} folded during ${round}.`);
        return 'fold';
      case 'bet':
      case 'raise':
      case 'all-in': {
        const requested = typeof action.amount === 'number' && Number.isFinite(action.amount) ? action.amount : 0;
        const amount = Math.max(0, Math.min(requested, seat.stack));
        if (amount > 0) {
          seat.stack -= amount;
          state.pot += amount;
          state.contributions.set(seat.id, (state.contributions.get(seat.id) ?? 0) + amount);
          const newContribution = (state.roundBets.get(seat.id) ?? 0) + amount;
          state.roundBets.set(seat.id, newContribution);
          state.currentBet = Math.max(state.currentBet, newContribution);
          const actionLabel = normalizedAction === 'raise' ? 'raise' : 'bet';
          await notify(`${seat.displayName} ${actionLabel} ${amount} during ${round}.`, {
            amount,
            pot: state.pot,
          });
          return actionLabel;
        } else {
          await notify(`${seat.displayName} checked during ${round}.`);
          return 'check';
        }
      }
      case 'call': {
        const contribution = state.roundBets.get(seat.id) ?? 0;
        const amountToCall = Math.max(0, state.currentBet - contribution);
        const callAmount = Math.min(amountToCall, seat.stack);
        if (callAmount > 0) {
          seat.stack -= callAmount;
          state.pot += callAmount;
          state.contributions.set(seat.id, (state.contributions.get(seat.id) ?? 0) + callAmount);
          state.roundBets.set(seat.id, contribution + callAmount);
          await notify(`${seat.displayName} called ${callAmount} during ${round}.`, {
            amount: callAmount,
            pot: state.pot,
          });
          return 'call';
        } else {
          await notify(`${seat.displayName} checked during ${round}.`);
          return 'check';
        }
      }
      case 'check':
      default:
        await notify(`${seat.displayName} chose to ${normalizedAction} during ${round}.`);
        return 'check';
    }
  }

  private async settlePot(
    seats: RegisteredPlayer[],
    holeCards: Map<string, Card[]>,
    communityCards: Card[],
    state: {
      pot: number;
      folded: Set<string>;
    },
  ): Promise<void> {
    if (state.pot <= 0) {
      this.lastMessage = 'Hand completed with no chips in the pot.';
      await this.publishEvent('hand_completed', this.lastMessage);
      return;
    }

    const activeSeats = seats.filter((seat) => !state.folded.has(seat.id));

    if (activeSeats.length === 1) {
      const winner = activeSeats[0];
      winner.stack += state.pot;
      this.lastMessage = `${winner.displayName} wins ${state.pot} (everyone else folded).`;
      await this.publishEvent('hand_completed', this.lastMessage, {
        winner: winner.displayName,
        amount: state.pot,
      });
      return;
    }

    const evaluations = activeSeats
      .map((seat) => {
        const cards = [...(holeCards.get(seat.id) ?? []), ...communityCards];
        return {
          seat,
          score: evaluateBestHand(cards),
        };
      })
      .filter((entry) => entry.score);

    if (evaluations.length === 0) {
      await this.publishEvent('room_error', 'No active players to settle the pot.');
      return;
    }

    evaluations.sort((a, b) => compareHandScores(b.score, a.score));
    const bestScore = evaluations[0].score;
    const winners = evaluations.filter((entry) => compareHandScores(entry.score, bestScore) === 0);

    const share = state.pot / winners.length;
    winners.forEach((winner) => {
      winner.seat.stack += share;
    });

    const winnerNames = winners
      .map((winner) => `${winner.seat.displayName} (${describeHand(winner.score)})`)
      .join(', ');

    this.lastMessage = `Pot ${state.pot} awarded to ${winnerNames}. Each receives ${share}.`;
    await this.publishEvent('hand_completed', this.lastMessage, {
      pot: state.pot,
      winners: winners.map((winner) => winner.seat.displayName),
      share,
    });
  }

  private async publishEvent(
    eventType: RoomEvent['eventType'],
    message: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const entry: RoomEvent = {
      roomId: this.roomId,
      eventType,
      message,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.eventLog.push(entry);
    if (this.eventLog.length > 200) {
      this.eventLog.shift();
    }
    if (!this.casinoCallback) {
      return;
    }

    try {
      await this.requireA2ARuntime().client.invoke(this.casinoCallback.card, this.casinoCallback.eventSkill, entry);
    } catch (error) {
      console.error(`[poker-room] Failed to publish event ${eventType}:`, error);
    }
  }

  private requireA2ARuntime(): A2ARuntime {
    if (!this.runtime.a2a) {
      throw new Error('A2A runtime not configured.');
    }
    return this.runtime.a2a;
  }

  private findBankruptSeat(): RegisteredPlayer | undefined {
    const players = Array.from(this.players.values());
    const broke = players.filter((player) => player.stack <= CHIP_EPSILON);
    const healthy = players.filter((player) => player.stack > CHIP_EPSILON);
    if (broke.length > 0 && healthy.length > 0) {
      return broke[0];
    }
    return undefined;
  }
}
