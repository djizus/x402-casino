import { resolve } from 'node:path';

import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { a2a } from '@lucid-agents/a2a';
import { createAgentApp } from '@lucid-agents/hono';
import { cors } from 'hono/cors';

import {
  CasinoState,
  CreateRoomInput,
  RegisterPlayerInput,
  StartRoomInput,
  RoomConfig,
  createRoomInputSchema,
  registerPlayerInputSchema,
  registerPlayerResultSchema,
  roomSnapshotSchema,
  startRoomInputSchema,
  roomConfigSchema,
  roomEventSchema,
  roomStateSchema,
  casinoStateSchema,
} from './protocol';
import { RoomManager, type CasinoRuntime } from './room-manager';
import { RoomLauncher } from './room-launcher';

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
  return fallback;
};

const clampSeats = (value: number): number => {
  const rounded = Math.round(value);
  return Math.min(Math.max(rounded, 2), 10);
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

const defaultRoomAgentCardUrl = process.env.DEFAULT_ROOM_AGENT_CARD_URL;

const defaultConfig = roomConfigSchema.parse({
  startingStack: toNumber(process.env.STARTING_STACK, 1),
  smallBlind: toNumber(process.env.SMALL_BLIND, 0.1),
  bigBlind: toNumber(process.env.BIG_BLIND, 1),
  maxHands: toNumber(process.env.MAX_HANDS, 1),
  minBuyIn: toNumber(process.env.MIN_BUY_IN, 0.1),
  maxBuyIn: toNumber(process.env.MAX_BUY_IN, 1),
  maxSeats: Math.min(Math.max(toNumber(process.env.MAX_SEATS, 6), 2), 10),
});

const embeddedWorkdir =
  process.env.ROOM_AGENT_WORKDIR ??
  process.env.TABLE_AGENT_WORKDIR ??
  resolve(new URL('../../../poker-room-agent', import.meta.url).pathname);
const enableRoomLauncher = (process.env.ROOM_AGENT_AUTOSPAWN ?? process.env.TABLE_AGENT_AUTOSPAWN) !== 'false';
const roomAgentBin = process.env.ROOM_AGENT_BIN ?? process.env.TABLE_AGENT_BIN ?? 'bun';
const roomAgentArgs = parseArgs(process.env.ROOM_AGENT_ARGS ?? process.env.TABLE_AGENT_ARGS, ['run', 'src/index.ts']);
const portRangeStart = Number.parseInt(process.env.ROOM_AGENT_PORT_START ?? process.env.TABLE_AGENT_PORT_START ?? '4500', 10);
const portRangeEnd = Number.parseInt(process.env.ROOM_AGENT_PORT_END ?? process.env.TABLE_AGENT_PORT_END ?? '4600', 10);

const roomLauncher = enableRoomLauncher
  ? new RoomLauncher({
      workdir: embeddedWorkdir,
      bin: roomAgentBin,
      args: roomAgentArgs,
      portRangeStart,
      portRangeEnd,
    })
  : undefined;

const runtime = await createAgent({
  name: casinoName,
  version: process.env.CASINO_AGENT_VERSION ?? '0.2.0',
  description:
    process.env.CASINO_AGENT_DESCRIPTION ??
    'Casino lobby agent that orchestrates poker rooms and coordinates player registrations.',
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
    roomLauncher,
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

const buildConfigFromPayload = (payload: any): RoomConfig =>
  roomConfigSchema.parse({
    startingStack: toConfigNumber(payload.startingStack, defaultConfig.startingStack),
    smallBlind: toConfigNumber(payload.smallBlind, defaultConfig.smallBlind),
    bigBlind: toConfigNumber(payload.bigBlind, defaultConfig.bigBlind),
    minBuyIn: toConfigNumber(payload.minBuyIn, defaultConfig.minBuyIn),
    maxBuyIn: toConfigNumber(payload.maxBuyIn, defaultConfig.maxBuyIn),
    maxHands: Math.max(1, Math.round(toConfigNumber(payload.maxHands, defaultConfig.maxHands))),
    maxSeats: clampSeats(toConfigNumber(payload.maxSeats, defaultConfig.maxSeats)),
  });

addEntrypoint({
  key: 'createRoom',
  description: 'Create a new poker room and bind a table agent to it.',
  input: createRoomInputSchema,
  output: roomSnapshotSchema,
  handler: async (ctx) => {
    const room = await roomManager.createRoom({
      ...ctx.input,
      roomAgentCardUrl: ctx.input.roomAgentCardUrl ?? defaultRoomAgentCardUrl,
    });
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
  description: 'Start one or more hands for a specific room.',
  input: startRoomInputSchema,
  output: roomStateSchema,
  handler: async (ctx) => {
    const summary = await roomManager.startRoom(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'recordGameEvent',
  description: 'Receive activity emitted by poker-table agents.',
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
    defaultConfig,
  });
});

app.post('/ui/rooms', async (c) => {
  try {
    const payload = await c.req.json();
    const config =
      typeof payload.config === 'object' && payload.config
        ? roomConfigSchema.parse({
            ...defaultConfig,
            ...(payload.config ?? {}),
          })
        : buildConfigFromPayload(payload);
    const launchOptions =
      payload.launchOptions ?? (payload.roomPort ? { port: Number(payload.roomPort) } : undefined);
    const explicitCard = normalizeOptionalUrl(payload.roomAgentCardUrl);
    const baseInput: Record<string, unknown> = {
      roomId: typeof payload.roomId === 'string' && payload.roomId.trim() ? payload.roomId.trim() : undefined,
      roomAgentSkills: payload.roomAgentSkills,
      config,
      launchOptions,
    };
    const resolvedCard = explicitCard ?? defaultRoomAgentCardUrl;
    if (resolvedCard) {
      baseInput.roomAgentCardUrl = resolvedCard;
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
    defaultConfig,
  });
});

export { app };
