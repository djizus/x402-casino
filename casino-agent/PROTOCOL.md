# Casino Agent Protocol (Rooms + Room Agents)

The Lucid Casino architecture consists of three independent agent roles:

1. **Casino Lobby Agent** – exposes entrypoints/REST routes for creating rooms, registering players, and orchestrating poker room agents.
2. **Poker Room Agents** – dedicated game runners that host Texas Hold’em hands and stream structured events back to the casino via A2A.
3. **Player Agents** – third-party bots that expose `signup` and `play` entrypoints.

All communication happens through typed entrypoints. Schemas below use Zod notation for clarity, but any runtime that validates the same shapes will interoperate.

---

## Player Agent Contracts

Player agents implement two entrypoints and must honor the lobby’s payloads.

### Signup Invitation

```ts
const signupInvitationSchema = z.object({
  casinoName: z.string(),
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
});
```

- `displayName` appears throughout the lobby UI.
- The casino chooses stacks + action skills when registering the player, so signup responses stay minimal.

### Action Request

```ts
const actionRequestSchema = z.object({
  roomId: z.string(),
  bettingRound: z.enum(['preflop','flop','turn','river']),
  communityCards: z.array(cardSchema),
  holeCards: z.array(cardSchema).length(2),
  pot: z.number().nonnegative(),
  minimumRaise: z.number().nonnegative(),
  currentBet: z.number().nonnegative(),
  playerStack: z.number().nonnegative(),
  legalActions: z.array(actionKindSchema).min(1),
});
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

Operators (or automation) interact with the lobby via these entrypoints/REST routes:

```ts
const roomConfigSchema = z.object({
  startingStack: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  maxHands: z.number().int().positive(),
  maxPlayers: z.number().int().min(2).max(8),
});

const createRoomInputSchema = z.object({
  roomId: z.string().optional(),
  roomAgentCardUrl: z.string().url().optional(),
  roomAgentSkills: z
    .object({
      configure: z.string().default('configureRoom'),
      register: z.string().default('registerPlayer'),
      start: z.string().default('startRoom'),
      summary: z.string().default('roomSummary'),
    })
    .default({
      configure: 'configureRoom',
      register: 'registerPlayer',
      start: 'startRoom',
      summary: 'roomSummary',
    }),
  config: roomConfigSchema,
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
  actionSkill: z.string().min(1).default('play'),
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

- `createRoom` configures (or auto-spawns) a poker room agent and stores the resulting room metadata.
- `registerPlayer` performs the signup handshake with a player agent, then forwards the seating request to the targeted room agent.
- `startRoom` proxies to the room agent’s `startRoom` entrypoint with optional overrides.
- `listRooms` returns lobby summaries, while `recordGameEvent` ingests structured telemetry from room agents.

When `config.maxPlayers` players are registered (and the room isn’t already running) the lobby automatically starts that room. Rooms created via the embedded launcher can also specify `launchOptions.port` to pin the spawned poker room agent to a stable TCP port. Room summaries/snapshots expose each room’s `roomAgentCardUrl` and, when known, `roomBaseUrl`, so other agents can connect to a specific room directly.

---

## Poker Room Agent Contracts

Poker room agents are standalone Lucid agents. They expose:

```ts
const configureRoomInputSchema = z.object({
  roomId: z.string(),
  casinoName: z.string(),
  config: roomConfigSchema,
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

const roomEventSchema = z.object({
  roomId: z.string(),
  eventType: z.enum([
    'player_registered',
    'hand_started',
    'hand_status',
    'action_taken',
    'hand_completed',
    'player_busted',
    'room_error',
    'room_status',
  ]),
  message: z.string(),
  timestamp: z.string(),
  payload: z.record(z.any()).optional(),
});
```

- `configureRoom` resets the engine and tells it where to publish `roomEvent` notifications (the lobby’s `recordGameEvent` entrypoint).
- `registerPlayer` seats a player that the lobby already authenticated.
- `startRoom` runs one or more hands and uses the `actionRequest`/`actionResponse` contract for each decision.
- `roomSummary` returns the room’s status, players, and latest message for dashboards.

Poker room agents **never** import casino or player code—they only adhere to these JSON contracts and communicate via A2A entrypoints.
