import { IPlayer, Meld } from './Player';
import { MayIRequest } from './GameState';
import { LocalGameState } from "./LocalGameState";
import { Card, InitialRunCount, InitialSetCount, Rank } from './Types';

export abstract class AIPlayer {
  thinkDelayMs = 1000;
  constructor(
    protected readonly game: LocalGameState,
    protected readonly player: IPlayer,
  ) {
    this.wireEvents();
  }

  private wireEvents() {
    this.game.onTurnAdvance(p => {
      if (p.id === this.player.id) {
        this.takeTurn();
      } else {
        this.considerRequestingMayI();
      }
    });

    this.game.onOpponentDiscard(() => {
      // this.considerRequestingMayI();
      // TODO: if it is about to be their turn there is no need to consider.
    });

    this.game.onOpponentDrawFromDiscard(() => {
      this.considerRequestingMayI();
    });

    this.game.onMayINextVoter((req, next) => {
      if (next.id === this.player.id) {
        this.considerMayIRequest(req);
      }
    });
  }

  abstract takeTurn(): Promise<void>;

  abstract considerRequestingMayI(): Promise<void>;

  abstract considerMayIRequest(request: MayIRequest): Promise<void>;

  protected async buildMelds() {
    console.log(`AI ${this.player.name} attempting to build melds.`);
    const config = this.game.roundConfigs[this.game.currentRound];
    const hand = [...this.player.hand];

    const melds: Meld[] = [];
    const used = new Set<string>();

    // build sets
    if (config.sets) {
      const sets = this.buildSets(config.sets, hand);
      melds.push(...sets.melds);
      sets.used.forEach(u => used.add(u));
    }

    // build runs
    if (config.runs) {
      const runs = this.buildRuns(config.runs, hand);
      melds.push(...runs.melds);
      runs.used.forEach(u => used.add(u));
    }

    // validate counts
    const runCount = melds.filter(m => m.type === "run").length;
    const setCount = melds.filter(m => m.type === "set").length;

    if (
      runCount === (config.runs ?? 0) &&
      setCount === (config.sets ?? 0)
    ) {
      console.log(`AI ${this.player.name} formed melds:`, melds);
      this.game.submitMelds(melds);
    }
  }

  protected buildSets(count: number, hand: Card[]): { melds: Meld[]; used: Set<string>; } {
    const melds: Meld[] = [];
    const used = new Set<string>();

    // group by rank
    const byRank = new Map<number, Card[]>();
    for (const card of hand) {
      if (!byRank.has(card.rank)) byRank.set(card.rank, []);
      byRank.get(card.rank)!.push(card);
    }

    for (const [, cards] of byRank) {
      if (melds.filter(m => m.type === "set").length >= count) break;

      const available = cards.filter(c => !used.has(c.guid));
      if (available.length >= InitialSetCount) {
        const chosen = available.slice(0, InitialSetCount);

        chosen.forEach(c => used.add(c.guid));

        melds.push({
          id: crypto.randomUUID(),
          type: "set",
          owner: this.player,
          cards: chosen.map(card => ({
            player: this.player,
            card
          }))
        });
      }
    }

    return { melds, used };
  }

  protected buildRuns(count: number, hand: Card[]): { melds: Meld[]; used: Set<string>; } {
    const melds: Meld[] = [];
    const used = new Set<string>();
    
    // group by suit
    const bySuit = new Map<Card["suit"], Card[]>();
    for (const card of hand) {
      if (!bySuit.has(card.suit)) bySuit.set(card.suit, []);
      bySuit.get(card.suit)!.push(card);
    }

    for (const [, cards] of bySuit) {
      if (melds.filter(m => m.type === "run").length >= count) break;

      const available = cards
        .filter(c => !used.has(c.guid))
        .sort((a, b) => a.rank - b.rank);

      let buffer: Card[] = [];

      for (let i = 0; i < available.length; i++) {
        const card = available[i];
        const prev = buffer[buffer.length - 1];

        if (!prev) {
          buffer.push(card);
        } else if (card.rank === prev.rank + 1) {
          buffer.push(card);
        } else if (card.rank === prev.rank) {
          // duplicate rank, ignore it
          continue;
        } else {
          buffer = [card];
        }

        if (buffer.length === InitialRunCount) {
          const chosen = [...buffer];

          chosen.forEach(c => used.add(c.guid));

          melds.push({
            id: crypto.randomUUID(),
            type: "run",
            owner: this.player,
            cards: chosen.map(card => ({
              player: this.player,
              card
            }))
          });

          break; // only one run per suit pass
        }
      }
    }
    
    return { melds, used };
  }

