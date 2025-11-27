import assert from 'assert';
import type { Chips, SeatArray, SeatIndex } from './types';
import type { Player } from './player';

export class Pot {
  private eligible: SeatIndex[] = [];
  private sizeValue: Chips = 0;

  size(): Chips {
    return this.sizeValue;
  }

  eligiblePlayers(): SeatIndex[] {
    return this.eligible;
  }

  add(amount: Chips): void {
    assert(amount >= 0, 'Cannot add negative amount');
    this.sizeValue += amount;
  }

  collectBetsFrom(players: SeatArray<Player>): Chips {
    const firstBetterIndex = players.findIndex((player) => (player?.betSize() ?? 0) !== 0);
    if (firstBetterIndex === -1) {
      this.eligible = players.reduce<SeatIndex[]>((acc, player, index) => {
        if (player !== null) {
          acc.push(index as SeatIndex);
        }
        return acc;
      }, []);
      return 0;
    }

    const firstBetter = players[firstBetterIndex];
    assert(firstBetter !== null, 'First better missing');
    const minBet = players.slice(firstBetterIndex + 1).reduce((acc, player) => {
      if (player !== null && player.betSize() !== 0 && player.betSize() < acc) {
        return player.betSize();
      }
      return acc;
    }, firstBetter.betSize());

    this.eligible = [];
    players.forEach((player, index) => {
      if (player !== null && player.betSize() !== 0) {
        player.takeFromBet(minBet);
        this.sizeValue += minBet;
        this.eligible.push(index as SeatIndex);
      }
    });

    return minBet;
  }
}
