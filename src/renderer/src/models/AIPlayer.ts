import { IPlayer, Meld } from './Player';
import { MayIRequest } from './GameState';
import { LocalGameState } from "./LocalGameState";
import { Card, InitialRunCount, InitialSetCount } from './Types';

export interface AIProfile {
  name: string;
  mayIDenyChance: number; // 0.0 - 1.0
  thinkDelayMs: number;
  drawFromDiscardChance: number; // 0.0 - 1.0
  requestMayIChance: number; // 0.0 - 1.0
}

export const EasyBot: AIProfile = {
  name: "Easy",
  mayIDenyChance: 0.05,
  thinkDelayMs: 250,//1000,
  drawFromDiscardChance: 0.3,
  requestMayIChance: 0.01
};

export const HardBot: AIProfile = {
  name: "Hard",
  mayIDenyChance: 0.25,
  thinkDelayMs: 500,//1700,
  drawFromDiscardChance: 0.7,
  requestMayIChance: 0.04
};

export class AIPlayer {
  constructor(
    private readonly game: LocalGameState,
    private readonly player: IPlayer,
    private readonly profile: AIProfile
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

    this.game.onOpponentDiscard((p, card) => {
      this.considerRequestingMayI();
    });

    this.game.onOpponentDrawFromDiscard((p, card) => {
      this.considerRequestingMayI();
    });

    this.game.onMayINextVoter((req, next) => {
      if (next.id === this.player.id) {
        this.considerMayIRequest(req);
      }
    });
  }

  private async takeTurn() {
    await this.delay(300);
    await this.game.waitForNoPendingMayI();
    // TODO: implement klennedy rules

    const shouldDrawDiscard =
      this.game.discardPile.length > 0 &&
      Math.random() < this.profile.drawFromDiscardChance;

    const card = shouldDrawDiscard
      ? this.game.drawDiscard()
      : this.game.drawCard();
    if (!card) return;

    await this.delay(this.profile.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    const index = Math.floor(Math.random() * (this.player.hand.length + 1));
    this.game.playerTakesCardOnTable(index);

    await this.delay(this.profile.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    if (!this.game.isPlayerDown(this.player)) {
      this.buildMelds();
    } else {
      this.addToMelds();
    }

    await this.delay(this.profile.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    if( this.player.hand.length === 0 ) {
      console.log(`> ${this.player.name}: I can't discard. Did I win?`);
      return; // cannot discard, probably just went out
    }
    const discardIndex = Math.floor(Math.random() * this.player.hand.length);
    const discard = this.player.hand[discardIndex];
    this.game.discard(discard);
    
    await this.delay(this.profile.thinkDelayMs);
    await this.game.waitForNoPendingMayI();
    await this.game.endTurn();
  }

  private async considerRequestingMayI() {
    // TODO: implement logic to decide whether to request May I
    // Look at the top card of the discard pile and see if it helps form melds
    if (Math.random() < this.profile.requestMayIChance) {
      const topCard = this.game.discardPile[this.game.discardPile.length - 1];
      this.game.mayI(this.player, topCard);
    }
  }

  private async considerMayIRequest(request: MayIRequest) {
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
    await this.delay(this.profile.thinkDelayMs);

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

    const deny = Math.random() < this.profile.mayIDenyChance;
    this.game.respondToMayI(this.player, request, !deny);
  }

  private async buildMelds() {
    console.log(`AI ${this.player.name} attempting to build melds.`);
    const config = this.game.roundConfigs[this.game.currentRound];
    const hand = [...this.player.hand];

    const melds: Meld[] = [];
    const used = new Set<string>();

    // group by rank
    const byRank = new Map<number, Card[]>();
    for (const card of hand) {
      if (!byRank.has(card.rank)) byRank.set(card.rank, []);
      byRank.get(card.rank)!.push(card);
    }

    // group by suit
    const bySuit = new Map<Card["suit"], Card[]>();
    for (const card of hand) {
      if (!bySuit.has(card.suit)) bySuit.set(card.suit, []);
      bySuit.get(card.suit)!.push(card);
    }

    // build sets
    if (config.sets) {
      for (const [, cards] of byRank) {
        if (melds.filter(m => m.type === "set").length >= config.sets) break;

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
    }

    // build runs
    if (config.runs) {
      for (const [, cards] of bySuit) {
        if (melds.filter(m => m.type === "run").length >= config.runs) break;

        const available = cards
          .filter(c => !used.has(c.guid))
          .sort((a, b) => a.rank - b.rank);

        let buffer: Card[] = [];

        for (let i = 0; i < available.length; i++) {
          const card = available[i];
          const prev = buffer[buffer.length - 1];

          if (!prev || card.rank === prev.rank + 1) {
            buffer.push(card);
          } else if (card.rank !== prev.rank) {
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

  private async addToMelds() {
    const hand = [...this.player.hand];

    for (const meld of this.game.roundMelds) {
      const playable = this.getPlayableCardsForMeld(meld, hand);

      if (playable.length === 0) continue;

      this.game.addToMeld(meld, playable);
    }
  }

  private getPlayableCardsForMeld(meld: Meld, hand: Card[]): Card[] {
    if (meld.type === "set") {
      return this.getPlayableForSet(meld, hand);
    }

    if (meld.type === "run") {
      return this.getPlayableForRun(meld, hand);
    }

    return [];
  }

  private getPlayableForSet(meld: Meld, hand: Card[]): Card[] {
    const rank = meld.cards[0].card.rank;

    return hand.filter(card => card.rank === rank);
  }

  private getPlayableForRun(meld: Meld, hand: Card[]): Card[] {
    const cards = meld.cards.map(c => c.card).sort((a, b) => a.rank - b.rank);

    const suit = cards[0].suit;
    const min = cards[0].rank;
    const max = cards[cards.length - 1].rank;

    return hand.filter(card =>
      card.suit === suit &&
      (card.rank === min - 1 || card.rank === max + 1)
    );
  }

  private delay(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }
}
