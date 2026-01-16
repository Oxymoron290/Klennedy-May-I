import { Card, Player, GameState } from './GameState'

export class LocalGameState implements GameState {
  decks: number = 3;
  totalPlayers: number = 5;
  players: Player[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: string = 'human';

  constructor() {
    this.initializePlayers();
    this.initializeDeck();
    this.dealCards();
  }

  private initializePlayers() {
    this.players.push({ id: 'human', hand: [], isPlayer: true, isHuman: true });
    for (let i = 1; i < this.totalPlayers; i++) {
      this.players.push({ id: `ai${i}`, hand: [], isPlayer: false, isHuman: false });
    }
  }

  private initializeDeck() {
    const suits: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs'];
    let fullDeck: Card[] = [];

    for (let d = 0; d < this.decks; d++) {
      for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) {
          fullDeck.push({ suit, rank });
        }
      }
    }

    // Shuffle
    for (let i = fullDeck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [fullDeck[i], fullDeck[j]] = [fullDeck[j], fullDeck[i]];
    }

    this.drawPile = fullDeck;
  }

  private dealCards() {
    for (const player of this.players) {
      player.hand = this.drawPile.splice(0, 11);
    }
  }

  drawCard(playerId: string): Card | null {
    if (this.drawPile.length === 0) return null;
    const card = this.drawPile.pop()!;
    const player = this.players.find(p => p.id === playerId);
    if (player) player.hand.push(card);
    return card;
  }
}