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
  RoomConfig,
  RoomEvent,
  RoomState as RoomGameState,
  playerSignupResponseSchema,
  registerPlayerResultSchema,
  roomSnapshotSchema,
  roomSummarySchema,
  signupInvitationSchema,
  roomEventSchema,
  roomStateSchema,
} from './protocol';
import { RoomGameDefinition, RoomAgentSkills } from './room-definitions';

export type CasinoRuntime = AgentRuntime & {
  a2a?: A2ARuntime;
};

interface RoomAgentHandle {
  cardUrl: string;
  card: AgentCard;
  skills: RoomAgentSkills;
}

interface RoomProcessHandle {
  stop: () => void;
  baseUrl: string;
}

interface ManagedRoom {
  roomId: string;
  gameType: string;
  definition: RoomGameDefinition;
  config: RoomConfig;
  roomAgent: RoomAgentHandle;
  roomBaseUrl?: string;
  roomProcess?: RoomProcessHandle;
  summary?: RoomGameState;
  events: RoomEvent[];
}

export class RoomManager {
  private readonly rooms = new Map<string, ManagedRoom>();
  private readonly runtime: CasinoRuntime;
  private readonly casinoName: string;
  private readonly callback: { agentCardUrl: string; eventSkill: string };
  private readonly games: Map<string, RoomGameDefinition>;
  private readonly defaultGameType: string;

