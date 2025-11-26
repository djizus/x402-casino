# Lucid Casino Agents

This repo hosts a tiny Lucid “casino” playground powered by the Lucid Agents framework. A casino lobby agent coordinates rooms, dedicated game agents (currently Texas Hold’em and a slot machine) run the underlying experiences, and multiple player agents register via A2A to battle each other. The logic is intentionally simple but still settles pots/spins, demonstrates typed entrypoints, LLM-backed strategies, and a dashboard for operator control.

## Directory Layout

| Path | Description |
| --- | --- |
| `casino-agent/` | Casino “lobby” agent that exposes entrypoints/REST API, manages rooms, and relays registrations to table agents |
| `poker-room-agent/` | Dedicated poker room agent that encapsulates the Texas Hold’em logic |
| `slot-machine-room-agent/` | Slot machine room agent that simulates reels, payouts, and busts |
| `blackjack-room-agent/` | Blackjack room agent that simulates rounds vs. the dealer |
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
   ROOM_AGENT_AUTOSPAWN=true \
   ROOM_AGENT_WORKDIR=../poker-room-agent \
   ROOM_AGENT_PORT_START=4500 \
   ROOM_AGENT_PORT_END=4600 \
   SLOT_ROOM_AGENT_AUTOSPAWN=true \
   SLOT_ROOM_AGENT_WORKDIR=../slot-machine-room-agent \
   SLOT_ROOM_AGENT_PORT_START=4700 \
   SLOT_ROOM_AGENT_PORT_END=4800 \
   BLACKJACK_ROOM_AGENT_AUTOSPAWN=true \
   BLACKJACK_ROOM_AGENT_WORKDIR=../blackjack-room-agent \
   BLACKJACK_ROOM_AGENT_PORT_START=4800 \
   BLACKJACK_ROOM_AGENT_PORT_END=4900 \
   PORT=4000 bun run dev
   ```
   The casino exposes `/entrypoints/*` plus `/ui/rooms`, `/ui/rooms/:roomId`, and room-scoped `/register`/`/start` routes. By default it also **auto-spawns** poker, slot, and blackjack room agents (one port per room) using the local projects. Set `ROOM_AGENT_AUTOSPAWN=false`, `SLOT_ROOM_AGENT_AUTOSPAWN=false`, or `BLACKJACK_ROOM_AGENT_AUTOSPAWN=false` plus matching `DEFAULT_*_ROOM_AGENT_CARD_URL=<remote card>` if you prefer to attach runners manually.

2. **Poker Table Agent(s) (optional)**
   ```bash
   cd poker-room-agent
   bun install
   PORT=4500 bun run dev
   ```
   Run this only if you disabled auto-spawn mode or want to debug a specific table instance. Each instance publishes its own agent card URL; provide that URL when creating rooms so the casino can configure it.

3. **Slot Machine Agent (optional)**
   ```bash
   cd slot-machine-room-agent
   bun install
   PORT=4700 bun run dev
   ```
   Run this to debug or deploy slot rooms manually (otherwise the casino will spawn them within the configured port range).

4. **Blackjack Agent (optional)**
   ```bash
   cd blackjack-room-agent
   bun install
   PORT=4800 bun run dev
   ```
   Run this to debug or deploy blackjack rooms manually (otherwise the casino will spawn them within the configured port range).

5. **Dashboard**
   ```bash
   cd casino-dashboard
   bun install
   bun run dev
   ```
   By default the dashboard expects the casino at `http://localhost:4000`. Override with `VITE_CASINO_URL=http://<host>:<port>` if needed, and optionally `VITE_ROOM_AGENT_CARD_URL` to pre-fill the “Create Room” form. It polls `/ui/rooms` for the lobby overview and `/ui/rooms/:roomId` for the selected room.

6. **Player Agents**
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

7. **Create a Room & Start Games**
   - From the dashboard, pick a **game type** (poker vs. slot machine vs. blackjack) and tweak its config fields. This invokes the casino’s `createRoom` entrypoint which configures the target game agent.
   - Each room receives its own dedicated endpoint (unique port) plus an agent card URL. The room list (`GET /ui/rooms`) shows both so agents can decide where to sit/spin.
   - For poker, register players until all seats are filled; the casino will automatically start the room when capacity is reached (you can still call `/entrypoints/startRoom/invoke` manually). Slot rooms let the operator start spins for any seated players, and blackjack rooms run rounds whenever at least one player is seated.
   - Game agents drive gameplay via A2A, and the casino displays their events in the Activity feed.

## Building Your Own Player

1. Scaffold a new Lucid agent (e.g. `bunx @lucid-agents/cli my-new-player`).
2. Implement two entrypoints:
   - `signup`: receives the casino invitation (`minBuyIn`, `maxBuyIn`, blinds) and returns `{ displayName, actionSkill, buyIn }`.
   - `act`: receives the current hand state and returns `{ action, amount?, message? }`.
3. Deploy it and give the casino its agent card URL.

Refer to `casino-agent/PROTOCOL.md` (or the copies inside each player project) for the exact Zod schemas that the casino and room agents expect. Following those contracts is enough to sit in any poker room (slot rooms just need the casino callback).

## Lobby + Room Routes

The lobby exposes:

- `GET /ui/rooms` – Lobby summary (`rooms`, `games`, `defaultGameType`)
- `POST /ui/rooms` – Create a room. Body `{ roomId?, gameType, config, roomAgentCardUrl?, launchOptions? }`
- `GET /ui/rooms/:roomId` – Live snapshot of a specific room
- `POST /ui/rooms/:roomId/register` – Register a player to that room
- `POST /ui/rooms/:roomId/start` – Start hands with optional overrides (`maxHands`, `smallBlind`, `bigBlind`)

Entry points mirror these capabilities:

- `createRoom`
- `registerPlayer`
- `startRoom`
- `listRooms`
- `recordGameEvent` (callback for all game agents)

Responses from `listRooms`/`/ui/rooms` include each room’s `roomAgentCardUrl`, `gameType`, and (when auto-spawned) `roomBaseUrl`, so other agents or tools can talk to a specific room endpoint directly. When creating rooms programmatically you can also supply `launchOptions.port` to pin a room agent to a specific port. Once a poker room has `maxPlayers` players registered, the casino automatically invokes `startRoom` so play begins immediately; other game types can decide their own auto-start logic.

Each room agent exposes its own card with entrypoints (`configureRoom`, `registerPlayer`, `startRoom`, `roomSummary`) and only communicates with the casino via A2A. The slot machine agent uses the shared callback to emit spin updates/busts.

## Next Ideas

- Extend the casino logic to settle pots and adjust stacks.
- Add timeouts/penalties for slow players.
- Publish player templates showing tool use, memory, or payments via the Daydreams router.
- Move the dashboard into its own frontend if you want richer visualizations.

Enjoy building and let us know if you create new room agents to pit against the house!
