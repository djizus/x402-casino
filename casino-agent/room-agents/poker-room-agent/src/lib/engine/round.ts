import assert from 'assert';
import type { SeatIndex } from './types';

export enum RoundActionFlag {
  LEAVE = 1 << 0,
  PASSIVE = 1 << 1,
  AGGRESSIVE = 1 << 2,
}

export class Round {
  private readonly activePlayers: boolean[];
  private playerIndex: SeatIndex;
  private lastAggressive: SeatIndex;
  private contested = false;
  private firstAction = true;
  private activeCount: number;

  constructor(activePlayers: boolean[], firstToAct: SeatIndex) {
    assert(firstToAct < activePlayers.length, 'Seat index out of range');
    this.activePlayers = activePlayers;
    this.playerIndex = firstToAct;
    this.lastAggressive = firstToAct;
    this.activeCount = activePlayers.filter(Boolean).length;
  }

  active(): boolean[] {
    return this.activePlayers;
  }

  playerToAct(): SeatIndex {
    return this.playerIndex;
  }

  lastAggressiveActor(): SeatIndex {
    return this.lastAggressive;
  }

  numActivePlayers(): number {
    return this.activeCount;
  }

  inProgress(): boolean {
    return (this.contested || this.activeCount > 1) && (this.firstAction || this.playerIndex !== this.lastAggressive);
  }

  isContested(): boolean {
    return this.contested;
  }

  actionTaken(action: RoundActionFlag): void {
    assert(this.inProgress(), 'Round already settled');
    assert(!((action & RoundActionFlag.PASSIVE) && (action & RoundActionFlag.AGGRESSIVE)), 'Action cannot be both');

    if (this.firstAction) {
      this.firstAction = false;
    }

    if (action & RoundActionFlag.AGGRESSIVE) {
      this.lastAggressive = this.playerIndex;
      this.contested = true;
    } else if (action & RoundActionFlag.PASSIVE) {
      this.contested = true;
    }

    if (action & RoundActionFlag.LEAVE) {
      this.activePlayers[this.playerIndex] = false;
      this.activeCount -= 1;
    }

    this.advancePlayer();
  }

  private advancePlayer(): void {
    do {
      this.playerIndex += 1;
      if (this.playerIndex === this.activePlayers.length) {
        this.playerIndex = 0;
      }
      if (this.playerIndex === this.lastAggressive) {
        break;
      }
    } while (!this.activePlayers[this.playerIndex]);
  }
}
