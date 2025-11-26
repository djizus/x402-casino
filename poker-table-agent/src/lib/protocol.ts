import { z } from 'zod';

export const suitSchema = z.enum(['hearts', 'diamonds', 'clubs', 'spades']);
export type Suit = z.infer<typeof suitSchema>;

export const rankSchema = z.enum(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
export type Rank = z.infer<typeof rankSchema>;

export const cardSchema = z.object({
  rank: rankSchema,
  suit: suitSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const bettingRoundSchema = z.enum(['preflop', 'flop', 'turn', 'river']);
export type BettingRound = z.infer<typeof bettingRoundSchema>;

export const actionKindSchema = z.enum(['fold', 'check', 'call', 'bet', 'raise', 'all-in']);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const actionRequestSchema = z.object({
  tableId: z.string(),
  bettingRound: bettingRoundSchema,
  communityCards: z.array(cardSchema),
  holeCards: z.array(cardSchema).length(2),
  pot: z.number().nonnegative(),
  minimumRaise: z.number().nonnegative(),
  currentBet: z.number().nonnegative(),
  playerStack: z.number().nonnegative(),
  legalActions: z.array(actionKindSchema).min(1),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const actionResponseSchema = z.object({
  action: actionKindSchema,
  amount: z.number().nonnegative().optional(),
  message: z.string().optional(),
});
export type ActionResponse = z.infer<typeof actionResponseSchema>;

export const tableConfigSchema = z.object({
  startingStack: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  maxHands: z.number().int().positive(),
  maxSeats: z.number().int().min(2).max(10),
});
export type TableConfig = z.infer<typeof tableConfigSchema>;

export const casinoCallbackSchema = z.object({
  agentCardUrl: z.string().url(),
  eventSkill: z.string().min(1),
});
export type CasinoCallback = z.infer<typeof casinoCallbackSchema>;

export const configureTableInputSchema = z.object({
  tableId: z.string().min(1),
  casinoName: z.string().min(1),
  config: tableConfigSchema,
  casinoCallback: casinoCallbackSchema,
});
export type ConfigureTableInput = z.infer<typeof configureTableInputSchema>;

export const playerSeatSchema = z.object({
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
});
export type PlayerSeatSummary = z.infer<typeof playerSeatSchema>;

export const tableSummarySchema = z.object({
  tableId: z.string(),
  status: z.enum(['waiting', 'running', 'idle', 'error']),
  handCount: z.number().int().nonnegative(),
  players: z.array(playerSeatSchema),
  message: z.string().optional(),
});
export type TableSummary = z.infer<typeof tableSummarySchema>;

export const registerPlayerInputSchema = z.object({
  playerId: z.string(),
  displayName: z.string(),
  agentCardUrl: z.string().url(),
  actionSkill: z.string().min(1),
  startingStack: z.number().positive(),
  preferredSeat: z.number().int().nonnegative().optional(),
});
export type RegisterPlayerInput = z.infer<typeof registerPlayerInputSchema>;

export const registerPlayerResultSchema = z.object({
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
});
export type RegisterPlayerResult = z.infer<typeof registerPlayerResultSchema>;

export const startGameInputSchema = z
  .object({
    maxHands: z.number().int().positive().optional(),
    smallBlind: z.number().positive().optional(),
    bigBlind: z.number().positive().optional(),
  })
  .partial()
  .default({});
export type StartGameInput = z.infer<typeof startGameInputSchema>;

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
