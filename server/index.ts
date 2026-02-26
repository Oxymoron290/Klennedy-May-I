import express from 'express'
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import cors from 'cors'
import { v4 as uuidv4 } from 'uuid'

import {
  Card,
  Rank,
  Meld,
  MeldCard,
  PlayerInfo,
  ServerGameState,
  JoinRoomPayload,
  SubmitMeldsPayload,
  AddToMeldPayload,
  DiscardPayload,
  MayIRequestPayload,
  MayIResponsePayload,
  MayIResolvedPayload,
  ClientToServerEvents,
  ServerToClientEvents,
  roundConfigs,
  values,
  InitialRunCount,
  InitialSetCount,
} from '../shared/types.ts'

// ─── Helpers ────────────────────────────────────────────────────────────────

function shuffleDeck(cards: Card[]): Card[] {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function buildDeck(deckCount: number): Card[] {
  const suits: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const deck: Card[] = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank: rank as Rank, guid: uuidv4() });
      }
    }
  }
  return shuffleDeck(deck);
}

function scoreHand(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + values[c.rank], 0);
}

// ─── Meld validation (mirrors client Player.ts logic) ───────────────────────

function isStrictlyConsecutive(ranks: number[]): boolean {
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}

function isConsecutiveWithAceWrap(sortedRanks: number[]): boolean {
  if (isStrictlyConsecutive(sortedRanks)) return true;
  if (sortedRanks[0] === 1) {
    const withHighAce = [...sortedRanks.slice(1), 14].sort((a, b) => a - b);
    if (isStrictlyConsecutive(withHighAce)) return true;
    for (let splitIdx = 1; splitIdx < sortedRanks.length; splitIdx++) {
      if (sortedRanks[splitIdx] === 1) continue;
      const wrapped = [
        ...sortedRanks.slice(splitIdx),
        ...sortedRanks.slice(0, splitIdx).map(r => r + 13),
      ].sort((a, b) => a - b);
      if (isStrictlyConsecutive(wrapped)) return true;
    }
  }
  return false;
}

interface MeldValidationCards { suit: Card['suit']; rank: Rank }[]

function validateMeldCards(type: 'set' | 'run', cards: { suit: Card['suit']; rank: Rank }[], initial: boolean): boolean {
  if (cards.length === 0) return false;

  if (type === 'set') {
    const rank = cards[0].rank;
    if (!cards.every(c => c.rank === rank)) return false;
    if (initial && cards.length !== InitialSetCount) return false;
    return true;
  }

  if (type === 'run') {
    if (cards.length > 13) return false;
    const suit = cards[0].suit;
    if (!cards.every(c => c.suit === suit)) return false;
    if (initial) {
      if (cards.length !== InitialRunCount) return false;
    }
    const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
    if (new Set(ranks).size !== ranks.length) return false;
    return isConsecutiveWithAceWrap(ranks);
  }

  return false;
}

// ─── Server-side player state ───────────────────────────────────────────────

interface ServerPlayer {
  id: string;
  name: string;
  socketId: string;
  hand: Card[];
  isDown: boolean;
  scores: number[];
}

// ─── May I request tracking ─────────────────────────────────────────────────

interface ServerMayIRequest {
  id: string;
  playerId: string;
  card: Card;
  voters: string[];        // player IDs in voting order
  nextVoterIndex: number;
  responses: Map<string, boolean>;
  resolved: boolean;
  winnerId: string | null;
  deniedById: string | null;
}

// ─── ServerGame class ───────────────────────────────────────────────────────

