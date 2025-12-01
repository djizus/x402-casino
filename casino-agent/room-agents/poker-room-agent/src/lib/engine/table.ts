import assert from 'assert';
import type { Chips, ForcedBets, SeatArray, SeatIndex } from './types';
import { Player } from './player';
import { Deck } from './deck';
import { CommunityCards, RoundOfBetting } from './community-cards';
import { Dealer, DealerAction, DealerActionRange, PotResolution } from './dealer';
import type { Card } from '../protocol';

export class Table {
  private readonly numSeats: number;
  private forcedBets: ForcedBets;
  private tablePlayers: SeatArray<Player>;
  private handPlayers?: SeatArray<Player>;
  private dealer?: Dealer;
  private communityCards?: CommunityCards;
  private buttonSeat: SeatIndex = 0;
  private handCounter = 0;

  constructor(forcedBets: ForcedBets, numSeats = 9) {
    assert(numSeats > 1 && numSeats <= 23, 'Seat count must be between 2 and 23');
    this.numSeats = numSeats;
    this.forcedBets = forcedBets;
    this.tablePlayers = new Array(numSeats).fill(null);
  }

  public sitDown(seat: SeatIndex, buyIn: Chips): void {
    assert(seat >= 0 && seat < this.numSeats, 'Seat index out of range');
    assert(this.tablePlayers[seat] === null, 'Seat already occupied');
    this.tablePlayers[seat] = new Player(buyIn);
  }

  public standUp(seat: SeatIndex): void {
    assert(seat >= 0 && seat < this.numSeats, 'Seat index out of range');
    this.tablePlayers[seat] = null;
  }

  public seatStates(): SeatArray<{ totalChips: Chips; stack: Chips; betSize: Chips }> {
    return this.tablePlayers.map((player) =>
      player
        ? {
            totalChips: player.totalChips(),
            stack: player.stack(),
            betSize: player.betSize(),
          }
        : null,
    );
  }

  public handSeatStates(): SeatArray<{ totalChips: Chips; stack: Chips; betSize: Chips }> {
    if (!this.handPlayers) {
      return new Array(this.numSeats).fill(null);
    }
    return this.handPlayers.map((player) =>
      player
        ? {
            totalChips: player.totalChips(),
            stack: player.stack(),
            betSize: player.betSize(),
          }
        : null,
    );
  }

  public startHand(): void {
    assert(!this.handInProgress(), 'Hand already in progress');
    const seated = this.tablePlayers.filter((player) => player !== null);
    assert(seated.length >= 2, 'Need at least two players');

    this.handPlayers = this.tablePlayers.map((player) => (player ? new Player(player) : null));
    this.communityCards = new CommunityCards();
    const deck = new Deck();
    this.advanceButton();
    this.dealer = new Dealer(
      this.handPlayers,
      this.buttonSeat,
      this.forcedBets,
      deck,
      this.communityCards,
      this.numSeats,
    );
    this.dealer.startHand();
    this.handCounter += 1;
  }

  public playerToAct(): SeatIndex {
    assert(this.dealer, 'Dealer not initialized');
    return this.dealer.playerToAct();
  }

  public legalActions(): DealerActionRange {
    assert(this.dealer, 'Dealer not initialized');
    return this.dealer.legalActions();
  }

  public applyAction(action: DealerAction, bet?: Chips): void {
    assert(this.dealer, 'Dealer not initialized');
    this.dealer.actionTaken(action, bet);
  }

  public endBettingRound(): void {
    assert(this.dealer, 'Dealer not initialized');
    this.dealer.endBettingRound();
  }

  public showdown(): PotResolution[] {
    assert(this.dealer, 'Dealer not initialized');
    const resolutions = this.dealer.showdown();
    this.syncToTablePlayers();
    this.handPlayers = undefined;
    this.dealer = undefined;
    this.communityCards = undefined;
    return resolutions;
  }

  public pots() {
    return this.dealer?.pots() ?? [];
  }

  public handInProgress(): boolean {
    return this.dealer?.handInProgress() ?? false;
  }

  public bettingRoundInProgress(): boolean {
    return this.dealer?.bettingRoundInProgress() ?? false;
  }

  public bettingRoundsCompleted(): boolean {
    return this.dealer?.bettingRoundsCompleted() ?? false;
  }

  public roundOfBetting(): RoundOfBetting {
    return this.dealer?.roundOfBetting() ?? RoundOfBetting.PREFLOP;
  }

  public communityCardsSnapshot(): Card[] {
    return this.dealer?.communityCardsSnapshot() ?? this.communityCards?.cardsSnapshot() ?? [];
  }

  public holeCardsSnapshot(): (Card[] | null)[] {
    return this.dealer?.holeCardsSnapshot() ?? [];
  }

  public button(): SeatIndex {
    return this.buttonSeat;
  }

  public setForcedBets(forcedBets: ForcedBets): void {
    assert(!this.handInProgress(), 'Cannot change blinds mid-hand');
    this.forcedBets = forcedBets;
  }

  public handCount(): number {
    return this.handCounter;
  }

  private advanceButton(): void {
    const start = this.buttonSeat;
    let seat = start;
    for (let i = 0; i < this.numSeats; i += 1) {
      seat = (seat + 1) % this.numSeats;
      if (this.handPlayers?.[seat]) {
        this.buttonSeat = seat;
        return;
      }
    }
    const fallback = this.handPlayers?.findIndex((player) => player !== null) ?? 0;
    assert(fallback !== -1, 'No occupied seats');
    this.buttonSeat = fallback;
  }

  private syncToTablePlayers(): void {
    if (!this.handPlayers) {
      return;
    }
    this.handPlayers.forEach((handPlayer, index) => {
      if (handPlayer) {
        this.tablePlayers[index] = new Player(handPlayer);
      }
    });
  }
}
