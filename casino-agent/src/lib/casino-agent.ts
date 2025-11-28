import { resolve } from 'node:path';

import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { a2a } from '@lucid-agents/a2a';
import { createAgentApp } from '@lucid-agents/hono';
import { cors } from 'hono/cors';
import { z } from 'zod';

import {
  CasinoState,
  CreateRoomInput,
  RegisterPlayerInput,
  StartRoomInput,
  createRoomInputSchema,
  registerPlayerInputSchema,
  registerPlayerResultSchema,
  roomSnapshotSchema,
  startRoomInputSchema,
  roomEventSchema,
  roomStateSchema,
  casinoStateSchema,
} from './protocol';
import { RoomManager, type CasinoRuntime } from './room-manager';
import { RoomLauncher } from './room-launcher';
import type { GameMetadata, RoomGameDefinition } from './room-definitions';

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toConfigNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const clampMaxPlayers = (value: number): number => {
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, 2), 8);
};

const readNumberEnv = (keys: string[], fallback: number): number => {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) {
      return toNumber(value, fallback);
    }
  }
  return fallback;
};

const normalizeOptionalUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const parseArgs = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback;
  }
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
};

const casinoName = process.env.CASINO_AGENT_NAME ?? 'casino-agent';
const casinoCardUrl = process.env.CASINO_AGENT_CARD_URL;

if (!casinoCardUrl) {
  throw new Error('CASINO_AGENT_CARD_URL must be set so table agents can send events back to the casino.');
}

const defaultGameType = process.env.DEFAULT_GAME_TYPE ?? 'poker';

const pokerConfigSchema = z.object({
  startingStack: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  maxHands: z.number().int().positive(),
  maxPlayers: z.number().int().min(2).max(8),
});
type PokerConfig = z.infer<typeof pokerConfigSchema>;

const slotMachineConfigSchema = z.object({
  maxPlayers: z.number().int().min(1).max(20),
  maxSpins: z.number().int().min(1).max(200),
  spinCost: z.number().positive(),
  jackpotMultiplier: z.number().positive(),
  pairMultiplier: z.number().positive(),
  reels: z.number().int().min(3).max(5),
});
type SlotMachineConfig = z.infer<typeof slotMachineConfigSchema>;

const blackjackRoomConfigSchema = z.object({
  maxPlayers: z.number().int().min(1).max(6),
  startingStack: z.number().positive(),
  minBet: z.number().positive(),
  maxBet: z.number().positive(),
  blackjackPayout: z.number().positive(),
  roundsPerSession: z.number().int().min(1).max(50),
  deckCount: z.number().int().min(1).max(8),
});
type BlackjackConfig = z.infer<typeof blackjackRoomConfigSchema>;

const pokerDefaultConfig = pokerConfigSchema.parse({
  startingStack: readNumberEnv(['POKER_STARTING_STACK', 'STARTING_STACK'], 1000),
  smallBlind: readNumberEnv(['POKER_SMALL_BLIND', 'SMALL_BLIND'], 5),
  bigBlind: readNumberEnv(['POKER_BIG_BLIND', 'BIG_BLIND'], 10),
  maxHands: Math.max(1, Math.round(readNumberEnv(['POKER_MAX_HANDS', 'MAX_HANDS'], 1000))),
  minBuyIn: readNumberEnv(['POKER_MIN_BUY_IN', 'MIN_BUY_IN'], 100),
  maxBuyIn: readNumberEnv(['POKER_MAX_BUY_IN', 'MAX_BUY_IN'], 100),
  maxPlayers: clampMaxPlayers(readNumberEnv(['POKER_MAX_PLAYERS', 'MAX_PLAYERS'], 8)),
});

const slotDefaultConfig = slotMachineConfigSchema.parse({
  maxPlayers: Math.max(1, Math.round(toNumber(process.env.SLOT_MAX_PLAYERS, 4))),
  maxSpins: Math.max(1, Math.round(toNumber(process.env.SLOT_MAX_SPINS, 20))),
  spinCost: toNumber(process.env.SLOT_SPIN_COST, 1),
  jackpotMultiplier: toNumber(process.env.SLOT_JACKPOT_MULTIPLIER, 25),
  pairMultiplier: toNumber(process.env.SLOT_PAIR_MULTIPLIER, 3),
  reels: Math.min(Math.max(Math.round(toNumber(process.env.SLOT_REELS, 3)), 3), 5),
});

