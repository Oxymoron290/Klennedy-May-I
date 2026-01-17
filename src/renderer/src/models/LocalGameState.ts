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
  discardedThisTurn: boolean = false;
  
  onOpponentDrawCallback: ((player: Player) => void) | null = null;
  onOpponentDiscardCallback: ((player: Player, card: Card) => void) | null = null
  onTurnAdvanceCallback: ((player: Player) => void) | null = null;

  constructor(decks: number = 3, totalPlayers: number = 5) {
    this.decks = decks;
    this.totalPlayers = totalPlayers;
    this.initializePlayers();
    this.initializeDeck();
    this.dealCards();
  }

  onOpponentDraw(callback: (player: Player) => void): void {
    this.onOpponentDrawCallback = callback;
    callback(this.getCurrentPlayer()!);
  }

  onOpponentDiscard(callback: (player: Player, card: Card) => void): void {
    this.onOpponentDiscardCallback = callback;
    callback(this.getCurrentPlayer()!, this.cardOnTable!);
  }

  onTurnAdvance(callback: (player: Player) => void): void {
    this.onTurnAdvanceCallback = callback;
    callback(this.getCurrentPlayer()!);
  }

  private opponentDraw(player: Player) {
    if (this.onOpponentDrawCallback) {
      this.onOpponentDrawCallback(player);
    }
  }

  private opponentDiscard(player: Player, card: Card) {
    if (this.onOpponentDiscardCallback) {
      this.onOpponentDiscardCallback(player, card);
    }
  }

  private turnAdvance(player: Player) {
    if (this.onTurnAdvanceCallback) {
      this.onTurnAdvanceCallback(player);
    }
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
    if (!this.drawnThisTurn) {
      console.log('Must draw a card before discarding');
      return;
    }
    if (this.discardedThisTurn) {
      console.log('Already discarded this turn');
      return;
    }
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
    if (this.cardOnTable) {
      if(this.cardOnTable.guid === card.guid) {
        this.cardOnTable = null;
      } else {
        this.pushPlayerHand(this.cardOnTable);
        this.cardOnTable = null;
      }
    }

    this.discardPile.push(card);
    
    console.log('Discarded:', card);
    this.discardedThisTurn = true;
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

  async endTurn(): Promise<void> {
    if(!this.drawnThisTurn || !this.discardedThisTurn) {
      console.log('Must draw and discard before ending turn.');
      return;
    }
    if(this.cardOnTable !== null) {
      console.log('Card is still on table. Deal with it before ending the turn.');
      return;
    }
    console.log('Ending turn for local game state');
    this.currentTurn = (this.currentTurn + 1) % this.totalPlayers;
    this.drawnThisTurn = false;
    this.discardedThisTurn = false;
    this.cardOnTable = null;

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer) {
      this.turnAdvance(currentPlayer);
    }

    await this.executeNextAITurn();
  }

  private async executeNextAITurn() {
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && !currentPlayer.isHuman) {
      await this.aiTurn();
    }
  }

  private async aiTurn(): Promise<void> {
    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.isHuman) return;

    console.log(`AI ${currentPlayer.name} taking turn`);

    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate thinking time

    // AI draws a card
    const drawnCard = this.drawCard();
    if (!drawnCard) return;
    this.opponentDraw(currentPlayer);

    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate thinking time

    // Place it randomly in hand
    const randomIndex = Math.floor(Math.random() * (currentPlayer.hand.length + 1));
    currentPlayer.hand.splice(randomIndex, 0, drawnCard);
    this.cardOnTable = null;

    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate thinking time

    // TODO: Attempt to form melds here

    // Pick a random card to discard
    const discardIndex = Math.floor(Math.random() * currentPlayer.hand.length);
    const cardToDiscard = currentPlayer.hand[discardIndex];
    this.discard(cardToDiscard);
    this.opponentDiscard(currentPlayer, cardToDiscard);

    console.log(`AI ${currentPlayer.name} discarded:`, cardToDiscard);
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate thinking time

    // End turn
    this.endTurn();
  }

  isPlayerTurn(player?: Player): boolean {
    if(!player) {
      const playerIndex = this.players.findIndex(p => p.isPlayer);
      return this.currentTurn === playerIndex;
    }
    const playerIndex = this.players.findIndex(p => p.id === player.id);
    return this.currentTurn === playerIndex;
  }

  getCurrentPlayer(): Player | undefined {
    return this.players[this.currentTurn];
  }
}