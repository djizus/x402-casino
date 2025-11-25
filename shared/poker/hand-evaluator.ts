import type { Card } from './types';

const rankValue: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const HAND_NAMES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

export type HandScore = {
  rank: number;
  tiebreakers: number[];
  name: string;
  bestCards: Card[];
};

const combinations = (cards: Card[]): Card[][] => {
  const result: Card[][] = [];
  const combo: Card[] = [];

  const helper = (start: number) => {
    if (combo.length === 5) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < cards.length; i += 1) {
      combo.push(cards[i]);
      helper(i + 1);
      combo.pop();
    }
  };

  helper(0);
  return result;
};

const isStraight = (ranks: number[]): number | null => {
  const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
  if (unique.length < 5) {
    return null;
  }

  // Handle wheel straight (A2345)
  const extended = unique.slice();
  if (extended[0] === 14) {
    extended.push(1);
  }

  let run = 1;
  for (let i = 1; i < extended.length; i += 1) {
    if (extended[i] === extended[i - 1] - 1) {
      run += 1;
      if (run >= 5) {
        return extended[i - 4];
      }
    } else {
      run = 1;
    }
  }
  return null;
};

const evaluateCombination = (cards: Card[]): HandScore => {
  const ranks = cards.map((card) => rankValue[card.rank]).sort((a, b) => b - a);
  const suits = cards.map((card) => card.suit);
  const counts = new Map<number, number>();
  ranks.forEach((rank) => counts.set(rank, (counts.get(rank) ?? 0) + 1));

  const distinctRanks = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return b[0] - a[0];
    })
    .map(([rank]) => rank);

  const sortedRanks = ranks.slice().sort((a, b) => b - a);
  const flush = suits.every((suit) => suit === suits[0]);
  const straightHigh = isStraight(ranks);
  const straight = straightHigh !== null;

  if (flush && straight) {
    return {
      rank: 8,
      tiebreakers: [straightHigh ?? 0],
      name: 'Straight Flush',
      bestCards: cards,
    };
  }

  if ([...counts.values()].includes(4)) {
    const quadRank = distinctRanks.find((rank) => counts.get(rank) === 4) ?? 0;
    const kicker = distinctRanks.find((rank) => counts.get(rank) === 1) ?? 0;
    return {
      rank: 7,
      tiebreakers: [quadRank, kicker],
      name: 'Four of a Kind',
      bestCards: cards,
    };
  }

  if ([...counts.values()].includes(3) && [...counts.values()].includes(2)) {
    const tripRank = distinctRanks.find((rank) => counts.get(rank) === 3) ?? 0;
    const pairRank = distinctRanks.find((rank) => counts.get(rank) === 2) ?? 0;
    return {
      rank: 6,
      tiebreakers: [tripRank, pairRank],
      name: 'Full House',
      bestCards: cards,
    };
  }

  if (flush) {
    return {
      rank: 5,
      tiebreakers: sortedRanks,
      name: 'Flush',
      bestCards: cards.sort((a, b) => rankValue[b.rank] - rankValue[a.rank]),
    };
  }

  if (straight) {
    return {
      rank: 4,
      tiebreakers: [straightHigh ?? 0],
      name: 'Straight',
      bestCards: cards,
    };
  }

  if ([...counts.values()].includes(3)) {
    const tripRank = distinctRanks.find((rank) => counts.get(rank) === 3) ?? 0;
    const kickers = distinctRanks.filter((rank) => counts.get(rank) === 1).slice(0, 2);
    return {
      rank: 3,
      tiebreakers: [tripRank, ...kickers],
      name: 'Three of a Kind',
      bestCards: cards,
    };
  }

  const pairRanks = distinctRanks.filter((rank) => counts.get(rank) === 2);
  if (pairRanks.length >= 2) {
    const [highPair, lowPair] = pairRanks.slice(0, 2);
    const kicker = distinctRanks.find((rank) => counts.get(rank) === 1) ?? 0;
    return {
      rank: 2,
      tiebreakers: [highPair, lowPair, kicker],
      name: 'Two Pair',
      bestCards: cards,
    };
  }

  if (pairRanks.length === 1) {
    const pairRank = pairRanks[0];
    const kickers = distinctRanks.filter((rank) => counts.get(rank) === 1).slice(0, 3);
    return {
      rank: 1,
      tiebreakers: [pairRank, ...kickers],
      name: 'One Pair',
      bestCards: cards,
    };
  }

  return {
    rank: 0,
    tiebreakers: sortedRanks,
    name: 'High Card',
    bestCards: cards.sort((a, b) => rankValue[b.rank] - rankValue[a.rank]),
  };
};

export const compareHandScores = (a: HandScore, b: HandScore): number => {
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  const len = Math.max(a.tiebreakers.length, b.tiebreakers.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

export const evaluateBestHand = (cards: Card[]): HandScore => {
  const combos = combinations(cards);
  let bestScore: HandScore | null = null;
  combos.forEach((combo) => {
    const score = evaluateCombination(combo);
    if (!bestScore || compareHandScores(score, bestScore) > 0) {
      bestScore = score;
    }
  });

  if (!bestScore) {
    return {
      rank: 0,
      tiebreakers: [],
      name: 'High Card',
      bestCards: cards.slice(0, 5),
    };
  }

  return bestScore;
};

export const describeHand = (score: HandScore): string =>
  `${HAND_NAMES[score.rank]} (${score.bestCards
    .map((card) => `${card.rank}${card.suit[0].toUpperCase()}`)
    .join(' ')})`;
