import type { AgentRuntime } from '@lucid-agents/types/core';
import type { AgentCard, A2ARuntime } from '@lucid-agents/types/a2a';
import { randomUUID } from 'crypto';

import {
  BlackjackRoomConfig,
  ConfigureRoomInput,
  RegisterPlayerInput,
  RegisterPlayerResult,
  RoomEvent,
  RoomSummary,
  StartGameInput,
  registerPlayerResultSchema,
  roomSummarySchema,
} from './protocol';

const CHIP_EPSILON = 1e-6;
type RoomStatus = 'waiting' | 'running' | 'idle' | 'error';

type HandOutcome = 'blackjack' | 'win' | 'push' | 'lose';

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

export class BlackjackRoom {
  private readonly runtime: RoomRuntime;
  private roomId: string;
  private roomConfig?: BlackjackRoomConfig;
  private casinoCallback?: { card: AgentCard; eventSkill: string };
  private casinoName = 'casino-agent';
  private status: RoomStatus = 'waiting';
  private players = new Map<string, RegisteredPlayer>();
  private roundCount = 0;
  private lastMessage?: string;
  private readonly eventLog: RoomEvent[] = [];

  constructor(runtime: RoomRuntime, roomId: string) {
    this.runtime = runtime;
    this.roomId = roomId;
  }

