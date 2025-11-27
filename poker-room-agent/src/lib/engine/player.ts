import assert from 'assert';
import type { Chips } from './types';

export class Player {
  private total: Chips;
  private betSizeValue: Chips = 0;

  constructor(input: Chips | Player) {
    if (typeof input === 'number') {
      this.total = input;
    } else if (input instanceof Player) {
      this.total = input.total;
      this.betSizeValue = input.betSizeValue;
    } else {
      throw new Error('Invalid player seed');
    }
  }

  stack(): Chips {
    return this.total - this.betSizeValue;
  }

  betSize(): Chips {
    return this.betSizeValue;
  }

  totalChips(): Chips {
    return this.total;
  }

  addToStack(amount: Chips): void {
    this.total += amount;
  }

  takeFromStack(amount: Chips): void {
    this.total -= amount;
  }

  bet(amount: Chips): void {
    assert(amount <= this.total, 'Player cannot bet more than stack');
    assert(amount >= this.betSizeValue, 'Bet must be non-decreasing within round');
    this.betSizeValue = amount;
  }

  takeFromBet(amount: Chips): void {
    assert(amount <= this.betSizeValue, 'Cannot take more than committed');
    this.total -= amount;
    this.betSizeValue -= amount;
  }
}