  protected async addToMelds() {
    const hand = [...this.player.hand];

    for (const meld of this.game.roundMelds) {
      const playable = this.getPlayableCardsForMeld(meld, hand);

      if (playable.length === 0) continue;

      this.game.addToMeld(meld, playable);
    }
  }

  protected getPlayableCardsForMeld(meld: Meld, hand: Card[]): Card[] {
    if (meld.type === "set") {
      return this.getPlayableForSet(meld, hand);
    }

    if (meld.type === "run") {
      return this.getPlayableForRun(meld, hand);
    }

    return [];
  }

  protected getPlayableForSet(meld: Meld, hand: Card[]): Card[] {
    const rank = meld.cards[0].card.rank;

    return hand.filter(card => card.rank === rank);
  }

  protected getPlayableForRun(meld: Meld, hand: Card[]): Card[] {
    const cards = meld.cards.map(c => c.card).sort((a, b) => a.rank - b.rank);

    const suit = cards[0].suit;
    const min = cards[0].rank;
    const max = cards[cards.length - 1].rank;

    return hand.filter(card =>
      card.suit === suit &&
      (card.rank === min - 1 || card.rank === max + 1)
    );
  }

  protected delay(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }
}

export class EasyBot extends AIPlayer {
  name = "Easy";
  mayIDenyChance = 0.05;
  thinkDelayMs = 750;
  drawFromDiscardChance = 0.3;
  requestMayIChance = 0.01;

  constructor(game: LocalGameState, player: IPlayer) {
    super(game, player);
    player.name = this.name;
  }

  async takeTurn() {
    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    // TODO: implement klennedy rules

    const shouldDrawDiscard =
      this.game.discardPile.length > 0 &&
      Math.random() < this.drawFromDiscardChance;

    const card = shouldDrawDiscard
      ? this.game.drawDiscard()
      : this.game.drawCard();
    if (!card) return;

    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    const index = Math.floor(Math.random() * (this.player.hand.length + 1));
    this.game.takeCardOnTable(index);

    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    if (!this.game.isPlayerDown(this.player)) {
      this.buildMelds();
    } else {
      this.addToMelds();
    }

    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    if( this.player.hand.length === 0 ) {
      console.log(`> ${this.player.name}: I can't discard. Did I win?`);
      return; // cannot discard, probably just went out
    }
    const discardIndex = Math.floor(Math.random() * this.player.hand.length);
    const discard = this.player.hand[discardIndex];
    this.game.discard(discard);
    
    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    await this.game.endTurn();
  }

  async considerRequestingMayI() {
    if(this.game.isPlayerDown(this.player)) {
      return; // cannot request May I if down
    }
    // TODO: implement logic to decide whether to request May I
    // Look at the top card of the discard pile and see if it helps form melds
    if (Math.random() < this.requestMayIChance) {
      const topCard = this.game.discardPile[this.game.discardPile.length - 1];
      this.game.mayI(this.player, topCard);
    }
  }

  async considerMayIRequest(request: MayIRequest) {
    console.log(`AI ${this.player.name} considering May I request ${request.id}`);
    // Must be eligible voter
    const isVoter = request.voters.some(v => v.id === this.player.id);
    if (!isVoter) {
      console.log(`AI ${this.player.name} is not a voter for May I request ${request.id}`);
      return;
    }

    // Already responded? Never try again.
    if (request.responses.some(r => r.player.id === this.player.id)) {
      console.log(`AI ${this.player.name} has already responded to May I request ${request.id}`);
      return;
    }

    // Must be this player's turn in voting order
    const expected = request.voters[request.nextVoterIndex];
    if (!expected || expected.id !== this.player.id) {
      console.log(`AI ${this.player.name} is not the expected voter for May I request ${request.id}`);
      return;
    }

    // Now safe to respond
    await this.delay(this.thinkDelayMs);

    // Check again after delay in case state changed
    if (request.responses.some(r => r.player.id === this.player.id)) {
      console.log(`AI ${this.player.name} has already responded to May I request ${request.id} after delay`);
      return;
    }
    const stillExpected = request.voters[request.nextVoterIndex];
    if (!stillExpected || stillExpected.id !== this.player.id) {
      console.log(`AI ${this.player.name} is no longer the expected voter for May I request ${request.id} after delay`);
      return;
    }

    const deny = Math.random() < this.mayIDenyChance;
    this.game.respondToMayI(this.player, request, !deny);
  }
}

