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
import { processPriceToAtomicAmount } from 'x402/shared';
import type { PaymentRequirements } from 'x402/types';
import { PayoutProcessor } from './payout-processor';

export type CasinoRuntime = AgentRuntime & {
  a2a?: A2ARuntime;
};

const normalizeAddress = (value: string) => value.toLowerCase();

interface RoomAgentHandle {
  cardUrl: string;
  card: AgentCard;
  skills: RoomAgentSkills;
}

interface PlayerProfile {
  payoutAddress: string;
  buyInAtomic: string;
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
  playerProfiles: Map<string, PlayerProfile>;
  registrationClosed: boolean;
  payoutSettled: boolean;
}

export class RoomManager {
  private readonly rooms = new Map<string, ManagedRoom>();
  private readonly runtime: CasinoRuntime;
  private readonly casinoName: string;
  private readonly callback: { agentCardUrl: string; eventSkill: string };
  private readonly games: Map<string, RoomGameDefinition>;
  private readonly defaultGameType: string;
  private readonly paymentsNetwork: PaymentRequirements['network'];
  private readonly payoutProcessor?: PayoutProcessor;

  constructor(
    runtime: CasinoRuntime,
    casinoName: string,
    callback: { agentCardUrl: string; eventSkill: string },
    options: {
      games: Map<string, RoomGameDefinition>;
      defaultGameType?: string;
      paymentsNetwork: PaymentRequirements['network'];
      payoutProcessor?: PayoutProcessor;
    },
  ) {
    this.runtime = runtime;
    this.casinoName = casinoName;
    this.callback = callback;
    this.games = options.games;
    this.defaultGameType = options.defaultGameType ?? 'poker';
    this.paymentsNetwork = options.paymentsNetwork;
    this.payoutProcessor = options.payoutProcessor;
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
      playerProfiles: new Map(),
      registrationClosed: false,
      payoutSettled: false,
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
    if (room.registrationClosed || room.summary?.status === 'ended') {
      throw new Error(`Room ${room.roomId} is closed for new registrations.`);
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
    if (!signup.payoutAddress) {
      throw new Error('Player did not provide a payout address during signup.');
    }
    const buyIn = registration.clampBuyIn(undefined, room.config);
    const actionSkill = input.actionSkill ?? 'play';
    const playerId = randomUUID();
    const buyInAtomic = this.calculateBuyInAtomic(room.config);

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
    const normalizedAddress = normalizeAddress(signup.payoutAddress);
    room.playerProfiles.set(parsed.playerId, {
      payoutAddress: normalizedAddress,
      buyInAtomic,
    });

    await this.refreshSummary(room);
    await this.maybeAutoStart(room);
    return {
      ...parsed,
      payoutAddress: normalizedAddress,
    };
  }

  public async startRoom(input: StartRoomInput): Promise<RoomGameState> {
    const room = this.requireRoom(input.roomId);
    if (room.summary?.status === 'ended') {
      throw new Error(`Room ${room.roomId} has already ended.`);
    }
    const a2a = this.ensureA2A();
    room.registrationClosed = true;

    const payload = {
      ...(input.overrides ?? {}),
    };
    const result = await a2a.client.invoke(room.roomAgent.card, room.roomAgent.skills.start, payload);
    const summary = roomStateSchema.parse(result.output ?? {});
    room.summary = summary;
    await this.settleRoomPayout(room);
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
    if (room.summary.status === 'running' || room.summary.status === 'ended') {
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

  private calculateBuyInAtomic(config: RoomConfig): string {
    const price = Number((config as Record<string, unknown>).buyInPriceUsd);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Room configuration is missing a valid buy-in price.');
    }
    const conversion = processPriceToAtomicAmount(price, this.paymentsNetwork);
    if ('error' in conversion) {
      throw new Error(conversion.error);
    }
    return conversion.maxAmountRequired;
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
    const parsed = roomStateSchema.parse(result.output ?? {});
    room.summary = {
      ...parsed,
      players: parsed.players.map((player) => ({
        ...player,
        payoutAddress: room.playerProfiles.get(player.playerId)?.payoutAddress,
      })),
    };
    await this.settleRoomPayout(room);
  }

  private calculateTotalPotAtomic(room: ManagedRoom): bigint {
    let total = 0n;
    for (const profile of room.playerProfiles.values()) {
      total += BigInt(profile.buyInAtomic);
    }
    return total;
  }

  private async settleRoomPayout(room: ManagedRoom): Promise<void> {
    if (room.payoutSettled) {
      return;
    }
    if (room.summary?.status !== 'ended') {
      return;
    }
    const winner = room.summary.players[0];
    if (!winner) {
      room.payoutSettled = true;
      return;
    }
    const profile = room.playerProfiles.get(winner.playerId);
    if (!profile?.payoutAddress) {
      console.warn(`[casino-agent] Missing payout address for winner ${winner.playerId}.`);
      room.payoutSettled = true;
      return;
    }
    const totalAtomic = this.calculateTotalPotAtomic(room);
    if (totalAtomic === 0n) {
      room.payoutSettled = true;
      return;
    }
    if (!this.payoutProcessor) {
      console.warn(
        `[casino-agent] Payout processor not configured. Skipping payout of ${totalAtomic} wei to ${profile.payoutAddress}.`,
      );
      room.payoutSettled = true;
      return;
    }
    try {
      await this.payoutProcessor.sendPayout({
        roomId: room.roomId,
        payTo: profile.payoutAddress,
        amountAtomic: totalAtomic,
        description: `Room ${room.roomId} payout`,
      });
      room.payoutSettled = true;
      const payoutEvent: RoomEvent = {
        roomId: room.roomId,
        eventType: 'room_status',
        message: `Paid out winnings to ${winner.displayName}.`,
        timestamp: new Date().toISOString(),
        payload: {
          winnerId: winner.playerId,
          payoutAddress: profile.payoutAddress,
          amountAtomic: totalAtomic.toString(),
        },
      };
      room.events.push(payoutEvent);
      if (room.events.length > 200) {
        room.events.shift();
      }
    } catch (error) {
      console.error('[casino-agent] Failed to settle payout:', error);
    }
  }
}