class ServerGame {
  roomId: string;
  players: ServerPlayer[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;
  currentRound: number = 0;
  turnCount: number = 0;
  roundMelds: Meld[] = [];
  drawnThisTurn: boolean = false;
  discardedThisTurn: boolean = false;
  cardOnTable: Map<string, Card | null> = new Map(); // per-player drawn card
  stockDepletionCount: number = 0;
  mayIPickedThisCycle: Set<string> = new Set();
  expectedHandSizes: Map<string, number> = new Map();
  pendingMayI: ServerMayIRequest | null = null;
  started: boolean = false;
  finished: boolean = false;

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  get deckCount(): number {
    return 2 + Math.ceil(this.players.length / 2);
  }

  getPlayerById(id: string): ServerPlayer | undefined {
    return this.players.find(p => p.id === id);
  }

  getCurrentPlayer(): ServerPlayer | undefined {
    return this.players[this.currentTurn];
  }

  isPlayerDown(playerId: string): boolean {
    return this.roundMelds.some(m => m.ownerId === playerId);
  }

  isFinalRound(): boolean {
    return this.currentRound === roundConfigs.length - 1;
  }

  // ── Deck / dealing ──────────────────────────────────────────────────────

  initializeDeck(): void {
    this.drawPile = buildDeck(this.deckCount);
  }

  dealCards(): void {
    for (const player of this.players) {
      player.hand = this.drawPile.splice(0, 11);
      player.isDown = false;
    }
    this.discardPile = [this.drawPile.pop()!];
  }

  // ── Round management ────────────────────────────────────────────────────

  startGame(): void {
    this.started = true;
    this.currentRound = 0;
    this.players.forEach(p => { p.scores = []; });
    this.startRound();
  }

  startRound(): void {
    this.drawPile = [];
    this.discardPile = [];
    this.currentTurn = this.currentRound % this.players.length;
    this.turnCount = 0;
    this.drawnThisTurn = false;
    this.discardedThisTurn = false;
    this.cardOnTable.clear();
    this.roundMelds = [];
    this.stockDepletionCount = 0;
    this.mayIPickedThisCycle.clear();
    this.pendingMayI = null;
    this.expectedHandSizes.clear();
    this.players.forEach(p => {
      this.expectedHandSizes.set(p.id, 11);
      p.isDown = false;
    });
    this.initializeDeck();
    this.dealCards();
  }

  endRound(): Record<string, number> {
    const scores: Record<string, number> = {};
    this.players.forEach(player => {
      let score = scoreHand(player.hand);
      const expected = this.expectedHandSizes.get(player.id) ?? 11;
      if (player.hand.length > 0 && player.hand.length < expected) {
        score += (expected - player.hand.length) * 10;
      }
      player.scores.push(score);
      scores[player.id] = score;
      player.hand = [];
    });
    return scores;
  }

  checkForWin(): boolean {
    const current = this.getCurrentPlayer();
    return current !== undefined && current.hand.length === 0;
  }

  // ── Stock pile depletion ────────────────────────────────────────────────

  private refillDrawPile(): boolean {
    if (this.discardPile.length === 0) return false;
    this.stockDepletionCount++;
    if (this.stockDepletionCount >= 2) return false;
    // Flip discard WITHOUT shuffling
    this.drawPile = this.discardPile.reverse();
    this.discardPile = [];
    return true;
  }

  // ── Draw ────────────────────────────────────────────────────────────────

  drawCard(playerId: string): { error?: string; card?: Card; roundEnded?: boolean } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    if (this.drawnThisTurn) return { error: 'Already drawn this turn' };
    if (this.pendingMayI) return { error: 'May I request pending' };

    const expected = this.expectedHandSizes.get(playerId) ?? 11;
    if (current.hand.length > expected) {
      // Too many cards — must discard without drawing
      this.drawnThisTurn = true;
      return { card: undefined };
    }

    if (this.drawPile.length === 0) {
      if (!this.refillDrawPile()) {
        return { roundEnded: true };
      }
    }

    const card = this.drawPile.pop()!;
    this.cardOnTable.set(playerId, card);
    this.drawnThisTurn = true;

    // Too few cards: draw without discarding until hand is restored
    if (current.hand.length < expected) {
      current.hand.push(card);
      this.cardOnTable.set(playerId, null);
      this.discardedThisTurn = true;
    }

    return { card };
  }

  drawDiscard(playerId: string): { error?: string; card?: Card } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    if (this.drawnThisTurn) return { error: 'Already drawn this turn' };
    if (this.discardPile.length === 0) return { error: 'Discard pile is empty' };

