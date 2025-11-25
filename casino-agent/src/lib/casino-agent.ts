import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { a2a } from '@lucid-agents/a2a';
import { createAgentApp } from '@lucid-agents/hono';
import { cors } from 'hono/cors';

import {
  RegisterPlayerInput,
  StartGameInput,
  registerPlayerInputSchema,
  registerPlayerResultSchema,
  startGameInputSchema,
  tableSummarySchema,
  playerSignupResponseSchema,
} from '../../../shared/poker/types';

import { CasinoTable } from './casino-state';

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const defaultTableId = process.env.TABLE_ID ?? 'casino-table-1';

const initialConfig = startGameInputSchema.parse({
  tableId: defaultTableId,
  startingStack: toNumber(process.env.STARTING_STACK, 1),
  smallBlind: toNumber(process.env.SMALL_BLIND, 0.1),
  bigBlind: toNumber(process.env.BIG_BLIND, 1),
  maxHands: toNumber(process.env.MAX_HANDS, 1),
  minBuyIn: toNumber(process.env.MIN_BUY_IN, 0.1),
  maxBuyIn: toNumber(process.env.MAX_BUY_IN, 1),
});

const casinoName = process.env.CASINO_AGENT_NAME ?? 'casino-agent';

const runtime = await createAgent({
  name: casinoName,
  version: process.env.CASINO_AGENT_VERSION ?? '0.1.0',
  description:
    process.env.CASINO_AGENT_DESCRIPTION ??
    'Casino agent that coordinates Texas Hold\'em hands between Lucid agents.',
})
  .use(http())
  .use(a2a())
  .build();

const { app, addEntrypoint } = await createAgentApp(runtime);

app.use('*', cors());

const table = new CasinoTable(runtime, defaultTableId, casinoName);
let currentConfig: StartGameInput = initialConfig;

const ensureA2A = () => {
  if (!runtime.a2a) {
    throw new Error('Casino agent needs the a2a extension to register players.');
  }
  return runtime.a2a;
};

const clampBuyIn = (value: number | undefined): number => {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : currentConfig.startingStack;
  return Math.min(Math.max(amount, currentConfig.minBuyIn), currentConfig.maxBuyIn);
};

const registerPlayerToTable = async (rawInput: unknown) => {
  const input: RegisterPlayerInput = registerPlayerInputSchema.parse(rawInput ?? {});
  const a2aRuntime = ensureA2A();
  const card = await a2aRuntime.fetchCard(input.agentCardUrl);

  const invitation = table.buildSignupInvitation(currentConfig);
  const signupResult = await a2aRuntime.client.invoke(card, input.signupSkill ?? 'signup', invitation);
  const signup = playerSignupResponseSchema.parse(signupResult.output ?? {});
  const buyIn = clampBuyIn(signup.buyIn);

  return table.registerPlayer({
    card,
    actionSkill: input.actionSkill ?? signup.actionSkill,
    displayName: signup.displayName,
    agentCardUrl: input.agentCardUrl,
    preferredSeat: input.preferredSeat,
    startingStack: buyIn,
  });
};

const startHandsWithConfig = async (rawInput?: unknown) => {
  const overrides = startGameInputSchema.parse({
    ...currentConfig,
    ...(rawInput ?? {}),
    tableId: table.id,
  });

  currentConfig = overrides;
  return table.startGame(currentConfig);
};

addEntrypoint({
  key: 'registerPlayer',
  description: 'Register an external agent to the casino table using A2A.',
  input: registerPlayerInputSchema,
  output: registerPlayerResultSchema,
  handler: async (ctx) => {
    const registered = await registerPlayerToTable(ctx.input);
    return {
      output: registered,
    };
  },
});

addEntrypoint({
  key: 'startGame',
  description: 'Start running one or more hands with the current roster.',
  input: startGameInputSchema,
  output: tableSummarySchema,
  handler: async (ctx) => {
    const summary = await startHandsWithConfig(ctx.input);

    return {
      output: summary,
    };
  },
});

addEntrypoint({
  key: 'tableSummary',
  description: 'Inspect the table status and registered players.',
  output: tableSummarySchema,
  handler: async () => ({
    output: table.getSummary(),
  }),
});

app.get('/ui/state', (c) =>
  c.json({
    summary: table.getSummary(),
    config: currentConfig,
    events: table.getEvents(),
  }),
);

app.post('/ui/register', async (c) => {
  try {
    const payload = await c.req.json();
    const player = await registerPlayerToTable(payload);
    return c.json({ ok: true, player });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to register player.',
      },
      400,
    );
  }
});

app.post('/ui/start', async (c) => {
  try {
    const payload = await c.req.json().catch(() => ({}));
    const summary = await startHandsWithConfig(payload);
    return c.json({ ok: true, summary });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to start game.',
      },
      400,
    );
  }
});

export { app };


