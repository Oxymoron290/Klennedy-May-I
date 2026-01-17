export const roundConfigs = [
  { sets: 2, },
  { runs: 1, sets: 1 },
  { runs: 2, },
  { sets: 3, },
  { runs: 1, sets: 2 },
  { runs: 2, sets: 1 },
  { runs: 3, },
];

export type Rank = 1|2|3|4|5|6|7|8|9|10|11|12|13;

export const values: Record<Rank, 5 | 10 | 15> = {
  1: 15,  // Ace
  2: 5,
  3: 5,
  4: 5,
  5: 5,
  6: 5,
  7: 5,
  8: 10,
  9: 10,
  10: 10,
  11: 10, // Jack
  12: 10, // Queen
  13: 15  // King
}

export interface Card {
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
  rank: Rank; // 1=A, 2-10, 11=J, 12=Q, 13=K
  guid: string;
  rotation?: number;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isPlayer: boolean; // this is the person playing on our instance.
  isHuman: boolean;

  currentScore?: number;
}

export interface MayIRequest {
  id: string;
  player: Player;
  card: Card;
  responses: MayIResponse[];
  resolved: boolean;

  resolve?: (accepted: boolean) => void;
  promise?: Promise<boolean>;
  
  voters: Player[];            // ordered voters (in order they must respond)
  nextVoterIndex: number;      // who is expected to respond next
  winner: Player | null;       // who ended up taking the card
  deniedBy: Player | null;     // if someone denied, who
  penaltyCard: Card | null;    // the penalty card for the winner (hidden by UI for others)
}

export interface MayIResponse {
  player: Player;
  accepted: boolean;
}

type OpponentDraw = (player: Player) => void;
type OpponentDiscard = (player: Player, card: Card) => void;
type TurnAdvance = (player: Player) => void;

export interface GameState {
  players: Player[];
  drawPile: Card[];
  discardPile: Card[];
  currentTurn: number;
  
  cardOnTable: Card | null;
  drawnThisTurn: boolean;

  startGame(): void;
  drawCard(): Card | null;
  drawDiscard(): Card | null;
  discard(card: Card): void;
  mayI(player: Player, card: Card): Promise<boolean>;
  respondToMayI(player: Player, request: MayIRequest, allow: boolean): void
  waitForNoPendingMayI(): Promise<void>;
  getCurrentPlayer(): Player | undefined;
  getCurrentPlayerHand(): Card[];
  isPlayerTurn(player?: Player): boolean;
  getOpponents(): Player[];
  
  onOpponentDraw(callback: OpponentDraw): void;
  onOpponentDiscard(callback: OpponentDiscard): void;
  onOpponentDrawFromDiscard(callback: (player: Player, card: Card) => void): void;
  onTurnAdvance(callback: TurnAdvance): void;
  onMayIRequest(callback: (request: MayIRequest) => void): void;
  onMayIResponse(callback: (request: MayIRequest, response: MayIResponse) => void): void;
  onMayIResolved(callback: (request: MayIRequest, accepted: boolean) => void): void;
  onMayINextVoter(callback: (request: MayIRequest, nextVoter: Player) => void): void;
  //onOpponentFormedMeld(callback: (player: Player, meld: Card[]) => void): void;
  // onOpponentWentOut(callback: (player: Player) => void): void;
  // onOpponentTookMayI(callback: (player: Player, card: Card) => void): void;
  // onOpponentAcceptedMayI(callback: (player: Player) => void): void;
  // Add more methods as needed: discard, meld, etc.

  discardCardOnTable(): void;
  playerTakesCardOnTable(index?: number): void;

  endTurn(): void;
}