    // Drawing from discard rejects pending May I
    if (this.pendingMayI && !this.pendingMayI.resolved) {
      this.pendingMayI.resolved = true;
      this.pendingMayI = null;
    }

    const card = this.discardPile.pop()!;
    this.cardOnTable.set(playerId, card);
    this.drawnThisTurn = true;
    return { card };
  }

  // ── Take / discard card on table ────────────────────────────────────────

  takeCardOnTable(playerId: string, index?: number): { error?: string } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    const card = this.cardOnTable.get(playerId);
    if (!card) return { error: 'No card on table' };

    if (index !== undefined) {
      current.hand.splice(index, 0, card);
    } else {
      current.hand.push(card);
    }
    this.cardOnTable.set(playerId, null);
    return {};
  }

  discardCardOnTable(playerId: string): { error?: string; roundEnded?: boolean } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    const card = this.cardOnTable.get(playerId);
    if (!card) return { error: 'No card on table' };
    return this.discardCard(playerId, card.guid);
  }

  // ── Discard ─────────────────────────────────────────────────────────────

  discardCard(playerId: string, cardGuid: string): { error?: string; roundEnded?: boolean } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    if (!this.drawnThisTurn) return { error: 'Must draw before discarding' };
    if (this.discardedThisTurn) return { error: 'Already discarded this turn' };
    if (this.pendingMayI) return { error: 'May I request pending' };

    // Find card in hand or on table
    let card: Card | undefined;
    const tableCard = this.cardOnTable.get(playerId);

    if (tableCard && tableCard.guid === cardGuid) {
      card = tableCard;
      this.cardOnTable.set(playerId, null);
    } else {
      const idx = current.hand.findIndex(c => c.guid === cardGuid);
      if (idx === -1) return { error: 'Card not in hand' };
      card = current.hand.splice(idx, 1)[0];
      // If there's still a card on table, put it in hand
      if (tableCard) {
        current.hand.push(tableCard);
        this.cardOnTable.set(playerId, null);
      }
    }

    this.discardPile.push(card);
    this.discardedThisTurn = true;

    return {};
  }

  // ── Melds ───────────────────────────────────────────────────────────────

  submitMelds(playerId: string, meldSpecs: SubmitMeldsPayload['melds']): { error?: string; melds?: Meld[] } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    if (!this.drawnThisTurn || this.discardedThisTurn) return { error: 'Cannot submit melds at this time' };
    if (this.mayIPickedThisCycle.has(playerId)) return { error: 'Cannot play cards this turn — picked out of turn via May I' };
    if (this.isPlayerDown(playerId)) return { error: 'Already gone down this round' };

    // Check hand count correctness
    const expected = this.expectedHandSizes.get(playerId) ?? 11;
    const tableCard = this.cardOnTable.get(playerId);
    const totalCards = current.hand.length + (tableCard ? 1 : 0);
    if (totalCards !== expected && totalCards !== expected + 1) {
      return { error: 'Cannot lay down cards — hand count is incorrect' };
    }

    // Validate round config match
    const config = roundConfigs[this.currentRound];
    const requiredRuns = config.runs ?? 0;
    const requiredSets = config.sets ?? 0;
    const runs = meldSpecs.filter(m => m.type === 'run').length;
    const sets = meldSpecs.filter(m => m.type === 'set').length;
    if (runs !== requiredRuns) return { error: `Expected ${requiredRuns} runs, got ${runs}` };
    if (sets !== requiredSets) return { error: `Expected ${requiredSets} sets, got ${sets}` };

    // Build cards for each meld, validate no reuse
    const usedGuids = new Set<string>();
    const newMelds: Meld[] = [];

    // Collect all available cards (hand + table card)
    const availableCards = new Map<string, Card>();
    for (const c of current.hand) availableCards.set(c.guid, c);
    if (tableCard) availableCards.set(tableCard.guid, tableCard);

    for (const spec of meldSpecs) {
      const meldCards: MeldCard[] = [];
      for (const guid of spec.cardGuids) {
        if (usedGuids.has(guid)) return { error: 'Card used in multiple melds' };
        usedGuids.add(guid);
        const card = availableCards.get(guid);
        if (!card) return { error: 'Card not in hand' };
        meldCards.push({ playerId, card });
      }

      if (!validateMeldCards(spec.type, meldCards.map(mc => mc.card), true)) {
        return { error: `Invalid ${spec.type} meld` };
      }

      newMelds.push({
        id: uuidv4(),
        type: spec.type,
        cards: meldCards,
        ownerId: playerId,
      });
    }

    // No two runs of the same suit
    const runSuits = newMelds.filter(m => m.type === 'run').map(m => m.cards[0].card.suit);
    if (new Set(runSuits).size !== runSuits.length) {
      return { error: 'Cannot have two runs of the same suit' };
    }

    // Remove cards from hand/table
    for (const guid of usedGuids) {
      if (tableCard && tableCard.guid === guid) {
        this.cardOnTable.set(playerId, null);
      } else {
        const idx = current.hand.findIndex(c => c.guid === guid);
        if (idx !== -1) current.hand.splice(idx, 1);
      }
    }

    this.roundMelds.push(...newMelds);
    current.isDown = true;

    return { melds: newMelds };
  }

  addToMeld(playerId: string, meldId: string, cardGuids: string[]): { error?: string; cards?: Card[] } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };
    if (!this.drawnThisTurn || this.discardedThisTurn) return { error: 'Cannot add to melds at this time' };
    if (this.mayIPickedThisCycle.has(playerId)) return { error: 'Cannot play cards this turn — picked out of turn via May I' };
    if (!this.isPlayerDown(playerId)) return { error: 'Must go down before adding to melds' };

    const meld = this.roundMelds.find(m => m.id === meldId);
    if (!meld) return { error: 'Meld not found' };

    const tableCard = this.cardOnTable.get(playerId);
    const availableCards = new Map<string, Card>();
    for (const c of current.hand) availableCards.set(c.guid, c);
    if (tableCard) availableCards.set(tableCard.guid, tableCard);

    const newCards: Card[] = [];
    for (const guid of cardGuids) {
      const card = availableCards.get(guid);
      if (!card) return { error: 'Card not in hand' };
      newCards.push(card);
    }

    // Validate the resulting meld
    const combinedCards = [
      ...meld.cards.map(mc => mc.card),
      ...newCards,
    ];
    if (!validateMeldCards(meld.type, combinedCards, false)) {
      return { error: 'Resulting meld would be invalid' };
    }

    // Remove cards from hand/table
    for (const guid of cardGuids) {
      if (tableCard && tableCard.guid === guid) {
        this.cardOnTable.set(playerId, null);
      } else {
        const idx = current.hand.findIndex(c => c.guid === guid);
        if (idx !== -1) current.hand.splice(idx, 1);
      }
    }

    // Add to meld
    for (const card of newCards) {
      meld.cards.push({ playerId, card });
    }

    return { cards: newCards };
  }

  // ── May I ───────────────────────────────────────────────────────────────

  getMayIVotersInOrder(requesterId: string): string[] {
    const requesterIdx = this.players.findIndex(p => p.id === requesterId);
    if (requesterIdx === -1) return [];

    const voters: string[] = [];
    // Voters are players from current turn player up to (but not including) requester
    // who haven't gone down yet
    if (requesterIdx === this.currentTurn) {
      // Everyone else votes
      for (let i = 0; i < this.players.length; i++) {
        if (i !== requesterIdx && !this.isPlayerDown(this.players[i].id)) {
          voters.push(this.players[i].id);
        }
      }
    } else {
      let i = this.currentTurn;
      while (i !== requesterIdx) {
        if (!this.isPlayerDown(this.players[i].id)) {
          voters.push(this.players[i].id);
        }
        i = (i + 1) % this.players.length;
      }
    }
    return voters;
  }

  requestMayI(playerId: string): { error?: string; request?: ServerMayIRequest } {
    if (this.pendingMayI) return { error: 'A May I request is already pending' };
    if (this.discardPile.length === 0) return { error: 'Discard pile is empty' };

    const current = this.getCurrentPlayer();
    if (current && current.id === playerId) return { error: 'Cannot May I on your own turn' };
    if (this.isPlayerDown(playerId)) return { error: 'Already gone down — cannot May I' };

    const card = this.discardPile[this.discardPile.length - 1];
    const voters = this.getMayIVotersInOrder(playerId);

    const request: ServerMayIRequest = {
      id: uuidv4(),
      playerId,
      card,
      voters,
      nextVoterIndex: 0,
      responses: new Map(),
      resolved: false,
      winnerId: null,
      deniedById: null,
    };

    this.pendingMayI = request;

    // If no voters, auto-accept
    if (voters.length === 0) {
      this.resolveMayI(request, true);
    }

    return { request };
  }

  respondToMayI(voterId: string, requestId: string, accepted: boolean): { error?: string } {
    const req = this.pendingMayI;
    if (!req || req.id !== requestId) return { error: 'No matching May I request' };
    if (req.resolved) return { error: 'Already resolved' };

    const expectedVoterId = req.voters[req.nextVoterIndex];
    if (expectedVoterId !== voterId) return { error: `Not your turn to vote (expected ${expectedVoterId})` };
    if (req.responses.has(voterId)) return { error: 'Already voted' };

    req.responses.set(voterId, accepted);

    if (!accepted) {
      // Denier takes the card + penalty instead
      req.deniedById = voterId;
      req.winnerId = voterId;
      this.resolveMayI(req, false);
      return {};
    }

    req.nextVoterIndex++;
    if (req.nextVoterIndex >= req.voters.length) {
      // All accepted — requester wins
      req.winnerId = req.playerId;
      this.resolveMayI(req, true);
    }

    return {};
  }

  private resolveMayI(req: ServerMayIRequest, requesterWon: boolean): void {
    req.resolved = true;

    // Remove the card from discard pile
    const idx = this.discardPile.findIndex(c => c.guid === req.card.guid);
    if (idx !== -1) this.discardPile.splice(idx, 1);

    const winner = this.getPlayerById(req.winnerId!);
    if (winner) {
      winner.hand.push(req.card);

      // Penalty card from draw pile
      if (this.drawPile.length > 0) {
        const penalty = this.drawPile.pop()!;
        winner.hand.push(penalty);
      }

      // Update expected hand size +2
      this.expectedHandSizes.set(
        winner.id,
        (this.expectedHandSizes.get(winner.id) ?? 11) + 2
      );

      // Winner picked out of turn — cannot play cards until their next regular turn
      this.mayIPickedThisCycle.add(winner.id);
    }

    this.pendingMayI = null;
  }

  cancelMayI(playerId: string, requestId: string): { error?: string } {
    const req = this.pendingMayI;
    if (!req || req.id !== requestId) return { error: 'No matching May I request' };
    if (req.playerId !== playerId) return { error: 'Only requester can cancel' };
    if (req.resolved) return { error: 'Already resolved' };

    req.resolved = true;
    req.winnerId = null;
    this.pendingMayI = null;
    return {};
  }

  // ── End turn ────────────────────────────────────────────────────────────

  endTurn(playerId: string): { error?: string; roundEnded?: boolean; nextPlayerId?: string } {
    const current = this.getCurrentPlayer();
    if (!current || current.id !== playerId) return { error: 'Not your turn' };

    if (this.checkForWin()) {
      return { roundEnded: true };
    }

    const finalRoundNoDiscard = this.isFinalRound() && current.hand.length === 0;
    if (!this.drawnThisTurn || (!this.discardedThisTurn && !finalRoundNoDiscard)) {
      return { error: 'Must draw and discard before ending turn' };
    }

    this.currentTurn = (this.currentTurn + 1) % this.players.length;
    this.turnCount++;
    this.drawnThisTurn = false;
    this.discardedThisTurn = false;
    this.cardOnTable.clear();

    // Clear May I pick restriction for the new current player
    const next = this.getCurrentPlayer();
    if (next) {
      this.mayIPickedThisCycle.delete(next.id);
    }

    return { nextPlayerId: next?.id };
  }

  // ── Public state ────────────────────────────────────────────────────────

  getPublicState(): ServerGameState {
    return {
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        isDown: p.isDown,
        scores: [...p.scores],
      })),
      drawPileCount: this.drawPile.length,
      discardPile: [...this.discardPile],
      currentTurn: this.currentTurn,
      currentRound: this.currentRound,
      turnCount: this.turnCount,
      roundMelds: this.roundMelds,
      drawnThisTurn: this.drawnThisTurn,
      discardedThisTurn: this.discardedThisTurn,
      cardOnTable: null, // per-player, sent via cardOnTable event
    };
  }
}

