export interface Card {
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs'
  rank: number // 1=A, 2-10, 11=J, 12=Q, 13=K
}

export interface Player {
  id: string;
  hand: Card[];
  isPlayer: boolean; // this is the person playing on our instance.
  isHuman: boolean;
}

export interface GameState {
  players: Player[]
  drawPile: Card[]
  discardPile: Card[]
  currentTurn: string

  drawCard(playerId: string): Card | null
  // Add more methods as needed: discard, meld, etc.
}