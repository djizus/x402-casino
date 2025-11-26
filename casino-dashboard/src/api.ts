import type {
  CreateRoomPayload,
  LobbyState,
  RegisterPayload,
  RoomSnapshot,
  StartRoomPayload,
} from './types';

const BASE_URL = import.meta.env.VITE_CASINO_URL ?? 'http://localhost:4000';

const toJson = async (response: Response) => {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }
  const body = await response.json();
  if (body && 'ok' in body && body.ok === false) {
    throw new Error(body.error ?? 'Request failed');
  }
  return body;
};

export const fetchLobbyState = async (): Promise<LobbyState> => {
  const res = await fetch(`${BASE_URL}/ui/rooms`);
  return toJson(res);
};

export const fetchRoomSnapshot = async (roomId: string): Promise<RoomSnapshot> => {
  const res = await fetch(`${BASE_URL}/ui/rooms/${encodeURIComponent(roomId)}`);
  const data = await toJson(res);
  return data.room;
};

export const createRoom = async (input: CreateRoomPayload) => {
  const body: Record<string, unknown> = {
    roomId: input.roomId || undefined,
    tableId: input.tableId || undefined,
    tableAgentCardUrl: input.tableAgentCardUrl || undefined,
    startingStack: input.startingStack,
    smallBlind: input.smallBlind,
    bigBlind: input.bigBlind,
    minBuyIn: input.minBuyIn,
    maxBuyIn: input.maxBuyIn,
    maxHands: input.maxHands,
  };
  if (typeof input.tablePort === 'number') {
    body.launchOptions = { port: input.tablePort };
  }

  const res = await fetch(`${BASE_URL}/ui/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await toJson(res);
  return data.room;
};

export const registerPlayer = async (roomId: string, input: RegisterPayload) => {
  const res = await fetch(`${BASE_URL}/ui/rooms/${encodeURIComponent(roomId)}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return toJson(res);
};

export const startRoom = async (roomId: string, input: StartRoomPayload) => {
  const res = await fetch(`${BASE_URL}/ui/rooms/${encodeURIComponent(roomId)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return toJson(res);
};