  constructor(
    runtime: CasinoRuntime,
    casinoName: string,
    callback: { agentCardUrl: string; eventSkill: string },
    options: { games: Map<string, RoomGameDefinition>; defaultGameType?: string },
  ) {
    this.runtime = runtime;
    this.casinoName = casinoName;
    this.callback = callback;
    this.games = options.games;
    this.defaultGameType = options.defaultGameType ?? 'poker';
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
            roomId: room.roomId,
            status: 'error',
            handCount: room.summary?.handCount ?? 0,
            players: room.summary?.players ?? [],
            message: error instanceof Error ? error.message : 'Failed to fetch room summary.',
          };
        }
      }),
    );
  }

  public async createRoom(input: CreateRoomInput): Promise<RoomSnapshot> {
    const roomId = input.roomId ?? `room-${randomUUID()}`;
    if (this.rooms.has(roomId)) {
      throw new Error(`Room ${roomId} already exists.`);
    }

    const gameType = input.gameType ?? this.defaultGameType;
    const definition = this.requireGame(gameType);
    const rawConfig = typeof input.config === 'object' && input.config ? input.config : undefined;
    const normalizedConfig = definition.normalizeConfig(rawConfig, definition.defaultConfig);
    const config = definition.configSchema.parse(normalizedConfig);

    const a2a = this.ensureA2A();
    let roomAgentCardUrl = input.roomAgentCardUrl ?? definition.roomAgent.defaultCardUrl;
    let roomBaseUrl: string | undefined;
    let roomProcess: RoomProcessHandle | undefined;

    if (!roomAgentCardUrl) {
      const launcher = definition.roomAgent.launcher;
      if (!launcher) {
        throw new Error(`roomAgentCardUrl is required for ${definition.type} rooms when no launcher is configured.`);
      }
      const launched = await launcher.launch(roomId, { port: input.launchOptions?.port });
      roomAgentCardUrl = launched.cardUrl;
      roomBaseUrl = launched.baseUrl;
      roomProcess = {
        stop: launched.stop,
        baseUrl: launched.baseUrl,
      };
    }

    if (!roomBaseUrl) {
      try {
        const parsed = new URL(roomAgentCardUrl);
        roomBaseUrl = `${parsed.protocol}//${parsed.host}`;
      } catch {
        // best effort
      }
    }

    const tableCard = await a2a.fetchCard(roomAgentCardUrl);
    const requestedSkills = input.roomAgentSkills ?? {};
    const skills: RoomAgentSkills = {
      configure: requestedSkills.configure ?? definition.roomAgent.skills.configure,
      register: requestedSkills.register ?? definition.roomAgent.skills.register,
      start: requestedSkills.start ?? definition.roomAgent.skills.start,
      summary: requestedSkills.summary ?? definition.roomAgent.skills.summary,
    };

    try {
      await a2a.client.invoke(tableCard, skills.configure, {
        roomId,
        casinoName: this.casinoName,
        config,
        casinoCallback: {
          agentCardUrl: this.callback.agentCardUrl,
          eventSkill: this.callback.eventSkill,
        },
      });
    } catch (error) {
      roomProcess?.stop();
      throw error;
    }

    const room: ManagedRoom = {
      roomId,
      gameType: definition.type,
      definition,
      config,
      roomAgent: {
        cardUrl: roomAgentCardUrl,
        card: tableCard,
        skills,
      },
      roomBaseUrl,
      roomProcess,
      summary: undefined,
      events: [],
    };

    try {
      await this.refreshSummary(room);
    } catch (error) {
      roomProcess?.stop();
      throw error;
    }
    this.rooms.set(roomId, room);
    return this.toSnapshot(room);
  }

  public async registerPlayer(input: RegisterPlayerInput): Promise<RegisterPlayerResult> {
    const room = this.requireRoom(input.roomId);
    if (!room.definition.supportsRegistration || !room.definition.registration) {
      throw new Error(`Room ${room.roomId} does not accept player registrations.`);
    }
    const registration = room.definition.registration;
    const a2a = this.ensureA2A();

    const playerCard = await a2a.fetchCard(input.agentCardUrl);
    const invitation = signupInvitationSchema.parse(
      registration.buildInvitation({
        casinoName: this.casinoName,
        roomId: room.roomId,
        config: room.config,
      }),
    );

    const signupResult = await a2a.client.invoke(playerCard, input.signupSkill, invitation);
    const signup = playerSignupResponseSchema.parse(signupResult.output ?? {});
    const buyIn = registration.clampBuyIn(signup.buyIn, room.config);
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

    const result = await a2a.client.invoke(room.roomAgent.card, room.roomAgent.skills.register, registerPayload);
    const parsed = registerPlayerResultSchema.parse({
      roomId: room.roomId,
      ...(result.output ?? {}),
    });

    await this.refreshSummary(room);
    await this.maybeAutoStart(room);
    return parsed;
  }

  public async startRoom(input: StartRoomInput): Promise<RoomGameState> {
    const room = this.requireRoom(input.roomId);
    const a2a = this.ensureA2A();

    const payload = {
      ...(input.overrides ?? {}),
    };
    const result = await a2a.client.invoke(room.roomAgent.card, room.roomAgent.skills.start, payload);
    const summary = roomStateSchema.parse(result.output ?? {});
    room.summary = summary;
    return summary;
  }

  public async refreshRoom(roomId: string): Promise<RoomSnapshot> {
    const room = this.requireRoom(roomId);
    await this.refreshSummary(room);
    return this.toSnapshot(room);
  }

  public async recordEvent(event: RoomEvent): Promise<void> {
    const parsed = roomEventSchema.parse(event);
    const room = this.findRoomById(parsed.roomId);
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

  private toSummary(room: ManagedRoom): RoomSummary {
    const summary: RoomSummary = {
      roomId: room.roomId,
      gameType: room.gameType,
      roomAgentCardUrl: room.roomAgent.cardUrl,
      roomBaseUrl: room.roomBaseUrl,
      status: room.summary?.status ?? 'waiting',
      handCount: room.summary?.handCount ?? 0,
      playerCount: room.summary?.players.length ?? 0,
      message: room.summary?.message,
    };
    return roomSummarySchema.parse(summary);
  }

  private toSnapshot(room: ManagedRoom): RoomSnapshot {
    const snapshot: RoomSnapshot = {
      roomId: room.roomId,
      gameType: room.gameType,
      config: room.config,
      summary: room.summary,
      roomAgentCardUrl: room.roomAgent.cardUrl,
      roomBaseUrl: room.roomBaseUrl,
      events: [...room.events],
    };
    return roomSnapshotSchema.parse(snapshot);
  }

  private async maybeAutoStart(room: ManagedRoom): Promise<void> {
    if (!room.definition.shouldAutoStart) {
      return;
    }
    if (!room.summary) {
      return;
    }
    if (room.summary.status === 'running') {
      return;
    }
    const shouldStart = room.definition.shouldAutoStart({
      summary: room.summary,
      config: room.config,
    });
    if (!shouldStart) {
      return;
    }

    try {
      await this.startRoom({ roomId: room.roomId });
    } catch (error) {
      console.error(`[casino-agent] Failed to auto-start room ${room.roomId}:`, error);
    }
  }

  public async shutdown(): Promise<void> {
    for (const room of this.rooms.values()) {
      room.roomProcess?.stop();
    }
  }

  private ensureA2A(): A2ARuntime {
    if (!this.runtime.a2a) {
      throw new Error('Casino agent needs the A2A extension.');
    }
    return this.runtime.a2a;
  }

  private requireRoom(roomId: string): ManagedRoom {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found.`);
    }
    return room;
  }

  private requireGame(gameType: string): RoomGameDefinition {
    const game = this.games.get(gameType);
    if (!game) {
      throw new Error(`Unsupported game type: ${gameType}.`);
    }
    return game;
  }

  private findRoomById(roomId: string): ManagedRoom | undefined {
    return Array.from(this.rooms.values()).find((room) => room.roomId === roomId);
  }

  private async refreshSummary(room: ManagedRoom): Promise<void> {
    const a2a = this.ensureA2A();
    const result = await a2a.client.invoke(room.roomAgent.card, room.roomAgent.skills.summary, {});
    room.summary = roomStateSchema.parse(result.output ?? {});
  }
}