// ─── Room management ────────────────────────────────────────────────────────

interface Room {
  id: string;
  hostId: string;
  playerSockets: Map<string, string>; // playerId → socketId
  socketPlayers: Map<string, string>; // socketId → playerId
  game: ServerGame;
}

const rooms = new Map<string, Room>();

function getPlayerInfo(game: ServerGame): PlayerInfo[] {
  return game.players.map(p => ({
    id: p.id,
    name: p.name,
    handCount: p.hand.length,
    isDown: p.isDown,
    scores: [...p.scores],
  }));
}

// ─── Express + Socket.IO setup ──────────────────────────────────────────────

const app = express()
app.use(cors())
const httpServer = createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
})

function broadcastState(room: Room): void {
  const state = room.game.getPublicState();
  io.to(room.id).emit('gameState', state);

  // Send each player their private hand + card on table
  for (const player of room.game.players) {
    const socketId = room.playerSockets.get(player.id);
    if (socketId) {
      io.to(socketId).emit('yourHand', player.hand);
      io.to(socketId).emit('cardOnTable', room.game.cardOnTable.get(player.id) ?? null);
    }
  }
}

function broadcastRoomInfo(room: Room): void {
  io.to(room.id).emit('roomInfo', {
    roomId: room.id,
    players: getPlayerInfo(room.game),
    hostId: room.hostId,
  });
}

