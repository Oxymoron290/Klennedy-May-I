import { Socket } from 'socket.io-client'
import { Card, Player, GameState, MayIRequest, MayIResponse } from './GameState'
import { request } from 'express';

export class MultiplayerGameState implements GameState {
  private socket: Socket;
  players: Player[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;
  
  cardOnTable: Card | null = null;
  drawnThisTurn: boolean = false;
  
  private onOpponentDrawCallbacks: Array<(player: Player) => void> = [];
  private onOpponentDiscardCallbacks: Array<(player: Player, card: Card) => void> = [];
  private onOpponentDrawFromDiscardCallbacks: Array<(player: Player, card: Card) => void> = [];
  private onTurnAdvanceCallbacks: Array<(player: Player) => void> = [];
  private onMayIRequestCallbacks: Array<(request: MayIRequest) => void> = [];
  private onMayIResponseCallbacks: Array<(request: MayIRequest, response: MayIResponse) => void> = [];
  private onMayIResolvedCallbacks: Array<(request: MayIRequest, accepted: boolean) => void> = [];

  constructor(socket: Socket) {
    this.socket = socket;

    // Listen for full game state updates from server
    this.socket.on('gameState', (serverState: any) => {
      this.syncFromServer(serverState);
    })

    // Optional: request initial state
    this.socket.emit('requestGameState');
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

  private mayIResponse(request: MayIRequest, response: MayIResponse) {
    for (const cb of this.onMayIResponseCallbacks) {
      cb(request, response);
    }
  }

  private mayIResolved(request: MayIRequest) {
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
      
      // Player must also draw a penalty card from draw pile
      // TODO: Klennedy rule.
      if (this.drawPile.length > 0) {
        const penaltyCard = this.drawPile.pop()!;
        request.player.hand.push(penaltyCard);
        console.log(`${request.player.name} also drew penalty card:`, penaltyCard);
      }
    }

    if (request.resolve) {
      request.resolve(accepted);
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
  
  private syncFromServer(serverState: any) {
    this.players = serverState.players;
    this.drawPile = serverState.drawPile;
    this.discardPile = serverState.discardPile;
    this.currentTurn = serverState.currentTurn;
    // Trigger scene update if needed
  }

  drawCard(): Card | null {
    // In multiplayer, we request from server
    this.socket.emit('drawCard');
    return null; // Actual card comes via gameState event
  }

  drawDiscard(): Card | null {
    this.socket.emit('drawDiscard');
    return null;
  }

  discard(card: Card): void {
    this.socket.emit('discardCard', card);
  }
  
  async mayI(player: Player, card: Card): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  
  respondToMayI(player: Player, request: MayIRequest, allow: boolean): void {
    throw new Error('Method not implemented.');
  }

  async waitForNoPendingMayI(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  discardCardOnTable(): void {
    // Notify server to discard the card on table
  }

  playerTakesCardOnTable(index?: number): void {
    // Notify server that player takes the card on table
  }

  endTurn(): void {
    console.log('Ending turn for local game state');
  }
}