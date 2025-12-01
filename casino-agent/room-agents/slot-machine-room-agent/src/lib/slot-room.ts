import type { AgentRuntime } from '@lucid-agents/types/core';
import type { AgentCard, A2ARuntime } from '@lucid-agents/types/a2a';
import { randomUUID } from 'crypto';

import {
  ConfigureRoomInput,
  RegisterPlayerInput,
  RegisterPlayerResult,
  RoomSummary,
  SlotRoomConfig,
  StartGameInput,
  RoomEvent,
  registerPlayerResultSchema,
  roomSummarySchema,
} from './protocol';

const DEFAULT_SYMBOLS = ['cherry', 'lemon', 'plum', 'bell', 'star', 'seven'];
type RoomStatus = 'waiting' | 'running' | 'idle' | 'error';

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

export class SlotMachineRoom {
  private readonly runtime: RoomRuntime;
  private roomId: string;
  private roomConfig?: SlotRoomConfig;
  private casinoCallback?: { card: AgentCard; eventSkill: string };
  private casinoName = 'casino-agent';
  private status: RoomStatus = 'waiting';
  private players = new Map<string, RegisteredPlayer>();
  private spinCount = 0;
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
    this.spinCount = 0;
    this.lastMessage = undefined;
    this.eventLog.length = 0;

    await this.publishEvent('room_status', `Slot room ${this.roomId} configured.`, {
      casinoName: this.casinoName,
      config: this.roomConfig,
    });

    return this.getSummary();
  }

  public getSummary(): RoomSummary {
    const summary: RoomSummary = {
      roomId: this.roomId,
      status: this.status,
      handCount: this.spinCount,
      players: Array.from(this.players.values())
        .sort((a, b) => a.seatNumber - b.seatNumber)
        .map((player) => ({
          playerId: player.id,
          seatNumber: player.seatNumber,
          displayName: player.displayName,
          stack: Number(player.stack.toFixed(4)),
        })),
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
      throw new Error(`Room ${this.roomId} is full (${config.maxPlayers} max players).`);
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

    await this.publishEvent('player_registered', `${player.displayName} joined the slot room.`, {
      playerId: player.id,
      seatNumber,
      stack: player.stack,
    });

    return registerPlayerResultSchema.parse(result);
  }

  public async startGame(input?: StartGameInput): Promise<RoomSummary> {
    const config = this.requireConfig();
    if (!this.players.size) {
      throw new Error('At least one player is required to start the slot machine.');
    }
    if (this.status === 'running') {
      throw new Error('Slots are already spinning.');
    }

    const spinsRequested = input?.spins ?? config.maxSpins;
    const orderedPlayers = this.getOrderedPlayers();

    this.status = 'running';
    this.lastMessage = undefined;
    await this.publishEvent(
      'hand_started',
      `Running ${spinsRequested} spin${spinsRequested === 1 ? '' : 's'} for room ${this.roomId}.`,
      { spinsRequested },
    );

    let spinsExecuted = 0;
    const bustedPlayers = new Set<string>();

    try {
      for (let spinIndex = 0; spinIndex < spinsRequested; spinIndex += 1) {
        const player = orderedPlayers[spinIndex % orderedPlayers.length];
        const outcome = this.executeSpin(player, config);
        await this.publishEvent('action_taken', outcome.message, outcome.payload);
        if (outcome.played) {
          spinsExecuted += 1;
          this.spinCount += 1;
        }
        if (outcome.busted && !bustedPlayers.has(player.id)) {
          bustedPlayers.add(player.id);
          await this.publishEvent('player_busted', `${player.displayName} is out of credits.`, {
            playerId: player.id,
          });
        }
      }

      this.lastMessage = `Completed ${spinsExecuted} spin${spinsExecuted === 1 ? '' : 's'}.`;
      this.status = 'idle';
      await this.publishEvent('hand_completed', this.lastMessage, { spinsExecuted });
    } catch (error) {
      this.status = 'error';
      this.lastMessage = error instanceof Error ? error.message : 'Unknown slot machine error.';
      await this.publishEvent('room_error', this.lastMessage);
      throw error;
    } finally {
      if (this.status === 'running') {
        this.status = 'idle';
      }
    }

    return this.getSummary();
  }

  private executeSpin(player: RegisteredPlayer, config: SlotRoomConfig): {
    played: boolean;
    message: string;
    payload: Record<string, unknown>;
    busted: boolean;
  } {
    if (player.stack < config.spinCost) {
      return {
        played: false,
        message: `${player.displayName} skipped (needs ${config.spinCost} credits).`,
        payload: {
          playerId: player.id,
          seatNumber: player.seatNumber,
          stack: player.stack,
        },
        busted: player.stack <= 0,
      };
    }

    player.stack -= config.spinCost;
    const reels = this.rollReels(config.reels);
    const uniqueSymbols = new Set(reels);

    let payout = 0;
    if (uniqueSymbols.size === 1) {
      payout = config.spinCost * config.jackpotMultiplier;
    } else if (uniqueSymbols.size <= config.reels - 1) {
      payout = config.spinCost * config.pairMultiplier;
    }

    if (payout > 0) {
      player.stack += payout;
    }

    const busted = player.stack <= 0;
    const payload = {
      playerId: player.id,
      seatNumber: player.seatNumber,
      reels,
      payout,
      stack: Number(player.stack.toFixed(4)),
    };
    const message = payout
      ? `${player.displayName} spun [${reels.join(' ')}] and won ${payout.toFixed(2)} credits.`
      : `${player.displayName} spun [${reels.join(' ')}] and missed.`;

    return {
      played: true,
      message,
      payload,
      busted,
    };
  }

  private rollReels(count: number): string[] {
    const reels: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const symbol = DEFAULT_SYMBOLS[Math.floor(Math.random() * DEFAULT_SYMBOLS.length)];
      reels.push(symbol);
    }
    return reels;
  }

  private getOrderedPlayers(): RegisteredPlayer[] {
    return Array.from(this.players.values()).sort((a, b) => a.seatNumber - b.seatNumber);
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
      console.warn('[slot-room] Failed to emit casino event', error);
    }
  }

  private requireA2ARuntime(): A2ARuntime {
    if (!this.runtime.a2a) {
      throw new Error('Slot machine room requires the A2A extension.');
    }
    return this.runtime.a2a;
  }

  private requireConfig(): SlotRoomConfig {
    if (!this.roomConfig) {
      throw new Error('Room is not configured.');
    }
    return this.roomConfig;
  }
}
