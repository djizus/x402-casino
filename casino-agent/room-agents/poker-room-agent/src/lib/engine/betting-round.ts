import assert from 'assert';
import { ChipRange } from './chip-range';
import { Round, RoundActionFlag } from './round';
import type { Chips, SeatArray, SeatIndex } from './types';
import { Player } from './player';

export enum BettingActionFlag {
  LEAVE,
  MATCH,
  RAISE,
}

export class BettingActionRange {
  constructor(public readonly canRaise: boolean, public readonly chipRange: ChipRange = new ChipRange(0, 0)) {}
}

export class BettingRound {
  private readonly players: SeatArray<Player>;
  private readonly round: Round;
  private biggestBet: Chips;
  private minRaise: Chips;

  constructor(players: SeatArray<Player>, firstToAct: SeatIndex, minRaise: Chips, biggestBet: Chips = 0) {
    assert(firstToAct < players.length, 'Seat index must be valid');
    assert(players[firstToAct] !== null, 'First player must exist');
    this.players = players;
    this.round = new Round(players.map((player) => player !== null), firstToAct);
    this.biggestBet = biggestBet;
    this.minRaise = minRaise;
  }

  inProgress(): boolean {
    return this.round.inProgress();
  }

  isContested(): boolean {
    return this.round.isContested();
  }

  playerToAct(): SeatIndex {
    return this.round.playerToAct();
  }

  biggest(): Chips {
    return this.biggestBet;
  }

  playersSnapshot(): SeatArray<Player> {
    return this.round.active().map((isActive, index) => (isActive ? this.players[index] : null));
  }

  numActivePlayers(): number {
    return this.round.numActivePlayers();
  }

  legalActions(): BettingActionRange {
    const player = this.players[this.round.playerToAct()];
    assert(player !== null, 'Active player missing');
    const playerChips = player.totalChips();
    const canRaise = playerChips > this.biggestBet;
    if (canRaise) {
      const minBet = this.biggestBet + this.minRaise;
      const range = new ChipRange(Math.min(minBet, playerChips), playerChips);
      return new BettingActionRange(true, range);
    }
    return new BettingActionRange(false);
  }

  actionTaken(action: BettingActionFlag, bet: Chips = 0): void {
    const player = this.players[this.round.playerToAct()];
    assert(player !== null, 'Active player missing');
    if (action === BettingActionFlag.RAISE) {
      assert(this.isRaiseValid(bet), 'Invalid raise amount');
      player.bet(bet);
      this.minRaise = bet - this.biggestBet;
      this.biggestBet = bet;
      let flag = RoundActionFlag.AGGRESSIVE;
      if (player.stack() === 0) {
        flag |= RoundActionFlag.LEAVE;
      }
      this.round.actionTaken(flag);
    } else if (action === BettingActionFlag.MATCH) {
      player.bet(Math.min(this.biggestBet, player.totalChips()));
      let flag = RoundActionFlag.PASSIVE;
      if (player.stack() === 0) {
        flag |= RoundActionFlag.LEAVE;
      }
      this.round.actionTaken(flag);
    } else {
      this.round.actionTaken(RoundActionFlag.LEAVE);
    }
  }

  private isRaiseValid(bet: Chips): boolean {
    const player = this.players[this.round.playerToAct()];
    assert(player !== null, 'Active player missing');
    const chips = player.stack() + player.betSize();
    const minBet = this.biggestBet + this.minRaise;
    if (chips > this.biggestBet && chips < minBet) {
      return bet === chips;
    }
    return bet >= minBet && bet <= chips;
  }
}
