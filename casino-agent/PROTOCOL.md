# Casino Agent Protocol (Rooms + Table Agents)

The Lucid Casino architecture consists of three independent agent roles:

1. **Casino Lobby Agent** – exposes entrypoints/REST routes for creating rooms, registering players, and orchestrating poker-table agents.
2. **Poker Table Agents** – dedicated game runners that host Texas Hold’em hands and stream structured events back to the casino via A2A.
3. **Player Agents** – third-party bots that expose `signup` and `act` entrypoints.

All communication happens through typed entrypoints. Schemas below use Zod notation for clarity, but any validation/runtime that matches these shapes will interoperate.

---

## Player Agent Contracts

Player agents need only two entrypoints, but they must honor the casino’s invitation payload.

### Signup Invitation

```ts
const signupInvitationSchema = z.object({
  casinoName: z.string(),
  tableId: z.string(),
  roomId: z.string(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
});
```

**Response:**

```ts
const playerSignupResponseSchema = z.object({
  displayName: z.string().min(1),
  actionSkill: z.string().min(1).default('act'),
  buyIn: z.number().positive().optional(),
});
```

- `displayName` appears in the casino dashboard.
- `actionSkill` identifies the entrypoint poker-table agents will invoke during play.
- `buyIn` lets agents choose a stack size within the published min/max.

### Action Request

```ts
const actionRequestSchema = z.object({
  tableId: z.string(),
  bettingRound: z.enum(['preflop','flop','turn','river']),
  communityCards: z.array(cardSchema),
  holeCards: z.array(cardSchema).length(2),
  pot: z.number().nonnegative(),
  minimumRaise: z.number().nonnegative(),
  currentBet: z.number().nonnegative(),
  playerStack: z.number().nonnegative(),
  legalActions: z.array(actionKindSchema).min(1),
});

const cardSchema = z.object({
  rank: z.enum(['2','3','4','5','6','7','8','9','T','J','Q','K','A']),
  suit: z.enum(['hearts','diamonds','clubs','spades']),
});

const actionKindSchema = z.enum(['fold','check','call','bet','raise','all-in']);
```

**Response:**

```ts
const actionResponseSchema = z.object({
  action: actionKindSchema,
  amount: z.number().nonnegative().optional(),
  message: z.string().optional(),
});
```

---

## Casino Lobby Entry Points

Operators (or automation) interact with the casino lobby agent through these entrypoints/REST routes:

```ts
const tableConfigSchema = z.object({
  startingStack: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  maxHands: z.number().int().positive(),
  maxSeats: z.number().int().min(2).max(10),
});

const createRoomInputSchema = z.object({
  roomId: z.string().optional(),
  tableId: z.string().optional(),
  tableAgentCardUrl: z.string().url().optional(),
  tableAgentSkills: z
    .object({
      configure: z.string().default('configureTable'),
      register: z.string().default('registerPlayer'),
      start: z.string().default('startGame'),
      summary: z.string().default('tableSummary'),
    })
    .default({
      configure: 'configureTable',
      register: 'registerPlayer',
      start: 'startGame',
      summary: 'tableSummary',
    }),
  config: tableConfigSchema,
  launchOptions: z
    .object({
      port: z.number().int().positive().optional(),
    })
    .optional(),
});

const registerPlayerInputSchema = z.object({
  roomId: z.string(),
  agentCardUrl: z.string().url(),
  signupSkill: z.string().min(1).default('signup'),
  actionSkill: z.string().min(1).optional(),
  preferredSeat: z.number().int().nonnegative().optional(),
});

const startRoomInputSchema = z.object({
  roomId: z.string(),
  overrides: z
    .object({
      maxHands: z.number().int().positive().optional(),
      smallBlind: z.number().positive().optional(),
      bigBlind: z.number().positive().optional(),
    })
    .optional(),
});
```

- `createRoom` configures a poker-table agent (by card URL) and stores the resulting room metadata.
- `registerPlayer` performs the signup handshake with a player agent, then forwards the seating request to the appropriate table agent.
- `startRoom` proxies to the table agent’s `startGame` entrypoint with optional overrides.
- `listRooms` returns lobby summaries, while `recordGameEvent` ingests structured telemetry from table agents.

When `config.maxSeats` players are registered (and the table isn’t already running), the lobby automatically starts that room. Rooms created via the embedded launcher can also specify `launchOptions.port` to pin the spawned poker-table agent to a stable TCP port. Room summaries/snapshots expose each table’s `tableAgentCardUrl` and (when known) `tableBaseUrl`, so other agents can join a specific room by hitting that poker-table endpoint directly.

---

## Poker Table Agent Contracts

Poker-table agents are standalone Lucid agents. They expose:

```ts
const configureTableInputSchema = z.object({
  tableId: z.string(),
  casinoName: z.string(),
  config: tableConfigSchema,
  casinoCallback: z.object({
    agentCardUrl: z.string().url(),
    eventSkill: z.string().min(1),
  }),
});

const registerPlayerInputSchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  agentCardUrl: z.string().url(),
  actionSkill: z.string().min(1),
  startingStack: z.number().positive(),
  preferredSeat: z.number().int().nonnegative().optional(),
});

const tableEventSchema = z.object({
  tableId: z.string(),
  eventType: z.enum([
    'player_registered',
    'hand_started',
    'action_taken',
    'hand_completed',
    'player_busted',
    'table_error',
    'table_status',
  ]),
  message: z.string(),
  timestamp: z.string(),
  payload: z.record(z.any()).optional(),
});
```

- `configureTable` resets the table’s state and tells it where to publish `tableEvent` notifications (the casino’s `recordGameEvent` entrypoint).
- `registerPlayer` seats a player that the casino already authenticated.
- `startGame` runs one or more hands and uses the `actionRequest`/`actionResponse` contract for each player decision.
- `tableSummary` returns the table’s status, players, and latest message for dashboards.

Poker-table agents **never** import casino or player code—they only adhere to these JSON contracts and communicate via A2A entrypoints.
