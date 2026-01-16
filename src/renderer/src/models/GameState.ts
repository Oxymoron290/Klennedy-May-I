export interface Card {
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
  rank: number; // 1=A, 2-10, 11=J, 12=Q, 13=K
  guid: string;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  isPlayer: boolean; // this is the person playing on our instance.
  isHuman: boolean;
}

export interface GameState {
  players: Player[];
  drawPile: Card[];
  discardPile: Card[];
  cardOnTable: Card | null;
  currentTurn: number;

  drawCard(): Card | null;
  getPlayer(): Player | undefined;
  getPlayerHand(): Card[];
  setPlayerHand(hand: Card[]): void;
  pushPlayerHand(card: Card): void;
  popPlayerHand(): Card | undefined;
  getOpponents(): Player[];
  // Add more methods as needed: discard, meld, etc.

  discardCardOnTable(): void;
  playerTakesCardOnTable(index?: number): void;

  endTurn(): void;
  isPlayerTurn(): boolean;
}