const blackjackDefaultConfig = blackjackRoomConfigSchema.parse({
  maxPlayers: Math.max(1, Math.min(6, Math.round(toNumber(process.env.BLACKJACK_MAX_PLAYERS, 4)))),
  startingStack: toNumber(process.env.BLACKJACK_STARTING_STACK, 20),
  minBet: toNumber(process.env.BLACKJACK_MIN_BET, 1),
  maxBet: Math.max(
    toNumber(process.env.BLACKJACK_MAX_BET, 5),
    toNumber(process.env.BLACKJACK_MIN_BET, 1),
  ),
  blackjackPayout: toNumber(process.env.BLACKJACK_BLACKJACK_PAYOUT, 1.5),
  roundsPerSession: Math.max(1, Math.min(50, Math.round(toNumber(process.env.BLACKJACK_ROUNDS, 5)))),
  deckCount: Math.max(1, Math.min(8, Math.round(toNumber(process.env.BLACKJACK_DECKS, 4)))),
});

const buildPokerConfig = (payload: unknown, defaults: PokerConfig = pokerDefaultConfig): PokerConfig => {
  const data = (typeof payload === 'object' && payload) ? (payload as Record<string, unknown>) : {};
  return pokerConfigSchema.parse({
    startingStack: toConfigNumber(data.startingStack, defaults.startingStack),
    smallBlind: toConfigNumber(data.smallBlind, defaults.smallBlind),
    bigBlind: toConfigNumber(data.bigBlind, defaults.bigBlind),
    minBuyIn: toConfigNumber(data.minBuyIn, defaults.minBuyIn),
    maxBuyIn: toConfigNumber(data.maxBuyIn, defaults.maxBuyIn),
    maxHands: Math.max(1, Math.round(toConfigNumber(data.maxHands, defaults.maxHands))),
    maxPlayers: clampMaxPlayers(toConfigNumber(data.maxPlayers, defaults.maxPlayers)),
  });
};

const buildSlotConfig = (payload: unknown, defaults: SlotMachineConfig = slotDefaultConfig): SlotMachineConfig => {
  const data = (typeof payload === 'object' && payload) ? (payload as Record<string, unknown>) : {};
  return slotMachineConfigSchema.parse({
    maxPlayers: Math.max(1, Math.round(toConfigNumber(data.maxPlayers, defaults.maxPlayers))),
    maxSpins: Math.max(1, Math.round(toConfigNumber(data.maxSpins, defaults.maxSpins))),
    spinCost: toConfigNumber(data.spinCost, defaults.spinCost),
    jackpotMultiplier: toConfigNumber(data.jackpotMultiplier, defaults.jackpotMultiplier),
    pairMultiplier: toConfigNumber(data.pairMultiplier, defaults.pairMultiplier),
    reels: Math.min(Math.max(Math.round(toConfigNumber(data.reels, defaults.reels)), 3), 5),
  });
};

const buildBlackjackConfig = (
  payload: unknown,
  defaults: BlackjackConfig = blackjackDefaultConfig,
): BlackjackConfig => {
  const data = (typeof payload === 'object' && payload) ? (payload as Record<string, unknown>) : {};
  const minBet = toConfigNumber(data.minBet, defaults.minBet);
  const maxBet = Math.max(toConfigNumber(data.maxBet, defaults.maxBet), minBet);
  return blackjackRoomConfigSchema.parse({
    maxPlayers: Math.max(1, Math.min(6, Math.round(toConfigNumber(data.maxPlayers, defaults.maxPlayers)))),
    startingStack: toConfigNumber(data.startingStack, defaults.startingStack),
    minBet,
    maxBet,
    blackjackPayout: toConfigNumber(data.blackjackPayout, defaults.blackjackPayout),
    roundsPerSession: Math.max(1, Math.min(50, Math.round(toConfigNumber(data.roundsPerSession, defaults.roundsPerSession)))),
    deckCount: Math.max(1, Math.min(8, Math.round(toConfigNumber(data.deckCount, defaults.deckCount)))),
  });
};

