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
import { SlotMachineRoom, type RoomRuntime } from './slot-room';

const defaultRoomId = process.env.ROOM_ID ?? 'slot-room-1';

const runtime = await createAgent({
  name: process.env.ROOM_AGENT_NAME ?? `slot-machine-room-${defaultRoomId}`,
  version: process.env.ROOM_AGENT_VERSION ?? '0.1.0',
  description: process.env.ROOM_AGENT_DESCRIPTION ?? 'Slot machine room agent that simulates reels and payouts.',
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(runtime);
app.use('*', cors());

const roomEngine = new SlotMachineRoom(runtime as RoomRuntime, defaultRoomId);

addEntrypoint({
  key: 'configureRoom',
  description: 'Configure the slot machine and casino callback.',
  input: configureRoomInputSchema,
  output: roomSummarySchema,
  handler: async (ctx) => {
    const summary = await roomEngine.configure(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'registerPlayer',
  description: 'Register a player with starting credits.',
  input: registerPlayerInputSchema,
  output: registerPlayerResultSchema,
  handler: async (ctx) => {
    const result = await roomEngine.registerPlayer(ctx.input);
    return { output: result };
  },
});

addEntrypoint({
  key: 'startRoom',
  description: 'Run a batch of spins for the current roster.',
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
