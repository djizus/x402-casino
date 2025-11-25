import { z } from 'zod';

export const suitSchema = z.enum(['hearts', 'diamonds', 'clubs', 'spades']);
export type Suit = z.infer<typeof suitSchema>;

export const rankSchema = z.enum([
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
]);
export type Rank = z.infer<typeof rankSchema>;

export const cardSchema = z.object({
  rank: rankSchema,
  suit: suitSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const bettingRoundSchema = z.enum([
  'preflop',
  'flop',
  'turn',
  'river',
  'showdown',
]);
export type BettingRound = z.infer<typeof bettingRoundSchema>;

export const actionKindSchema = z.enum([
  'fold',
  'check',
  'call',
  'bet',
  'raise',
  'all-in',
]);
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

export const signupInvitationSchema = z.object({
  casinoName: z.string(),
  tableId: z.string(),
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

export const registerPlayerInputSchema = z.object({
  agentCardUrl: z.string().url(),
  signupSkill: z.string().min(1).default('signup'),
  actionSkill: z.string().min(1).optional(),
  preferredSeat: z.number().int().nonnegative().optional(),
});
export type RegisterPlayerInput = z.infer<typeof registerPlayerInputSchema>;

export const registerPlayerResultSchema = z.object({
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  actionSkill: z.string(),
  stack: z.number().positive(),
});
export type RegisterPlayerResult = z.infer<typeof registerPlayerResultSchema>;

export const startGameInputSchema = z.object({
  tableId: z.string().default('table-1'),
  startingStack: z.number().positive().default(1),
  smallBlind: z.number().positive().default(0.1),
  bigBlind: z.number().positive().default(1),
  maxHands: z.number().int().positive().default(1),
  minBuyIn: z.number().positive().default(0.1),
  maxBuyIn: z.number().positive().default(1),
});
export type StartGameInput = z.infer<typeof startGameInputSchema>;

export const tableSummarySchema = z.object({
  tableId: z.string(),
  status: z.enum(['waiting', 'running', 'idle', 'error']),
  players: z.array(
    z.object({
      playerId: z.string(),
      seatNumber: z.number().int().nonnegative(),
      displayName: z.string(),
      stack: z.number().nonnegative(),
    })
  ),
  handCount: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type TableSummary = z.infer<typeof tableSummarySchema>;

export interface PlayerSeat {
  id: string;
  seatNumber: number;
  displayName: string;
  actionSkill: string;
  agentCardUrl: string;
  stack: number;
}
