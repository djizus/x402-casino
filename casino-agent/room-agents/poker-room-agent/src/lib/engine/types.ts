import type { Card } from '../protocol';

export type Chips = number;
export type SeatIndex = number;
export type SeatArray<T = unknown> = Array<T | null>;

export type ForcedBets = {
  ante?: Chips;
  blinds: {
    small: Chips;
    big: Chips;
  };
};

export type EnginePlayerState = {
  totalChips: Chips;
  stack: Chips;
  betSize: Chips;
};

export type PotSnapshot = {
  size: Chips;
  eligiblePlayers: SeatIndex[];
};

export type HoleCards = [Card, Card];

export type EngineCard = Card;

export class EngineError extends Error {}

export type EnginePlayer = import('./player').Player;
