import { z } from "zod";

export const suitSchema = z.enum(["hearts", "diamonds", "clubs", "spades"]);
export type Suit = z.infer<typeof suitSchema>;

export const rankSchema = z.enum(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
export type Rank = z.infer<typeof rankSchema>;

export const cardSchema = z.object({
  rank: rankSchema,
  suit: suitSchema,
});
export type Card = z.infer<typeof cardSchema>;

export const bettingRoundSchema = z.enum(["preflop", "flop", "turn", "river", "showdown"]);
export type BettingRound = z.infer<typeof bettingRoundSchema>;

export const actionKindSchema = z.enum(["fold", "check", "call", "bet", "raise", "all-in"]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const actionRequestSchema = z.object({
  roomId: z.string(),
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
  roomId: z.string(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
});
export type SignupInvitation = z.infer<typeof signupInvitationSchema>;

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

export const playerSignupResponseSchema = z.object({
  displayName: z.string().min(1),
  payoutAddress: evmAddressSchema,
});
export type PlayerSignupResponse = z.infer<typeof playerSignupResponseSchema>;
