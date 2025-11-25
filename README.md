# Lucid Poker Agents

This repo hosts a tiny Texas Hold’em playground powered by the Lucid Agents framework. A casino agent (“house”) coordinates games, and multiple player agents can register via A2A to battle each other. The poker logic is intentionally simple today (bets aren’t settled yet), but it demonstrates typed entrypoints, LLM-backed strategies, and a dashboard for operator control.

## Directory Layout

| Path | Description |
| --- | --- |
| `casino-agent/` | Lucid agent that runs the table, exposes entrypoints/UI, and calls each player’s `act` skill when it’s their turn |
| `agent-player-1/` | Gemini-backed player agent (defaults to `gemini-1.5-pro`) |
| `agent-player-2/` | GPT-backed player agent (defaults to `gpt-4.1-mini`) |
| `shared/poker/` | Types and deck helpers used across the casino and players (card schema, action payloads, etc.) |

Each player folder is a standalone Lucid project, so others can clone one template, wire up their own `signup`/`act` entrypoints, and point the casino at their agent card URL.

## Prerequisites

- Bun ≥ 1.0
- Node 20+ (if running via Node)
- API keys:
  - Player 1: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
  - Player 2: `OPENAI_API_KEY`
- Optional: `CASINO_AGENT_NAME`, buy-in + blind overrides, etc.

## Running the System

1. **Casino (UI + entrypoints)**
   ```bash
   cd casino-agent
   bun install
   PORT=4000 bun run dev
   ```
   Visit `http://localhost:4000/` for the dashboard. There you can register agents, tweak blinds/buy-ins, and start games. The UI uses the `/ui/*` JSON routes in `casino-agent/src/lib/casino-agent.ts`.

2. **Player Agents**
   ```bash
   # Player 1 (Gemini)
   cd agent-player-1
   bun install
   GEMINI_API_KEY=... PORT=4101 bun run dev

   # Player 2 (GPT)
   cd agent-player-2
   bun install
   OPENAI_API_KEY=... PORT=4102 bun run dev
   ```
   Point the casino at each player’s agent card URL (e.g. `http://localhost:4101/.well-known/agent-card.json`). Registration can be done via the dashboard form or by calling the `registerPlayer` entrypoint.

3. **Start a Game**
   - Ensure at least two players are registered.
   - Use the “Game Controls” form or call `/entrypoints/startGame/invoke`.
   - Watch the Activity feed and table summary to see each agent’s actions.

## Building Your Own Player

1. Scaffold a new Lucid agent (e.g. `bunx @lucid-agents/cli my-new-player`).
2. Implement two entrypoints:
   - `signup`: receives the casino invitation (`minBuyIn`, `maxBuyIn`, blinds) and returns `{ displayName, actionSkill, buyIn }`.
   - `act`: receives the current hand state and returns `{ action, amount?, message? }`.
3. Deploy it and give the casino its agent card URL.

The `shared/poker/types.ts` file shows the exact Zod schemas the casino and sample players use. Following that contract is enough to participate in the table.

## Dashboard Routes

- `GET /` – Casino dashboard (HTML)
- `GET /ui/state` – Summary JSON (`tableSummary`, config, event log)
- `POST /ui/register` – Body `{ agentCardUrl, signupSkill?, actionSkill?, preferredSeat? }`
- `POST /ui/start` – Body `{ startingStack, smallBlind, bigBlind, minBuyIn, maxBuyIn, maxHands }`

Entry points remain available at `/entrypoints/*/invoke` if you need to script interactions manually.

## Next Ideas

- Extend the casino logic to settle pots and adjust stacks.
- Add timeouts/penalties for slow players.
- Publish player templates showing tool use, memory, or payments via the Daydreams router.
- Move the dashboard into its own frontend if you want richer visualizations.

Enjoy building and let us know if you create new poker agents to pit against the house!
