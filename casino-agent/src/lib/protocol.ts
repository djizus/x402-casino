import { z } from 'zod';

export const tableConfigSchema = z.object({
  startingStack: z.number().positive().default(1),
  smallBlind: z.number().positive().default(0.1),
  bigBlind: z.number().positive().default(1),
  minBuyIn: z.number().positive().default(0.1),
  maxBuyIn: z.number().positive().default(1),
  maxHands: z.number().int().positive().default(1),
  maxSeats: z.number().int().min(2).max(10).default(6),
});
export type TableConfig = z.infer<typeof tableConfigSchema>;

export const signupInvitationSchema = z.object({
  casinoName: z.string(),
  tableId: z.string(),
  roomId: z.string(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
});
export type SignupInvitation = z.infer<typeof signupInvitationSchema>;

export const playerSignupResponseSchema = z.object({
  displayName: z.string().min(1),
  actionSkill: z.string().min(1).default('act'),
  buyIn: z.number().positive().optional(),
});
export type PlayerSignupResponse = z.infer<typeof playerSignupResponseSchema>;

export const playerSeatSchema = z.object({
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
});
export type PlayerSeat = z.infer<typeof playerSeatSchema>;

export const tableSummarySchema = z.object({
  tableId: z.string(),
  status: z.enum(['waiting', 'running', 'idle', 'error']),
  handCount: z.number().int().nonnegative(),
  players: z.array(playerSeatSchema),
  message: z.string().optional(),
});
export type TableSummary = z.infer<typeof tableSummarySchema>;

export const tableEventSchema = z.object({
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
  payload: z.record(z.string(), z.any()).optional(),
});
export type TableEvent = z.infer<typeof tableEventSchema>;

export const roomSummarySchema = z.object({
  roomId: z.string(),
  tableId: z.string(),
  gameType: z.literal('poker'),
  tableAgentCardUrl: z.string().url(),
  tableBaseUrl: z.string().url().optional(),
  status: z.enum(['waiting', 'running', 'idle', 'error']),
  handCount: z.number().int().nonnegative(),
  playerCount: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const roomSnapshotSchema = z.object({
  roomId: z.string(),
  config: tableConfigSchema,
  summary: tableSummarySchema.optional(),
  tableAgentCardUrl: z.string().url(),
  tableBaseUrl: z.string().url().optional(),
  events: z.array(tableEventSchema),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const createRoomInputSchema = z.object({
  roomId: z.string().optional(),
  tableId: z.string().optional(),
  gameType: z.literal('poker').default('poker'),
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
  config: tableConfigSchema.default({
    startingStack: 1,
    smallBlind: 0.1,
    bigBlind: 1,
    minBuyIn: 0.1,
    maxBuyIn: 1,
    maxHands: 1,
    maxSeats: 6,
  }),
  launchOptions: z
    .object({
      port: z.number().int().positive().optional(),
    })
    .optional(),
});
export type CreateRoomInput = z.infer<typeof createRoomInputSchema>;

export const registerPlayerInputSchema = z.object({
  roomId: z.string(),
  agentCardUrl: z.string().url(),
  signupSkill: z.string().min(1).default('signup'),
  actionSkill: z.string().min(1).optional(),
  preferredSeat: z.number().int().nonnegative().optional(),
});
export type RegisterPlayerInput = z.infer<typeof registerPlayerInputSchema>;

export const registerPlayerResultSchema = z.object({
  roomId: z.string(),
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
});
export type RegisterPlayerResult = z.infer<typeof registerPlayerResultSchema>;

export const startRoomInputSchema = z.object({
  roomId: z.string(),
  overrides: z
    .object({
      maxHands: z.number().int().positive().optional(),
      smallBlind: z.number().positive().optional(),
      bigBlind: z.number().positive().optional(),
    })
    .optional(),
});
export type StartRoomInput = z.infer<typeof startRoomInputSchema>;

export const casinoStateSchema = z.object({
  rooms: z.array(roomSummarySchema),
});
export type CasinoState = z.infer<typeof casinoStateSchema>;
