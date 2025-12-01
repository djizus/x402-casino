import { shuffleInPlace } from './utils';
import { createDeck } from '../cards';
import type { Card } from '../protocol';

export class Deck {
  private cards: Card[] = [];
  private remaining = 0;

  constructor() {
    this.fillAndShuffle();
  }

  public fillAndShuffle(): void {
    this.cards = createDeck();
    shuffleInPlace(this.cards);
    this.remaining = this.cards.length;
  }

  public size(): number {
    return this.remaining;
  }

  public draw(): Card {
    if (this.remaining <= 0) {
      throw new Error('Deck is empty');
    }
    this.remaining -= 1;
    return this.cards[this.remaining];
  }
}
