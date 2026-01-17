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

  drawCard(): Card | null;
  drawDiscard(): Card | null;
  discard(card: Card): void;
  getPlayer(): Player | undefined;
  getPlayerHand(): Card[];
  setPlayerHand(hand: Card[]): void;
  pushPlayerHand(card: Card): void;
  popPlayerHand(): Card | undefined;
  getOpponents(): Player[];
  
  onOpponentDraw(callback: OpponentDraw): void;
  onOpponentDiscard(callback: OpponentDiscard): void;
  onTurnAdvance(callback: TurnAdvance): void;
  // Add more methods as needed: discard, meld, etc.

  discardCardOnTable(): void;
  playerTakesCardOnTable(index?: number): void;

  endTurn(): void;
  isPlayerTurn(player?: Player): boolean;
  getCurrentPlayer(): Player | undefined;
}