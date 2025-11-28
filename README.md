# X402 Casino Playground

This repository is a miniature ecosystem of Lucid agents that run a casino lobby, spin up poker/slot/blackjack rooms, invite third‑party player agents, enforce paid registrations via x402, and expose a React dashboard for operators. Each directory contains an independent Bun project so you can study, extend, or replace any tier of the stack.

## What Lives Here?

| Path | Role | Highlights |
| --- | --- | --- |
| `casino-agent/` | **Lobby + REST API** | Orchestrates rooms, relays registrations, records events, handles x402 buy‑ins and payouts |
| `poker-room-agent/` | Poker room agent | No-limit Hold’em engine, pauses only when a single player remains |
| `slot-machine-room-agent/` | Slot room agent | Multiplayer slot simulator with configurable reels/bets |
| `blackjack-room-agent/` | Blackjack room agent | Dealer vs. players with adjustable stacks, bets, decks |
| `agent-player-1/` | Sample player | Gemini-backed agent with deterministic fallback strategy |
| `agent-player-2/` | Sample player | GPT-backed agent with configurable aggression |
| `client/` | Dashboard | Vite/React UI for room management and live event feeds |
| `dps-facilitator/` | DPS demo | Minimal facilitator used for issuing and settling x402 quotes |
| `scripts/install-all.ts` | Tooling | Installs dependencies for every sub-project in a single `bun install` |

`README_LUCID_AGENTS.md` contains extra background on Lucid Agents if you are new to the framework.

---

## Architecture Overview

```
Player Agents  ──A2A──► Room Agents ──A2A──► Casino Lobby ──REST/WS──► Dashboard
                            ▲                │                     │
                            │                │                     └─ Operator tools
                            └────── Events ──┘

Payments: Player ▷ x402 buy-in via DPS facilitator ▷ Casino  
          Casino ◁ x402 payout (winner takes entire pot)
```

1. **Casino Lobby** (`casino-agent/`) exposes Lucid entrypoints and `/ui/*` REST mirrors for creating rooms, registering player cards, starting games, and streaming events.
2. **Room Agents** (poker, slot, blackjack) only speak Lucid A2A. The lobby configures them, forwards player registrations, and subscribes to their events.
3. **Player Agents** implement `signup` and `play`. When the lobby registers a player, it first issues an x402 quote and charges the buy‑in before forwarding the request to the room.
4. **Dashboard** polls the lobby to visualize tables, register agents manually, and trigger starts if the room type requires it.

---

## Payment & Wallet Flow

1. **Registration Paywall** – when a player registers for a poker room, the lobby issues an x402 quote via `dps-facilitator`. The React dashboard surfaces the quote and lets an operator pay with a Base/Base‑Sepolia wallet. The casino settles the facilitator invoice and forwards the `registerPlayer` call only after payment succeeds.
2. **Winner Payouts** – once the room reports `status: ended` (only one player remains), the lobby sums the original buy‑ins and creates a fresh x402 payment targeting the winner’s `payoutAddress` (advertised during signup). The facilitator verifies/settles the payout and the lobby logs a `room_status` event confirming the transfer.

To wire this up you **must** configure:

| Variable | Description |
| --- | --- |
| `DPS_FACILITATOR_URL` | URL of the DPS/x402 facilitator (use the local demo in `dps-facilitator/` during development) |
| `PAYMENTS_NETWORK` | Network identifier (`base`, `base-sepolia`, etc.). Both buy‑ins and payouts use the same network. |
| `PAYMENTS_RECEIVABLE_ADDRESS` | Casino wallet receiving registration fees |
| `DPS_PAYER_PRIVATE_KEY` | Private key the casino uses to settle facilitator invoices for buy‑ins |
| `PAYOUT_PRIVATE_KEY` | Private key used to pay out winners (can be the same as above) |

player agents must also return a `payoutAddress` from their `signup` entrypoint.

---

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.0 (Node 20+ works but Bun is the default runtime)
- Access to an LLM if you want the sample players to do more than heuristics (`GEMINI_API_KEY` or `OPENAI_API_KEY`)
- Wallet credentials for the x402 buy‑in/payout flow on Base or Base Sepolia
- A reachable AgentCard URL for the casino lobby (the room agents need it to publish events)

---

## Getting Started

1. **Install everything once**
   ```bash
   cd casino-agent
   bun install        # installs deps for every subproject via scripts/install-all.ts
   ```

2. **Run the DPS facilitator**
   ```bash
   cd dps-facilitator
   bun install
   bun run dev        # http://localhost:3002 by default
   ```

3. **Launch the casino lobby**
   ```bash
   cd casino-agent
   CASINO_AGENT_CARD_URL=http://localhost:4000/.well-known/agent-card.json \
   DPS_FACILITATOR_URL=http://localhost:3002 \
   PAYMENTS_NETWORK=base-sepolia \
   PAYMENTS_RECEIVABLE_ADDRESS=0xYourCasinoWallet \
   DPS_PAYER_PRIVATE_KEY=0x... \
   PAYOUT_PRIVATE_KEY=0x... \
   ROOM_AGENT_AUTOSPAWN=true \
   SLOT_ROOM_AGENT_AUTOSPAWN=true \
   BLACKJACK_ROOM_AGENT_AUTOSPAWN=true \
   PORT=4000 bun run dev
   ```
   Auto-spawn launches local poker/slot/blackjack agents. Disable it if you prefer attaching remote rooms through their AgentCards.

4. **Start the React dashboard**
   ```bash
   cd client
   bun install
   bun run dev        # defaults to http://localhost:5173 and calls http://localhost:4000
   ```

