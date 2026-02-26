import { BucketValue, Bucket, Card, values, InitialRunCount, InitialSetCount } from './Types';
import { v4 as uuidv4 } from 'uuid';

export interface Meld {
  id: string;
  type: 'set' | 'run';
  cards: MeldCard[];
  owner: IPlayer;
}

export interface MeldCard {
  player: IPlayer;
  card: Card;
}

export const validateMeld = (meld: Meld, initial: boolean = false): boolean => {
  if (meld.type === 'set') {
    // All cards must have the same rank
    const rank = meld.cards[0].card.rank;
    const result = meld.cards.every(mc => mc.card.rank === rank);
    if(result && initial) {
      if(meld.cards.length < InitialSetCount) {
        console.log(`Sets must have at least ${InitialSetCount} cards to start a meld.`);
        return false;
      }
      if(meld.cards.length > InitialSetCount) {
        console.log(`Sets cannot have more than ${InitialSetCount} cards on a new meld.`);
        return false;
      }
    }
    return result;
  } else if (meld.type === 'run') {
    // All cards must be of the same suit and consecutive ranks
    if (!meld.cards || meld.cards.length === 0) return false;

    // No run may contain more than 13 cards
    if (meld.cards.length > 13) {
      console.log('Runs cannot contain more than 13 cards.');
      return false;
    }

    const suit = meld.cards[0].card.suit;

    // All cards same suit
    const sameSuit = meld.cards.every(mc => mc.card.suit === suit);
    if (!sameSuit) return false;

    // Initial run size constraints
    if (initial) {
      if (meld.cards.length < InitialRunCount) {
        console.log(`Runs must have at least ${InitialRunCount} cards to start a meld.`);
        return false;
      }
      if (meld.cards.length > InitialRunCount) {
        console.log(`Runs cannot have more than ${InitialRunCount} cards on a new meld.`);
        return false;
      }
    }

    const ranks = meld.cards
      .map(mc => mc.card.rank)
      .sort((a, b) => a - b);

    // No duplicate ranks
    if (new Set(ranks).size !== ranks.length) return false;

    // Check for consecutive sequence, with Ace (1) allowed as high (after K) and/or wrapping
    return isConsecutiveWithAceWrap(ranks);
  }
  return false;
}

// Validates that sorted ranks form a consecutive sequence.
// Ace (1) can be low (A-2-3...), high (...Q-K-A), or wrap (...K-A-2...).
function isConsecutiveWithAceWrap(sortedRanks: number[]): boolean {
  // Try standard consecutive first (no wrapping)
  if (isStrictlyConsecutive(sortedRanks)) return true;

  // If Ace is present, try treating it as rank 14 (high)
  if (sortedRanks[0] === 1) {
    const withHighAce = [...sortedRanks.slice(1), 14].sort((a, b) => a - b);
    if (isStrictlyConsecutive(withHighAce)) return true;

    // Ace wrapping: find the best split where Ace bridges low and high
    // e.g., [1,2,3,11,12,13] → treat as [11,12,13,14,15,16] — no, that doesn't work.
    // Wrapping means the run goes ...Q(12)-K(13)-A(1)-2-3...
    // Represent as contiguous: [11,12,13,14,15,16] by mapping 1→14, 2→15, 3→16 etc.
    // Only valid if the sequence is contiguous when some low cards are shifted up by 13
    for (let splitIdx = 1; splitIdx < sortedRanks.length; splitIdx++) {
      if (sortedRanks[splitIdx] === 1) continue; // skip if multiple aces somehow
      const wrapped = [
        ...sortedRanks.slice(splitIdx),
        ...sortedRanks.slice(0, splitIdx).map(r => r + 13)
      ].sort((a, b) => a - b);
      if (isStrictlyConsecutive(wrapped)) return true;
    }
  }

  return false;
}

function isStrictlyConsecutive(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

export interface IPlayer {
  id: string;
  name: string;
  hand: Card[];
  isPlayer: boolean; // this is the person playing on our instance.
  isHuman: boolean;
  scores: number[];

  getHandSummary(): HandSummary
}

export type HandSummary = {
  buckets: Record<BucketValue, Bucket>;
  grandCount: number;
  grandTotal: number;
};

export class Player implements IPlayer {
  id: string;
  name: string;
  hand: Card[];
  isPlayer: boolean;
  isHuman: boolean;
  scores: number[];

  constructor(name: string, isPlayer: boolean, isHuman: boolean) {
    this.id = uuidv4();
    this.name = name;
    this.hand = [];
    this.isPlayer = isPlayer;
    this.isHuman = isHuman;
    this.scores = [];
  }

  getHandSummary(): HandSummary {
    const buckets: Record<BucketValue, Bucket> = {
      5: { count: 0, total: 0 },
      10: { count: 0, total: 0 },
      15: { count: 0, total: 0 },
    };

    this.hand.forEach(card => {
      const value = values[card.rank] as BucketValue | undefined;

      if (value === 5 || value === 10 || value === 15) {
        buckets[value].count++;
        buckets[value].total += value;
      }
    });

    const grandCount =
      buckets[5].count + buckets[10].count + buckets[15].count;
    const grandTotal =
      buckets[5].total + buckets[10].total + buckets[15].total;

    return { buckets, grandCount, grandTotal };
  }
}