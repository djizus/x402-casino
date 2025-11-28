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
import { cardToString } from './cards';
import { describeHand } from './hand-evaluator';
import { Table } from './engine/table';
import { DealerAction, type DealerActionRange, type PotResolution } from './engine/dealer';
import { RoundOfBetting } from './engine/community-cards';

type RoomStatus = 'waiting' | 'running' | 'idle' | 'error' | 'ended';
const CHIP_EPSILON = 1e-6;
type HandStage = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

interface RegisteredPlayer {
  id: string;
  seatNumber: number;
  displayName: string;
  actionSkill: string;
  agentCardUrl: string;
  stack: number;
  card: AgentCard;
}
type BettingState = {
  pot: number;
  contributions: Map<string, number>;
  folded: Set<string>;
  roundBets: Map<string, number>;
  currentBet: number;
};

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
  private buttonSeat = -1;
  private table?: Table;
  private readonly seatAssignments = new Map<number, string>();

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
    this.seatAssignments.clear();
    this.handCount = 0;
    this.lastMessage = undefined;
    this.eventLog.length = 0;
    this.buttonSeat = -1;
    this.table = new Table(
      {
        blinds: {
          small: input.config.smallBlind,
          big: input.config.bigBlind,
        },
      },
      input.config.maxPlayers,
    );

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
    const table = this.ensureTable();

    if (this.players.size >= this.roomConfig.maxPlayers) {
      throw new Error(`Room ${this.roomId} is full (${this.roomConfig.maxPlayers} players max).`);
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

    table.sitDown(seatNumber, input.startingStack);
    this.seatAssignments.set(seatNumber, player.id);
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
    if (this.status === 'ended') {
      throw new Error('This room has already ended.');
    }

    const config: RoomConfig = {
      ...this.roomConfig,
      ...(overrides ?? {}),
    } as RoomConfig;

    const table = this.ensureTable();
    table.setForcedBets({
      blinds: { small: config.smallBlind, big: config.bigBlind },
    });

    this.status = 'running';
    this.lastMessage = undefined;
    await this.publishEvent('hand_started', `Starting winner-takes-all session at ${this.roomId}.`, {});

    const initialHandCount = this.handCount;
    try {
      while (this.players.size > 1) {
        await this.playHand(config);
        this.handCount += 1;
        const bustedSeat = this.findBankruptSeat();
        if (bustedSeat) {
          await this.publishEvent('player_busted', `${bustedSeat.displayName} is out of chips.`, {
            playerId: bustedSeat.id,
          });
          this.table?.standUp(bustedSeat.seatNumber);
          this.seatAssignments.delete(bustedSeat.seatNumber);
          this.players.delete(bustedSeat.id);
        }
      }

      const handsPlayed = this.handCount - initialHandCount;
      if (this.players.size === 1) {
        const winner = Array.from(this.players.values())[0];
        this.status = 'ended';
        this.lastMessage = `${winner.displayName} won the table.`;
        await this.publishEvent('room_ended', this.lastMessage, {
          winnerId: winner.id,
          stack: winner.stack,
        });
      } else {
        this.status = 'idle';
        this.lastMessage = `Stopped after ${handsPlayed} hand${handsPlayed === 1 ? '' : 's'}.`;
        await this.publishEvent('hand_completed', this.lastMessage, { handsPlayed });
      }
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
    const table = this.ensureTable();
    const bettingState: BettingState = {
      pot: 0,
      contributions: new Map<string, number>(),
      folded: new Set<string>(),
      roundBets: new Map<string, number>(),
      currentBet: 0,
    };

    table.startHand();
    this.buttonSeat = table.button();
    this.syncStacksFromHand(table);
    await this.publishHandStage('preflop', table.communityCardsSnapshot());
    await this.playBettingRound('preflop', table, config, bettingState, true);

    while (!table.bettingRoundsCompleted()) {
      const stage = this.toHandStage(table.roundOfBetting());
      await this.publishHandStage(stage, table.communityCardsSnapshot());
      await this.playBettingRound(stage, table, config, bettingState, false);
    }

    const communityCards = table.communityCardsSnapshot();
    const showdownCards = table.holeCardsSnapshot();
    const resolutions = table.showdown();
    this.syncStacksFromTable();
    await this.publishShowdown(communityCards, showdownCards, resolutions);
    await this.publishHandStage('showdown', communityCards);

    this.lastMessage = `Hand #${this.handCount + 1} completed. Community cards: ${communityCards
      .map(cardToString)
      .join(' ')}`;
  }

  private async playBettingRound(
    stage: BettingRound,
    table: Table,
    config: RoomConfig,
    state: BettingState,
    includeExistingBets: boolean,
  ): Promise<void> {
    this.prepareRoundState(state, table, includeExistingBets);

    while (table.bettingRoundInProgress()) {
      const seatIndex = table.playerToAct();
      const seat = this.getSeatPlayer(seatIndex);
      if (!seat) {
        table.applyAction(DealerAction.FOLD);
        continue;
      }

      const holeCards = table.holeCardsSnapshot()[seatIndex];
      if (!holeCards || holeCards.length === 0) {
        table.applyAction(DealerAction.FOLD);
        continue;
      }

      const roundContribution = state.roundBets.get(seat.id) ?? 0;
      const amountToCall = Math.max(0, state.currentBet - roundContribution);
      const seatState = this.getHandSeatState(table, seatIndex);
      const seatStack = seatState?.stack ?? seat.stack;
      const range = table.legalActions();
      const legalActions = this.actionMaskToLabels(range);

      const actionRequest = actionRequestSchema.parse({
        roomId: this.roomId,
        bettingRound: stage,
        communityCards: table.communityCardsSnapshot(),
        holeCards,
        pot: state.pot,
        minimumRaise: config.smallBlind,
        currentBet: amountToCall,
        playerStack: seatStack,
        legalActions,
      });

      const result = await this.requireA2ARuntime().client.invoke(seat.card, seat.actionSkill, actionRequest);
      const action = actionResponseSchema.parse(result.output ?? {});
      const resolved = await this.applyAction({
        seat,
        action,
        stage,
        state,
        allowedActions: legalActions,
        table,
        seatIndex,
        amountToCall,
        communityCards: table.communityCardsSnapshot(),
        range,
      });

      if (resolved === 'bet' || resolved === 'raise') {
        // reset action count equivalent by restarting loop
      }
    }

    table.endBettingRound();
  }

  private async applyAction(params: {
    seat: RegisteredPlayer;
    action: { action: string; amount?: number; message?: string };
    stage: BettingRound;
    state: BettingState;
    allowedActions: string[];
    table: Table;
    seatIndex: number;
    amountToCall: number;
    communityCards: Card[];
    range: DealerActionRange;
  }): Promise<'fold' | 'call' | 'check' | 'bet' | 'raise'> {
    const { seat, action, stage, state, allowedActions, table, seatIndex, amountToCall, communityCards, range } = params;

    const seatState = this.getHandSeatState(table, seatIndex);
    const available = seatState?.stack ?? seat.stack;

    const notify = async (message: string, payload?: Record<string, unknown>) => {
      this.lastMessage = message;
      await this.publishEvent('action_taken', message, {
        playerId: seat.id,
        playerName: seat.displayName,
        seatNumber: seat.seatNumber,
        stage,
        communityCards: communityCards.map(cardToString),
        currentBet: state.currentBet,
        legalActions: allowedActions,
        ...(action.message ? { agentMessage: action.message } : {}),
        ...payload,
      });
    };

    const allow = (name: string) => allowedActions.includes(name);
    let requestedAction = action.action;
    if (requestedAction === 'all-in') {
      requestedAction = amountToCall > 0 ? 'raise' : 'bet';
    }

    let normalizedAction = requestedAction;
    if (!allow(requestedAction)) {
      if ((requestedAction === 'check' || requestedAction === 'bet' || requestedAction === 'raise') && allow('call')) {
        normalizedAction = 'call';
      } else if (allow('check')) {
        normalizedAction = 'check';
      } else if (allow('call')) {
        normalizedAction = 'call';
      } else if (allow('fold')) {
        normalizedAction = 'fold';
      }
    }

    const contribution = state.roundBets.get(seat.id) ?? 0;

    const updateStacks = (delta: number) => {
      if (delta <= 0) {
        return;
      }
      state.contributions.set(seat.id, (state.contributions.get(seat.id) ?? 0) + delta);
      state.roundBets.set(seat.id, contribution + delta);
      state.pot += delta;
      state.currentBet = Math.max(state.currentBet, contribution + delta);
    };

    switch (normalizedAction) {
      case 'fold':
        state.folded.add(seat.id);
        table.applyAction(DealerAction.FOLD);
        await notify(`${seat.displayName} folded during ${stage}.`, {
          pot: state.pot,
          playerStack: seat.stack,
        });
        return 'fold';
      case 'bet':
      case 'raise': {
        const requestedDelta = typeof action.amount === 'number' && Number.isFinite(action.amount) ? action.amount : available;
        const boundedDelta = Math.max(0, Math.min(requestedDelta, available));
        let targetTotal = contribution + boundedDelta;
        if (range.chipRange) {
          targetTotal = Math.max(range.chipRange.min, targetTotal);
          targetTotal = Math.min(range.chipRange.max, targetTotal);
        } else {
          targetTotal = Math.min(contribution + available, targetTotal);
        }
        const delta = Math.max(0, targetTotal - contribution);
        if (delta <= 0) {
          table.applyAction(DealerAction.CHECK);
          await notify(`${seat.displayName} checked during ${stage}.`, {
            pot: state.pot,
            playerStack: seat.stack,
          });
          return 'check';
        }
        table.applyAction(normalizedAction === 'raise' ? DealerAction.RAISE : DealerAction.BET, targetTotal);
        updateStacks(delta);
        this.syncStacksFromHand(table);
        await notify(`${seat.displayName} ${normalizedAction} ${delta} during ${stage}.`, {
          amount: delta,
          pot: state.pot,
          playerStack: seat.stack,
        });
        return normalizedAction;
      }
      case 'call': {
        if (amountToCall <= 0 && allow('check')) {
          table.applyAction(DealerAction.CHECK);
          await notify(`${seat.displayName} checked during ${stage}.`, {
            pot: state.pot,
            playerStack: seat.stack,
          });
          return 'check';
        }
        const callAmount = Math.min(amountToCall, available);
        table.applyAction(DealerAction.CALL);
        updateStacks(callAmount);
        if (callAmount > 0) {
          this.syncStacksFromHand(table);
          await notify(`${seat.displayName} called ${callAmount} during ${stage}.`, {
            amount: callAmount,
            pot: state.pot,
            playerStack: seat.stack,
          });
          return 'call';
        }
        await notify(`${seat.displayName} checked during ${stage}.`, {
          pot: state.pot,
          playerStack: seat.stack,
        });
        return 'check';
      }
      case 'check':
      default:
        table.applyAction(DealerAction.CHECK);
        await notify(`${seat.displayName} checked during ${stage}.`, {
          pot: state.pot,
          playerStack: seat.stack,
        });
        return 'check';
    }
  }

  private prepareRoundState(state: BettingState, table: Table, includeExistingBets: boolean): void {
    state.roundBets.clear();
    state.currentBet = 0;
    if (includeExistingBets) {
      const seatStates = table.handSeatStates();
      seatStates.forEach((seatState, seatIndex) => {
        if (!seatState || seatState.betSize <= 0) {
          return;
        }
        const player = this.getSeatPlayer(seatIndex);
        if (!player) {
          return;
        }
        state.roundBets.set(player.id, seatState.betSize);
        state.contributions.set(player.id, (state.contributions.get(player.id) ?? 0) + seatState.betSize);
        state.currentBet = Math.max(state.currentBet, seatState.betSize);
      });
    }
    state.pot = this.computePot(state);
  }

  private actionMaskToLabels(range: DealerActionRange): string[] {
    const labels: string[] = [];
    if (range.actionMask & DealerAction.FOLD) {
      labels.push('fold');
    }
    if (range.actionMask & DealerAction.CHECK) {
      labels.push('check');
    }
    if (range.actionMask & DealerAction.CALL) {
      labels.push('call');
    }
    if (range.actionMask & DealerAction.BET) {
      labels.push('bet');
    }
    if (range.actionMask & DealerAction.RAISE) {
      labels.push('raise');
    }
    return labels;
  }

  private computePot(state: BettingState): number {
    let total = 0;
    state.contributions.forEach((value) => {
      total += value;
    });
    return total;
  }

  private toHandStage(round: RoundOfBetting): BettingRound {
    switch (round) {
      case RoundOfBetting.FLOP:
        return 'flop';
      case RoundOfBetting.TURN:
        return 'turn';
      case RoundOfBetting.RIVER:
        return 'river';
      case RoundOfBetting.PREFLOP:
      default:
        return 'preflop';
    }
  }

  private async publishShowdown(
    communityCards: Card[],
    showdownCards: (Card[] | null)[],
    resolutions: PotResolution[],
  ): Promise<void> {
    const handNumber = this.handCount + 1;
    const totalPot = resolutions.reduce((sum, resolution) => sum + resolution.pot.size(), 0);
    const showdownHands = Array.from(this.players.values())
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((player) => ({
        playerId: player.id,
        displayName: player.displayName,
        cards: (showdownCards[player.seatNumber] ?? []).map(cardToString),
      }));

    const winningHands = resolutions.flatMap((resolution) =>
      resolution.winners.map((winner) => {
        const player = this.getSeatPlayer(winner.seatIndex);
        return {
          playerId: player?.id,
          displayName: player?.displayName ?? `Seat ${winner.seatIndex}`,
          cards: winner.holeCards.map(cardToString),
          amountWon: winner.share,
          description: describeHand(winner.score),
        };
      }),
    );

    const winnerDescription =
      winningHands.length > 0
        ? winningHands.map((hand) => `${hand.displayName} (${hand.description})`).join(', ')
        : 'No contest';
    this.lastMessage = `Pot ${totalPot} awarded to ${winnerDescription}.`;

    await this.publishEvent('hand_completed', this.lastMessage, {
      pot: totalPot,
      communityCards: communityCards.map(cardToString),
      winningHands,
      showdownHands,
      handNumber,
    });
  }

  private getSeatPlayer(seatIndex: number): RegisteredPlayer | undefined {
    const playerId = this.seatAssignments.get(seatIndex);
    if (!playerId) {
      return undefined;
    }
    return this.players.get(playerId);
  }

  private getHandSeatState(table: Table, seatIndex: number) {
    const states = table.handSeatStates();
    return states[seatIndex] ?? null;
  }

  private syncStacksFromHand(table: Table): void {
    const states = table.handSeatStates();
    states.forEach((seatState, seatIndex) => {
      if (!seatState) {
        return;
      }
      const player = this.getSeatPlayer(seatIndex);
      if (player) {
        player.stack = seatState.stack;
      }
    });
  }

  private syncStacksFromTable(): void {
    const table = this.table;
    if (!table) {
      return;
    }
    const states = table.seatStates();
    states.forEach((seatState, seatIndex) => {
      if (!seatState) {
        return;
      }
      const player = this.getSeatPlayer(seatIndex);
      if (player) {
        player.stack = seatState.stack;
      }
    });
  }

  private ensureTable(): Table {
    if (!this.table) {
      throw new Error('Room is not configured.');
    }
    return this.table;
  }

  private async publishHandStage(stage: HandStage, cards: Card[]): Promise<void> {
    const descriptors = {
      flop: 'Dealt the flop',
      turn: 'Dealt the turn',
      river: 'Dealt the river',
      showdown: 'Showdown',
      preflop: 'Starting preflop',
    } as const;
    const cardsLabel = cards.map(cardToString).join(' ') || '—';
    await this.publishEvent(
      'hand_status',
      `${descriptors[stage]}${stage === 'preflop' ? '' : `: ${cardsLabel}`}.`,
      {
        stage,
        communityCards: cards.map(cardToString),
        buttonSeat: this.buttonSeat,
      },
    );
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
