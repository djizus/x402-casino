import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { a2a } from '@lucid-agents/a2a';
import { createAgentApp } from '@lucid-agents/hono';

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

app.use('/', async (c, next) => {
  if (c.req.path === '/' && c.req.method === 'GET') {
    return c.html(casinoDashboardHtml);
  }
  return next();
});

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

const casinoDashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Lucid Casino Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        background: #0f1115;
        color: #f4f4f5;
      }
      body {
        margin: 0;
        padding: 0 1.5rem 2rem;
        line-height: 1.5;
      }
      header {
        padding: 1.5rem 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      h1 {
        margin: 0;
        font-size: 2rem;
      }
      main {
        display: grid;
        gap: 1.25rem;
      }
      section.card {
        background: #181b23;
        border: 1px solid #202736;
        border-radius: 12px;
        padding: 1.25rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      }
      section.card h2 {
        margin-top: 0;
        font-size: 1.2rem;
      }
      label {
        font-size: 0.85rem;
        display: block;
        margin-bottom: 0.35rem;
        color: #b1b6c6;
      }
      input, select {
        width: 100%;
        padding: 0.5rem 0.6rem;
        border-radius: 8px;
        border: 1px solid #2b3244;
        background: #10131a;
        color: inherit;
        font-size: 0.95rem;
      }
      input:focus {
        outline: none;
        border-color: #4f9cfe;
        box-shadow: 0 0 0 1px rgba(79, 156, 254, 0.3);
      }
      button {
        border: none;
        background: linear-gradient(135deg, #4f46e5, #2563eb);
        color: #fff;
        padding: 0.65rem 1.1rem;
        border-radius: 10px;
        font-size: 0.95rem;
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.95rem;
      }
      th, td {
        padding: 0.35rem 0.5rem;
        border-bottom: 1px solid #232838;
      }
      th {
        text-align: left;
        font-weight: 600;
        color: #9ba3b8;
      }
      .status-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
        padding: 0.2rem 0.65rem;
        border-radius: 999px;
        font-size: 0.85rem;
        text-transform: capitalize;
        background: #1f2433;
        color: #e5e7ff;
      }
      .status-pill[data-status='running'] {
        background: rgba(34, 197, 94, 0.15);
        color: #4ade80;
      }
      .status-pill[data-status='waiting'] {
        background: rgba(59, 130, 246, 0.2);
        color: #60a5fa;
      }
      .status-pill[data-status='error'] {
        background: rgba(248, 113, 113, 0.2);
        color: #f87171;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.75rem;
      }
      .message {
        margin-top: 0.25rem;
        font-size: 0.9rem;
        color: #c7d2fe;
      }
      ul.events {
        list-style: none;
        padding: 0;
        margin: 0;
        max-height: 240px;
        overflow: auto;
        font-size: 0.9rem;
      }
      ul.events li {
        padding: 0.3rem 0;
        border-bottom: 1px solid #1f2433;
        color: #bac2da;
      }
      .form-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 0.85rem;
        margin-bottom: 0.9rem;
      }
      .toast {
        min-height: 1.2rem;
        font-size: 0.9rem;
        margin-top: 0.35rem;
      }
      .toast[data-kind='error'] {
        color: #f87171;
      }
      .toast[data-kind='success'] {
        color: #4ade80;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Lucid Casino</h1>
      <p>Register agents, watch the table, and start a game.</p>
    </header>
    <main>
      <section class="card">
        <h2>Table Overview</h2>
        <div class="grid">
          <div>
            <div>Status</div>
            <div class="status-pill" id="table-status">loading</div>
          </div>
          <div>
            <div>Hands Played</div>
            <strong id="hand-count">–</strong>
          </div>
          <div>
            <div>Players Seated</div>
            <strong id="player-count">–</strong>
          </div>
          <div>
            <div>Blinds</div>
            <strong id="blind-info">–</strong>
          </div>
          <div>
            <div>Buy-in Range</div>
            <strong id="buyin-info">–</strong>
          </div>
        </div>
        <p class="message" id="last-message">Waiting for updates…</p>
      </section>

      <section class="card">
        <h2>Register Player</h2>
        <form id="register-form">
          <div class="form-grid">
            <div>
              <label for="card-url">Agent Card URL</label>
              <input id="card-url" name="agentCardUrl" type="url" placeholder="https://agent.example/.well-known/agent-card.json" required />
            </div>
            <div>
              <label for="signup-skill">Signup Skill (optional)</label>
              <input id="signup-skill" name="signupSkill" placeholder="signup" />
            </div>
            <div>
              <label for="action-skill">Action Skill (optional)</label>
              <input id="action-skill" name="actionSkill" placeholder="act" />
            </div>
            <div>
              <label for="preferred-seat">Preferred Seat (optional)</label>
              <input id="preferred-seat" name="preferredSeat" type="number" min="0" placeholder="0" />
            </div>
          </div>
          <button type="submit">Register Agent</button>
          <div class="toast" id="register-toast"></div>
        </form>
      </section>

      <section class="card">
        <h2>Game Controls</h2>
        <form id="start-form">
          <div class="form-grid">
            <div>
              <label for="starting-stack">Starting Stack</label>
              <input id="starting-stack" name="startingStack" type="number" min="0.01" step="0.01" value="1" />
            </div>
            <div>
              <label for="small-blind">Small Blind</label>
              <input id="small-blind" name="smallBlind" type="number" min="0.01" step="0.01" value="0.1" />
            </div>
            <div>
              <label for="big-blind">Big Blind</label>
              <input id="big-blind" name="bigBlind" type="number" min="0.01" step="0.01" value="1" />
            </div>
            <div>
              <label for="min-buy-in">Min Buy-in</label>
              <input id="min-buy-in" name="minBuyIn" type="number" min="0.01" step="0.01" value="0.1" />
            </div>
            <div>
              <label for="max-buy-in">Max Buy-in</label>
              <input id="max-buy-in" name="maxBuyIn" type="number" min="0.01" step="0.01" value="1" />
            </div>
            <div>
              <label for="max-hands">Hands to Play</label>
              <input id="max-hands" name="maxHands" type="number" min="1" value="1" />
            </div>
          </div>
          <button type="submit">Start Game</button>
          <div class="toast" id="start-toast"></div>
        </form>
      </section>

      <section class="card">
        <h2>Players</h2>
        <table>
          <thead>
            <tr>
              <th>Seat</th>
              <th>Player</th>
              <th>Stack</th>
              <th>Action Skill</th>
            </tr>
          </thead>
          <tbody id="players-table">
            <tr><td colspan="4">No players yet.</td></tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Activity</h2>
        <ul class="events" id="events-log">
          <li>Waiting for activity…</li>
        </ul>
      </section>
    </main>
    <script>
      (() => {
        const statusEl = document.getElementById('table-status');
        const handCountEl = document.getElementById('hand-count');
        const playerCountEl = document.getElementById('player-count');
        const blindInfoEl = document.getElementById('blind-info');
        const buyInInfoEl = document.getElementById('buyin-info');
        const lastMessageEl = document.getElementById('last-message');
        const playersTable = document.getElementById('players-table');
        const eventsList = document.getElementById('events-log');
        const registerForm = document.getElementById('register-form');
        const startForm = document.getElementById('start-form');
        const registerToast = document.getElementById('register-toast');
        const startToast = document.getElementById('start-toast');

        const updateToast = (el, kind, text) => {
          el.dataset.kind = kind;
          el.textContent = text;
        };

        const fillTable = (players) => {
          if (!players || players.length === 0) {
            playersTable.innerHTML = '<tr><td colspan="4">No players yet.</td></tr>';
            return;
          }
          playersTable.innerHTML = players
            .map(
              (player) =>
                '<tr>' +
                '<td>' + player.seatNumber + '</td>' +
                '<td>' + player.displayName + '</td>' +
                '<td>' + player.stack + '</td>' +
                '<td>' + player.actionSkill + '</td>' +
                '</tr>',
            )
            .join('');
        };

        const fillEvents = (events) => {
          if (!events || events.length === 0) {
            eventsList.innerHTML = '<li>No events recorded yet.</li>';
            return;
          }
          eventsList.innerHTML = events
            .slice(-50)
            .reverse()
            .map((entry) => '<li>' + entry + '</li>')
            .join('');
        };

        const formatAmount = (value) => {
          const num = Number(value);
          if (!Number.isFinite(num)) return String(value);
          return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
        };

        const refreshState = async () => {
          try {
            const res = await fetch('/ui/state');
            if (!res.ok) throw new Error('Failed to fetch casino state.');
            const data = await res.json();
            const summary = data.summary;
            const config = data.config;

            statusEl.textContent = summary.status;
            statusEl.dataset.status = summary.status;
            handCountEl.textContent = summary.handCount;
            playerCountEl.textContent = summary.players.length;
            blindInfoEl.textContent = formatAmount(config.smallBlind) + ' / ' + formatAmount(config.bigBlind);
            buyInInfoEl.textContent = formatAmount(config.minBuyIn) + ' - ' + formatAmount(config.maxBuyIn);
            lastMessageEl.textContent = summary.message || 'No recent activity.';

            fillTable(summary.players);
            fillEvents(data.events);

            document.getElementById('starting-stack').value = config.startingStack;
            document.getElementById('small-blind').value = config.smallBlind;
            document.getElementById('big-blind').value = config.bigBlind;
            document.getElementById('min-buy-in').value = config.minBuyIn;
            document.getElementById('max-buy-in').value = config.maxBuyIn;
            document.getElementById('max-hands').value = config.maxHands;
          } catch (error) {
            console.warn('Failed to refresh state', error);
          }
        };

        registerForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          registerToast.textContent = '';
          const formData = new FormData(registerForm);
          const payload = {
            agentCardUrl: formData.get('agentCardUrl'),
            signupSkill: formData.get('signupSkill') || undefined,
            actionSkill: formData.get('actionSkill') || undefined,
          };
          const seat = formData.get('preferredSeat');
          if (seat) {
            payload.preferredSeat = Number(seat);
          }

          try {
            const res = await fetch('/ui/register', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || 'Registration failed.');
            }
            updateToast(registerToast, 'success', 'Player registered: ' + data.player.displayName);
            registerForm.reset();
            refreshState();
          } catch (error) {
            updateToast(registerToast, 'error', error.message);
          }
        });

        startForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          startToast.textContent = '';

          const formData = new FormData(startForm);
          const payload = {
            startingStack: Number(formData.get('startingStack')),
            smallBlind: Number(formData.get('smallBlind')),
            bigBlind: Number(formData.get('bigBlind')),
            minBuyIn: Number(formData.get('minBuyIn')),
            maxBuyIn: Number(formData.get('maxBuyIn')),
            maxHands: Number(formData.get('maxHands')),
          };

          try {
            const res = await fetch('/ui/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) {
              throw new Error(data.error || 'Failed to start game.');
            }
            updateToast(startToast, 'success', 'Game started.');
            refreshState();
          } catch (error) {
            updateToast(startToast, 'error', error.message);
          }
        });

        refreshState();
        setInterval(refreshState, 4000);
      })();
    </script>
  </body>
</html>`;
