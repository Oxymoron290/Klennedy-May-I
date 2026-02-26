export const InitialRunCount = 4;
export const InitialSetCount = 3;

export const roundConfigs = [
  { sets: 2, },
  { runs: 1, sets: 1 },
  { runs: 2, },
  { sets: 3, },
  { runs: 1, sets: 2 },
  { runs: 2, sets: 1 },
  { runs: 3, },
];

export interface Card {
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
  rank: Rank; // 1=A, 2-10, 11=J, 12=Q, 13=K
  guid: string;
  rotation?: number;
}

export type Rank = 1|2|3|4|5|6|7|8|9|10|11|12|13;

export const values: Record<Rank, 5 | 10 | 15> = {
  1: 15,  // Ace
  2: 5,
  3: 5,
  4: 5,
  5: 5,
  6: 5,
  7: 5,
  8: 5,
  9: 5,
  10: 10,
  11: 10, // Jack
  12: 10, // Queen
  13: 10  // King
}

export type BucketValue = 5 | 10 | 15;

export type Bucket = {
  count: number;
  total: number;
};

export const buckets: Record<BucketValue, Bucket> = {
  5: { count: 0, total: 0 },
  10: { count: 0, total: 0 },
  15: { count: 0, total: 0 },
};