export class BirdBot extends AIPlayer {
  thinkDelayMs: number = 500;
  name = "Bird-Bot";

  constructor(game: LocalGameState, player: IPlayer) {
    super(game, player);
    player.name = this.name;
  }

  async takeTurn(): Promise<void> {
    await this.delay(this.thinkDelayMs);

    // Step 1: try to go down if possible
    await this.buildMelds();
    await this.delay(this.thinkDelayMs);

    // Step 2: try to add to existing melds
    await this.addToMelds();
    await this.delay(this.thinkDelayMs);
    // Step 3: choose draw source
    const topDiscard = this.game.discardPile[this.game.discardPile.length - 1];

    if (topDiscard && this.shouldTakeDiscard(topDiscard)) {
      this.game.drawDiscard();
    } else {
      this.game.drawCard();
    }

    await this.delay(this.thinkDelayMs);

    // Step 4: discard weakest card
    const discard = this.chooseDiscard();
    if (discard) {
      this.game.discard(discard);
    }

    await this.delay(this.thinkDelayMs);

    await this.game.endTurn();
  }

  async considerRequestingMayI(): Promise<void> {
    const top = this.game.discardPile[this.game.discardPile.length - 1];
    if (!top) return;

    if (this.shouldTakeDiscard(top)) {
      await this.delay(this.thinkDelayMs);
      await this.game.mayI(this.player, top);
    }
  }

  async considerMayIRequest(request: MayIRequest): Promise<void> {
    await this.delay(this.thinkDelayMs);

    // deny if this card is useful to us
    if (this.shouldTakeDiscard(request.card)) {
      this.game.respondToMayI(this.player, request, false);
      return;
    }

    // otherwise approve
    this.game.respondToMayI(this.player, request, true);
  }

  // -------------------------
  // Heuristics
  // -------------------------

  private shouldTakeDiscard(card: Card): boolean {
    const hand = this.player.hand;

    // Helps set
    const sameRank = hand.filter(c => c.rank === card.rank);
    if (sameRank.length >= 1) return true;

    // Helps run
    const sameSuit = hand.filter(c => c.suit === card.suit);
    const ranks = sameSuit.map(c => c.rank);

    if (ranks.includes(card.rank - 1 as Rank) || ranks.includes(card.rank + 1 as Rank)) {
      return true;
    }

    return false;
  }

  private chooseDiscard(): Card | null {
    const hand = this.player.hand;

    if (hand.length === 0) return null;

    // Score each card by usefulness
    const scored = hand.map(card => ({
      card,
      score: this.evaluateCard(card)
    }));

    // Discard lowest usefulness
    scored.sort((a, b) => a.score - b.score);

    return scored[0].card;
  }

  private evaluateCard(card: Card): number {
    let score = 0;
    const hand = this.player.hand;

    // Same rank nearby helps sets
    const sameRank = hand.filter(c => c.rank === card.rank).length;
    score += sameRank * 3;

    // Same suit neighbors helps runs
    const sameSuit = hand.filter(c => c.suit === card.suit);
    const ranks = sameSuit.map(c => c.rank);

    if (ranks.includes(card.rank - 1 as Rank)) score += 2;
    if (ranks.includes(card.rank + 1 as Rank)) score += 2;

    // Slight penalty for extreme cards
    if (card.rank === 1 || card.rank === 13) score -= 0.5;

    return score;
  }
}

export class HardBot extends AIPlayer {
  name = "Hard";

  constructor(game: LocalGameState, player: IPlayer) {
    super(game, player);
    player.name = this.name;
  }