const pokerEmbeddedWorkdir =
  process.env.ROOM_AGENT_WORKDIR ??
  process.env.TABLE_AGENT_WORKDIR ??
  resolve(new URL('../../../poker-room-agent', import.meta.url).pathname);
const enablePokerLauncher = (process.env.ROOM_AGENT_AUTOSPAWN ?? process.env.TABLE_AGENT_AUTOSPAWN) !== 'false';
const pokerAgentBin = process.env.ROOM_AGENT_BIN ?? process.env.TABLE_AGENT_BIN ?? 'bun';
const pokerAgentArgs = parseArgs(process.env.ROOM_AGENT_ARGS ?? process.env.TABLE_AGENT_ARGS, ['run', 'src/index.ts']);
const pokerPortRangeStart = Number.parseInt(
  process.env.ROOM_AGENT_PORT_START ?? process.env.TABLE_AGENT_PORT_START ?? '4500',
  10,
);
const pokerPortRangeEnd = Number.parseInt(
  process.env.ROOM_AGENT_PORT_END ?? process.env.TABLE_AGENT_PORT_END ?? '4600',
  10,
);

const pokerLauncher = enablePokerLauncher
  ? new RoomLauncher({
      workdir: pokerEmbeddedWorkdir,
      bin: pokerAgentBin,
      args: pokerAgentArgs,
      portRangeStart: pokerPortRangeStart,
      portRangeEnd: pokerPortRangeEnd,
    })
  : undefined;

const slotWorkdir =
  process.env.SLOT_ROOM_AGENT_WORKDIR ??
  resolve(new URL('../../../slot-machine-room-agent', import.meta.url).pathname);
const enableSlotLauncher = (process.env.SLOT_ROOM_AGENT_AUTOSPAWN ?? 'true') !== 'false';
const slotAgentBin = process.env.SLOT_ROOM_AGENT_BIN ?? 'bun';
const slotAgentArgs = parseArgs(process.env.SLOT_ROOM_AGENT_ARGS, ['run', 'src/index.ts']);
const slotPortRangeStart = Number.parseInt(process.env.SLOT_ROOM_AGENT_PORT_START ?? '4700', 10);
const slotPortRangeEnd = Number.parseInt(process.env.SLOT_ROOM_AGENT_PORT_END ?? '4800', 10);

const slotLauncher = enableSlotLauncher
  ? new RoomLauncher({
      workdir: slotWorkdir,
      bin: slotAgentBin,
      args: slotAgentArgs,
      portRangeStart: slotPortRangeStart,
      portRangeEnd: slotPortRangeEnd,
    })
  : undefined;

const defaultPokerCardUrl = process.env.DEFAULT_ROOM_AGENT_CARD_URL;
const defaultSlotCardUrl = process.env.DEFAULT_SLOT_ROOM_AGENT_CARD_URL ?? process.env.SLOT_ROOM_AGENT_CARD_URL;
const blackjackWorkdir =
  process.env.BLACKJACK_ROOM_AGENT_WORKDIR ??
  resolve(new URL('../../../blackjack-room-agent', import.meta.url).pathname);
const enableBlackjackLauncher = (process.env.BLACKJACK_ROOM_AGENT_AUTOSPAWN ?? 'true') !== 'false';
const blackjackAgentBin = process.env.BLACKJACK_ROOM_AGENT_BIN ?? 'bun';
const blackjackAgentArgs = parseArgs(process.env.BLACKJACK_ROOM_AGENT_ARGS, ['run', 'src/index.ts']);
const blackjackPortRangeStart = Number.parseInt(process.env.BLACKJACK_ROOM_AGENT_PORT_START ?? '4800', 10);
const blackjackPortRangeEnd = Number.parseInt(process.env.BLACKJACK_ROOM_AGENT_PORT_END ?? '4900', 10);

