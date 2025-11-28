# Lucid Casino Agents

Lucid Casino is a miniature playground for the Lucid Agents framework. A casino **lobby agent** exposes typed entrypoints and REST routes, **room agents** (Texas Hold’em, a slot machine, Blackjack) handle gameplay, **player agents** sit at tables through A2A, and a **React dashboard** keeps operators in the loop. The projects are intentionally lightweight so you can study a multi-agent system end-to-end and remix any of the components for your own rooms or players.

## Repository Layout

| Path | Role | Notes |
| --- | --- | --- |
| `casino-agent/` | Lobby + REST API | Coordinates rooms, relays registrations, records events, auto-spawns room agents |
| `poker-room-agent/` | Game agent | No-limit Texas Hold’em engine with buy-in enforcement and typed entrypoints |
| `slot-machine-room-agent/` | Game agent | Multi-player slot machine simulator capable of batching spins |
| `blackjack-room-agent/` | Game agent | Blackjack vs. dealer with configurable stacks, bets, and decks |
| `agent-player-1/` | Player template | Gemini-backed player that falls back to heuristics |
| `agent-player-2/` | Player template | GPT-backed player that prefers pressure play |
| `casino-dashboard/` | Operator UI | Vite/React dashboard hitting `/ui/*` routes |
| `README_LUCID_AGENTS.md` | Reference | High-level docs for the Lucid Agents framework itself |

Every folder (agents, dashboard) is a standalone Bun project. Running `bun install` inside `casino-agent` triggers a `postinstall` script (`scripts/install-all.ts`) that installs all subprojects so you only need a single install command.

## Architecture at a Glance

1. The **casino lobby** exposes `createRoom`, `registerPlayer`, `startRoom`, `listRooms`, and `recordGameEvent` entrypoints plus `/ui` REST mirrors.
2. Creating a room wires it to a **room agent**. If auto-spawn mode is enabled, the lobby launches a local Bun process per room and forwards game events back to itself.
3. **Player agents** fetch the casino’s AgentCard, call `registerPlayer`, and then receive invitations + hand states from the room agent via A2A calls to their `signup`/`play` entrypoints.
4. The **dashboard** polls `/ui/rooms` and `/ui/rooms/:roomId`, letting operators create rooms, register cards, and monitor activity feeds.

## Requirements

