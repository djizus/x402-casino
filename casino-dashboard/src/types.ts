export type PlayerSeat = {
  playerId: string;
  seatNumber: number;
  displayName: string;
  stack: number;
};

export type RoomStateSummary = {
  roomId: string;
  status: 'waiting' | 'running' | 'idle' | 'error';
  players: PlayerSeat[];
  handCount: number;
  message?: string;
};

export type RoomConfig = {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxHands: number;
  maxSeats: number;
};

export type RoomEvent = {
  roomId: string;
  eventType:
    | 'player_registered'
    | 'hand_started'
    | 'action_taken'
    | 'hand_completed'
    | 'player_busted'
    | 'room_error'
    | 'room_status';
  message: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type RoomSummary = {
  roomId: string;
  gameType: string;
  roomAgentCardUrl: string;
  roomBaseUrl?: string;
  status: 'waiting' | 'running' | 'idle' | 'error';
  handCount: number;
  playerCount: number;
  message?: string;
};

export type RoomSnapshot = {
  roomId: string;
  config: RoomConfig;
  summary?: RoomStateSummary;
  roomAgentCardUrl: string;
  roomBaseUrl?: string;
  events: RoomEvent[];
};

export type LobbyState = {
  rooms: RoomSummary[];
  defaultConfig: RoomConfig;
};

export type CreateRoomPayload = {
  roomId?: string;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxHands: number;
  maxSeats: number;
};

export type RegisterPayload = {
  agentCardUrl: string;
  signupSkill?: string;
  actionSkill?: string;
  preferredSeat?: number;
};
