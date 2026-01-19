import { GameState, MayIRequest, MayIResponse } from './GameState'
import { Card, roundConfigs, Rank } from './Types';
import { IPlayer, Player, Meld, validateMeld } from './Player';
import { v4 as uuidv4 } from 'uuid';

export class LocalGameState implements GameState {
  readonly decks: number;
  readonly totalPlayers: number;
  readonly players: IPlayer[] = [];
  drawPile: Card[] = [];
  discardPile: Card[] = [];
  currentTurn: number = 0;
  currentRound: number = 0;
  turnCount: number = 0;
  roundConfigs = roundConfigs;
  roundMelds: Meld[] = [];

  mayIRequests: MayIRequest[] = [];

  cardOnTable: Card | null = null;
  drawnThisTurn: boolean = false;
  discardedThisTurn: boolean = false;

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

  constructor(decks: number = 3, totalPlayers: number = 5) {
    this.decks = decks;
    this.totalPlayers = totalPlayers;
    this.initializePlayers();
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

  startGame(): void {
    for (const cb of this.onGameStartCallbacks) {
      cb();
    }

    this.startRound();
  }

  endGame(): void {
    for (const cb of this.onGameEndCallbacks) {
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
        request.penaltyCard = penaltyCard;
        console.log(`${request.player.name} also drew penalty card:`, penaltyCard);
      }
    }

    if (request.resolve) {
      request.resolve(accepted);
    }

    request.resolved = true;

    for (const cb of this.onMayIResolvedCallbacks) {
      cb(request, accepted);
    }
  }
  
  private mayINextVoter(request: MayIRequest, nextVoter: IPlayer) {
    for (const cb of this.onMayINextVoterCallbacks) {
      cb(request, nextVoter);
    }
  }

  private getMayIVotersInOrder(requester: IPlayer): IPlayer[] {
    const requesterIndex = this.players.findIndex(p => p.id === requester.id);
    if (requesterIndex === -1) return [];

    // If requester is the current player, everyone else votes (full circle) except those who are already down.
    if (requesterIndex === this.currentTurn) {
      return this.players.filter(p => p.id !== requester.id && !this.isPlayerDown(p));
    }

    // Otherwise, only players from currentTurn up to (but not including) requester vote except those who are already down.
    const voters: IPlayer[] = [];
    let i = this.currentTurn;

    while (i !== requesterIndex) {
      if (!this.isPlayerDown(this.players[i])) {
        voters.push(this.players[i]);
      }
      i = (i + 1) % this.totalPlayers;
    }

    return voters;
  }

  private waitForMayIResolution(request: MayIRequest): Promise<boolean> {
    request.promise = new Promise<boolean>(resolve => {
      request.resolve = resolve;
    });

    return request.promise;
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

  getRoundMelds(): Meld[] {
    return this.roundMelds;
  }

  isPlayerDown(player: IPlayer): boolean {
    return this.roundMelds.some(m => m.owner.id === player.id);
  }

  private initializePlayers() {
    this.players.push(new Player('human', true, true));

    for (let i = 1; i < this.totalPlayers; i++) {
      this.players.push(new Player(`ai${i}`, false, false));
    }
  }

  private initializeDeck() {
    const suits: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs'];
    let fullDeck: Card[] = [];

    for (let d = 0; d < this.decks; d++) {
      for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) {
          fullDeck.push({ suit, rank: rank as Rank, guid: uuidv4() });
        }
      }
    }

