import { Socket } from 'socket.io-client'
import { GameState, MayIRequest, MayIResponse } from './GameState'
import { Card } from './Types';
import { IPlayer, Meld, MeldCard, Player } from './Player';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  ServerGameState,
  PlayerInfo,
  MayIRequestPayload,
  MayIResponsePayload,
  MayIResolvedPayload,
  Meld as ServerMeld,
} from '../../../../shared/types';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export class MultiplayerGameState implements GameState {
  private socket: TypedSocket;
  private playerName: string;
  private localPlayerId: string = '';

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

  constructor(socket: Socket, playerName: string) {
    this.socket = socket as TypedSocket;
    this.playerName = playerName;
    this.wireSocketEvents();
  }

  // --- Socket event wiring ---

  private wireSocketEvents(): void {
    this.socket.on('gameState', (state: ServerGameState) => {
      this.discardPile = state.discardPile;
      this.currentTurn = state.currentTurn;
      this.currentRound = state.currentRound;
      this.turnCount = state.turnCount;
      this.drawnThisTurn = state.drawnThisTurn;
      this.discardedThisTurn = state.discardedThisTurn;
      this.cardOnTable = state.cardOnTable;

      // Represent draw pile as an array whose length matches the server count
      this.drawPile = new Array(state.drawPileCount);

      // Map PlayerInfo → IPlayer, preserving existing hand for local player
      const oldLocalPlayer = this.players.find(p => p.isPlayer);
      this.players = state.players.map(pi => this.mapPlayerInfo(pi, oldLocalPlayer));

      // Convert server melds to client melds
      this.roundMelds = state.roundMelds.map(sm => this.mapServerMeld(sm));
    });

    this.socket.on('yourHand', (hand: Card[]) => {
      const localPlayer = this.players.find(p => p.isPlayer);
      if (localPlayer) {
        localPlayer.hand = hand;
      }
    });

    this.socket.on('cardOnTable', (card: Card | null) => {
      this.cardOnTable = card;
    });

    this.socket.on('turnAdvanced', (playerId: string) => {
      const player = this.players.find(p => p.id === playerId);
      if (player) {
        for (const cb of this.onTurnAdvanceCallbacks) cb(player);
      }
    });

    this.socket.on('roundStarted', (round: number) => {
      this.currentRound = round;
      for (const cb of this.onRoundStartCallbacks) cb();
    });

    this.socket.on('roundEnded', () => {
      for (const cb of this.onRoundEndCallbacks) cb();
    });

    this.socket.on('gameStarted', () => {
      for (const cb of this.onGameStartCallbacks) cb();
    });

    this.socket.on('gameEnded', () => {
      for (const cb of this.onGameEndCallbacks) cb();
    });

    this.socket.on('mayIRequest', (payload: MayIRequestPayload) => {
      const requestingPlayer = this.findPlayer(payload.playerId);
      const card = payload.card;
      const voters = payload.voters.map(v => this.findPlayer(v.id)).filter(Boolean) as IPlayer[];

      let resolve: ((accepted: boolean) => void) | undefined;
      const promise = new Promise<boolean>(r => { resolve = r; });

      const request: MayIRequest = {
        id: payload.requestId,
        player: requestingPlayer ?? this.players[0],
        card,
        responses: [],
        resolved: false,
        resolve,
        promise,
        voters,
        nextVoterIndex: payload.nextVoterIndex,
        winner: null,
        deniedBy: null,
        penaltyCard: null,
      };
      this.mayIRequests.push(request);
      for (const cb of this.onMayIRequestCallbacks) cb(request);
    });

    this.socket.on('mayIResponse', (payload: MayIResponsePayload) => {
      const request = this.mayIRequests.find(r => r.id === payload.requestId);
      if (!request) return;
      const responder = this.findPlayer(payload.playerId);
      if (!responder) return;
      const response: MayIResponse = { player: responder, accepted: payload.accepted };
      request.responses.push(response);
      for (const cb of this.onMayIResponseCallbacks) cb(request, response);
    });

    this.socket.on('mayIResolved', (payload: MayIResolvedPayload) => {
      const request = this.mayIRequests.find(r => r.id === payload.requestId);
      if (!request) return;
      request.resolved = true;
      request.winner = payload.winnerId ? (this.findPlayer(payload.winnerId) ?? null) : null;
      request.deniedBy = payload.deniedById ? (this.findPlayer(payload.deniedById) ?? null) : null;
      if (request.resolve) request.resolve(payload.accepted);
      for (const cb of this.onMayIResolvedCallbacks) cb(request, payload.accepted);
    });

    this.socket.on('mayINextVoter', (requestId: string, voterId: string) => {
      const request = this.mayIRequests.find(r => r.id === requestId);
      const voter = this.findPlayer(voterId);
      if (request && voter) {
        request.nextVoterIndex = request.voters.findIndex(v => v.id === voterId);
        for (const cb of this.onMayINextVoterCallbacks) cb(request, voter);
      }
    });

    this.socket.on('meldSubmitted', (melds: ServerMeld[]) => {
      const clientMelds = melds.map(sm => this.mapServerMeld(sm));
      for (const cb of this.onMeldSubmittedCallbacks) cb(clientMelds);
    });

    this.socket.on('meldAppended', (meldId: string, cards: Card[]) => {
      const meld = this.roundMelds.find(m => m.id === meldId);
      if (meld) {
        for (const cb of this.onMeldAppendedCallbacks) cb(meld, cards);
      }
    });

    this.socket.on('roomInfo', (info) => {
      const me = info.players.find(p => p.name === this.playerName);
      if (me) this.localPlayerId = me.id;
    });

    this.socket.on('error', (message: string) => {
      console.error('[MultiplayerGameState] Server error:', message);
    });
  }

  // --- Helpers ---

  private findPlayer(id: string): IPlayer | undefined {
    return this.players.find(p => p.id === id);
  }

  private mapPlayerInfo(pi: PlayerInfo, oldLocalPlayer?: IPlayer): IPlayer {
    const isLocal = pi.id === this.localPlayerId || pi.name === this.playerName;
    const player = new Player(pi.name, isLocal, true);
    player.id = pi.id;
    player.scores = pi.scores;

    if (isLocal) {
      this.localPlayerId = pi.id;
      // Preserve existing hand until server sends yourHand
      player.hand = oldLocalPlayer?.hand ?? [];
    } else {
      // Opponents: empty array (use handCount for rendering)
      player.hand = [];
      (player as any).handCount = pi.handCount;
    }
    return player;
  }

  private mapServerMeld(sm: ServerMeld): Meld {
    const owner = this.findPlayer(sm.ownerId) ?? this.players[0];
    const cards: MeldCard[] = sm.cards.map(mc => ({
      player: this.findPlayer(mc.playerId) ?? owner,
      card: mc.card,
    }));
    return { id: sm.id, type: sm.type, cards, owner };
  }

  // --- Player Actions (emit to server) ---

  drawCard(): Card | null {
    this.socket.emit('drawCard');
    return null;
  }

  drawDiscard(): Card | null {
    this.socket.emit('drawDiscard');
    return null;
  }

  discard(card: Card): void {
    this.socket.emit('discard', { cardGuid: card.guid });
  }

  submitMelds(melds: Meld[]): boolean {
    this.socket.emit('submitMelds', {
      melds: melds.map(m => ({
        type: m.type,
        cardGuids: m.cards.map(mc => mc.card.guid),
      })),
    });
    return true;
  }

  addToMeld(meld: Meld, cards: Card[]): boolean {
    this.socket.emit('addToMeld', {
      meldId: meld.id,
      cardGuids: cards.map(c => c.guid),
    });
    return true;
  }

  async mayI(player: IPlayer, card: Card): Promise<boolean> {
    this.socket.emit('mayI', card.guid);
    return new Promise<boolean>(resolve => {
      this.socket.once('mayIResolved', (payload) => {
        resolve(payload.accepted);
      });
    });
  }

  respondToMayI(player: IPlayer, request: MayIRequest, allow: boolean): void {
    this.socket.emit('respondToMayI', {
      requestId: request.id,
      playerId: player.id,
      accepted: allow,
    });
  }

  cancelMayI(player: IPlayer, request: MayIRequest): void {
    this.socket.emit('cancelMayI', request.id);
  }

  takeCardOnTable(index?: number): void {
    this.socket.emit('takeCardOnTable', index);
  }

  discardCardOnTable(): void {
    this.socket.emit('discardCardOnTable');
  }

  endTurn(): void {
    this.socket.emit('endTurn');
  }

  startGame(): void {
    this.socket.emit('startGame');
  }

  // --- State Queries ---

  getCurrentPlayer(): IPlayer | undefined {
    return this.players[this.currentTurn];
  }

  getCurrentPlayerHand(): Card[] {
    const player = this.getCurrentPlayer();
    return player ? player.hand : [];
  }

  isPlayerTurn(player?: IPlayer): boolean {
    if (!player) {
      const playerIndex = this.players.findIndex(p => p.isPlayer);
      return this.currentTurn === playerIndex;
    }
    const playerIndex = this.players.findIndex(p => p.id === player.id);
    return this.currentTurn === playerIndex;
  }

  getOpponents(): IPlayer[] {
    return this.players.filter(p => !p.isPlayer);
  }

  getRoundMelds(): Meld[] {
    return this.roundMelds;
  }

  isPlayerDown(player: IPlayer): boolean {
    return this.roundMelds.some(m => m.owner.id === player.id);
  }

  async waitForNoPendingMayI(): Promise<void> {
    const pending = this.mayIRequests.filter(r => !r.resolved);
    if (pending.length === 0) return;
    await Promise.all(pending.map(r => r.promise));
  }

  // --- Event Registration ---

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
}