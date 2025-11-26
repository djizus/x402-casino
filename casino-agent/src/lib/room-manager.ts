import { randomUUID } from 'crypto';

import type { AgentCard, A2ARuntime } from '@lucid-agents/types/a2a';
import type { AgentRuntime } from '@lucid-agents/types/core';

import {
  CreateRoomInput,
  RegisterPlayerInput,
  RegisterPlayerResult,
  RoomSnapshot,
  RoomSummary,
  StartRoomInput,
  TableConfig,
  TableEvent,
  TableSummary,
  playerSignupResponseSchema,
  registerPlayerResultSchema,
  roomSnapshotSchema,
  roomSummarySchema,
  signupInvitationSchema,
  tableEventSchema,
  tableSummarySchema,
} from './protocol';
import { TableLauncher } from './table-launcher';

export type CasinoRuntime = AgentRuntime & {
  a2a?: A2ARuntime;
};

type TableAgentSkills = {
  configure: string;
  register: string;
  start: string;
  summary: string;
};

interface TableAgentHandle {
  cardUrl: string;
  card: AgentCard;
  skills: TableAgentSkills;
}

interface TableProcessHandle {
  stop: () => void;
  baseUrl: string;
}

interface RoomState {
  roomId: string;
  tableId: string;
  gameType: 'poker';
  config: TableConfig;
  tableAgent: TableAgentHandle;
  tableBaseUrl?: string;
  tableProcess?: TableProcessHandle;
  summary?: TableSummary;
  events: TableEvent[];
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomState>();
  private readonly runtime: CasinoRuntime;
  private readonly casinoName: string;
  private readonly callback: { agentCardUrl: string; eventSkill: string };
  private readonly tableLauncher?: TableLauncher;

  constructor(
    runtime: CasinoRuntime,
    casinoName: string,
    callback: { agentCardUrl: string; eventSkill: string },
    options?: { tableLauncher?: TableLauncher },
  ) {
    this.runtime = runtime;
    this.casinoName = casinoName;
    this.callback = callback;
    this.tableLauncher = options?.tableLauncher;
  }

  public listRooms(): RoomSummary[] {
    return Array.from(this.rooms.values()).map((room) => this.toSummary(room));
  }

  public async refreshAllRooms(): Promise<void> {
    await Promise.all(
      Array.from(this.rooms.values()).map(async (room) => {
        try {
          await this.refreshSummary(room);
        } catch (error) {
          room.summary = {
            tableId: room.tableId,
            status: 'error',
            handCount: room.summary?.handCount ?? 0,
            players: room.summary?.players ?? [],
            message: error instanceof Error ? error.message : 'Failed to fetch table summary.',
          };
        }
      }),
    );
  }

