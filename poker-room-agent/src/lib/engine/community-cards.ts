import assert from 'assert';
import type { Card } from '../protocol';

export enum RoundOfBetting {
  PREFLOP = 0,
  FLOP = 3,
  TURN = 4,
  RIVER = 5,
}

export const nextRound = (round: RoundOfBetting): RoundOfBetting => {
  if (round === RoundOfBetting.PREFLOP) {
    return RoundOfBetting.FLOP;
  }
  return (round + 1) as RoundOfBetting;
};

export class CommunityCards {
  private cards: Card[] = [];

  cardsSnapshot(): Card[] {
    return [...this.cards];
  }

  deal(cards: Card[]): void {
    assert(cards.length <= 5 - this.cards.length, 'Too many community cards');
    this.cards = this.cards.concat(cards);
  }
}
