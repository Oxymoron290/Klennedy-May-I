import { Player, MayIRequest } from "./GameState";
import { LocalGameState } from "./LocalGameState";

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
  thinkDelayMs: 1000,
  drawFromDiscardChance: 0.3,
  requestMayIChance: 0.01
};

export const HardBot: AIProfile = {
  name: "Hard",
  mayIDenyChance: 0.25,
  thinkDelayMs: 1700,
  drawFromDiscardChance: 0.7,
  requestMayIChance: 0.04
};

export class AIPlayer {
  constructor(
    private readonly game: LocalGameState,
    private readonly player: Player,
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

    this.game.onMayIRequest(req => {
      if (req.player.id !== this.player.id) {
        this.considerMayIRequest(req);
      }
    });
  }

  private async takeTurn() {
    await this.delay(this.profile.thinkDelayMs);
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
    this.player.hand.splice(index, 0, card);

    await this.delay(this.profile.thinkDelayMs);
    await this.game.waitForNoPendingMayI();

    const discardIndex = Math.floor(Math.random() * this.player.hand.length);
    const discard = this.player.hand[discardIndex];

    this.game.discard(discard);

    await this.delay(300);
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
    await this.delay(this.profile.thinkDelayMs);

    const deny = Math.random() < this.profile.mayIDenyChance;
    this.game.respondToMayI(this.player, request, !deny);
  }

  private delay(ms: number) {
    return new Promise(res => setTimeout(res, ms));
  }
}