  async takeTurn(): Promise<void> {
    await this.delay(this.thinkDelayMs);

    // If card on table exists, take it if useful
    if (this.game.cardOnTable) {
      const useful = this.isCardUseful(this.game.cardOnTable);
      if (useful) {
        this.game.takeCardOnTable();
      } else {
        this.game.discardCardOnTable();
      }
      return;
    }
    await this.delay(this.thinkDelayMs);

    // Decide draw source
    const topDiscard = this.game.discardPile[this.game.discardPile.length - 1];
    if (topDiscard && this.isCardUseful(topDiscard)) {
      this.game.drawDiscard();
    } else {
      this.game.drawCard();
    }

    await this.delay(this.thinkDelayMs);

    // Try to go down
    await this.buildMelds();

    // Try to append to existing melds
    await this.addToMelds();

    await this.delay(this.thinkDelayMs);

    // Discard worst card
    const discard = this.chooseDiscard();
    if (discard) {
      this.game.discard(discard);
    }

    await this.delay(this.thinkDelayMs);

    await this.game.endTurn();
  }

  async considerRequestingMayI(): Promise<void> {
    if (this.game.isPlayerDown(this.player)) return;

    const top = this.game.discardPile[this.game.discardPile.length - 1];
    if (!top) return;

    if (this.isCardVeryUseful(top)) {
      await this.game.mayI(this.player, top);
    }
  }

  async considerMayIRequest(request: MayIRequest): Promise<void> {
    await this.delay(this.thinkDelayMs);

    const helpsRequester = this.cardImprovesPlayer(request.card, request.player);
    const hurtsMe = this.isCardUseful(request.card);

    // Strategy:
    // If it helps them a lot and hurts me, deny
    // If neutral, allow
    if (helpsRequester && !hurtsMe) {
      this.game.respondToMayI(this.player, request, false);
    } else {
      this.game.respondToMayI(this.player, request, true);
    }
  }

  // -------------------------
  // Card evaluation logic
  // -------------------------

  private isCardUseful(card: Card): boolean {
    const hand = this.player.hand;

    // Set potential
    const sameRank = hand.filter(c => c.rank === card.rank).length;
    if (sameRank >= 1) return true;

    // Run potential
    const neighbors = hand.filter(
      c => c.suit === card.suit &&
      (c.rank === card.rank - 1 || c.rank === card.rank + 1)
    );
    if (neighbors.length > 0) return true;

    return false;
  }

  private isCardVeryUseful(card: Card): boolean {
    const hand = this.player.hand;

    const sameRank = hand.filter(c => c.rank === card.rank).length;
    if (sameRank >= 2) return true;

    const neighbors = hand.filter(
      c => c.suit === card.suit &&
      (c.rank === card.rank - 1 || c.rank === card.rank + 1)
    );
    if (neighbors.length >= 2) return true;

    return false;
  }

  private chooseDiscard(): Card | null {
    const hand = [...this.player.hand];

    // Score each card
    const scored = hand.map(card => ({
      card,
      score: this.cardValue(card)
    }));

    // Lowest value gets discarded
    scored.sort((a, b) => a.score - b.score);

    return scored[0]?.card ?? null;
  }

  private cardValue(card: Card): number {
    let score = 0;

    const hand = this.player.hand;

    // Prefer keeping set cards
    score += hand.filter(c => c.rank === card.rank).length * 3;

    // Prefer keeping run adjacency
    score += hand.filter(
      c => c.suit === card.suit &&
      (c.rank === card.rank - 1 || c.rank === card.rank + 1)
    ).length * 2;

    // Penalize high deadwood
    score -= card.rank > 10 ? 2 : 0;

    return score;
  }

  private cardImprovesPlayer(card: Card, player: IPlayer): boolean {
    const hand = player.hand;

    const sameRank = hand.filter(c => c.rank === card.rank).length;
    if (sameRank >= 2) return true;

    const neighbors = hand.filter(
      c => c.suit === card.suit &&
      (c.rank === card.rank - 1 || c.rank === card.rank + 1)
    );

    return neighbors.length >= 2;
  }
}

export class ExpertBot extends AIPlayer {
  name = "Expert";

  constructor(game: LocalGameState, player: IPlayer) {
    super(game, player);
    player.name = this.name;
  }

