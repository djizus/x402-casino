export type PlayerSeat = {
  playerId: string;
  seatNumber: number;
  displayName: string;
  stack: number;
  actionSkill: string;
};

export type TableSummary = {
  tableId: string;
  status: 'waiting' | 'running' | 'idle' | 'error';
  players: PlayerSeat[];
  handCount: number;
  message?: string;
};

export type GameConfig = {
  tableId: string;
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxHands: number;
};

export type CasinoState = {
  summary: TableSummary;
  config: GameConfig;
  events: string[];
};

export type RegisterPayload = {
  agentCardUrl: string;
  signupSkill?: string;
  actionSkill?: string;
  preferredSeat?: number;
};

export type StartGamePayload = {
  startingStack: number;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  maxHands: number;
};
