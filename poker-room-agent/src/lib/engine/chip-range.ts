import type { Chips } from './types';

export class ChipRange {
  public readonly min: Chips;
  public readonly max: Chips;

  constructor(min: Chips, max: Chips) {
    this.min = min;
    this.max = max;
  }

  contains(amount: Chips): boolean {
    return this.min <= amount && amount <= this.max;
  }
}