const blackjackLauncher = enableBlackjackLauncher
  ? new RoomLauncher({
      workdir: blackjackWorkdir,
      bin: blackjackAgentBin,
      args: blackjackAgentArgs,
      portRangeStart: blackjackPortRangeStart,
      portRangeEnd: blackjackPortRangeEnd,
    })
  : undefined;
const defaultBlackjackCardUrl =
  process.env.DEFAULT_BLACKJACK_ROOM_AGENT_CARD_URL ?? process.env.BLACKJACK_ROOM_AGENT_CARD_URL;

const pokerDefinition: RoomGameDefinition<PokerConfig> = {
  type: 'poker',
  label: 'Texas Hold’em Table',
  description: 'No-limit Texas Hold’em session with Lucid poker tables.',
  supportsRegistration: true,
  configSchema: pokerConfigSchema,
  defaultConfig: pokerDefaultConfig,
  configFields: [
    { key: 'startingStack', label: 'Starting Stack', type: 'number', step: 0.1 },
    { key: 'smallBlind', label: 'Small Blind', type: 'number', step: 0.1 },
    { key: 'bigBlind', label: 'Big Blind', type: 'number', step: 0.1 },
    { key: 'minBuyIn', label: 'Min Buy-in', type: 'number', step: 0.1 },
    { key: 'maxBuyIn', label: 'Max Buy-in', type: 'number', step: 0.1 },
    { key: 'maxHands', label: 'Max Hands', type: 'number', step: 1, min: 1 },
    { key: 'maxPlayers', label: 'Max Players', type: 'number', step: 1, min: 2, max: 8 },
  ],
  normalizeConfig: (payload) => buildPokerConfig(payload, pokerDefaultConfig),
  roomAgent: {
    skills: {
      configure: 'configureRoom',
      register: 'registerPlayer',
      start: 'startRoom',
      summary: 'roomSummary',
    },
    defaultCardUrl: defaultPokerCardUrl,
    launcher: pokerLauncher,
  },
  registration: {
    buildInvitation: ({ casinoName, roomId, config }) => ({
      casinoName,
      roomId,
      minBuyIn: config.minBuyIn,
      maxBuyIn: config.maxBuyIn,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
    }),
    clampBuyIn: (value, config) => {
      const requested = typeof value === 'number' && Number.isFinite(value) ? value : config.startingStack;
      return Math.min(Math.max(requested, config.minBuyIn), config.maxBuyIn);
    },
  },
  shouldAutoStart: ({ summary, config }) => Boolean(summary && summary.players.length >= config.maxPlayers),
};

const slotDefinition: RoomGameDefinition<SlotMachineConfig> = {
  type: 'slot-machine',
  label: 'Slot Machine',
  description: 'Multi-player reel spinner with configurable volatility.',
  supportsRegistration: true,
  configSchema: slotMachineConfigSchema,
  defaultConfig: slotDefaultConfig,
  configFields: [
    { key: 'maxPlayers', label: 'Max Players', type: 'number', min: 1, max: 20, step: 1 },
    { key: 'maxSpins', label: 'Spins per Run', type: 'number', min: 1, max: 200, step: 1 },
    { key: 'spinCost', label: 'Spin Cost', type: 'number', step: 0.1 },
    { key: 'pairMultiplier', label: 'Pair Multiplier', type: 'number', step: 0.1 },
    { key: 'jackpotMultiplier', label: 'Jackpot Multiplier', type: 'number', step: 0.1 },
    { key: 'reels', label: 'Reels', type: 'number', min: 3, max: 5, step: 1 },
  ],
  normalizeConfig: (payload) => buildSlotConfig(payload, slotDefaultConfig),
  roomAgent: {
    skills: {
      configure: 'configureRoom',
      register: 'registerPlayer',
      start: 'startRoom',
      summary: 'roomSummary',
    },
    defaultCardUrl: defaultSlotCardUrl,
    launcher: slotLauncher,
  },
  registration: {
    buildInvitation: ({ casinoName, roomId, config }) => ({
      casinoName,
      roomId,
      minBuyIn: config.spinCost,
      maxBuyIn: config.spinCost * config.jackpotMultiplier * 5,
      smallBlind: config.spinCost,
      bigBlind: config.spinCost,
    }),
    clampBuyIn: (value, config) => {
      const fallback = config.spinCost * 5;
      const requested = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      const min = config.spinCost;
      const max = config.spinCost * config.jackpotMultiplier * 10;
      return Math.min(Math.max(requested, min), max);
    },
  },
};