  public async configure(input: ConfigureRoomInput): Promise<RoomSummary> {
    this.roomId = input.roomId;
    this.roomConfig = this.normalizeConfig(input.config);
    this.casinoName = input.casinoName;

    const a2a = this.requireA2ARuntime();
    const casinoCard = await a2a.fetchCard(input.casinoCallback.agentCardUrl);
    this.casinoCallback = { card: casinoCard, eventSkill: input.casinoCallback.eventSkill };

    this.status = 'waiting';
    this.players.clear();
    this.roundCount = 0;
    this.lastMessage = undefined;
    this.eventLog.length = 0;

    await this.publishEvent('room_status', `Blackjack room ${this.roomId} configured.`, {
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
          stack: Number(player.stack.toFixed(2)),
        })),
      handCount: this.roundCount,
      message: this.lastMessage,
    };

    return roomSummarySchema.parse(summary);
  }

  public getEvents(): RoomEvent[] {
    return [...this.eventLog];
  }

  public async registerPlayer(input: RegisterPlayerInput): Promise<RegisterPlayerResult> {
    const config = this.requireConfig();

    if (this.players.size >= config.maxPlayers) {
      throw new Error(`Room ${this.roomId} is full (${config.maxPlayers} seats).`);
    }

    const seatNumber = this.findSeat(input.preferredSeat);
    const a2a = this.requireA2ARuntime();
    const card = await a2a.fetchCard(input.agentCardUrl);

    if (
      this.players.has(input.playerId) ||
      Array.from(this.players.values()).some((player) => player.agentCardUrl === input.agentCardUrl)
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

    await this.publishEvent('player_registered', `${player.displayName} joined the blackjack table.`, {
      playerId: player.id,
      seatNumber,
      stack: player.stack,
    });

    return registerPlayerResultSchema.parse(result);
  }

  public async startGame(input?: StartGameInput): Promise<RoomSummary> {
    const config = this.requireConfig();
    if (!this.players.size) {
      throw new Error('At least one player is required to start blackjack.');
    }
    if (this.status === 'running') {
      throw new Error('Blackjack session already running.');
    }

    const roundsRequested = Math.min(input?.rounds ?? config.roundsPerSession, 100);
    const orderedPlayers = this.getOrderedPlayers();

    this.status = 'running';
    this.lastMessage = undefined;
    await this.publishEvent(
      'hand_started',
      `Starting ${roundsRequested} round${roundsRequested === 1 ? '' : 's'} at ${this.roomId}.`,
      { roundsRequested },
    );

    let roundsCompleted = 0;

    try {
      for (let round = 0; round < roundsRequested; round += 1) {
        let active = false;
        for (const player of orderedPlayers) {
          if (player.stack < config.minBet - CHIP_EPSILON) {
            continue;
          }
          active = true;
          const bet = this.determineBet(player.stack, config);
          const outcome = this.resolveHand(config);
          const delta = this.applyOutcome(player, bet, outcome, config.blackjackPayout);
          const payload = {
            playerId: player.id,
            seatNumber: player.seatNumber,
            bet,
            outcome,
            delta,
            stack: Number(player.stack.toFixed(2)),
          };
          const description = this.describeOutcome(player.displayName, outcome, bet, delta);
          await this.publishEvent('action_taken', description, payload);
          if (player.stack <= CHIP_EPSILON) {
            player.stack = 0;
            await this.publishEvent('player_busted', `${player.displayName} is out of chips.`, {
              playerId: player.id,
            });
          }
        }
        if (!active) {
          break;
        }
        roundsCompleted += 1;
        this.roundCount += 1;
      }

      this.status = 'idle';
      this.lastMessage = `Completed ${roundsCompleted} round${roundsCompleted === 1 ? '' : 's'}.`;
      await this.publishEvent('hand_completed', this.lastMessage, {
        roundsCompleted,
      });
    } catch (error) {
      this.status = 'error';
      this.lastMessage = error instanceof Error ? error.message : 'Unknown blackjack error.';
      await this.publishEvent('room_error', this.lastMessage);
      throw error;
    } finally {
      if (this.status === 'running') {
        this.status = 'idle';
      }
    }

    return this.getSummary();
  }

  private determineBet(stack: number, config: BlackjackRoomConfig): number {
    const bet = Math.min(config.maxBet, Math.max(config.minBet, stack * 0.1));
    return Number(Math.min(bet, stack).toFixed(2));
  }

  private resolveHand(config: BlackjackRoomConfig): HandOutcome {
    const roll = Math.random();
    const blackjackChance = Math.min(0.05 * config.deckCount, 0.15);
    const winChance = 0.45;
    const pushChance = 0.15;

    if (roll < blackjackChance) {
      return 'blackjack';
    }
    if (roll < blackjackChance + winChance) {
      return 'win';
    }
    if (roll < blackjackChance + winChance + pushChance) {
      return 'push';
    }
    return 'lose';
  }

  private applyOutcome(player: RegisteredPlayer, bet: number, outcome: HandOutcome, payout: number): number {
    let delta = 0;
    switch (outcome) {
      case 'blackjack':
        delta = bet * payout;
        break;
      case 'win':
        delta = bet;
        break;
      case 'push':
        delta = 0;
        break;
      case 'lose':
        delta = -bet;
        break;
    }
    player.stack += delta;
    return Number(delta.toFixed(2));
  }

  private describeOutcome(playerName: string, outcome: HandOutcome, bet: number, delta: number): string {
    switch (outcome) {
      case 'blackjack':
        return `${playerName} hit blackjack on a ${bet.toFixed(2)} bet and won ${delta.toFixed(2)}.`;
      case 'win':
        return `${playerName} beat the dealer for ${delta.toFixed(2)} on a ${bet.toFixed(2)} bet.`;
      case 'push':
        return `${playerName} pushed their ${bet.toFixed(2)} bet.`;
      case 'lose':
      default:
        return `${playerName} lost ${(-delta).toFixed(2)} on a ${bet.toFixed(2)} bet.`;
    }
  }

  private findSeat(preferred?: number): number {
    if (typeof preferred === 'number' && preferred >= 0 && Number.isInteger(preferred)) {
      const seatTaken = Array.from(this.players.values()).some((player) => player.seatNumber === preferred);
      if (!seatTaken) {
        return preferred;
      }
    }

    const occupied = new Set(Array.from(this.players.values()).map((player) => player.seatNumber));
    let seat = 0;
    while (occupied.has(seat)) {
      seat += 1;
    }
    return seat;
  }

  private getOrderedPlayers(): RegisteredPlayer[] {
    return Array.from(this.players.values()).sort((a, b) => a.seatNumber - b.seatNumber);
  }

  private normalizeConfig(config: BlackjackRoomConfig): BlackjackRoomConfig {
    if (config.maxBet < config.minBet) {
      return {
        ...config,
        maxBet: config.minBet,
      };
    }
    return config;
  }

  private async publishEvent(eventType: RoomEvent['eventType'], message: string, payload?: Record<string, unknown>) {
    const event: RoomEvent = {
      roomId: this.roomId,
      eventType,
      message,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.eventLog.push(event);
    if (this.eventLog.length > 200) {
      this.eventLog.shift();
    }

    await this.sendCasinoEvent(event);
  }

  private async sendCasinoEvent(event: RoomEvent): Promise<void> {
    if (!this.casinoCallback) {
      return;
    }
    try {
      const a2a = this.requireA2ARuntime();
      await a2a.client.invoke(this.casinoCallback.card, this.casinoCallback.eventSkill, event);
    } catch (error) {
      console.warn('[blackjack-room] Failed to emit casino event', error);
    }
  }

  private requireA2ARuntime(): A2ARuntime {
    if (!this.runtime.a2a) {
      throw new Error('Blackjack room requires the A2A extension.');
    }
    return this.runtime.a2a;
  }

  private requireConfig(): BlackjackRoomConfig {
    if (!this.roomConfig) {
      throw new Error('Room is not configured.');
    }
    return this.roomConfig;
  }
}
