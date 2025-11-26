# Lucid Poker Agents

This repo hosts a tiny Texas Hold’em playground powered by the Lucid Agents framework. A casino lobby agent coordinates rooms, dedicated poker-table agents run games, and multiple player agents register via A2A to battle each other. The poker logic is intentionally simple but still settles pots, demonstrates typed entrypoints, LLM-backed strategies, and a dashboard for operator control.

## Directory Layout

| Path | Description |
| --- | --- |
| `casino-agent/` | Casino “lobby” agent that exposes entrypoints/REST API, manages rooms, and relays registrations to table agents |
| `poker-table-agent/` | Dedicated game agent that encapsulates Texas Hold’em logic and streams events back to the casino |
| `agent-player-1/` | Gemini-backed player agent (defaults to `gemini-1.5-pro`) |
| `agent-player-2/` | GPT-backed player agent (defaults to `gpt-4.1-mini`) |
| `casino-dashboard/` | Standalone Vite/React UI that consumes the lobby REST API, manages rooms, and displays activity |

Each player folder is a standalone Lucid project, so others can clone one template, wire up their own `signup`/`act` entrypoints, and point the casino at their agent card URL.

## Prerequisites

- Bun ≥ 1.0
- Node 20+ (if running via Node)
- API keys:
  - Player 1: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
  - Player 2: `OPENAI_API_KEY`
- Optional: `CASINO_AGENT_NAME`, buy-in + blind overrides, etc.

## Running the System

1. **Casino Lobby (entrypoints + REST API)**
   ```bash
   cd casino-agent
   bun install
   CASINO_AGENT_CARD_URL=http://localhost:4000/.well-known/agent-card.json \
   DEFAULT_TABLE_AGENT_CARD_URL=http://localhost:4500/.well-known/agent-card.json \
   PORT=4000 bun run dev
   ```
   The casino now exposes `/entrypoints/*` plus `/ui/rooms`, `/ui/rooms/:roomId`, and room-scoped `/register`/`/start` routes. Configure `CASINO_AGENT_CARD_URL` so poker-table agents know where to send events, and `DEFAULT_TABLE_AGENT_CARD_URL` so new rooms can automatically bind to a table agent.

2. **Poker Table Agent(s)**
   ```bash
   cd poker-table-agent
   bun install
   PORT=4500 bun run dev
   ```
   Spin up one instance per physical table you want to offer. Each instance publishes its own agent card URL; provide that URL when creating rooms so the casino can configure it.

3. **Dashboard**
   ```bash
   cd casino-dashboard
   bun install
   bun run dev
   ```
   By default the dashboard expects the casino at `http://localhost:4000`. Override with `VITE_CASINO_URL=http://<host>:<port>` if needed, and optionally `VITE_TABLE_AGENT_CARD_URL` to pre-fill the “Create Room” form. It polls `/ui/rooms` for the lobby overview and `/ui/rooms/:roomId` for the selected room.

4. **Player Agents**
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
   Point the casino at each player’s agent card URL (e.g. `http://localhost:4101/.well-known/agent-card.json`). Registration is scoped to a room and can be done via the dashboard form or by calling the lobby’s `registerPlayer` entrypoint with `roomId`.

5. **Create a Room & Start Hands**
   - From the dashboard, create a room by supplying a `tableAgentCardUrl` (or rely on the default env). This invokes the casino’s `createRoom` entrypoint which configures the poker-table agent.
   - Register at least two players to that room.
   - Use the “Room Controls” form or call `/entrypoints/startRoom/invoke` with `{ roomId, overrides? }`.
   - The poker-table agent drives gameplay via A2A, and the casino displays its events in the Activity feed.

## Building Your Own Player

1. Scaffold a new Lucid agent (e.g. `bunx @lucid-agents/cli my-new-player`).
2. Implement two entrypoints:
   - `signup`: receives the casino invitation (`minBuyIn`, `maxBuyIn`, blinds) and returns `{ displayName, actionSkill, buyIn }`.
   - `act`: receives the current hand state and returns `{ action, amount?, message? }`.
3. Deploy it and give the casino its agent card URL.

Refer to `casino-agent/PROTOCOL.md` (or the copies inside each player project) for the exact Zod schemas that the casino and poker-table agents expect. Following those contracts is enough to sit in any room.

## Lobby + Table Routes

The lobby exposes:

- `GET /ui/rooms` – Lobby summary (`rooms`, `defaultConfig`)
- `POST /ui/rooms` – Create a room. Body `{ roomId?, tableId?, tableAgentCardUrl?, startingStack, ... }`
- `GET /ui/rooms/:roomId` – Live snapshot of a specific room
- `POST /ui/rooms/:roomId/register` – Register a player to that room
- `POST /ui/rooms/:roomId/start` – Start hands with optional overrides (`maxHands`, `smallBlind`, `bigBlind`)

Entry points mirror these capabilities:

- `createRoom`
- `registerPlayer`
- `startRoom`
- `listRooms`
- `recordGameEvent` (callback for poker-table agents)

Each poker-table agent exposes its own card with entrypoints (`configureTable`, `registerPlayer`, `startGame`, `tableSummary`) and only communicates with the casino via A2A.

## Next Ideas

- Extend the casino logic to settle pots and adjust stacks.
- Add timeouts/penalties for slow players.
- Publish player templates showing tool use, memory, or payments via the Daydreams router.
- Move the dashboard into its own frontend if you want richer visualizations.

Enjoy building and let us know if you create new poker agents to pit against the house!