const blackjackDefinition: RoomGameDefinition<BlackjackConfig> = {
  type: 'blackjack',
  label: 'Blackjack Table',
  description: 'Fast blackjack rounds with simulated dealer + payouts.',
  supportsRegistration: true,
  configSchema: blackjackRoomConfigSchema,
  defaultConfig: blackjackDefaultConfig,
  configFields: [
    { key: 'maxPlayers', label: 'Max Players', type: 'number', min: 1, max: 6, step: 1 },
    { key: 'startingStack', label: 'Starting Stack', type: 'number', step: 1 },
    { key: 'minBet', label: 'Min Bet', type: 'number', step: 0.1 },
    { key: 'maxBet', label: 'Max Bet', type: 'number', step: 0.1 },
    { key: 'blackjackPayout', label: 'Blackjack Payout', type: 'number', step: 0.1 },
    { key: 'roundsPerSession', label: 'Rounds per Session', type: 'number', min: 1, max: 50, step: 1 },
    { key: 'deckCount', label: 'Decks', type: 'number', min: 1, max: 8, step: 1 },
  ],
  normalizeConfig: (payload) => buildBlackjackConfig(payload, blackjackDefaultConfig),
  roomAgent: {
    skills: {
      configure: 'configureRoom',
      register: 'registerPlayer',
      start: 'startRoom',
      summary: 'roomSummary',
    },
    defaultCardUrl: defaultBlackjackCardUrl,
    launcher: blackjackLauncher,
  },
  registration: {
    buildInvitation: ({ casinoName, roomId, config }) => ({
      casinoName,
      roomId,
      minBuyIn: config.minBet * 5,
      maxBuyIn: config.startingStack * 10,
      smallBlind: config.minBet,
      bigBlind: config.maxBet,
    }),
    clampBuyIn: (value, config) => {
      const fallback = config.startingStack;
      const requested = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
      const min = config.minBet * 2;
      const max = config.startingStack * 20;
      return Math.min(Math.max(requested, min), max);
    },
  },
  shouldAutoStart: ({ summary }) => Boolean(summary && summary.players.length > 0),
};

const roomGames = new Map<string, RoomGameDefinition<any>>([
  ['poker', pokerDefinition],
  ['slot-machine', slotDefinition],
  ['blackjack', blackjackDefinition],
]);

const getGameMetadata = (): GameMetadata[] =>
  Array.from(roomGames.values()).map((game) => ({
    type: game.type,
    label: game.label,
    description: game.description,
    supportsRegistration: game.supportsRegistration,
    configFields: game.configFields,
    defaultConfig: game.defaultConfig,
  }));

if (!roomGames.has(defaultGameType)) {
  throw new Error(`DEFAULT_GAME_TYPE "${defaultGameType}" is not registered.`);
}

const runtime = await createAgent({
  name: casinoName,
  version: process.env.CASINO_AGENT_VERSION ?? '0.2.0',
  description:
    process.env.CASINO_AGENT_DESCRIPTION ??
    'Casino lobby agent that orchestrates Lucid game rooms and coordinates player registrations.',
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(runtime);
app.use('*', cors());

const roomManager = new RoomManager(
  runtime as CasinoRuntime,
  casinoName,
  {
    agentCardUrl: casinoCardUrl,
    eventSkill: 'recordGameEvent',
  },
  {
    games: roomGames,
    defaultGameType,
  },
);

const gracefulShutdown = async () => {
  try {
    await roomManager.shutdown();
  } catch (error) {
    console.error('[casino-agent] Failed to shutdown rooms', error);
  }
};

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});
process.on('exit', () => {
  roomManager.shutdown().catch(() => undefined);
});

const listRooms = (): CasinoState =>
  casinoStateSchema.parse({
    rooms: roomManager.listRooms(),
  });

