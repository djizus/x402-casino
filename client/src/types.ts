export type PlayerSeat = {
  playerId: string;
  seatNumber: number;
  displayName: string;
  stack: number;
  payoutAddress?: string;
};

export type RoomStateSummary = {
  roomId: string;
  status: 'waiting' | 'running' | 'idle' | 'error' | 'ended';
  players: PlayerSeat[];
  handCount: number;
  message?: string;
};

export type RoomConfig = Record<string, number | string>;

export type RoomEvent = {
  roomId: string;
  eventType:
    | 'player_registered'
    | 'hand_started'
    | 'hand_status'
    | 'action_taken'
    | 'hand_completed'
    | 'player_busted'
    | 'room_error'
    | 'room_status'
    | 'room_ended';
  message: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type RoomSummary = {
  roomId: string;
  gameType: string;
  roomAgentCardUrl: string;
  roomBaseUrl?: string;
  status: 'waiting' | 'running' | 'idle' | 'error' | 'ended';
  handCount: number;
  playerCount: number;
  message?: string;
};

export type RoomSnapshot = {
  roomId: string;
  gameType: string;
  config: RoomConfig;
  summary?: RoomStateSummary;
  roomAgentCardUrl: string;
  roomBaseUrl?: string;
  events: RoomEvent[];
};

export type GameConfigField = {
  key: string;
  label: string;
  type: 'number' | 'text';
  min?: number;
  max?: number;
  step?: number;
  helperText?: string;
};

export type LobbyGame = {
  type: string;
  label: string;
  description: string;
  supportsRegistration: boolean;
  configFields: GameConfigField[];
  defaultConfig: RoomConfig;
};

export type LobbyState = {
  rooms: RoomSummary[];
  games: LobbyGame[];
  defaultGameType: string;
};

export type CreateRoomPayload = {
  roomId?: string;
  gameType: string;
  config: Record<string, number>;
  roomAgentCardUrl?: string;
};

export type RegisterPayload = {
  agentCardUrl: string;
  signupSkill?: string;
  actionSkill?: string;
  preferredSeat?: number;
};
