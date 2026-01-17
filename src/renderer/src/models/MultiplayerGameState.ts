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

  constructor(socket: Socket) {
    this.socket = socket;

    // Listen for full game state updates from server
    this.socket.on('gameState', (serverState: any) => {
      this.syncFromServer(serverState);
    })

    // Optional: request initial state
    this.socket.emit('requestGameState');
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

  // Add more methods: discardCard(card: Card), etc.
  

  endTurn(): void {
    console.log('Ending turn for local game state');
  }

  isPlayerTurn(): boolean {
    const playerIndex = this.players.findIndex(p => p.isPlayer);
    return this.currentTurn === playerIndex;
  }
}