const fetchLobbyState = async (): Promise<CasinoState> => {
  await roomManager.refreshAllRooms();
  return listRooms();
};

addEntrypoint({
  key: 'createRoom',
  description: 'Create a new casino room and bind the requested game agent.',
  input: createRoomInputSchema,
  output: roomSnapshotSchema,
  handler: async (ctx) => {
    const room = await roomManager.createRoom(ctx.input);
    return { output: room };
  },
});

addEntrypoint({
  key: 'registerPlayer',
  description: 'Register an external agent to a specific room via A2A.',
  input: registerPlayerInputSchema,
  output: registerPlayerResultSchema,
  handler: async (ctx) => {
    const result = await roomManager.registerPlayer(ctx.input);
    return { output: result };
  },
});

addEntrypoint({
  key: 'startRoom',
  description: 'Start gameplay for a specific room.',
  input: startRoomInputSchema,
  output: roomStateSchema,
  handler: async (ctx) => {
    const summary = await roomManager.startRoom(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'recordGameEvent',
  description: 'Receive activity emitted by room agents.',
  input: roomEventSchema,
  handler: async (ctx) => {
    await roomManager.recordEvent(ctx.input);
    return { output: { ok: true } };
  },
});

addEntrypoint({
  key: 'listRooms',
  description: 'Return lobby overview.',
  output: casinoStateSchema,
  handler: async () => ({
    output: await fetchLobbyState(),
  }),
});

app.get('/ui/rooms', async (c) => {
  const state = await fetchLobbyState();
  return c.json({
    ...state,
    games: getGameMetadata(),
    defaultGameType,
  });
});

app.post('/ui/rooms', async (c) => {
  try {
    const payload = await c.req.json();
    const requestedGameType =
      typeof payload.gameType === 'string' && payload.gameType.trim().length > 0
        ? payload.gameType.trim()
        : defaultGameType;
    const configPayload =
      typeof payload.config === 'object' && payload.config
        ? payload.config
        : payload;
    const launchOptions =
      payload.launchOptions ?? (payload.roomPort ? { port: Number(payload.roomPort) } : undefined);
    const explicitCard = normalizeOptionalUrl(payload.roomAgentCardUrl);
    const baseInput: Record<string, unknown> = {
      roomId: typeof payload.roomId === 'string' && payload.roomId.trim() ? payload.roomId.trim() : undefined,
      gameType: requestedGameType,
      roomAgentSkills: payload.roomAgentSkills,
      launchOptions,
    };
    if (configPayload && typeof configPayload === 'object') {
      baseInput.config = configPayload;
    }
    if (explicitCard) {
      baseInput.roomAgentCardUrl = explicitCard;
    }
    const parsed = createRoomInputSchema.parse(baseInput);
    const room = await roomManager.createRoom(parsed);
    return c.json({ ok: true, room });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to create room.' },
      400,
    );
  }
});

app.get('/ui/rooms/:roomId', async (c) => {
  try {
    const roomId = c.req.param('roomId');
    const snapshot = await roomManager.refreshRoom(roomId);
    return c.json({ ok: true, room: snapshot });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'Room not found.' },
      404,
    );
  }
});

app.post('/ui/rooms/:roomId/register', async (c) => {
  try {
    const roomId = c.req.param('roomId');
    const payload = await c.req.json();
    const input: RegisterPlayerInput = registerPlayerInputSchema.parse({
      roomId,
      ...payload,
    });
    const player = await roomManager.registerPlayer(input);
    return c.json({ ok: true, player });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to register player.' },
      400,
    );
  }
});

app.post('/ui/rooms/:roomId/start', async (c) => {
  try {
    const roomId = c.req.param('roomId');
    const payload = await c.req.json().catch(() => ({}));
    const input: StartRoomInput = startRoomInputSchema.parse({
      roomId,
      overrides: payload,
    });
    const summary = await roomManager.startRoom(input);
    return c.json({ ok: true, summary });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to start room.' },
      400,
    );
  }
});

app.get('/ui/state', async (c) => {
  const state = await fetchLobbyState();
  return c.json({
    ...state,
    games: getGameMetadata(),
    defaultGameType,
  });
});

export { app };
