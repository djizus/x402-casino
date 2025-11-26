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
  createRoomInputSchema,
  registerPlayerInputSchema,
  registerPlayerResultSchema,
  roomSnapshotSchema,
  startRoomInputSchema,
  tableConfigSchema,
  tableEventSchema,
  tableSummarySchema,
  casinoStateSchema,
} from './protocol';
import { RoomManager, type CasinoRuntime } from './room-manager';

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const casinoName = process.env.CASINO_AGENT_NAME ?? 'casino-agent';
const casinoCardUrl = process.env.CASINO_AGENT_CARD_URL;

if (!casinoCardUrl) {
  throw new Error('CASINO_AGENT_CARD_URL must be set so table agents can send events back to the casino.');
}

const defaultTableAgentCardUrl = process.env.DEFAULT_TABLE_AGENT_CARD_URL;

const defaultConfig = tableConfigSchema.parse({
  startingStack: toNumber(process.env.STARTING_STACK, 1),
  smallBlind: toNumber(process.env.SMALL_BLIND, 0.1),
  bigBlind: toNumber(process.env.BIG_BLIND, 1),
  maxHands: toNumber(process.env.MAX_HANDS, 1),
  minBuyIn: toNumber(process.env.MIN_BUY_IN, 0.1),
  maxBuyIn: toNumber(process.env.MAX_BUY_IN, 1),
});

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
);

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
  description: 'Create a new poker room and bind a table agent to it.',
  input: createRoomInputSchema,
  output: roomSnapshotSchema,
  handler: async (ctx) => {
    const tableAgentCardUrl = ctx.input.tableAgentCardUrl ?? defaultTableAgentCardUrl;
    if (!tableAgentCardUrl) {
      throw new Error('A tableAgentCardUrl must be provided via input or DEFAULT_TABLE_AGENT_CARD_URL.');
    }
    const room = await roomManager.createRoom({
      ...ctx.input,
      tableAgentCardUrl,
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
  output: tableSummarySchema,
  handler: async (ctx) => {
    const summary = await roomManager.startRoom(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'recordGameEvent',
  description: 'Receive activity emitted by poker-table agents.',
  input: tableEventSchema,
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
    const parsed = createRoomInputSchema.parse({
      config: defaultConfig,
      ...payload,
    });
    const tableAgentCardUrl = parsed.tableAgentCardUrl ?? defaultTableAgentCardUrl;
    if (!tableAgentCardUrl) {
      throw new Error('DEFAULT_TABLE_AGENT_CARD_URL is not set and tableAgentCardUrl was not provided.');
    }
    const room = await roomManager.createRoom({
      ...parsed,
      tableAgentCardUrl,
    });
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
