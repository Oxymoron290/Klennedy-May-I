import { Card, Player, GameState, MayIRequest, MayIResponse } from './GameState'
import { v4 as uuidv4 } from 'uuid';

export const roundConfigs = [
  { sets: 2, },
  { runs: 1, sets: 1 },
  { runs: 2, },
  { sets: 3, },
  { runs: 1, sets: 2 },
  { runs: 2, sets: 1 },
  { runs: 3, },
];

const values = {
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

export class LocalGameState implements GameState {
  decks: number;
  totalPlayers: number;
  players: Player[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;
  currentRound: number = 0;
  roundConfigs = roundConfigs;

  mayIRequests: MayIRequest[] = [];

  cardOnTable: Card | null = null;
  drawnThisTurn: boolean = false;
  discardedThisTurn: boolean = false;
  
  private onOpponentDrawCallbacks: Array<(player: Player) => void> = [];
  private onOpponentDiscardCallbacks: Array<(player: Player, card: Card) => void> = [];
  private onOpponentDrawFromDiscardCallbacks: Array<(player: Player, card: Card) => void> = [];
  private onTurnAdvanceCallbacks: Array<(player: Player) => void> = [];
  private onMayIRequestCallbacks: Array<(request: MayIRequest) => void> = [];
  private onMayIResponseCallbacks: Array<(request: MayIRequest, response: MayIResponse) => void> = [];
  private onMayIResolvedCallbacks: Array<(request: MayIRequest, accepted: boolean) => void> = [];

  constructor(decks: number = 3, totalPlayers: number = 5) {
    this.decks = decks;
    this.totalPlayers = totalPlayers;
    this.initializePlayers();
    this.initializeDeck();
    this.dealCards();
  }

  startGame(): void {
    const current = this.getCurrentPlayer();
    if (current) {
      for (const cb of this.onTurnAdvanceCallbacks) {
        cb(current);
      }
    }
  }

  onOpponentDraw(callback: (player: Player) => void): void {
    this.onOpponentDrawCallbacks.push(callback);
  }

  onOpponentDiscard(callback: (player: Player, card: Card) => void): void {
    this.onOpponentDiscardCallbacks.push(callback);
  }

  onOpponentDrawFromDiscard(callback: (player: Player, card: Card) => void): void {
    this.onOpponentDrawFromDiscardCallbacks.push(callback);
  }

  onTurnAdvance(callback: (player: Player) => void): void {
    this.onTurnAdvanceCallbacks.push(callback);
  }

  onMayIRequest(callback: (request: MayIRequest) => void): void {
    this.onMayIRequestCallbacks.push(callback);
  }

  onMayIResponse(callback: (request: MayIRequest, response: MayIResponse) => void): void {
    this.onMayIResponseCallbacks.push(callback);
  }

  onMayIResolved(callback: (request: MayIRequest, accepted: boolean) => void): void {
    this.onMayIResolvedCallbacks.push(callback);
  }

  private opponentDraw(player: Player) {
    for (const cb of this.onOpponentDrawCallbacks) {
      cb(player);
    }
  }

  private opponentDrawFromDiscard(player: Player, card: Card) {
    for (const cb of this.onOpponentDrawFromDiscardCallbacks) {
      cb(player, card);
    }
  }

  private opponentDiscard(player: Player, card: Card) {
    for (const cb of this.onOpponentDiscardCallbacks) {
      cb(player, card);
    }
  }

  private turnAdvance(player: Player) {
    for (const cb of this.onTurnAdvanceCallbacks) {
      cb(player);
    }
  }

  private mayIRequest(request: MayIRequest) {
    for (const cb of this.onMayIRequestCallbacks) {
      cb(request);
    }
  }

  private waitForMayIResolution(request: MayIRequest): Promise<boolean> {
    request.promise = new Promise<boolean>(resolve => {
      request.resolve = resolve;
    });

    return request.promise;
  }

  private mayIResponse(request: MayIRequest, response: MayIResponse) {
    for (const cb of this.onMayIResponseCallbacks) {
      cb(request, response);
    }
  }

  private mayIResolved(request: MayIRequest) {
    request.resolved = true;
    const accepted = request.responses.every(r => r.accepted);
    console.log(`May I request ${accepted ? 'accepted' : 'denied'} for card:`, request.card);
    
    if (accepted) {
      // Remove card from discard pile
      const cardIndex = this.discardPile.findIndex(c => c.guid === request.card.guid);
      if (cardIndex !== -1) {
        this.discardPile.splice(cardIndex, 1);
      }
      
      // Add card to requesting player's hand
      request.player.hand.push(request.card);

      // TODO: Klennedy rule.
      if (this.drawPile.length > 0) {
        const penaltyCard = this.drawPile.pop()!;
        request.player.hand.push(penaltyCard);
        request.peanaltyCard = penaltyCard;
        console.log(`${request.player.name} also drew penalty card:`, penaltyCard);
      }
    }

    if (request.resolve) {
      request.resolve(accepted);
    }

    // Remove the request from active requests
    const requestIndex = this.mayIRequests.indexOf(request);
    if (requestIndex !== -1) {
      this.mayIRequests.splice(requestIndex, 1);
    }

    for (const cb of this.onMayIResolvedCallbacks) {
      cb(request, accepted);
    }
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

  getCurrentPlayerHand(): Card[] {
    const player = this.getCurrentPlayer();
    return player ? player.hand : [];
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
    if(!this.isPlayerTurn()) {
      this.opponentDraw(this.getCurrentPlayer()!);
    }
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
    if(!this.isPlayerTurn()) {
      this.opponentDrawFromDiscard(this.getCurrentPlayer()!, card);
    }
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
        this.getCurrentPlayerHand().push(this.cardOnTable);
        this.cardOnTable = null;
      }
    }

    this.discardPile.push(card);
    
    console.log('Discarded:', card);
    this.discardedThisTurn = true;

    if(!this.isPlayerTurn()) {
      this.opponentDiscard(this.getCurrentPlayer()!, card);
    }
  }

  async mayI(player: Player, card: Card): Promise<boolean> {
    if (card.guid !== this.discardPile[this.discardPile.length - 1].guid) {
      console.log("Can only May I the top card of the discard pile.");
      return false;
    }

    const request: MayIRequest = {
      id: uuidv4(),
      player,
      card,
      responses: [],
      resolved: false,
      peanaltyCard: null
    };

    this.mayIRequests.push(request);
    this.mayIRequest(request);

    return await this.waitForMayIResolution(request);
  }

  respondToMayI(player: Player, request: MayIRequest, allow: boolean): void {
    const req = this.mayIRequests.find(r => r === request);

    if (!req) {
      console.log('May I request not found.');
      return;
    }

    if(req.player.id === this.getCurrentPlayer()!.id) {
      console.log('Player cannot respond to their own May I request.');
      return;
    }

    // Prevent duplicate responses
    if (req.responses.some(r => r.player.id === player.id)) {
      console.log('Player has already responded to this May I.');
      return;
    }

    const response: MayIResponse = {
      player,
      accepted: allow
    };

    req.responses.push(response);
    this.mayIResponse(req, response);

    const eligibleVoters = this.players.filter(p => p.id !== req.player.id);
    if (req.responses.length === eligibleVoters.length) {
      this.mayIResolved(req);
    }
  }

  async waitForNoPendingMayI(): Promise<void> {
    const pending = this.mayIRequests.filter(r => !r.resolved);

    if (pending.length === 0) return;

    await Promise.all(pending.map(r => r.promise));
  }

  discardCardOnTable(): void {
    this.discard(this.cardOnTable!);
  }

  playerTakesCardOnTable(index?: number): void {
    if (this.cardOnTable) {
      if (index !== undefined) {
        this.getCurrentPlayerHand().splice(index, 0, this.cardOnTable);
      } else {
        this.getCurrentPlayerHand().push(this.cardOnTable);
      }
      this.cardOnTable = null;
    }
  }

  async endTurn(): Promise<void> {
    if (!this.drawnThisTurn || !this.discardedThisTurn) {
      console.log("Must draw and discard before ending turn.");
      return;
    }

    this.currentTurn = (this.currentTurn + 1) % this.totalPlayers;
    this.drawnThisTurn = false;
    this.discardedThisTurn = false;
    this.cardOnTable = null;

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer) {
      this.turnAdvance(currentPlayer);
    }
  }
}