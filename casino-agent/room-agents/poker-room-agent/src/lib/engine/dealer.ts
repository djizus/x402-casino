import assert from 'assert';
import { Deck } from './deck';
import { CommunityCards, RoundOfBetting, nextRound } from './community-cards';
import { BettingRound, BettingActionFlag } from './betting-round';
import type { Chips, ForcedBets, HoleCards, SeatArray, SeatIndex } from './types';
import { PotManager } from './pot-manager';
import { Pot } from './pot';
import { Player } from './player';
import { nextOrWrap } from './utils';
import { evaluateBestHand, compareHandScores } from '../hand-evaluator';
import type { HandScore } from '../hand-evaluator';
import type { Card } from '../protocol';

export enum DealerAction {
  FOLD = 1 << 0,
  CHECK = 1 << 1,
  CALL = 1 << 2,
  BET = 1 << 3,
  RAISE = 1 << 4,
}

export type DealerActionRange = {
  actionMask: number;
  chipRange?: { min: Chips; max: Chips };
};

export type PotWinner = {
  seatIndex: SeatIndex;
  holeCards: HoleCards;
  score: HandScore;
  share: Chips;
};

export type PotResolution = {
  pot: Pot;
  winners: PotWinner[];
};

export class Dealer {
  private readonly buttonSeat: SeatIndex;
  private readonly communityCards: CommunityCards;
  private readonly holeCards: (HoleCards | null)[];
  private players: SeatArray<Player>;
  private bettingRound: BettingRound | null = null;
  private forcedBets: ForcedBets;
  private deck: Deck;
  private handRunning = false;
  private bettingRoundIndex: RoundOfBetting = RoundOfBetting.PREFLOP;
  private completedBettingRounds = false;
  private readonly potManager = new PotManager();
  private winners: PotResolution[] = [];

  constructor(players: SeatArray<Player>, button: SeatIndex, forcedBets: ForcedBets, deck: Deck, communityCards: CommunityCards, numSeats: number) {
    this.players = players;
    this.buttonSeat = button;
    this.forcedBets = forcedBets;
    this.deck = deck;
    this.communityCards = communityCards;
    this.holeCards = new Array(numSeats).fill(null);
    assert(deck.size() === 52, 'Deck must start full');
    assert(this.communityCards.cardsSnapshot().length === 0, 'Community cards must be empty');
  }

  public static isAggressive(action: DealerAction): boolean {
    return !!(action & DealerAction.BET) || !!(action & DealerAction.RAISE);
  }

  handInProgress(): boolean {
    return this.handRunning;
  }

  bettingRoundsCompleted(): boolean {
    assert(this.handInProgress(), 'Hand must be active');
    return this.completedBettingRounds;
  }

  playerToAct(): SeatIndex {
    assert(this.bettingRoundInProgress(), 'Betting round must be active');
    assert(this.bettingRound !== null);
    return this.bettingRound.playerToAct();
  }

  playersSnapshot(): SeatArray<Player> {
    return this.bettingRound?.playersSnapshot() ?? [];
  }

  bettingRoundPlayers(): SeatArray<Player> {
    return this.players;
  }

  roundOfBetting(): RoundOfBetting {
    assert(this.handInProgress(), 'Hand must be in progress');
    return this.bettingRoundIndex;
  }

  numActivePlayers(): number {
    return this.bettingRound?.numActivePlayers() ?? 0;
  }

  biggestBet(): Chips {
    return this.bettingRound?.biggest() ?? 0;
  }

  bettingRoundInProgress(): boolean {
    return this.bettingRound?.inProgress() ?? false;
  }

  isContested(): boolean {
    return this.bettingRound?.isContested() ?? false;
  }

  legalActions(): DealerActionRange {
    assert(this.bettingRoundInProgress(), 'Betting round must be in progress');
    assert(this.bettingRound !== null);
    const actingPlayer = this.players[this.bettingRound.playerToAct()];
    assert(actingPlayer !== null, 'Acting player missing');
    const actions = this.bettingRound.legalActions();
    let mask = DealerAction.FOLD;
    if (this.bettingRound.biggest() - actingPlayer.betSize() === 0) {
      mask |= DealerAction.CHECK;
      if (actions.canRaise) {
        mask |= actingPlayer.betSize() > 0 ? DealerAction.RAISE : DealerAction.BET;
      }
    } else {
      mask |= DealerAction.CALL;
      if (actions.canRaise) {
        mask |= DealerAction.RAISE;
      }
    }

    return {
      actionMask: mask,
      chipRange: actions.canRaise ? { min: actions.chipRange.min, max: actions.chipRange.max } : undefined,
    };
  }