  public async createRoom(input: CreateRoomInput): Promise<RoomSnapshot> {
    const roomId = input.roomId ?? `room-${randomUUID()}`;
    const tableId = input.tableId ?? roomId;
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists.`);
    }

    const a2a = this.ensureA2A();
    let tableCardUrl = input.tableAgentCardUrl;
    let tableBaseUrl: string | undefined;
    let tableProcess: TableProcessHandle | undefined;

    if (!tableCardUrl) {
      if (!this.tableLauncher) {
        throw new Error('tableAgentCardUrl is required when no table launcher is configured.');
      }
      const launched = await this.tableLauncher.launch(roomId, tableId, { port: input.launchOptions?.port });
      tableCardUrl = launched.cardUrl;
      tableBaseUrl = launched.baseUrl;
      tableProcess = {
        stop: launched.stop,
        baseUrl: launched.baseUrl,
      };
    }

    if (!tableBaseUrl) {
      try {
        const parsed = new URL(tableCardUrl);
        tableBaseUrl = `${parsed.protocol}//${parsed.host}`;
      } catch {
        // best effort
      }
    }

    const tableCard = await a2a.fetchCard(tableCardUrl);
    const skills: TableAgentSkills = {
      configure: input.tableAgentSkills.configure,
      register: input.tableAgentSkills.register,
      start: input.tableAgentSkills.start,
      summary: input.tableAgentSkills.summary,
    };

    try {
      await a2a.client.invoke(tableCard, skills.configure, {
        tableId,
        casinoName: this.casinoName,
        config: input.config,
        casinoCallback: {
          agentCardUrl: this.callback.agentCardUrl,
          eventSkill: this.callback.eventSkill,
        },
      });
    } catch (error) {
      tableProcess?.stop();
      throw error;
    }

    const room: RoomState = {
      roomId,
      tableId,
      gameType: 'poker',
      config: input.config,
      tableAgent: {
        cardUrl: tableCardUrl,
        card: tableCard,
        skills,
      },
      tableBaseUrl,
      tableProcess,
      summary: undefined,
      events: [],
    };

    try {
      await this.refreshSummary(room);
    } catch (error) {
      tableProcess?.stop();
      throw error;
    }
    this.rooms.set(roomId, room);
    return this.toSnapshot(room);
  }

  public async registerPlayer(input: RegisterPlayerInput): Promise<RegisterPlayerResult> {
    const room = this.requireRoom(input.roomId);
    const a2a = this.ensureA2A();

    const playerCard = await a2a.fetchCard(input.agentCardUrl);
    const invitation = signupInvitationSchema.parse({
      casinoName: this.casinoName,
      tableId: room.tableId,
      roomId: room.roomId,
      minBuyIn: room.config.minBuyIn,
      maxBuyIn: room.config.maxBuyIn,
      smallBlind: room.config.smallBlind,
      bigBlind: room.config.bigBlind,
    });

    const signupResult = await a2a.client.invoke(playerCard, input.signupSkill, invitation);
    const signup = playerSignupResponseSchema.parse(signupResult.output ?? {});
    const buyIn = this.clampBuyIn(signup.buyIn ?? room.config.startingStack, room.config);
    const actionSkill = input.actionSkill ?? signup.actionSkill ?? 'act';
    const playerId = randomUUID();

    const registerPayload = {
      playerId,
      displayName: signup.displayName,
      agentCardUrl: input.agentCardUrl,
      actionSkill,
      startingStack: buyIn,
      preferredSeat: input.preferredSeat,
    };

    const result = await a2a.client.invoke(room.tableAgent.card, room.tableAgent.skills.register, registerPayload);
    const parsed = registerPlayerResultSchema.parse({
      roomId: room.roomId,
      ...(result.output ?? {}),
    });

    await this.refreshSummary(room);
    return parsed;
  }

  public async startRoom(input: StartRoomInput): Promise<TableSummary> {
    const room = this.requireRoom(input.roomId);
    const a2a = this.ensureA2A();

    const payload = {
      ...(input.overrides ?? {}),
    };
    const result = await a2a.client.invoke(room.tableAgent.card, room.tableAgent.skills.start, payload);
    const summary = tableSummarySchema.parse(result.output ?? {});
    room.summary = summary;
    return summary;
  }

  public async refreshRoom(roomId: string): Promise<RoomSnapshot> {
    const room = this.requireRoom(roomId);
    await this.refreshSummary(room);
    return this.toSnapshot(room);
  }

  public async recordEvent(event: TableEvent): Promise<void> {
    const parsed = tableEventSchema.parse(event);
    const room = this.findRoomByTableId(parsed.tableId);
    if (!room) {
      return;
    }
    room.events.push(parsed);
    if (room.events.length > 200) {
      room.events.shift();
    }
  }

  public getRoomSnapshot(roomId: string): RoomSnapshot {
    const room = this.requireRoom(roomId);
    return this.toSnapshot(room);
  }

  private clampBuyIn(value: number, config: TableConfig): number {
    if (!Number.isFinite(value)) {
      return config.startingStack;
    }
    return Math.min(Math.max(value, config.minBuyIn), config.maxBuyIn);
  }

  private toSummary(room: RoomState): RoomSummary {
    const summary: RoomSummary = {
      roomId: room.roomId,
      tableId: room.tableId,
      gameType: room.gameType,
      tableAgentCardUrl: room.tableAgent.cardUrl,
      tableBaseUrl: room.tableBaseUrl,
      status: room.summary?.status ?? 'waiting',
      handCount: room.summary?.handCount ?? 0,
      playerCount: room.summary?.players.length ?? 0,
      message: room.summary?.message,
    };
    return roomSummarySchema.parse(summary);
  }

  private toSnapshot(room: RoomState): RoomSnapshot {
    const snapshot: RoomSnapshot = {
      roomId: room.roomId,
      config: room.config,
      summary: room.summary,
      tableAgentCardUrl: room.tableAgent.cardUrl,
      tableBaseUrl: room.tableBaseUrl,
      events: [...room.events],
    };
    return roomSnapshotSchema.parse(snapshot);
  }

  public async shutdown(): Promise<void> {
    for (const room of this.rooms.values()) {
      room.tableProcess?.stop();
    }
  }

  private ensureA2A(): A2ARuntime {
    if (!this.runtime.a2a) {
      throw new Error('Casino agent needs the A2A extension.');
    }
    return this.runtime.a2a;
  }

  private requireRoom(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found.`);
    }
    return room;
  }

  private findRoomByTableId(tableId: string): RoomState | undefined {
    return Array.from(this.rooms.values()).find((room) => room.tableId === tableId);
  }

  private async refreshSummary(room: RoomState): Promise<void> {
    const a2a = this.ensureA2A();
    const result = await a2a.client.invoke(room.tableAgent.card, room.tableAgent.skills.summary, {});
    room.summary = tableSummarySchema.parse(result.output ?? {});
  }
}
