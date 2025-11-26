import type { Card, Rank, Suit } from './protocol';

const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const suits: Suit[] = ['hearts', 'diamonds', 'clubs', 'spades'];

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  for (const rank of ranks) {
    for (const suit of suits) {
      deck.push({ rank, suit });
    }
  }
  return deck;
};

export const shuffleDeck = (deck: Card[], random = Math.random): Card[] => {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

export const drawCards = (deck: Card[], count: number): Card[] => {
  if (deck.length < count) {
    throw new Error('Deck does not contain enough cards');
  }
  return deck.splice(0, count);
};

export const cardToString = (card: Card): string => `${card.rank}${card.suit[0].toUpperCase()}`;