  pots(): Pot[] {
    assert(this.handInProgress(), 'Hand must be active');
    return this.potManager.pots();
  }

  button(): SeatIndex {
    return this.buttonSeat;
  }

  holeCardsSnapshot(): (HoleCards | null)[] {
    assert(this.handInProgress() || this.bettingRoundInProgress(), 'Hand must be active or showdown finished');
    return this.holeCards;
  }

  startHand(): void {
    assert(!this.handInProgress(), 'Hand already running');
    this.completedBettingRounds = false;
    this.bettingRoundIndex = RoundOfBetting.PREFLOP;
    this.winners = [];
    this.collectAnte();
    const bigBlindSeat = this.postBlinds();
    const firstAction = this.nextOrWrap(bigBlindSeat);
    this.dealHoleCards();
    if (this.players.filter((player, seat) => player !== null && (player.stack() !== 0 || seat === bigBlindSeat)).length > 1) {
      this.bettingRound = new BettingRound([...this.players], firstAction, this.forcedBets.blinds.big, this.forcedBets.blinds.big);
    }
    this.handRunning = true;
  }

  actionTaken(action: DealerAction, bet?: Chips): void {
    assert(this.bettingRoundInProgress(), 'Betting round inactive');
    assert(this.bettingRound !== null, 'Missing betting round');
    const legal = this.legalActions();
    const isAggressive = Dealer.isAggressive(action);
    if (isAggressive) {
      assert(legal.chipRange, 'Raise requires chip range');
      assert(typeof bet === 'number', 'Raise requires bet');
    }

    if (action & DealerAction.CHECK || action & DealerAction.CALL) {
      this.bettingRound.actionTaken(BettingActionFlag.MATCH);
    } else if (action & DealerAction.BET || action & DealerAction.RAISE) {
      this.bettingRound.actionTaken(BettingActionFlag.RAISE, bet);
    } else {
      const foldingPlayer = this.players[this.playerToAct()];
      assert(foldingPlayer !== null, 'Folding player missing');
      this.potManager.betFolded(foldingPlayer.betSize());
      foldingPlayer.takeFromBet(foldingPlayer.betSize());
      this.players[this.playerToAct()] = null;
      this.bettingRound.actionTaken(BettingActionFlag.LEAVE);
    }
  }

  endBettingRound(): void {
    assert(!this.completedBettingRounds, 'All betting rounds already finished');
    assert(!this.bettingRoundInProgress(), 'Betting round still in progress');

    this.potManager.collectBetsFrom(this.players);
    if ((this.bettingRound?.numActivePlayers() ?? 0) <= 1) {
      this.bettingRoundIndex = RoundOfBetting.RIVER;
      if (!(this.potManager.pots().length === 1 && this.potManager.pots()[0].eligiblePlayers().length === 1)) {
        this.dealCommunityCards();
      }
      this.completedBettingRounds = true;
    } else if (this.bettingRoundIndex < RoundOfBetting.RIVER) {
      this.bettingRoundIndex = nextRound(this.bettingRoundIndex);
      this.players = this.bettingRound?.playersSnapshot() ?? [];
      this.bettingRound = new BettingRound([...this.players], this.nextOrWrap(this.buttonSeat), this.forcedBets.blinds.big);
      this.dealCommunityCards();
    } else {
      this.completedBettingRounds = true;
    }
  }

  winnersSnapshot(): PotResolution[] {
    assert(!this.handInProgress(), 'Hand still running');
    return this.winners;
  }

