import { z } from 'zod';

export const roomConfigSchema = z.record(z.string(), z.any());
export type RoomConfig = z.infer<typeof roomConfigSchema>;

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

export const playerSeatSchema = z.object({
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
  payoutAddress: evmAddressSchema.optional(),
});
export type PlayerSeat = z.infer<typeof playerSeatSchema>;

export const roomStateSchema = z.object({
  roomId: z.string(),
  status: z.enum(['waiting', 'running', 'idle', 'error', 'ended']),
  handCount: z.number().int().nonnegative(),
  players: z.array(playerSeatSchema),
  message: z.string().optional(),
});
export type RoomState = z.infer<typeof roomStateSchema>;

export const roomEventSchema = z.object({
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
    'room_ended',
  ]),
  message: z.string(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.any()).optional(),
});
export type RoomEvent = z.infer<typeof roomEventSchema>;

export const roomSummarySchema = z.object({
  roomId: z.string(),
  gameType: z.string(),
  roomAgentCardUrl: z.string().url(),
  roomBaseUrl: z.string().url().optional(),
  status: z.enum(['waiting', 'running', 'idle', 'error', 'ended']),
  handCount: z.number().int().nonnegative(),
  playerCount: z.number().int().nonnegative(),
  message: z.string().optional(),
});
export type RoomSummary = z.infer<typeof roomSummarySchema>;

export const roomSnapshotSchema = z.object({
  roomId: z.string(),
  gameType: z.string(),
  config: roomConfigSchema,
  summary: roomStateSchema.optional(),
  roomAgentCardUrl: z.string().url(),
  roomBaseUrl: z.string().url().optional(),
  events: z.array(roomEventSchema),
});
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;

export const createRoomInputSchema = z.object({
  roomId: z.string().optional(),
  gameType: z.string().min(1).default('poker'),
  roomAgentCardUrl: z.string().url().optional(),
  roomAgentSkills: z
    .object({
      configure: z.string().optional(),
      register: z.string().optional(),
      start: z.string().optional(),
      summary: z.string().optional(),
    })
    .optional(),
  config: roomConfigSchema.optional(),
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
  actionSkill: z.string().min(1).default('play'),
  preferredSeat: z.number().int().nonnegative().optional(),
});
export type RegisterPlayerInput = z.infer<typeof registerPlayerInputSchema>;

export const registerPlayerResultSchema = z.object({
  roomId: z.string(),
  playerId: z.string(),
  seatNumber: z.number().int().nonnegative(),
  displayName: z.string(),
  stack: z.number().nonnegative(),
  payoutAddress: evmAddressSchema.optional(),
});
export type RegisterPlayerResult = z.infer<typeof registerPlayerResultSchema>;

export const startRoomInputSchema = z.object({
  roomId: z.string(),
  overrides: z.record(z.string(), z.any()).optional(),
});
export type StartRoomInput = z.infer<typeof startRoomInputSchema>;

export const casinoStateSchema = z.object({
  rooms: z.array(roomSummarySchema),
});
export type CasinoState = z.infer<typeof casinoStateSchema>;
