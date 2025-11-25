import { randomUUID } from 'crypto';

import type { AgentCard, A2ARuntime } from '@lucid-agents/types/a2a';
import type { AgentRuntime } from '@lucid-agents/types/core';

import {
  PlayerSeat,
  RegisterPlayerResult,
  SignupInvitation,
  StartGameInput,
  TableSummary,
  BettingRound,
  Card,
  actionRequestSchema,
  actionResponseSchema,
  registerPlayerResultSchema,
  signupInvitationSchema,
  tableSummarySchema,
} from '../../../shared/poker/types';
import { cardToString, createDeck, drawCards, shuffleDeck } from '../../../shared/poker/cards';
import { evaluateBestHand, compareHandScores, describeHand } from '../../../shared/poker/hand-evaluator';

interface RegisteredPlayer extends PlayerSeat {
  card: AgentCard;
}

const statusValues = ['waiting', 'running', 'idle', 'error'] as const;
type TableStatus = (typeof statusValues)[number];

type CasinoRuntime = AgentRuntime & {
  meta: { name: string };
  a2a?: A2ARuntime;
};

export class CasinoTable {
  private readonly runtime: CasinoRuntime;
  private readonly tableId: string;
  private readonly casinoName: string;
  private readonly players = new Map<string, RegisteredPlayer>();
  private status: TableStatus = 'waiting';
  private handCount = 0;
  private lastMessage?: string;
  private readonly eventLog: string[] = [];

  constructor(runtime: CasinoRuntime, tableId = 'table-1', casinoName: string) {
    this.runtime = runtime;
    this.tableId = tableId;
    this.casinoName = casinoName;
  }

  public get id(): string {
    return this.tableId;
  }

  public getSummary(): TableSummary {
    const summary = {
      tableId: this.tableId,
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
    } satisfies TableSummary;

    return tableSummarySchema.parse(summary);
  }

  public getEvents(): string[] {
    return [...this.eventLog];
  }

  public listPlayers(): PlayerSeat[] {
    return Array.from(this.players.values())
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((player) => ({
        id: player.id,
        seatNumber: player.seatNumber,
        displayName: player.displayName,
        actionSkill: player.actionSkill,
        agentCardUrl: player.agentCardUrl,
        stack: player.stack,
      }));
  }

  public registerPlayer(params: {
    card: AgentCard;
    actionSkill: string;
    displayName: string;
    agentCardUrl: string;
    preferredSeat?: number;
    startingStack: number;
  }): RegisterPlayerResult {
    const { card, actionSkill, displayName, agentCardUrl, preferredSeat, startingStack } = params;
    const alreadyRegistered = Array.from(this.players.values()).find(
      (player) => player.agentCardUrl === agentCardUrl || player.displayName === displayName,
    );

    if (alreadyRegistered) {
      throw new Error(`Player ${displayName} is already seated at this table.`);
    }

    const seatNumber = this.findSeat(preferredSeat);
    const playerId = randomUUID();

    const player: RegisteredPlayer = {
      id: playerId,
      seatNumber,
      displayName,
      actionSkill,
      agentCardUrl,
      stack: startingStack,
      card,
    };

    this.players.set(playerId, player);

    const result: RegisterPlayerResult = {
      playerId,
      seatNumber,
      displayName,
      actionSkill,
      stack: player.stack,
    };

    this.recordEvent(`${displayName} joined the table (seat ${seatNumber}).`);

    return registerPlayerResultSchema.parse(result);
  }

