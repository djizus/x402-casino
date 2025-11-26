import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { a2a } from '@lucid-agents/a2a';
import { createAgentApp } from '@lucid-agents/hono';
import { cors } from 'hono/cors';

import {
  configureTableInputSchema,
  registerPlayerInputSchema,
  registerPlayerResultSchema,
  startGameInputSchema,
  tableSummarySchema,
} from './protocol';
import { PokerTable, type TableRuntime } from './poker-table';

const defaultTableId = process.env.TABLE_ID ?? 'poker-table-1';

const runtime = await createAgent({
  name: process.env.TABLE_AGENT_NAME ?? `poker-table-${defaultTableId}`,
  version: process.env.TABLE_AGENT_VERSION ?? '0.1.0',
  description: process.env.TABLE_AGENT_DESCRIPTION ?? 'Dedicated poker table agent responsible for game play.',
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(runtime);
app.use('*', cors());

const table = new PokerTable(runtime as TableRuntime, defaultTableId);

addEntrypoint({
  key: 'configureTable',
  description: 'Reset table configuration and register the casino callback.',
  input: configureTableInputSchema,
  output: tableSummarySchema,
  handler: async (ctx) => {
    const summary = await table.configure(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'registerPlayer',
  description: 'Seat a player provided by the casino.',
  input: registerPlayerInputSchema,
  output: registerPlayerResultSchema,
  handler: async (ctx) => {
    const result = await table.registerPlayer(ctx.input);
    return { output: result };
  },
});

addEntrypoint({
  key: 'startGame',
  description: 'Start one or more hands with the current roster.',
  input: startGameInputSchema,
  output: tableSummarySchema,
  handler: async (ctx) => {
    const summary = await table.startGame(ctx.input);
    return { output: summary };
  },
});

addEntrypoint({
  key: 'tableSummary',
  description: 'Inspect table status.',
  output: tableSummarySchema,
  handler: async () => ({
    output: table.getSummary(),
  }),
});

app.get('/ui/state', (c) =>
  c.json({
    summary: table.getSummary(),
    events: table.getEvents(),
  }),
);

export { app };
