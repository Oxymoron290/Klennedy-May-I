import { Socket } from 'socket.io-client'
import { Card, Player, GameState } from './GameState'

export class MultiplayerGameState implements GameState {
  private socket: Socket;
  players: Player[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;
  
  cardOnTable: Card | null = null;
  drawnThisTurn: boolean = false;
  
  onOpponentDrawCallback: ((player: Player) => void) | null = null;
  onOpponentDiscardCallback: ((player: Player, card: Card) => void) | null = null
  onTurnAdvanceCallback: ((player: Player) => void) | null = null;

  constructor(socket: Socket) {
    this.socket = socket;

    // Listen for full game state updates from server
    this.socket.on('gameState', (serverState: any) => {
      this.syncFromServer(serverState);
    })

    // Optional: request initial state
    this.socket.emit('requestGameState');
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

  discardCardOnTable(): void {
    // Notify server to discard the card on table
  }

  playerTakesCardOnTable(index?: number): void {
    // Notify server that player takes the card on table
  }

  endTurn(): void {
    console.log('Ending turn for local game state');
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