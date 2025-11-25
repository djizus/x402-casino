import type { CasinoState, RegisterPayload, StartGamePayload } from './types';

const BASE_URL = import.meta.env.VITE_CASINO_URL ?? 'http://localhost:4000';

const toJson = async (response: Response) => {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }
  return response.json();
};

export const fetchCasinoState = async (): Promise<CasinoState> => {
  const res = await fetch(`${BASE_URL}/ui/state`);
  return toJson(res);
};

export const registerPlayer = async (input: RegisterPayload) => {
  const res = await fetch(`${BASE_URL}/ui/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return toJson(res);
};

export const startGame = async (input: StartGamePayload) => {
  const res = await fetch(`${BASE_URL}/ui/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return toJson(res);
};