    // Shuffle
    this.drawPile = this.shuffleDeck(fullDeck);
  }

  private shuffleDeck(deck: Card[]): Card[] {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  private dealCards() {
    for (const player of this.players) {
      player.hand = this.drawPile.splice(0, 11);
    }

    this.discardPile.push(this.drawPile.pop()!);
  }

  private startRound() {
    this.drawPile = [];
    this.discardPile = [];
    this.currentTurn = this.currentRound % this.totalPlayers;
    this.turnCount = 0;
    this.mayIRequests = [];
    this.drawnThisTurn = false;
    this.discardedThisTurn = false;
    this.cardOnTable = null;
    this.roundMelds = [];
    this.initializeDeck();
    this.dealCards();
    this.roundStart();
    this.turnAdvance(this.getCurrentPlayer()!);
  }

  private endRound() {
    // Tally everyone's scores, reset hands, redeal, etc.
    this.players.forEach(player => {
      player.scores[this.currentRound] = player.getHandSummary().grandTotal;
      player.hand = [];
    });

    // Invoke round end callbacks
    this.roundEnd();
    // TODO: Do we need to wait or anything before starting next round?

    this.currentRound++;
    this.startRound();
  }

  private checkForWin(honors: boolean = false): boolean {
    const currentPlayer = this.getCurrentPlayer();
    // If nothing left in player's hand, they go out and round ends (with honors)
    if(currentPlayer!.hand.length === 0) {
      console.log(`${currentPlayer!.name} has gone out! Ending round.`);
      // TODO: What about honors?
      this.endRound();
      return true;
    }
    return false;
  }

  // ============= Player Controls =================

  submitMelds(melds: Meld[]): boolean {
    // Ensure it is the current player's turn and that they have drawn but not discarded.
    const currentPlayer = this.getCurrentPlayer();
    if(!currentPlayer) {
      console.log("No current player.");
      return false;
    }

    if(this.drawnThisTurn === false || this.discardedThisTurn === true) {
      console.log("Cannot submit melds at this time.");
      return false;
    }

    // Ensure the player hasn't already done down
    if (this.roundMelds.some(m => m.owner.id === currentPlayer.id)) {
      console.log("Player has already gone down this round.");
      return false;
    }
    
    // Validate melds according to current round config
    const config = this.roundConfigs[this.currentRound];
    const requiredRuns = config.runs ?? 0;
    const requiredSets = config.sets ?? 0;
    const runs = melds.filter(m => m.type === 'run').length;
    const sets = melds.filter(m => m.type === 'set').length;
    if (requiredRuns !== runs) {
      console.log(`Invalid number of runs for this round. Expected ${requiredRuns}, got ${runs}.`);
      return false;
    }
    if (requiredSets !== sets) {
      console.log(`Invalid number of sets for this round. Expected ${requiredSets}, got ${sets}.`);
      return false;
    }

    // ensure no cards are reused across melds by ensuring all cards are unique
    const usedCardGuids = new Set<string>();
    for (const meld of melds) {
      for (const mc of meld.cards) {
        if (usedCardGuids.has(mc.card.guid)) {
          console.log("Card used in multiple melds:", mc.card);
          return false;
        }
        usedCardGuids.add(mc.card.guid);
      }
    }

    melds.forEach(meld => {
      if(meld.owner.id !== currentPlayer.id) {
        console.log("Meld owner does not match current player.");
        return false;
      }
      // Ensure all cards in meld belong to current player
      for (const c of meld.cards) {
        const cardIndex = currentPlayer.hand.findIndex(card => card.guid === c.card.guid);
        if (cardIndex === -1) {
          console.log("Player does not have card in hand for meld:", c.card);
          return false;
        }
      }

      // validate meld structure
      if (!validateMeld(meld, true)) {
        console.log("Invalid meld:", meld);
        return false;
      }
    });

    melds.forEach(meld => {
      meld.cards.forEach(mc => {
        const cardIndex = currentPlayer.hand.findIndex(card => card.guid === mc.card.guid);
        if (cardIndex !== -1) {
          currentPlayer.hand.splice(cardIndex, 1);
        }
      });
      this.roundMelds.push(meld);
    });
    
    // Fire event/callback for meld submission
    for (const cb of this.onMeldSubmittedCallbacks) {
      cb(melds);
    }

    this.checkForWin(true);

    return true;
  }

  addToMeld(meld: Meld, cards: Card[]): boolean {
    // Ensure it is the current player's turn and that they have drawn but not discarded.
    const currentPlayer = this.getCurrentPlayer();
    if(!currentPlayer) {
      console.log("No current player.");
      return false;
    }

    if(this.drawnThisTurn === false || this.discardedThisTurn === true) {
      console.log("Cannot submit melds at this time.");
      return false;
    }

    // Cannot append to melds if you have not gone down yet
    if(!this.isPlayerDown(currentPlayer)) {
      console.log("Player must go down before adding to melds.");
      return false;
    }
    
    cards.forEach(c => {
      // Ensure the cards being added to the meld belong to the player
      const cardIndex = currentPlayer.hand.findIndex(card => card.guid === c.guid);
      if (cardIndex === -1) {
        console.log("Player does not have card in hand for meld:", c);
        return false;
      }
    });

    // Validate that the meld remains valid after adding the cards
    const newMeld: Meld = {
      id: meld.id,
      type: meld.type,
      owner: meld.owner,
      cards: meld.cards.concat(cards.map(c => ({ player: currentPlayer, card: c })))
    };
    if (!validateMeld(newMeld, false)) {
      console.log("Resulting meld would be invalid after adding cards.");
      return false;
    }
    
    // Remove cards from player's hand and add to meld
    cards.forEach(c => {
      const index = currentPlayer.hand.findIndex(card => card.guid === c.guid);
      if (index !== -1) {
        currentPlayer.hand.splice(index, 1);
      }
    });
    meld.cards = newMeld.cards;
    
    // Fire event/callback for meld append
    for (const cb of this.onMeldAppendedCallbacks) {
      cb(meld, cards);
    }

    this.checkForWin(true);

    return true;
  }

  drawCard(): Card | null {
    if (this.drawPile.length === 0)
    {
      console.log('Draw pile is empty');
      if(this.discardPile.length === 0) {
        this.endRound();
        return null;
      }
      this.drawPile = this.shuffleDeck(this.discardPile);
      this.discardPile = [];
      return this.drawCard();
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
    if (this.drawnThisTurn) {
      console.log('Already drawn this turn');
      return null;
    }
    // If there is a pending may I request, drawing from discard rejects the request
    const pendingMayI = this.mayIRequests.find(r => r.resolved === false);
    if (pendingMayI) {
      console.log('Drawing from discard pile rejects pending May I request');
      this.resolveMayI(pendingMayI, pendingMayI.player, null);
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

    // if pending may I request ... implement klennedy rules here
    const pendingMayI = this.mayIRequests.find(r => r.resolved === false);
    if (pendingMayI) {
      console.log('Cannot discard while there is a pending May I request');
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

  async mayI(player: IPlayer, card: Card): Promise<boolean> {
    if (card.guid !== this.discardPile[this.discardPile.length - 1].guid) {
      console.log("Can only May I the top card of the discard pile.");
      return false;
    }

    if (this.isPlayerDown(player)) {
      console.log("Player has already gone down this round and cannot request May I.");
      return false;
    }

    if (this.isPlayerTurn(player)) {
      console.log("Player cannot request May I on their own turn.");
      return false;
    }

    const voters = this.getMayIVotersInOrder(player);

    console.log("May I voters in order:", voters.map(v => v.name));

    const request: MayIRequest = {
      id: uuidv4(),
      player,
      card,
      responses: [],
      resolved: false,
      voters,
      nextVoterIndex: 0,
      winner: null,
      deniedBy: null,
      penaltyCard: null
    };

    // IMPORTANT: create the promise BEFORE any chance of resolving
    const promise = this.waitForMayIResolution(request);

    this.mayIRequests.push(request);
    this.mayIRequest(request);

    // If nobody can vote, requester automatically wins
    if (request.voters.length === 0) {
      request.resolved = true;
      request.winner = request.player;
      this.resolveMayI(request);
      return await promise;
    }

    this.mayINextVoter(request, request.voters[0]);
    return await promise;
  }

  respondToMayI(player: IPlayer, request: MayIRequest, allow: boolean): void {
    const req = this.mayIRequests.find(r => r.id === request.id);

    if (!req) {
      console.log('May I request not found.');
      return;
    }

    if (req.resolved) {
      console.log('May I request already resolved.');
      return;
    }

    const isEligible = req.voters.some(v => v.id === player.id);
    if (!isEligible) {
      console.log("Player is not an eligible voter for this May I.");
      return;
    }

    // Prevent duplicate responses
    if (req.responses.some(r => r.player.id === player.id)) {
      console.log('Player has already responded to this May I.');
      return;
    }
    
    const expected = req.voters[req.nextVoterIndex];
    if (!expected || expected.id !== player.id) {
      console.log(`Out of order May I response. Expected ${expected?.name}, got ${player.name}.`);
      return;
    }

    const response: MayIResponse = {
      player,
      accepted: allow
    };

    req.responses.push(response);
    this.mayIResponse(req, response);

    let pendingVote = req.voters.length !== req.responses.length;
    req.deniedBy = req.responses?.find(r => r.accepted === false)?.player || null;
    req.resolved = !pendingVote || req.responses!.some(r => r.accepted === false);
    req.winner = (req.deniedBy != null) ? req.deniedBy : req.resolved && req.responses!.every(r => r.accepted === true) ? req.player : null;

    if (!req.resolved) {
      req.nextVoterIndex++;
      const next = req.voters[req.nextVoterIndex];
      this.mayINextVoter(req, next);
    } else {
      this.resolveMayI(req);
    }
  }

  private resolveMayI(req: MayIRequest) {
    const requesterWon = req.winner?.id === req.player.id;

    // Remove the requested card from discard pile (someone is taking it)
    const cardIndex = this.discardPile.findIndex(c => c.guid === req.card.guid);
    if (cardIndex !== -1) {
      this.discardPile.splice(cardIndex, 1);
    }

    // Winner takes requested card
    req.winner!.hand.push(req.card);

    // Winner takes penalty card
    if (this.drawPile.length > 0) {
      const penaltyCard = this.drawPile.pop()!;
      req.winner!.hand.push(penaltyCard);
      if(req.winner!.id === this.getCurrentPlayer()!.id) {
        // TODO: need to muck the penalty card from other players
        req.penaltyCard = penaltyCard;
      }
    }

    if (req.resolve) {
      // your original meaning of "accepted" was requester success
      req.resolve(requesterWon);
    }

    req.resolved = true;

    // Fire callback: accepted = requesterWon
    for (const cb of this.onMayIResolvedCallbacks) {
      cb(req, requesterWon);
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

  takeCardOnTable(index?: number): void {
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
    if (this.checkForWin()) {
      return;
    }
    if (!this.drawnThisTurn || !this.discardedThisTurn) {
      console.log("Must draw and discard before ending turn.");
      return;
    }

    this.currentTurn = (this.currentTurn + 1) % this.totalPlayers;
    this.turnCount++;
    this.drawnThisTurn = false;
    this.discardedThisTurn = false;
    this.cardOnTable = null;

    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer) {
      this.turnAdvance(currentPlayer);
    }
  }
}