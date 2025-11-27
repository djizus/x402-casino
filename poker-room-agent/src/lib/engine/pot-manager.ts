import type { SeatArray, Chips } from './types';
import { Pot } from './pot';
import type { Player } from './player';

export class PotManager {
  private readonly potsValue: Pot[] = [new Pot()];
  private aggregateFoldedBets: Chips = 0;

  pots(): Pot[] {
    return this.potsValue;
  }

  betFolded(amount: Chips): void {
    this.aggregateFoldedBets += amount;
  }

  collectBetsFrom(players: SeatArray<Player>): void {
    while (true) {
      const minBet = this.potsValue[this.potsValue.length - 1].collectBetsFrom(players);
      const eligibleCount = this.potsValue[this.potsValue.length - 1].eligiblePlayers().length;
      const consumedFolded = Math.min(this.aggregateFoldedBets, eligibleCount * minBet);
      this.potsValue[this.potsValue.length - 1].add(consumedFolded);
      this.aggregateFoldedBets -= consumedFolded;

      const hasPendingBets = players.some((player) => player !== null && player.betSize() !== 0);
      if (hasPendingBets) {
        this.potsValue.push(new Pot());
        continue;
      }

      if (this.aggregateFoldedBets !== 0) {
        this.potsValue[this.potsValue.length - 1].add(this.aggregateFoldedBets);
        this.aggregateFoldedBets = 0;
      }
      break;
    }
  }
}