  async takeTurn(): Promise<void> {
    await this.delay(this.thinkDelayMs);

    // Handle card on table first
    if (this.game.cardOnTable) {
      const value = this.evaluateCard(this.game.cardOnTable);
      if (value > 4) {
        this.game.takeCardOnTable();
      } else {
        this.game.discardCardOnTable();
      }
      return;
    }

    const topDiscard = this.game.discardPile.at(-1);

    // Choose best draw source
    if (topDiscard && this.evaluateCard(topDiscard) > 4) {
      this.game.drawDiscard();
    } else {
      this.game.drawCard();
    }

    await this.delay(this.thinkDelayMs);

    // Meld logic
    await this.buildMelds();
    await this.addToMelds();

    await this.delay(this.thinkDelayMs);

    // Discard worst card
    const discard = this.chooseDiscard();
    if (discard) {
      this.game.discard(discard);
    }

    await this.delay(this.thinkDelayMs);
    await this.game.endTurn();
  }

  async considerRequestingMayI(): Promise<void> {
    if (this.game.isPlayerDown(this.player)) return;

    const top = this.game.discardPile.at(-1);
    if (!top) return;

    // Expert only May I if strongly beneficial
    if (this.evaluateCard(top) >= 6) {
      await this.game.mayI(this.player, top);
    }
  }

  async considerMayIRequest(request: MayIRequest): Promise<void> {
    await this.delay(this.thinkDelayMs);

    const requesterGain = this.evaluateCardForPlayer(request.card, request.player);
    const myGain = this.evaluateCard(request.card);

    // Expert logic: block if it benefits them more than me
    if (requesterGain > myGain + 1) {
      this.game.respondToMayI(this.player, request, false);
    } else {
      this.game.respondToMayI(this.player, request, true);
    }
  }

  // -------------------------
  // Evaluation logic
  // -------------------------

  private evaluateCard(card: Card): number {
    return this.evaluateCardForPlayer(card, this.player);
  }

  private evaluateCardForPlayer(card: Card, player: IPlayer): number {
    const hand = player.hand;
    let score = 0;

    // Set potential
    const sameRank = hand.filter(c => c.rank === card.rank).length;
    score += sameRank * 3;

    // Run connectivity
    const suitCards = hand.filter(c => c.suit === card.suit).map(c => c.rank);
    const neighbors = suitCards.filter(r =>
      r === card.rank - 1 || r === card.rank + 1
    );
    score += neighbors.length * 2;

    // Bonus for bridging gap (e.g. 5 and 7 makes 6 powerful)
    if (suitCards.includes(card.rank - 2 as Rank) && suitCards.includes(card.rank + 2 as Rank)) {
      score += 2;
    }

    // Deadwood penalty for high cards
    if (card.rank >= 10) score -= 1;

    return score;
  }

  private chooseDiscard(): Card | null {
    const hand = [...this.player.hand];

    const scored = hand.map(card => ({
      card,
      score: this.evaluateCard(card)
    }));

    // Expert wants to discard the *least useful* card
    scored.sort((a, b) => a.score - b.score);

    return scored[0]?.card ?? null;
  }
}

export class IntermediateBot extends AIPlayer {
  name = "Intermediate";

  constructor(game: LocalGameState, player: IPlayer) {
    super(game, player);
    player.name = this.name;
  }

  async takeTurn(): Promise<void> {
    await this.delay(this.thinkDelayMs);

    // 1. Draw decision
    const topDiscard = this.game.discardPile[this.game.discardPile.length - 1];

    if (topDiscard && this.shouldTakeDiscard(topDiscard)) {
      this.game.drawDiscard();
    } else {
      this.game.drawCard();
    }

    await this.delay(this.thinkDelayMs);

    // 2. Try to go down
    await this.buildMelds();

    // 3. Try to add to existing melds
    await this.addToMelds();

    await this.delay(this.thinkDelayMs);

    // 4. Discard weakest card
    const discard = this.chooseDiscard();
    if (discard) {
      this.game.discard(discard);
    }

    await this.delay(this.thinkDelayMs);
    await this.game.endTurn();
  }

  async considerRequestingMayI(): Promise<void> {
    const top = this.game.discardPile[this.game.discardPile.length - 1];
    if (!top) return;

    if (this.shouldTakeDiscard(top)) {
      await this.game.mayI(this.player, top);
    }
  }

  async considerMayIRequest(request: MayIRequest): Promise<void> {
    await this.delay(this.thinkDelayMs);

    // Only deny if the card would help opponent less than it hurts you
    const helpsMe = this.shouldTakeDiscard(request.card);
    const deny = helpsMe;

    this.game.respondToMayI(this.player, request, !deny);
  }

  // ---------- Intelligence ----------

