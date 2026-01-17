import { Card, Player, GameState } from './GameState'
import { v4 as uuidv4 } from 'uuid';

export class LocalGameState implements GameState {
  decks: number;
  totalPlayers: number;
  players: Player[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;

  cardOnTable: Card | null = null;
  drawnThisTurn: boolean = false;

  constructor(decks: number = 3, totalPlayers: number = 5) {
    this.decks = decks;
    this.totalPlayers = totalPlayers;
    this.initializePlayers();
    this.initializeDeck();
    this.dealCards();
  }

  getPlayer(): Player | undefined {
    return this.players.find(p => p.isPlayer);
  }

  getPlayerHand(): Card[] {
    const player = this.getPlayer();
    return player ? player.hand : [];
  }

  setPlayerHand(hand: Card[]): void {
    const player = this.getPlayer();
    if (player) {
      player.hand = hand;
    }
  }

  pushPlayerHand(card: Card): void {
    const player = this.getPlayer();
    if (player) {
      player.hand.push(card);
    }
  }

  popPlayerHand(): Card | undefined {
    const player = this.getPlayer();
    if (player) {
      return player.hand.pop();
    }
    return undefined;
  }

  getOpponents(): Player[] {
    return this.players.filter(p => !p.isPlayer);
  }

  private initializePlayers() {
    this.players.push({ id: uuidv4(), name: 'human', hand: [], isPlayer: true, isHuman: true });
    for (let i = 1; i < this.totalPlayers; i++) {
      this.players.push({ id: uuidv4(), name: `ai${i}`, hand: [], isPlayer: false, isHuman: false });
    }
  }

  private initializeDeck() {
    const suits: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs'];
    let fullDeck: Card[] = [];

    for (let d = 0; d < this.decks; d++) {
      for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) {
          fullDeck.push({ suit, rank, guid: uuidv4() });
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

    this.discardPile.push(this.drawPile.pop()!);
  }

  drawCard(): Card | null {
    if (this.drawPile.length === 0)
    {
      console.log('Draw pile is empty');
      return null;
    }
    if (this.drawnThisTurn) {
      console.log('Already drawn this turn');
      return null;
    }
    const card = this.drawPile.pop()!;
    this.cardOnTable = card;
    this.drawnThisTurn = true;
    return card;
  }

  drawDiscard(): Card | null {
    if (this.discardPile.length === 0) {
      console.log('Discard pile is empty');
      return null;
    }
    const card = this.discardPile.pop()!;
    this.cardOnTable = card;
    this.drawnThisTurn = true;
    return card;
  }

  discard(card: Card): void {
    // ensure the card is not in any player's hand
    this.players.forEach(p => {
      const index = p.hand.findIndex(c => c.guid === card.guid);
      if (index !== -1) {
        p.hand.splice(index, 1);
        return;
      }
    });

    // ensure the card is not in the draw pile
    this.drawPile = this.drawPile.filter(c => c.guid !== card.guid);

    // ensure the card is not the cardOnTable
    if (this.cardOnTable && this.cardOnTable.guid === card.guid) {
      this.cardOnTable = null;
    }

    this.discardPile.push(card);
    
    console.log('Discarded:', card);
  }

  discardCardOnTable(): void {
    this.discard(this.cardOnTable!);
  }

  playerTakesCardOnTable(index?: number): void {
    if (this.cardOnTable) {
      if (index !== undefined) {
        this.getPlayerHand().splice(index, 0, this.cardOnTable);
      } else {
        this.pushPlayerHand(this.cardOnTable);
      }
      this.cardOnTable = null;
    }
  }

  endTurn(): void {
    console.log('Ending turn for local game state');
    this.currentTurn = (this.currentTurn + 1) % this.totalPlayers;
    this.drawnThisTurn = false;
    this.cardOnTable = null;
  }

  isPlayerTurn(): boolean {
    const playerIndex = this.players.findIndex(p => p.isPlayer);
    return this.currentTurn === playerIndex;
  }
}