5. **Start player agents (optional, you can also register any custom agent)**
   ```bash
   # Gemini player
   cd agent-player-1
   GEMINI_API_KEY=... PAYOUT_ADDRESS=0xWinnerWallet PORT=4101 bun run dev

   # GPT player
   cd agent-player-2
   OPENAI_API_KEY=... PAYOUT_ADDRESS=0xWinnerWallet PORT=4102 bun run dev
   ```

6. **Manage rooms**
   - Use the dashboard to create a poker/slot/blackjack room (the poker defaults mirror `POKER_*` env vars).
   - Register player AgentCards. The dashboard will show the x402 quote and let you pay with a Base/Base‑Sepolia wallet.
   - Poker rooms auto-start when eligible seats are filled. Slots/blackjack can be started manually from the UI or through the REST endpoint.

---

## Room Agents

Every room agent exposes the same Lucid entrypoints:

| Entrypoint | Purpose |
| --- | --- |
| `configureRoom` | Apply room config and provide the casino’s callback card so events can be streamed back |
| `registerPlayer` | Seat a player (poker enforces unique AgentCards and seat numbers) |
| `startRoom` | Start gameplay; poker runs until a single player remains, slot/blackjack play a fixed number of rounds |
| `roomSummary` | Returns the latest state + player stacks |

### Poker-Specific Notes
- Seats up to eight players.
- Registration closes as soon as the first hand starts; the game runs until one player holds all chips and emits a `room_ended` event.
- Uses the deterministic `hand-evaluator` to resolve winners.

### Slot & Blackjack
- Slot rooms accept multiple players and simulate spins according to cost/multiplier settings.
- Blackjack rooms pit players against the dealer for a configurable number of rounds.

You can run any room outside the lobby launcher (set the respective `*_ROOM_AGENT_AUTOSPAWN=false` and provide the AgentCard URL via env).

---

## Player Agents

Both sample players are Lucid HTTP agents:

| Env | Meaning (Player 1) | Player 2 Equivalent |
| --- | --- | --- |
| `PORT` | HTTP port | Same |
| `PLAYER_DISPLAY_NAME` | Display name shown in UI | Same |
| `PAYOUT_ADDRESS` / `PAYMENTS_RECEIVABLE_ADDRESS` | Wallet for payouts (required) | Same |
| `GEMINI_API_KEY` / `PLAYER_MODEL` | Model & credentials | `OPENAI_API_KEY`, `PLAYER_MODEL`, `PLAYER_AGGRESSION` |

Each agent exposes `.well-known/agent-card.json`. Provide that URL to `/ui/rooms/:roomId/register` (or via the dashboard) to seat the player.

---

## Dashboard (`client/`)

- Polls `/ui/rooms` and `/ui/rooms/:roomId`.
- Shows table summaries, poker seat maps, recent events, and room configuration.
- Registration form supports manual AgentCard URLs and handles the x402 paywall UI, including wallet connection and one-click payout of the buy‑in.
- Define `VITE_CASINO_URL` and `VITE_POLL_INTERVAL` if you need custom targets.

Important: The dashboard never stores private keys. It uses the browser wallet (MetaMask, etc.) to sign the x402 payment header on Base/Base‑Sepolia.

---

## REST & Entry Points

| Route / Entrypoint | Description |
| --- | --- |
| `GET /ui/rooms` | Lobby summary, available game metadata, default game type |
| `POST /ui/rooms` | Create a room (`roomId?`, `gameType`, `config`, optional AgentCard) |
| `GET /ui/rooms/:roomId` | Latest snapshot (config, summary, room AgentCard URL, events) |
| `POST /ui/rooms/:roomId/register` | Register a player (requires `agentCardUrl`, optional seat/skills). Triggers x402 paywall for poker. |
| `POST /ui/rooms/:roomId/start` | Start gameplay with optional overrides (non-poker) |
| `/entrypoints/createRoom` | Lucid counterpart to `POST /ui/rooms` |
| `/entrypoints/registerPlayer` | Lucid counterpart to the register route |
| `/entrypoints/startRoom` | Lucid counterpart to start route |
| `/entrypoints/listRooms` | Returns the lobby state |
| `/entrypoints/recordGameEvent` | Callback used by room agents to stream activity |

Use the entrypoints when orchestrating rooms from another Lucid agent; use the REST routes when integrating via HTTP.

---

## Customization Tips

- **Add new rooms** by building a Lucid agent that exposes the shared entrypoints and registering it in `casino-agent/src/lib/casino-agent.ts` (see `roomGames` map).
- **Add new players** by cloning `agent-player-1` or `agent-player-2`, changing the decision logic under `play`, and hosting the AgentCard somewhere reachable.
- **Disable auto-spawn** when deploying room agents separately; point `DEFAULT_*_ROOM_AGENT_CARD_URL` to your hosted AgentCard.
- **Bring your own dashboard**: everything the React UI uses is under `/ui`. You can build any other consumer (CLI, bot, etc.) using the same endpoints.

---

## Troubleshooting

- **Facilitator errors** – ensure `dps-facilitator` is running and the lobby can reach it. Look for console logs mentioning `/dps/quote`, `/verify`, or `/settle`.
- **Registration stuck on payment** – confirm your wallet is on `PAYMENTS_NETWORK`, and the quote still matches the current room (quotes expire after 60 seconds).
- **Room fails to start** – poker requires ≥2 registered players; other rooms may need manual `POST /ui/rooms/:roomId/start`.
- **Payout skipped** – set `PAYOUT_PRIVATE_KEY` and ensure the facilitator trusts the payout wallet. The lobby logs a warning if it cannot send the payout.

---

## License

This project is licensed under the [MIT License](./LICENSE).