  private shouldTakeDiscard(card: Card): boolean {
    const hand = this.player.hand;

    // Helps complete set
    const sameRank = hand.filter(c => c.rank === card.rank).length;
    if (sameRank >= 2) return true;

    // Helps complete run
    const suited = hand.filter(c => c.suit === card.suit).map(c => c.rank);
    if (suited.includes(card.rank - 1 as Rank) && suited.includes(card.rank + 1 as Rank)) return true;

    return false;
  }

  private chooseDiscard(): Card | null {
    const hand = [...this.player.hand];

    const scored = hand.map(card => ({
      card,
      score: this.cardValue(card, hand)
    }));

    scored.sort((a, b) => a.score - b.score);
    return scored[0]?.card ?? null;
  }

  private cardValue(card: Card, hand: Card[]): number {
    let score = 0;

    // High ranks = more dangerous to hold
    score += card.rank >= 10 ? 2 : 0;

    // Same-rank neighbors = valuable
    const sameRank = hand.filter(c => c.rank === card.rank).length;
    score -= sameRank * 3;

    // Run neighbors
    const sameSuit = hand.filter(c => c.suit === card.suit);
    if (sameSuit.some(c => c.rank === card.rank - 1)) score -= 2;
    if (sameSuit.some(c => c.rank === card.rank + 1)) score -= 2;

    return score;
  }
}

export class TimBot extends AIPlayer {
  private readonly pickupPenalty = 3;
  private readonly denialThreshold = 2;
  name = "Tim";
  thinkDelayMs = 50;
  
  constructor(game: LocalGameState, player: IPlayer) {
    super(game, player);
    player.name = this.name;
  }

