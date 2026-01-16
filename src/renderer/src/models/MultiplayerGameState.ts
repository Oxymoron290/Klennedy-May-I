import { Socket } from 'socket.io-client'
import { Card, Player, GameState } from './GameState'

export class MultiplayerGameState implements GameState {
  private socket: Socket
  players: Player[] = []
  drawPile: Card[] = []
  discardPile: Card[] = []
  currentTurn: string = ''

  constructor(socket: Socket) {
    this.socket = socket

    // Listen for full game state updates from server
    this.socket.on('gameState', (serverState: any) => {
      this.syncFromServer(serverState)
    })

    // Optional: request initial state
    this.socket.emit('requestGameState')
  }

  private syncFromServer(serverState: any) {
    this.players = serverState.players
    this.drawPile = serverState.drawPile
    this.discardPile = serverState.discardPile
    this.currentTurn = serverState.currentTurn
    // Trigger scene update if needed
  }

  drawCard(playerId: string): Card | null {
    // In multiplayer, we request from server
    this.socket.emit('drawCard', playerId)
    return null // Actual card comes via gameState event
  }

  // Add more methods: discardCard(card: Card), etc.
}