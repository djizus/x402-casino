import { z } from 'zod';

export const blackjackRoomConfigSchema = z.object({
  maxPlayers: z.number().int().min(1).max(6),
  startingStack: z.number().positive(),
  minBet: z.number().positive(),
  maxBet: z.number().positive(),
  blackjackPayout: z.number().positive().default(1.5),
  roundsPerSession: z.number().int().min(1).max(50),
  deckCount: z.number().int().min(1).max(8),
});
export type BlackjackRoomConfig = z.infer<typeof blackjackRoomConfigSchema>;

export const casinoCallbackSchema = z.object({
  agentCardUrl: z.string().url(),
  eventSkill: z.string().min(1),
});
export type CasinoCallback = z.infer<typeof casinoCallbackSchema>;

export const configureRoomInputSchema = z.object({
  roomId: z.string().min(1),
  casinoName: z.string().min(1),
  config: blackjackRoomConfigSchema,
  casinoCallback: casinoCallbackSchema,
});
export type ConfigureRoomInput = z.infer<typeof configureRoomInputSchema>;

export const playerSeatSchema = z.object({
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
});
export type PlayerSeatSummary = z.infer<typeof playerSeatSchema>;

export const roomSummarySchema = z.object({
  roomId: z.string(),
  status: z.enum(['waiting', 'running', 'idle', 'error']),
  handCount: z.number().int().nonnegative(),
  players: z.array(playerSeatSchema),
  message: z.string().optional(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

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

export const startGameInputSchema = z.object({
  rounds: z.number().int().positive().max(100).optional(),
});
export type StartGameInput = z.infer<typeof startGameInputSchema>;

export const roomEventSchema = z.object({
  roomId: z.string(),
  eventType: z.enum([
    'player_registered',
    'hand_started',
    'action_taken',
    'hand_completed',
    'player_busted',
    'room_error',
    'room_status',
  ]),
  message: z.string(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
});
export type RoomEvent = z.infer<typeof roomEventSchema>;