- [Bun](https://bun.sh) ≥ 1.0 (Node 20+ also works but Bun tooling is the default)
- API keys for whichever model(s) you want the player agents to use:
  - Player 1: `GEMINI_API_KEY` or `GOOGLE_API_KEY`
  - Player 2: `OPENAI_API_KEY`
- A reachable AgentCard URL for the casino lobby (`CASINO_AGENT_CARD_URL`)
- Optional: wallets, additional Lucid extensions, or any other runtime configuration supported by Lucid Agents

## Quick Start

1. **Clone and install dependencies**
   ```bash
   cd casino-agent
   bun install
   ```
   The `postinstall` script installs dependencies for every sub-project so you’re ready to boot any component.

2. **Start the casino lobby (auto-spawns room agents by default)**
   ```bash
   cd casino-agent
   CASINO_AGENT_CARD_URL=http://localhost:4000/.well-known/agent-card.json \
   ROOM_AGENT_AUTOSPAWN=true \
   SLOT_ROOM_AGENT_AUTOSPAWN=true \
   BLACKJACK_ROOM_AGENT_AUTOSPAWN=true \
   PORT=4000 bun run dev
   ```
   Override the env vars documented below to pin different ports, attach remote room agents, or disable auto-spawn behavior.

3. **Run the player agents**
   ```bash
   # Player 1 (Gemini, defaults to gemini-1.5-pro)
   cd agent-player-1
   GEMINI_API_KEY=... PORT=4101 bun run dev

   # Player 2 (GPT, defaults to gpt-4.1-mini)
   cd agent-player-2
   OPENAI_API_KEY=... PORT=4102 bun run dev
   ```
   Each player publishes `.well-known/agent-card.json`. Supply those URLs when registering with a room.

4. **Launch the dashboard**
   ```bash
   cd casino-dashboard
   bun install
   bun run dev
   ```
   Point your browser at the dev server (default `http://localhost:5173`). The UI hits `http://localhost:4000` unless you override `VITE_CASINO_URL`.

5. **Create rooms and start games**
   - Create a room in the dashboard or via `POST /ui/rooms`
   - Register player cards with `/ui/rooms/:roomId/register`
   - Poker starts automatically once seats are full; slots and blackjack can be kicked off manually from the dashboard or by calling `/ui/rooms/:roomId/start`

## Service Guides

### Casino Lobby (`casino-agent/`)

The lobby is a Lucid HTTP agent + REST API that manages room lifecycles, launches embedded room agents, proxies registration, and records game events for UI consumption.

```bash
cd casino-agent
CASINO_AGENT_CARD_URL=http://localhost:4000/.well-known/agent-card.json \
PORT=4000 bun run dev
```

- Auto-launches poker, slot, and blackjack agents by default (uses Bun to spawn `src/index.ts` inside each project)
- `RoomManager` keeps track of all rooms, snapshots, events, and handles graceful shutdown
- `/ui/state` exposes a combined summary useful for debugging outside the dashboard

#### Core Environment Variables

| Variable | Description | Default |
| --- | --- | --- |
| `CASINO_AGENT_CARD_URL` | Public AgentCard URL (required so room agents can send callbacks) | _none_ |
| `CASINO_AGENT_NAME` | Name shown in cards + invitations | `casino-agent` |
| `CASINO_AGENT_VERSION` / `CASINO_AGENT_DESCRIPTION` | Metadata for the AgentCard | `0.2.0` / canned text |
| `PORT` | HTTP port for the lobby | `4000` |
| `DEFAULT_GAME_TYPE` | Initial selection in UI + default when omitted in requests (`poker`, `slot-machine`, `blackjack`) | `poker` |

#### Embedded Room Launchers

| Variable | Purpose | Default |
| --- | --- | --- |
| `ROOM_AGENT_AUTOSPAWN` | Enable/disable local poker room spawning (`false` when attaching remote rooms) | `true` |
| `ROOM_AGENT_WORKDIR` | Folder for the poker room template | `../poker-room-agent` |
| `ROOM_AGENT_BIN` / `ROOM_AGENT_ARGS` | Command + args used to start poker rooms | `bun` / `run src/index.ts` |
| `ROOM_AGENT_PORT_START` / `ROOM_AGENT_PORT_END` | Port range to choose from when spawning poker rooms | `4500`–`4600` |
| `DEFAULT_ROOM_AGENT_CARD_URL` | Static poker room card when not auto-spawning | _unset_ |
| `SLOT_ROOM_AGENT_*` | Same knobs for slot rooms (`../slot-machine-room-agent`, ports `4700`–`4800`) | varies |
| `BLACKJACK_ROOM_AGENT_*` | Same knobs for blackjack rooms (`../blackjack-room-agent`, ports `4800`–`4900`) | varies |

If you disable auto-spawn for a game, set `DEFAULT_*_ROOM_AGENT_CARD_URL` (or `*_ROOM_AGENT_CARD_URL`) to your deployed room agent’s card so the casino can configure it.

#### Default Game Config Overrides

| Poker | Description | Default |
| --- | --- | --- |
| `POKER_STARTING_STACK` / `STARTING_STACK` | Starting chips for each seat | `1000` |
| `POKER_SMALL_BLIND` / `SMALL_BLIND` | Small blind | `5` |
| `POKER_BIG_BLIND` / `BIG_BLIND` | Big blind | `10` |
| `POKER_MAX_HANDS` / `MAX_HANDS` | Hands to run per `startRoom` | `1000` |
| `POKER_MIN_BUY_IN` / `MIN_BUY_IN` | Min buy-in during signup | `100` |
| `POKER_MAX_BUY_IN` / `MAX_BUY_IN` | Max buy-in | `100` |
| `POKER_MAX_PLAYERS` / `MAX_PLAYERS` | Seats per table (clamped 2–10) | `8` |
| `POKER_BUY_IN_PRICE` / `BUY_IN_PRICE` | USD price charged via x402 per registration | `1` |

| Slot Machine | Description | Default |
| --- | --- | --- |
| `SLOT_MAX_PLAYERS` | Room capacity | `4` |
| `SLOT_MAX_SPINS` | Spins per batch | `20` |
| `SLOT_SPIN_COST` | Credits burned per spin | `1` |
| `SLOT_JACKPOT_MULTIPLIER` | Jackpot payout multiplier | `25` |
| `SLOT_PAIR_MULTIPLIER` | Pair payout multiplier | `3` |
| `SLOT_REELS` | Reel count (3–5) | `3` |

| Blackjack | Description | Default |
| --- | --- | --- |
| `BLACKJACK_MAX_PLAYERS` | Seats per room (1–6) | `4` |
| `BLACKJACK_STARTING_STACK` | Chips given to each player | `20` |
| `BLACKJACK_MIN_BET` / `BLACKJACK_MAX_BET` | Betting bounds | `1` / `5` |
| `BLACKJACK_BLACKJACK_PAYOUT` | Blackjack payout ratio | `1.5` |
| `BLACKJACK_ROUNDS` | Rounds per session (`roundsPerSession`) | `5` |
| `BLACKJACK_DECKS` | Deck count (1–8) | `4` |

#### Registration Paywall / DPS

| Variable | Purpose | Default |
| --- | --- | --- |
| `DPS_FACILITATOR_URL` | Base URL for the DPS-powered x402 facilitator | `http://localhost:3002` |
| `PAYMENTS_NETWORK` | Network identifier for USDC payments (`base`, `base-sepolia`, …) | `base-sepolia` |
| `PAYMENTS_RECEIVABLE_ADDRESS` | Address that receives poker registration payments | _unset_ |
| `DPS_PAYER_PRIVATE_KEY` | Private key the casino uses to pay DPS invoices | _unset_ |

Run `bun run dev` inside `dps-facilitator/` to launch the local facilitator (copied from `old/DPS-DEMO`). The casino agent now requires this service to issue dynamic quotes, so make sure it’s running before you start the lobby.
### Room Agents (`poker-room-agent/`, `slot-machine-room-agent/`, `blackjack-room-agent/`)

Each room agent is a Lucid agent that exposes `configureRoom`, `registerPlayer`, `startRoom`, and `roomSummary`. Rooms only speak to the casino via A2A and expect a callback pointing to the lobby’s `recordGameEvent` entrypoint.

- Default ports: poker `4500`, slot `4700`, blackjack `4800`
- Shared env vars:
  - `PORT` – HTTP port
  - `ROOM_ID` (or `TABLE_ID` for poker) – default identifier to advertise
  - `ROOM_AGENT_NAME`, `ROOM_AGENT_VERSION`, `ROOM_AGENT_DESCRIPTION` – metadata for the AgentCard
- Poker-only logic tracks blinds, stacks, and uses the `hand-evaluator` helper
- Slot/blackjack agents keep an event log accessible via `GET /ui/state` for debugging

Run `bun install && bun run dev` inside any room folder when you want to run it independently of the lobby launcher.

### Player Agents (`agent-player-1/`, `agent-player-2/`)

Both players are Lucid HTTP agents with a `signup` and `play` entrypoint. The casino invites them with the table limits, then the room agent calls `play` each time the player needs to decide. Signup responses only return the player's display name—the casino handles stacks and targets the `play` action skill configured during registration.

| Player 1 (Gemini) | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` → override in quick start |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `AX_GEMINI_API_KEY` | API key(s) used by the AxLLM client | _required for LLM play_ |
| `PLAYER_MODEL` | Gemini model id | `gemini-1.5-pro` |
| `PLAYER_DISPLAY_NAME` | Name reported during signup | `Player One` |

| Player 2 (GPT) | Description | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` / `AX_OPENAI_API_KEY` | API key for GPT decisions | _required for LLM play_ |
| `PLAYER_MODEL` | OpenAI model id | `gpt-4.1-mini` |
| `PLAYER_DISPLAY_NAME` | Name reported during signup | `Player Two` |
| `PLAYER_AGGRESSION` | Heuristic aggression factor (0–1) | `0.6` |

Both agents fall back to deterministic heuristics when the Ax LLM client is not configured, so you can still run local demos without API keys.

### Dashboard (`casino-dashboard/`)

React + Vite UI that consumes `/ui/rooms` and `/ui/rooms/:roomId`.

| Variable | Description | Default |
| --- | --- | --- |
| `VITE_CASINO_URL` | Base URL for lobby HTTP requests | `http://localhost:4000` |
| `VITE_POLL_INTERVAL` | Polling interval in ms | `4000` |

Commands:

```bash
cd casino-dashboard
bun install
bun run dev        # start dev server
bun run build      # type-check + production build
```

## Lobby Entrypoints and REST Routes

| Entrypoint / Route | Purpose |
| --- | --- |
| `GET /ui/rooms` | Lobby summary plus available game metadata |
| `POST /ui/rooms` | Create a room. Body accepts `roomId?`, `gameType`, `config`, `roomAgentCardUrl?`, `roomAgentSkills?`, `launchOptions?` |
| `GET /ui/rooms/:roomId` | Latest snapshot for a room (config, summary, events, card URL) |
| `POST /ui/rooms/:roomId/register` | Register a player card for that room |
| `POST /ui/rooms/:roomId/start` | Manually start gameplay with optional overrides |
| `/entrypoints/createRoom` | Same as `POST /ui/rooms` but via the Lucid entrypoint |
| `/entrypoints/registerPlayer` | Register a player via A2A |
| `/entrypoints/startRoom` | Start/continue gameplay |
| `/entrypoints/listRooms` | Return the current `CasinoState` |
| `/entrypoints/recordGameEvent` | Callback used by room agents to stream activity |

Responses from `listRooms`/`/ui/rooms` include each room’s `roomAgentCardUrl`, `roomBaseUrl` (when auto-spawned), and summarized state so external tools or agents can interact with a specific table directly. When creating rooms programmatically you can provide `launchOptions.port` to force the spawned agent to run on a specific port.

## Building New Players or Rooms

- `casino-agent/PROTOCOL.md` and the copies inside each project define the Zod schemas for invitations, actions, room configuration, and events—use them to bootstrap new agents quickly.
- To create your own player: scaffold a Lucid agent (`bunx @lucid-agents/cli my-player`), implement `signup` and `play`, and hand the casino your AgentCard URL.
- To add a new game type: create a room agent exposing the shared `configureRoom`/`registerPlayer`/`startRoom`/`roomSummary` skills, then register a `RoomGameDefinition` inside `casino-agent/src/lib/casino-agent.ts`.

## Tips & Troubleshooting

- Run `bun run dev` from the lobby while `ROOM_AGENT_AUTOSPAWN=false` to keep currently running room processes alive during code reloads.
- Use `GET /ui/state` on the lobby or `GET /ui/state` on any room agent for raw JSON snapshots when debugging outside the dashboard.
- If `CASINO_AGENT_CARD_URL` is misconfigured the lobby throws at startup—make sure it’s reachable by the room agents (even if it points back to the same origin).
- When experimenting with external players, use the dashboard’s “Register Player” form to point at your new AgentCard without touching the lobby code.
