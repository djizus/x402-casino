import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { a2a } from '@lucid-agents/a2a';
import { createAgentApp } from '@lucid-agents/hono';
import { cors } from 'hono/cors';

import {
  configureRoomInputSchema,
  registerPlayerInputSchema,
  registerPlayerResultSchema,
  startGameInputSchema,
  roomSummarySchema,
} from './protocol';
import { PokerRoom, type RoomRuntime } from './poker-room';

const defaultRoomId = process.env.ROOM_ID ?? process.env.TABLE_ID ?? 'room-1';

const runtime = await createAgent({
  name: process.env.ROOM_AGENT_NAME ?? process.env.TABLE_AGENT_NAME ?? `poker-room-${defaultRoomId}`,
  version: process.env.ROOM_AGENT_VERSION ?? process.env.TABLE_AGENT_VERSION ?? '0.1.0',
  description:
    process.env.ROOM_AGENT_DESCRIPTION ?? process.env.TABLE_AGENT_DESCRIPTION ?? 'Dedicated poker room agent responsible for game play.',
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(runtime);
app.use('*', cors());

const roomEngine = new PokerRoom(runtime as RoomRuntime, defaultRoomId);

addEntrypoint({
  key: 'configureRoom',
  description: 'Reset room configuration and register the casino callback.',
  input: configureRoomInputSchema,
  output: roomSummarySchema,
  handler: async (ctx) => {
    const summary = await roomEngine.configure(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'registerPlayer',
  description: 'Seat a player provided by the casino.',
  input: registerPlayerInputSchema,
  output: registerPlayerResultSchema,
  handler: async (ctx) => {
    const result = await roomEngine.registerPlayer(ctx.input);
    return { output: result };
  },
});

addEntrypoint({
  key: 'startRoom',
  description: 'Start one or more hands with the current roster.',
  input: startGameInputSchema,
  output: roomSummarySchema,
  handler: async (ctx) => {
    const summary = await roomEngine.startGame(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'roomSummary',
  description: 'Inspect room status.',
  output: roomSummarySchema,
  handler: async () => ({
    output: roomEngine.getSummary(),
  }),
});

app.get('/ui/state', (c) =>
  c.json({
    summary: roomEngine.getSummary(),
    events: roomEngine.getEvents(),
  }),
);

export { app };
