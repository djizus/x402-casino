import type { CreateRoomPayload, LobbyState, RegisterPayload, RoomSnapshot } from './types';

const BASE_URL = import.meta.env.VITE_CASINO_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  body?: unknown;
  rawBody?: string;

  constructor(message: string, init: { status: number; body?: unknown; rawBody?: string }) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.body = init.body;
    this.rawBody = init.rawBody;
  }
}

const tryParseJson = (text: string) => {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};

const toJson = async (response: Response) => {
  if (!response.ok) {
    const rawBody = await response.text();
    const parsedBody = tryParseJson(rawBody);
    const message =
      (parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody && typeof parsedBody.error === 'string'
        ? parsedBody.error
        : rawBody) || 'Request failed';
    throw new ApiError(message, {
      status: response.status,
      body: parsedBody,
      rawBody,
    });
  }
  const body = await response.json();
  if (body && 'ok' in body && body.ok === false) {
    throw new ApiError(body.error ?? 'Request failed', { status: response.status, body });
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
    gameType: input.gameType,
    config: input.config,
  };
  if (input.roomAgentCardUrl) {
    body.roomAgentCardUrl = input.roomAgentCardUrl;
  }

  const res = await fetch(`${BASE_URL}/ui/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await toJson(res);
  return data.room;
};

type RegisterOptions = {
  paymentHeader?: string;
};

export const registerPlayer = async (roomId: string, input: RegisterPayload, options?: RegisterOptions) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.paymentHeader) {
    headers['X-PAYMENT'] = options.paymentHeader;
    headers['Access-Control-Expose-Headers'] = 'X-PAYMENT-RESPONSE';
  }
  const res = await fetch(`${BASE_URL}/ui/rooms/${encodeURIComponent(roomId)}/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  return toJson(res);
};