  public async startGame(config: StartGameInput): Promise<TableSummary> {
    if (this.players.size < 2) {
      throw new Error('At least two players are required to start a hand.');
    }

    if (this.status === 'running') {
      throw new Error('A hand is already running. Wait for it to finish or stop it.');
    }

    this.status = 'running';
    this.lastMessage = undefined;
    this.recordEvent(`Starting ${config.maxHands} hand${config.maxHands > 1 ? 's' : ''} at table ${this.tableId}.`);

    try {
      for (let handIndex = 0; handIndex < config.maxHands; handIndex += 1) {
        await this.playHand(config);
        this.handCount += 1;
      }
      this.status = 'idle';
      this.lastMessage = `Completed ${config.maxHands} hand${config.maxHands > 1 ? 's' : ''}.`;
      if (this.lastMessage) {
        this.recordEvent(this.lastMessage);
      }
    } catch (error) {
      this.status = 'error';
      this.lastMessage =
        error instanceof Error ? error.message : 'Unknown error occurred while running the game.';
      if (this.lastMessage) {
        this.recordEvent(this.lastMessage);
      }
      throw error;
    } finally {
      if (this.status === 'running') {
        this.status = 'idle';
      }
    }

    return this.getSummary();
  }

  public buildSignupInvitation(config: StartGameInput): SignupInvitation {
    const invitation = {
      casinoName: this.casinoName,
      tableId: this.tableId,
      minBuyIn: config.minBuyIn,
      maxBuyIn: config.maxBuyIn,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
    } satisfies SignupInvitation;

    return signupInvitationSchema.parse(invitation);
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

  private async playHand(config: StartGameInput): Promise<void> {
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

    this.settlePot(seats, holeCards, communityCards, bettingState);

    this.lastMessage = `Hand #${this.handCount + 1} completed. Community cards: ${communityCards
      .map(cardToString)
      .join(' ')}`;
    if (this.lastMessage) {
      this.recordEvent(this.lastMessage);
    }
  }

  private async playBettingRound(
    bettingRound: BettingRound,
    seats: RegisteredPlayer[],
    holeCards: Map<string, Card[]>,
    communityCards: Card[],
    config: StartGameInput,
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

    for (const seat of seats) {
      if (state.folded.has(seat.id) || (holeCards.get(seat.id)?.length ?? 0) === 0) {
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
        tableId: this.tableId,
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
      this.applyAction(seat, action, bettingRound, state);
    }
  }
  private recordEvent(message: string): void {
    const entry = `[${new Date().toISOString()}] ${message}`;
    this.eventLog.push(entry);
    if (this.eventLog.length > 100) {
      this.eventLog.shift();
    }
  }
  private requireA2ARuntime(): A2ARuntime {
    if (!this.runtime.a2a) {
      throw new Error('A2A runtime not configured for the casino agent.');
    }
    return this.runtime.a2a;
  }

  private applyAction(
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
  ): void {
    const setMessage = (message: string) => {
      this.lastMessage = message;
      this.recordEvent(message);
    };

    switch (action.action) {
      case 'fold':
        state.folded.add(seat.id);
        setMessage(`${seat.displayName} folded during ${round}.`);
        break;
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
          setMessage(`${seat.displayName} bet ${amount} during ${round}.`);
        } else {
          setMessage(`${seat.displayName} checked during ${round}.`);
        }
        break;
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
          setMessage(`${seat.displayName} called ${callAmount} during ${round}.`);
        } else {
          setMessage(`${seat.displayName} checked during ${round}.`);
        }
        break;
      }
      case 'check':
      default:
        setMessage(`${seat.displayName} chose to ${action.action} during ${round}.`);
        break;
    }
  }

  private settlePot(
    seats: RegisteredPlayer[],
    holeCards: Map<string, Card[]>,
    communityCards: Card[],
    state: {
      pot: number;
      folded: Set<string>;
    },
  ): void {
    if (state.pot <= 0) {
      this.lastMessage = 'Hand completed with no chips in the pot.';
      this.recordEvent(this.lastMessage);
      return;
    }

    const activeSeats = seats.filter((seat) => !state.folded.has(seat.id));

    if (activeSeats.length === 1) {
      const winner = activeSeats[0];
      winner.stack += state.pot;
      this.lastMessage = `${winner.displayName} wins ${state.pot} (everyone else folded).`;
      this.recordEvent(this.lastMessage);
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
      this.recordEvent('No active players to settle the pot.');
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
    this.recordEvent(this.lastMessage);
  }
}