function emitError(socket: Socket<ClientToServerEvents, ServerToClientEvents>, msg: string): void {
  socket.emit('error', msg);
}

function getRoom(socket: Socket<ClientToServerEvents, ServerToClientEvents>): { room: Room; playerId: string } | null {
  for (const [, room] of rooms) {
    const playerId = room.socketPlayers.get(socket.id);
    if (playerId) return { room, playerId };
  }
  return null;
}

// ─── Socket event handlers ──────────────────────────────────────────────────

io.on('connection', (socket) => {

  // ── joinRoom ──────────────────────────────────────────────────────────
  socket.on('joinRoom', (payload: JoinRoomPayload) => {
    const { roomId, playerName } = payload;

    let room = rooms.get(roomId);
    if (!room) {
      const game = new ServerGame(roomId);
      room = {
        id: roomId,
        hostId: '', // set when first player joins
        playerSockets: new Map(),
        socketPlayers: new Map(),
        game,
      };
      rooms.set(roomId, room);
    }

    if (room.game.started) {
      // Allow reconnection by matching name
      const existing = room.game.players.find(p => p.name === playerName);
      if (existing) {
        // Update socket mappings
        room.playerSockets.set(existing.id, socket.id);
        room.socketPlayers.set(socket.id, existing.id);
        existing.socketId = socket.id;
        socket.join(roomId);
        broadcastState(room);
        broadcastRoomInfo(room);
        return;
      }
      return emitError(socket, 'Game already started');
    }

    if (room.game.players.length >= 8) {
      return emitError(socket, 'Room is full (max 8 players)');
    }

    const playerId = uuidv4();
    const player: ServerPlayer = {
      id: playerId,
      name: playerName,
      socketId: socket.id,
      hand: [],
      isDown: false,
      scores: [],
    };

    room.game.players.push(player);
    room.playerSockets.set(playerId, socket.id);
    room.socketPlayers.set(socket.id, playerId);

    if (room.hostId === '') {
      room.hostId = playerId;
    }

    socket.join(roomId);
    broadcastRoomInfo(room);

    const info: PlayerInfo = {
      id: playerId,
      name: playerName,
      handCount: 0,
      isDown: false,
      scores: [],
    };
    socket.to(roomId).emit('playerJoined', info);
  });

  // ── startGame ─────────────────────────────────────────────────────────
  socket.on('startGame', () => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    if (playerId !== room.hostId) return emitError(socket, 'Only host can start');
    if (room.game.players.length < 4) return emitError(socket, 'Need at least 4 players');
    if (room.game.started) return emitError(socket, 'Game already started');

    room.game.startGame();
    io.to(room.id).emit('gameStarted');
    io.to(room.id).emit('roundStarted', 0);
    broadcastState(room);
  });

  // ── drawCard ──────────────────────────────────────────────────────────
  socket.on('drawCard', () => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.drawCard(playerId);
    if (result.error) return emitError(socket, result.error);

    if (result.roundEnded) {
      const scores = room.game.endRound();
      io.to(room.id).emit('roundEnded', scores);
      if (room.game.currentRound >= roundConfigs.length - 1) {
        room.game.finished = true;
        const finalScores: Record<string, number[]> = {};
        room.game.players.forEach(p => { finalScores[p.id] = [...p.scores]; });
        io.to(room.id).emit('gameEnded', finalScores);
      } else {
        room.game.currentRound++;
        room.game.startRound();
        io.to(room.id).emit('roundStarted', room.game.currentRound);
      }
    }

    broadcastState(room);
  });

  // ── drawDiscard ───────────────────────────────────────────────────────
  socket.on('drawDiscard', () => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.drawDiscard(playerId);
    if (result.error) return emitError(socket, result.error);
    broadcastState(room);
  });

  // ── discard ───────────────────────────────────────────────────────────
  socket.on('discard', (payload: DiscardPayload) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.discardCard(playerId, payload.cardGuid);
    if (result.error) return emitError(socket, result.error);
    broadcastState(room);
  });

  // ── takeCardOnTable ───────────────────────────────────────────────────
  socket.on('takeCardOnTable', (index?: number) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.takeCardOnTable(playerId, index);
    if (result.error) return emitError(socket, result.error);
    broadcastState(room);
  });

  // ── discardCardOnTable ────────────────────────────────────────────────
  socket.on('discardCardOnTable', () => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.discardCardOnTable(playerId);
    if (result.error) return emitError(socket, result.error);

    if (result.roundEnded) {
      handleRoundEnd(room);
    }

    broadcastState(room);
  });

  // ── submitMelds ───────────────────────────────────────────────────────
  socket.on('submitMelds', (payload: SubmitMeldsPayload) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.submitMelds(playerId, payload.melds);
    if (result.error) return emitError(socket, result.error);

    io.to(room.id).emit('meldSubmitted', result.melds!);

    // Check if submitting melds caused a win (hand empty)
    if (room.game.checkForWin()) {
      handleRoundEnd(room);
    }

    broadcastState(room);
  });

  // ── addToMeld ─────────────────────────────────────────────────────────
  socket.on('addToMeld', (payload: AddToMeldPayload) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.addToMeld(playerId, payload.meldId, payload.cardGuids);
    if (result.error) return emitError(socket, result.error);

    io.to(room.id).emit('meldAppended', payload.meldId, result.cards!);

    // Check win after adding to meld
    if (room.game.checkForWin()) {
      handleRoundEnd(room);
    }

    broadcastState(room);
  });

  // ── mayI ──────────────────────────────────────────────────────────────
  socket.on('mayI', (_cardGuid: string) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.requestMayI(playerId);
    if (result.error) return emitError(socket, result.error);

    const req = result.request!;
    const player = room.game.getPlayerById(playerId)!;
    const voterInfos: PlayerInfo[] = req.voters.map(vid => {
      const p = room.game.getPlayerById(vid)!;
      return { id: p.id, name: p.name, handCount: p.hand.length, isDown: p.isDown, scores: [...p.scores] };
    });

    const payload: MayIRequestPayload = {
      requestId: req.id,
      playerId,
      card: req.card,
      voters: voterInfos,
      nextVoterIndex: req.nextVoterIndex,
    };
    io.to(room.id).emit('mayIRequest', payload);

    // If auto-resolved (no voters)
    if (req.resolved) {
      const resolved: MayIResolvedPayload = {
        requestId: req.id,
        accepted: req.winnerId === req.playerId,
        winnerId: req.winnerId,
        deniedById: null,
      };
      io.to(room.id).emit('mayIResolved', resolved);
      broadcastState(room);
      return;
    }

    // Notify first voter
    if (req.voters.length > 0) {
      io.to(room.id).emit('mayINextVoter', req.id, req.voters[0]);
    }
  });

  // ── respondToMayI ─────────────────────────────────────────────────────
  socket.on('respondToMayI', (payload: MayIResponsePayload) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const req = room.game.pendingMayI;
    if (!req || req.id !== payload.requestId) return emitError(socket, 'No matching request');

    const result = room.game.respondToMayI(playerId, payload.requestId, payload.accepted);
    if (result.error) return emitError(socket, result.error);

    // Broadcast the vote
    io.to(room.id).emit('mayIResponse', {
      requestId: payload.requestId,
      playerId,
      accepted: payload.accepted,
    });

    if (req.resolved) {
      const resolved: MayIResolvedPayload = {
        requestId: req.id,
        accepted: req.winnerId === req.playerId,
        winnerId: req.winnerId,
        deniedById: req.deniedById,
      };
      io.to(room.id).emit('mayIResolved', resolved);
    } else {
      // Notify next voter
      const nextVoterId = req.voters[req.nextVoterIndex];
      if (nextVoterId) {
        io.to(room.id).emit('mayINextVoter', req.id, nextVoterId);
      }
    }

    broadcastState(room);
  });

  // ── cancelMayI ────────────────────────────────────────────────────────
  socket.on('cancelMayI', (requestId: string) => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.cancelMayI(playerId, requestId);
    if (result.error) return emitError(socket, result.error);

    const resolved: MayIResolvedPayload = {
      requestId,
      accepted: false,
      winnerId: null,
      deniedById: null,
    };
    io.to(room.id).emit('mayIResolved', resolved);
    broadcastState(room);
  });

  // ── endTurn ───────────────────────────────────────────────────────────
  socket.on('endTurn', () => {
    const ctx = getRoom(socket);
    if (!ctx) return emitError(socket, 'Not in a room');
    const { room, playerId } = ctx;

    const result = room.game.endTurn(playerId);
    if (result.error) return emitError(socket, result.error);

    if (result.roundEnded) {
      handleRoundEnd(room);
    } else if (result.nextPlayerId) {
      io.to(room.id).emit('turnAdvanced', result.nextPlayerId);
    }

    broadcastState(room);
  });

  // ── disconnect ────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const ctx = getRoom(socket);
    if (!ctx) return;
    const { room, playerId } = ctx;

    room.playerSockets.delete(playerId);
    room.socketPlayers.delete(socket.id);

    if (!room.game.started) {
      // Remove player from waiting room
      const idx = room.game.players.findIndex(p => p.id === playerId);
      if (idx !== -1) room.game.players.splice(idx, 1);

      // If host left, assign new host
      if (room.hostId === playerId && room.game.players.length > 0) {
        room.hostId = room.game.players[0].id;
      }

      // Clean up empty rooms
      if (room.game.players.length === 0) {
        rooms.delete(room.id);
        return;
      }
    }

    io.to(room.id).emit('playerLeft', playerId);
    broadcastRoomInfo(room);
  });
});

// ── Round end helper ──────────────────────────────────────────────────────

function handleRoundEnd(room: Room): void {
  const scores = room.game.endRound();
  io.to(room.id).emit('roundEnded', scores);

  room.game.currentRound++;
  if (room.game.currentRound >= roundConfigs.length) {
    room.game.finished = true;
    const finalScores: Record<string, number[]> = {};
    room.game.players.forEach(p => { finalScores[p.id] = [...p.scores]; });
    io.to(room.id).emit('gameEnded', finalScores);
  } else {
    room.game.startRound();
    io.to(room.id).emit('roundStarted', room.game.currentRound);
  }
}

// ── Start server ────────────────────────────────────────────────────────────

httpServer.listen(3001, () => console.log('Server:3001'))