  async takeTurn(): Promise<void> {
    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();

    // TODO: implement klennedy rules

    // Determine if drawing from the discard pile
    const shouldDrawDiscard = this.testDiscard();

    let card: Card | null = null;
    do {
      card = shouldDrawDiscard
        ? this.game.drawDiscard()
        : this.game.drawCard();
    } while (!card);
    if (!card) return;

    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    const index = Math.floor(Math.random() * (this.player.hand.length + 1));
    this.game.takeCardOnTable(index);

    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    if (!this.game.isPlayerDown(this.player)) {
      this.buildMelds();
    } else {
      this.addToMelds();
    }

    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    if (this.player.hand.length === 0) {
      console.log(`> ${this.player.name}: I can't discard. Did I win?`);
      return; // cannot discard, probably just went out
    }
    const discard = this.chooseDiscard();
    this.game.discard(discard!);
    
    await this.delay(this.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    await this.game.endTurn();
  }

  async considerRequestingMayI(): Promise<void> {
    const topDiscard = this.game.discardPile[this.game.discardPile.length - 1];
    if (!topDiscard) return;

    const hand = this.player.hand;
    const discardPile = this.game.discardPile;
    const mayIRequests = this.game.mayIRequests;
    const turnCount = this.game.turnCount;

    // Score current hand
    const currentScores = this.applyContextualAdjustments(
      this.scoreCardsByFutureValue(hand),
      hand,
      discardPile,
      mayIRequests,
      turnCount
    );

    const currentTotal = [...currentScores.values()]
      .sort((a, b) => b - a)
      .slice(0, hand.length)
      .reduce((sum, s) => sum + s, 0);

    // Simulate taking the discard
    const newHand = [...hand, topDiscard];

    const newScores = this.applyContextualAdjustments(
      this.scoreCardsByFutureValue(newHand),
      newHand,
      discardPile,
      mayIRequests,
      turnCount
    );

    // Simulate best possible hand after discard
    const bestTotal = [...newScores.values()]
      .sort((a, b) => b - a)
      .slice(0, hand.length)
      .reduce((sum, s) => sum + s, 0);

    const improvement = bestTotal - currentTotal;

    // Threshold logic
    // Early game: be picky
    // Late game: be aggressive
    let threshold = 4;
    if (turnCount >= 4) threshold = 3;
    if (turnCount >= 7) threshold = 2;

    if(improvement >= threshold) {
      this.game.mayI(this.player, topDiscard);
    }
  }

  async considerMayIRequest(request: MayIRequest): Promise<void> {
    const requestedCard = request.card;

    if (this.speculate([requestedCard])) {
      this.game.respondToMayI(this.player, request, false);
      return;
    }

    const hand = this.player.hand; // or however you access player hand
    const discardPile = this.game.discardPile;
    const mayIRequests = this.game.mayIRequests;
    const turnCount = this.game.turnCount;

    // Score current hand
    const currentScores = this.applyContextualAdjustments(
      this.scoreCardsByFutureValue(hand),
      hand,
      discardPile,
      mayIRequests,
      turnCount
    );

    const currentTotal = [...currentScores.values()]
      .sort((a, b) => b - a)
      .slice(0, hand.length)
      .reduce((sum, s) => sum + s, 0);

    // Simulate receiving the requested card
    const newHand = [...hand, requestedCard];

    const newScores = this.applyContextualAdjustments(
      this.scoreCardsByFutureValue(newHand),
      newHand,
      discardPile,
      mayIRequests,
      turnCount
    );

    // Simulate optimal discard after gaining the card
    const bestTotal = [...newScores.values()]
      .sort((a, b) => b - a)
      .slice(0, hand.length)
      .reduce((sum, s) => sum + s, 0);

    // If it meaningfully helps me, deny the request
    const wouldHelpMe = bestTotal > currentTotal + this.denialThreshold;

    this.game.respondToMayI(this.player, request, !wouldHelpMe);
  }

  private chooseDiscard(): Card | null {
    const hand = [...this.player.hand];
    // TODO: Never discard what someone else obviously needs
    // What players are picking up from the discard pile
    // What they are asking "May I?" for
    // What melds they have already laid down

    // TODO: Discard high dead cards early
    // High cards that do not connect to anything, K, Q, J, 10 with no neighbors
    // Suits where you only have one card
    // Duplicate high cards that are unlikely to form sets

    // TODO: Protect flexible cards
    // 5, 6, 7, 8
    // Cards that match another rank you already have
    // Cards that are 1 away from two different sequences, like holding 6 with 5 and 7 potential
    // If a card has multiple possible futures, keep it longer.

    const baseScores = this.scoreCardsByFutureValue(hand);

    const finalScores = this.applyContextualAdjustments(
      baseScores,
      hand,
      this.game.discardPile,
      this.game.mayIRequests,
      this.game.turnCount
    );

    return [...finalScores.entries()].sort((a, b) => a[1] - b[1])[0][0];
  }

  private scoreCardsByFutureValue(hand: Card[]): Map<Card, number> {
    const scores = new Map<Card, number>();

    const rankCounts: { [key: number]: number } = {};
    const suitCounts: { [key: string]: number } = {};

    for (const card of hand) {
      rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
      suitCounts[card.suit] = (suitCounts[card.suit] || 0) + 1;
    }

    for (const card of hand) {
      let score = 0;

      const { rank, suit } = card;

      // 1) Pairs / sets potential
      if (rankCounts[rank] === 2) score += 4;
      if (rankCounts[rank] >= 3) score += 8;

      // 2) Run potential (same suit neighbors)
      const hasPrev = hand.some(c => c.suit === suit && c.rank === rank - 1);
      const hasNext = hand.some(c => c.suit === suit && c.rank === rank + 1);

      if (hasPrev) score += 3;
      if (hasNext) score += 3;
      if (hasPrev && hasNext) score += 2; // bonus for middle of run

      // 3) Middle rank flexibility
      if (rank >= 5 && rank <= 9) score += 2;

      // 4) Suit density
      if (suitCounts[suit] >= 3) score += 2;
      if (suitCounts[suit] >= 5) score += 2;

      // 5) High card penalty if unconnected
      const isHigh = rank >= 11;
      if (isHigh && !hasPrev && !hasNext && rankCounts[rank] === 1) {
        score -= 3;
      }

      // 6) Totally isolated penalty
      const isIsolated =
        rankCounts[rank] === 1 &&
        !hasPrev &&
        !hasNext &&
        suitCounts[suit] === 1;

      if (isIsolated) score -= 4;

      scores.set(card, score);
    }

    return scores;
  }

  private applyContextualAdjustments(
    scores: Map<Card, number>,
    hand: Card[],
    discardPile: Card[],
    mayIRequests: MayIRequest[],
    turnCount: number
  ): Map<Card, number> {

    const adjusted = new Map(scores);

    // Build quick lookup helpers
    const discardCount = new Map<string, number>();
    const mayICount = new Map<string, number>();

    const key = (c: Card) => `${c.rank}-${c.suit}`;

    for (const c of discardPile) {
      discardCount.set(key(c), (discardCount.get(key(c)) || 0) + 1);
    }

    for (const r of mayIRequests) {
      mayICount.set(key(r.card), (mayICount.get(key(r.card)) || 0) + 1);
    }

    for (const card of hand) {
      let score = adjusted.get(card) ?? 0;

      const cardKey = key(card);

      // 1) Strong penalty if people asked for this exact card
      const mayIHits = mayICount.get(cardKey) || 0;
      if (mayIHits > 0) {
        score -= mayIHits * 6;
      }

      // 2) Penalty if this card is adjacent to many discarded cards of same suit
      // This suggests opponent might be building that run
      const leftKey = `${card.rank - 1}-${card.suit}`;
      const rightKey = `${card.rank + 1}-${card.suit}`;

      const adjacencyPressure =
        (discardCount.get(leftKey) || 0) +
        (discardCount.get(rightKey) || 0);

      if (adjacencyPressure > 0) {
        score -= adjacencyPressure * 2;
      }

      // 3) Late game tightening, value shifts toward speed
      if (turnCount >= 6) {
        const isHigh = card.rank >= 11;
        if (isHigh) score -= 2;

        const isolated =
          !hand.some(c => c !== card && c.rank === card.rank) &&
          !hand.some(c => c.suit === card.suit && Math.abs(c.rank - card.rank) === 1);

        if (isolated) score -= 2;
      }

      // 4) Bonus if both neighbors already dead in discard pile
      const leftDead = discardCount.get(leftKey) || 0;
      const rightDead = discardCount.get(rightKey) || 0;

      if (leftDead > 0 && rightDead > 0) {
        score += 3;
      }

      adjusted.set(card, score);
    }

    return adjusted;
  }

  private shouldTakeTopDiscard(
    hand: Card[],
    topDiscard: Card,
    discardPile: Card[],
    mayIRequests: MayIRequest[],
    turnCount: number
  ): boolean {

    // Score current hand
    const currentScores = this.applyContextualAdjustments(
      this.scoreCardsByFutureValue(hand),
      hand,
      discardPile,
      mayIRequests,
      turnCount
    );

    const currentTotal = [...currentScores.values()]
      .sort((a, b) => b - a)
      .slice(0, hand.length) // redundant but explicit
      .reduce((sum, s) => sum + s, 0);

    // Simulate picking up the discard
    const newHand = [...hand, topDiscard];

    const newScores = this.applyContextualAdjustments(
      this.scoreCardsByFutureValue(newHand),
      newHand,
      discardPile,
      mayIRequests,
      turnCount
    );

    // Best possible hand after discarding one card
    const bestTotal = [...newScores.values()]
      .sort((a, b) => b - a)
      .slice(0, hand.length) // simulate discarding worst card
      .reduce((sum, s) => sum + s, 0);

    // Threshold prevents weak pickups
    return bestTotal > currentTotal + this.pickupPenalty;
  }

  private testDiscard(): boolean {
    const topCard = this.game.discardPile[this.game.discardPile.length - 1];
    if (!topCard) return false;
    if (this.speculate([topCard])) {
      return true;
    }

    // // Todo: do I need runs?
    // if (hand.some(c => c.rank === topDiscard.rank)) return true;
    // // TODO: do I need sets?
    // if (
    //   hand.some(c => c.suit === topDiscard.suit && Math.abs(c.rank - topDiscard.rank) === 1)
    // ) return true;

    return this.shouldTakeTopDiscard(
      this.player.hand,
      topCard,
      this.game.discardPile,
      this.game.mayIRequests,
      this.game.turnCount
    );
  }

  private speculate(cards: Card[]): boolean {
    const config = this.game.roundConfigs[this.game.currentRound];
    const hand = [...this.player.hand];
    const newHand = [...this.player.hand, ...cards];

    // build sets
    if (config.sets) {
      const sets = this.buildSets(config.sets, hand);
      const newSets = this.buildSets(config.sets, newHand);
      if (newSets.melds.length > sets.melds.length) {
        return true;
      }
    }

    // build runs
    if (config.runs) {
      const runs = this.buildRuns(config.runs, hand);
      const newRuns = this.buildRuns(config.runs, newHand);
      if (newRuns.melds.length > runs.melds.length) {
        return true;
      }
    }

    return false;
  }
}