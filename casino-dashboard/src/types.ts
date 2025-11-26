export type PlayerSeat = {
  playerId: string;
  seatNumber: number;
  displayName: string;
  stack: number;
};

export type TableSummary = {
  tableId: string;
  status: 'waiting' | 'running' | 'idle' | 'error';
  players: PlayerSeat[];
  handCount: number;
  message?: string;
};

export type TableConfig = {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxHands: number;
};

export type TableEvent = {
  tableId: string;
  eventType:
    | 'player_registered'
    | 'hand_started'
    | 'action_taken'
    | 'hand_completed'
    | 'player_busted'
    | 'table_error'
    | 'table_status';
  message: string;
  timestamp: string;
  payload?: Record<string, unknown>;
};

export type RoomSummary = {
  roomId: string;
  tableId: string;
  gameType: string;
  tableAgentCardUrl: string;
  status: 'waiting' | 'running' | 'idle' | 'error';
  handCount: number;
  playerCount: number;
  message?: string;
};

export type RoomSnapshot = {
  roomId: string;
  config: TableConfig;
  summary?: TableSummary;
  tableAgentCardUrl: string;
  events: TableEvent[];
};

export type LobbyState = {
  rooms: RoomSummary[];
  defaultConfig: TableConfig;
};

export type CreateRoomPayload = {
  roomId?: string;
  tableId?: string;
  tableAgentCardUrl?: string;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxHands: number;
};

export type RegisterPayload = {
  agentCardUrl: string;
  signupSkill?: string;
  actionSkill?: string;
  preferredSeat?: number;
};

export type StartRoomPayload = {
  maxHands?: number;
  smallBlind?: number;
  bigBlind?: number;
};
