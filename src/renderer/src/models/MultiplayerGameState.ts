import { Socket } from 'socket.io-client'
import { GameState, MayIRequest, MayIResponse } from './GameState'
import { Card } from './Types';
import { IPlayer, Meld } from './Player';

export class MultiplayerGameState implements GameState {
  private socket: Socket;
  players: IPlayer[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;
  currentRound: number = 0;
  turnCount: number = 0;
  roundMelds: Meld[] = [];
  mayIRequests: MayIRequest[] = [];

  discardedThisTurn: boolean = false;
  cardOnTable: Card | null = null;
  drawnThisTurn: boolean = false;
  
  private onGameStartCallbacks: Array<() => void> = [];
  private onGameEndCallbacks: Array<() => void> = [];
  private onRoundStartCallbacks: Array<() => void> = [];
  private onRoundEndCallbacks: Array<() => void> = [];
  private onTurnAdvanceCallbacks: Array<(player: IPlayer) => void> = [];
  private onOpponentDrawCallbacks: Array<(player: IPlayer) => void> = [];
  private onOpponentDiscardCallbacks: Array<(player: IPlayer, card: Card) => void> = [];
  private onOpponentDrawFromDiscardCallbacks: Array<(player: IPlayer, card: Card) => void> = [];
  private onMayIRequestCallbacks: Array<(request: MayIRequest) => void> = [];
  private onMayIResponseCallbacks: Array<(request: MayIRequest, response: MayIResponse) => void> = [];
  private onMayIResolvedCallbacks: Array<(request: MayIRequest, accepted: boolean) => void> = [];
  private onMayINextVoterCallbacks: Array<(request: MayIRequest, nextVoter: IPlayer) => void> = [];
  private onMeldSubmittedCallbacks: Array<(melds: Meld[]) => void> = [];
  private onMeldAppendedCallbacks: Array<(meld: Meld, cards: Card[]) => void> = [];

  constructor(socket: Socket) {
    this.socket = socket;

    // Listen for full game state updates from server
    this.socket.on('gameState', (serverState: any) => {
      this.syncFromServer(serverState);
    })

    // Optional: request initial state
    this.socket.emit('requestGameState');
  }

  getRoundMelds(): Meld[] {
    throw new Error('Method not implemented.');
  }
  isPlayerDown(player: IPlayer): boolean {
    throw new Error('Method not implemented.');
  }
  
  startGame(): void {
    const current = this.getCurrentPlayer();
    if (current) {
      for (const cb of this.onTurnAdvanceCallbacks) {
        cb(current);
      }
    }
  }

  onGameStart(callback: () => void): void {
    this.onGameStartCallbacks.push(callback);
  }

  onGameEnd(callback: () => void): void {
    this.onGameEndCallbacks.push(callback);
  }

  onRoundStart(callback: () => void): void {
    this.onRoundStartCallbacks.push(callback);
  }

  onRoundEnd(callback: () => void): void {
    this.onRoundEndCallbacks.push(callback);
  }

  onTurnAdvance(callback: (player: IPlayer) => void): void {
    this.onTurnAdvanceCallbacks.push(callback);
  }

  onOpponentDraw(callback: (player: IPlayer) => void): void {
    this.onOpponentDrawCallbacks.push(callback);
  }

  onOpponentDiscard(callback: (player: IPlayer, card: Card) => void): void {
    this.onOpponentDiscardCallbacks.push(callback);
  }

  onOpponentDrawFromDiscard(callback: (player: IPlayer, card: Card) => void): void {
    this.onOpponentDrawFromDiscardCallbacks.push(callback);
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

  onMayINextVoter(callback: (request: MayIRequest, nextVoter: IPlayer) => void): void {
    this.onMayINextVoterCallbacks.push(callback);
  }

  onMeldSubmitted(callback: (melds: Meld[]) => void): void {
    this.onMeldSubmittedCallbacks.push(callback);
  }

  onMeldAppended(callback: (meld: Meld, cards: Card[]) => void): void {
    this.onMeldAppendedCallbacks.push(callback);
  }

  private gameStart() {
    for (const cb of this.onRoundStartCallbacks) {
      cb();
    }
  }

  private gameEnd() { 
    for (const cb of this.onRoundEndCallbacks) {
      cb();
    }
  }

  private roundStart() {
    for (const cb of this.onRoundStartCallbacks) {
      cb();
    }
  }

  private roundEnd() {
    for (const cb of this.onRoundEndCallbacks) {
      cb();
    }
  }

  private turnAdvance(player: IPlayer) {
    for (const cb of this.onTurnAdvanceCallbacks) {
      cb(player);
    }
  }


  private opponentDraw(player: IPlayer) {
    for (const cb of this.onOpponentDrawCallbacks) {
      cb(player);
    }
  }

  private opponentDrawFromDiscard(player: IPlayer, card: Card) {
    for (const cb of this.onOpponentDrawFromDiscardCallbacks) {
      cb(player, card);
    }
  }

  private opponentDiscard(player: IPlayer, card: Card) {
    for (const cb of this.onOpponentDiscardCallbacks) {
      cb(player, card);
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
      
      // IPlayer must also draw a penalty card from draw pile
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
  
  isPlayerTurn(player?: IPlayer): boolean {
    if(!player) {
      const playerIndex = this.players.findIndex(p => p.isPlayer);
      return this.currentTurn === playerIndex;
    }
    const playerIndex = this.players.findIndex(p => p.id === player.id);
    return this.currentTurn === playerIndex;
  }

  getCurrentPlayer(): IPlayer | undefined {
    return this.players[this.currentTurn];
  }

  getCurrentPlayerHand(): Card[] {
    const player = this.getCurrentPlayer();
    return player ? player.hand : [];
  }

  getOpponents(): IPlayer[] {
    return this.players.filter(p => !p.isPlayer);
  }
  
  private syncFromServer(serverState: any) {
    this.players = serverState.players;
    this.drawPile = serverState.drawPile;
    this.discardPile = serverState.discardPile;
    this.currentTurn = serverState.currentTurn;
    // Trigger scene update if needed
  }

  submitMelds(melds: Meld[]): boolean {
    throw new Error('Method not implemented.');
  }
  
  addToMeld(meld: Meld, cards: Card[]): boolean {
    throw new Error('Method not implemented.');
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
  
  async mayI(player: IPlayer, card: Card): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  
  respondToMayI(player: IPlayer, request: MayIRequest, allow: boolean): void {
    throw new Error('Method not implemented.');
  }

  cancelMayI(player: IPlayer, request: MayIRequest): void {
    throw new Error('Method not implemented.');
  }

  async waitForNoPendingMayI(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  discardCardOnTable(): void {
    // Notify server to discard the card on table
  }

  takeCardOnTable(index?: number): void {
    // Notify server that player takes the card on table
  }

  endTurn(): void {
    console.log('Ending turn for local game state');
  }
}