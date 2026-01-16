import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

/* ------------------------------ */
// TODO: import gameLogic.ts properly
export interface Card { suit: string; rank: number }
export interface GameState {
  deck: Card[]
  players: { id: string; hand: Card[]; melds: Card[][] }[]
  discard: Card[]
  currentTurn: string
  round: number  // 1-7 configs
}

const roundConfigs = [
  { sets: 2, },
  { runs: 1, sets: 1 },
  { runs: 2, },
  { sets: 3, },
  { runs: 1, sets: 2 },
  { runs: 2, sets: 1 },
  { runs: 3, },
]

export function shuffleDeck(): Card[] {
  /* Fisher-Yates */
  const suits = ['hearts', 'diamonds', 'clubs', 'spades']
  const ranks = Array.from({ length: 13 }, (_, i) => i + 1)
  const deck: Card[] = []
  const deckCount = 3  // Number of decks to use
  for(var i = 0; i < deckCount; i++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        deck.push({ suit, rank })
      }
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function isValidMeld(meld: Card[], config: any): boolean {
  console.log(roundConfigs);
  console.log(config);
  console.log(meld);
  /* Sets/runs logic */
  
  return false;
}

export function initGame(roomId: string): GameState {
  console.log(`Initializing game for room ${roomId}`);
  /* Deal 10 cards */
  return {
    deck: shuffleDeck(),
    players: [],
    discard: [],
    currentTurn: '',
    round: 1
  };
}

/* ------------------------------ */

const app = express()
app.use(cors())
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

const games: Record<string, GameState> = {}

io.on('connection', (socket) => {
  socket.on('joinRoom', (roomId: string) => {
    socket.join(roomId)
    if (!games[roomId]) games[roomId] = initGame(roomId)
    socket.emit('gameState', games[roomId])
    io.to(roomId).emit('playerJoined')
  })

  socket.on('mayI', (roomId: string) => {
    const game = games[roomId]
    // Validate claim, draw extra, broadcast
    io.to(roomId).emit('gameState', game)
  })

  socket.on('playMeld', (roomId: string, meld: Card[]) => {
    console.log(`Received meld in room ${roomId}:`, meld);
    // Validate vs roundConfigs[game.round-1]
    // Update state, next turn
  })
})

httpServer.listen(3001, () => console.log('Server:3001'))