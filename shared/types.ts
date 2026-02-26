// Shared types and constants for May I card game
// Used by both client (renderer) and server

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

// Scoring per GameRules.md: 2-9 = 5pts, 10 and face cards = 10pts, Aces = 15pts
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

// Meld types
export interface Meld {
  id: string;
  type: 'set' | 'run';
  cards: MeldCard[];
  ownerId: string;
}

export interface MeldCard {
  playerId: string;
  card: Card;
}

// Player info (serializable, no methods)
export interface PlayerInfo {
  id: string;
  name: string;
  handCount: number; // other players can't see cards
  isDown: boolean;
  scores: number[];
}

// Socket event payloads
export interface ServerGameState {
  players: PlayerInfo[];
  drawPileCount: number;
  discardPile: Card[];
  currentTurn: number;
  currentRound: number;
  turnCount: number;
  roundMelds: Meld[];
  drawnThisTurn: boolean;
  discardedThisTurn: boolean;
  cardOnTable: Card | null;
}

export interface JoinRoomPayload {
  roomId: string;
  playerName: string;
}

export interface MayIRequestPayload {
  requestId: string;
  playerId: string;
  card: Card;
  voters: PlayerInfo[];
  nextVoterIndex: number;
}

export interface MayIResponsePayload {
  requestId: string;
  playerId: string;
  accepted: boolean;
}

export interface MayIResolvedPayload {
  requestId: string;
  accepted: boolean;
  winnerId: string | null;
  deniedById: string | null;
}

export interface SubmitMeldsPayload {
  melds: Array<{ type: 'set' | 'run'; cardGuids: string[] }>;
}

export interface AddToMeldPayload {
  meldId: string;
  cardGuids: string[];
}

export interface DiscardPayload {
  cardGuid: string;
}

// Client → Server events
export interface ClientToServerEvents {
  joinRoom: (payload: JoinRoomPayload) => void;
  startGame: () => void;
  drawCard: () => void;
  drawDiscard: () => void;
  discard: (payload: DiscardPayload) => void;
  submitMelds: (payload: SubmitMeldsPayload) => void;
  addToMeld: (payload: AddToMeldPayload) => void;
  mayI: (cardGuid: string) => void;
  respondToMayI: (payload: MayIResponsePayload) => void;
  cancelMayI: (requestId: string) => void;
  takeCardOnTable: (index?: number) => void;
  discardCardOnTable: () => void;
  endTurn: () => void;
}

// Server → Client events
export interface ServerToClientEvents {
  gameState: (state: ServerGameState) => void;
  yourHand: (hand: Card[]) => void;
  cardOnTable: (card: Card | null) => void;
  playerJoined: (player: PlayerInfo) => void;
  playerLeft: (playerId: string) => void;
  gameStarted: () => void;
  roundStarted: (round: number) => void;
  roundEnded: (scores: Record<string, number>) => void;
  gameEnded: (finalScores: Record<string, number[]>) => void;
  turnAdvanced: (playerId: string) => void;
  mayIRequest: (payload: MayIRequestPayload) => void;
  mayIResponse: (payload: MayIResponsePayload) => void;
  mayIResolved: (payload: MayIResolvedPayload) => void;
  mayINextVoter: (requestId: string, voterId: string) => void;
  meldSubmitted: (melds: Meld[]) => void;
  meldAppended: (meldId: string, cards: Card[]) => void;
  error: (message: string) => void;
  roomInfo: (info: { roomId: string; players: PlayerInfo[]; hostId: string }) => void;
}