  showdown(): PotResolution[] {
    assert(this.bettingRoundIndex === RoundOfBetting.RIVER, 'River must be dealt');
    assert(!this.bettingRoundInProgress(), 'Betting round in progress');
    assert(this.bettingRoundsCompleted(), 'Betting not complete');

    this.handRunning = false;
    if (this.potManager.pots().length === 1 && this.potManager.pots()[0].eligiblePlayers().length === 1) {
      const index = this.potManager.pots()[0].eligiblePlayers()[0];
      const player = this.players[index];
      assert(player !== null, 'Winner missing');
      player.addToStack(this.potManager.pots()[0].size());
      this.winners = [
        {
          pot: this.potManager.pots()[0],
          winners: [
            {
              seatIndex: index,
              holeCards: this.holeCards[index] ?? ([] as unknown as HoleCards),
              score: evaluateBestHand([...(this.holeCards[index] ?? []), ...this.communityCards.cardsSnapshot()]),
              share: this.potManager.pots()[0].size(),
            },
          ],
        },
      ];
      return this.winners;
    }

    const resolutions: PotResolution[] = [];
    for (const pot of this.potManager.pots()) {
      const playerResults = pot
        .eligiblePlayers()
        .map((seatIndex) => {
          const hole = this.holeCards[seatIndex];
          assert(hole, 'Hole cards missing');
          const score = evaluateBestHand([...hole, ...this.communityCards.cardsSnapshot()]);
          return { seatIndex, holeCards: hole, score };
        })
        .sort((a, b) => compareHandScores(b.score, a.score));

      const bestScore = playerResults[0]?.score;
      const winners = playerResults.filter((result) => compareHandScores(result.score, bestScore) === 0);
      const totalPot = pot.size();
      const baseShare = winners.length > 0 ? (totalPot - (totalPot % winners.length)) / winners.length : 0;
      let oddChips = winners.length > 0 ? totalPot % winners.length : 0;
      const extraOdd = new Map<SeatIndex, number>();

      winners.forEach((winner) => {
        const player = this.players[winner.seatIndex];
        player?.addToStack(baseShare);
      });

      if (oddChips !== 0 && winners.length > 0) {
        const winnerSeats: SeatArray<Player> = new Array(this.players.length).fill(null);
        winners.forEach((winner) => {
          winnerSeats[winner.seatIndex] = this.players[winner.seatIndex];
        });
        let seat = this.buttonSeat;
        while (oddChips > 0) {
          seat = nextOrWrap(winnerSeats, seat);
          const winnerPlayer = winnerSeats[seat];
          if (!winnerPlayer) {
            break;
          }
          winnerPlayer.addToStack(1);
          extraOdd.set(seat, (extraOdd.get(seat) ?? 0) + 1);
          oddChips -= 1;
        }
      }

      resolutions.push({
        pot,
        winners: winners.map((winner) => ({
          ...winner,
          share: baseShare + (extraOdd.get(winner.seatIndex) ?? 0),
        })),
      });
    }

    this.winners = resolutions;
    return resolutions;
  }

  communityCardsSnapshot(): Card[] {
    return this.communityCards.cardsSnapshot();
  }

  private nextOrWrap(seat: SeatIndex): SeatIndex {
    return nextOrWrap(this.players, seat);
  }

  private collectAnte(): void {
    if (this.forcedBets.ante === undefined) {
      return;
    }
    let total = 0;
    for (const player of this.players) {
      if (player !== null) {
        const ante = Math.min(this.forcedBets.ante, player.totalChips());
        player.takeFromStack(ante);
        total += ante;
      }
    }
    this.potManager.pots()[0].add(total);
  }

  private postBlinds(): SeatIndex {
    let seat = this.buttonSeat;
    const activeCount = this.players.filter((player) => player !== null).length;
    if (activeCount !== 2) {
      seat = this.nextOrWrap(seat);
    }
    const smallBlind = this.players[seat];
    assert(smallBlind !== null, 'Small blind missing');
    smallBlind.bet(Math.min(this.forcedBets.blinds.small, smallBlind.totalChips()));
    seat = this.nextOrWrap(seat);
    const bigBlind = this.players[seat];
    assert(bigBlind !== null, 'Big blind missing');
    bigBlind.bet(Math.min(this.forcedBets.blinds.big, bigBlind.totalChips()));
    return seat;
  }

  private dealHoleCards(): void {
    this.players.forEach((player, index) => {
      if (player !== null) {
        this.holeCards[index] = [this.deck.draw(), this.deck.draw()];
      }
    });
  }

  private dealCommunityCards(): void {
    const cards: Card[] = [];
    const numToDeal = this.bettingRoundIndex - this.communityCards.cardsSnapshot().length;
    for (let index = 0; index < numToDeal; index += 1) {
      cards.push(this.deck.draw());
    }
    this.communityCards.deal(cards);
  }
}
