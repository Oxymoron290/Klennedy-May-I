import Phaser from 'phaser';
import io, { Socket } from 'socket.io-client';
import { LocalGameState } from '../models/LocalGameState';
import { MultiplayerGameState } from '../models/MultiplayerGameState';
import { GameState, MayIRequest } from '../models/GameState';
import { Card } from '../models/Types';
import { IPlayer } from '../models/Player';
import { AIPlayer, EasyBot, HardBot } from "../models/AIPlayer";

export default class GameScene extends Phaser.Scene {
  socket!: Socket;
  onlineModeEnabled: boolean = false;
  roomId: string = 'test';
  cardBackTexture: string = 'cardBack_blue2.png';
  wandaMode: boolean = true;
  gameState!: GameState | null;

  handContainer!: Phaser.GameObjects.Container;
  handSprites: Map<Phaser.GameObjects.Sprite, Card> = new Map();
  discardContainer!: Phaser.GameObjects.Container;
  discardZone!: Phaser.GameObjects.Zone;
  drawPileSprite!: Phaser.GameObjects.Sprite;
  playerNameText!: Phaser.GameObjects.Text;
  drawPileText!: Phaser.GameObjects.Text;
  discardPileText!: Phaser.GameObjects.Text;
  discardRect!: Phaser.GameObjects.Rectangle;
  handDropZone!: Phaser.GameObjects.Zone;
  scoreboardContainer!: Phaser.GameObjects.Container;
  mayIContainer!: Phaser.GameObjects.Container;
  cardSummaryContainer!: Phaser.GameObjects.Container;

  private draggedCardData: Card | null = null;
  private originalIndex: number = -1;
  private opponentHandContainers: Phaser.GameObjects.Container[] = [];
  private opponentNameTexts: Phaser.GameObjects.Text[] = [];
  private pendingCardSprite: Phaser.GameObjects.Sprite | null = null;
  private activeMayIRequest: any = null;
  private mayIResultMode: boolean = false;
  private activeIncomingMayI: MayIRequest | null = null;

  constructor() {
    super({ key: 'GameScene' })
  }

  preload() {
    this.load.atlasXML('cards', '/playingCards.png', '/playingCards.xml')
    this.load.atlasXML('backs', '/playingCardBacks.png', '/playingCardBacks.xml')
  }

  private scoreBoardOffset() {
    const seatOffset = 50 * (this.gameState?.players.length ?? 0);
    return 1100 - seatOffset;
  }

  create() {
    this.add.text(600, 50, 'May I?', {
      fontSize: '48px',
      color: '#fff',
      fontStyle: 'bold'
    }).setOrigin(0.5)

    this.scoreboardContainer = this.add.container(this.scoreBoardOffset(), 30)
      .setDepth(60)
      .setVisible(false);

    let joinBtn: Phaser.GameObjects.Text;
    // Mode selection
    if(this.onlineModeEnabled) {
      joinBtn = this.add.text(600, 150, 'Multiplayer', {
        fontSize: '24px',
        color: '#0f0',
        backgroundColor: '#000',
        padding: { x: 20, y: 10 }
      }).setOrigin(0.5).setInteractive({ cursor: 'pointer' })

      joinBtn.on('pointerdown', () => {
        this.socket = io('http://localhost:3001')
        this.gameState = new MultiplayerGameState(this.socket)
        joinBtn.destroy()
        localBtn.destroy()
      })
    }

    const localBtn = this.add.text(600, 200, 'Single Player', {
      fontSize: '24px',
      color: '#0f0',
      backgroundColor: '#000',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ cursor: 'pointer' })

    localBtn.on('pointerdown', () => {
      this.gameState = new LocalGameState();

      this.gameState.players.forEach((player, index) => {
        if (!player.isHuman) {
          const profile = index % 2 === 0 ? EasyBot : HardBot;
          new AIPlayer(this.gameState as LocalGameState, player, profile);
          player.name = `${profile.name} Bot ${index}`;
        }
      });

      this.gameState!.onOpponentDraw((player: IPlayer) => {
        console.log(`${player.name} drew a card.`);
        this.animateOpponentDraw(player);
      });
      this.gameState!.onOpponentDrawFromDiscard((player: IPlayer, card: Card) => {
        console.log(`${player.name} drew from discard: ${card?.suit} ${card?.rank}`);
        this.animateOpponentDiscardDraw(player);
      });
      this.gameState!.onOpponentDiscard((player: IPlayer, card: Card) => {
        console.log(`${player.name} discarded ${card?.suit} ${card?.rank}`);
        this.animateOpponentDiscard(player, card);
      });
      this.gameState!.onTurnAdvance(() => {
        const currentPlayer = this.gameState!.getCurrentPlayer();
        console.log(`It's now ${currentPlayer?.name}'s turn.`);
        this.updateFromGameState();
      });
      this.gameState!.onMayIRequest(req => {
        const player = this.gameState!.players.find(p => p.isPlayer)!;
        if (req.player.id === player.id) {
          this.activeMayIRequest = req;
          this.renderMayIUI();
        } else {
          this.activeIncomingMayI = req;
          this.renderMayIOverlay();
        }
      });

      this.gameState!.onMayIResponse((req, res) => {
        if (this.activeMayIRequest?.id === req.id) {
          this.renderMayIUI();
        }
        
        if (this.activeIncomingMayI) {
          this.renderMayIOverlay();
        }
      });
      this.gameState!.onMayINextVoter((req, nextVoter) => {
        if (this.activeIncomingMayI?.id === req.id) {
          this.renderMayIOverlay();
        }
      });

      this.gameState!.onMayIResolved((request, accepted) => {
        if (this.activeIncomingMayI?.id === request.id) {
          this.handleIncomingResolution(request);
        }
        if (this.activeMayIRequest?.id !== request.id) return;

        if (!accepted) {
          // existing behavior: show denied for 2s
          this.renderMayIUI();
          this.time.delayedCall(2000, () => {
            this.activeMayIRequest = null;
            this.mayIContainer.setVisible(false);
          });
          return;
        }

        // Accepted path: switch to result mode
        this.mayIResultMode = true;
        this.renderMayIUI();

        // Let them hover in box
        this.time.delayedCall(1000, () => {
          this.animateMayIResultCards(request);
        });
      });

      this.gameState!.startGame();

      this.updateFromGameState();
      localBtn.destroy();
      if (joinBtn) joinBtn.destroy();
    })

    // Draw pile (top back card)
    this.drawPileSprite = this.add.sprite(550, 400, 'backs', this.cardBackTexture)
      .setScale(0.6)
      .setInteractive()
      .setVisible(false);
      
    this.drawPileText = this.add.text(this.drawPileSprite.x, this.drawPileSprite.y - 80, 'DRAW', { fontSize: '20px', color: '#fff' })
      .setOrigin(0.5)
      .setVisible(false)
      
    this.drawPileSprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.gameState?.isPlayerTurn()) {
        console.log('Not your turn!');
        return;
      }
      const drawn = this.gameState?.drawCard();
      if (!drawn) return;

      this.addPendingCardSprite(drawn);

      // Animate from draw pile to pointer position
      this.tweens.add({
        targets: this.pendingCardSprite,
        x: pointer.x,
        y: pointer.y,
        duration: 400,
        ease: 'Back.easeOut',
        onComplete: () => {
          console.log('Drawn card ready to drag:', drawn)
        }
      });
    });

    // Discard Zone
    this.discardContainer = this.add.container(700, 400).setDepth(10).setVisible(false);
    this.discardRect = this.add.rectangle(this.discardContainer.x, this.discardContainer.y, 84, 114, 0xff0000, 0.3)
      .setOrigin(0.5)
      .setDepth(2)
      .setVisible(false);
    this.discardZone = this.add.zone(this.discardContainer.x, this.discardContainer.y, 100, 130)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setDepth(3)
      .setVisible(false);
    this.discardPileText = this.add.text(this.discardContainer.x, this.discardContainer.y - 80, 'DISCARD', { fontSize: '20px', color: '#fff' })
      .setOrigin(0.5)
      .setVisible(false)

    this.mayIContainer = this.add.container(600, 560)
      .setDepth(80)
      .setVisible(false);

    this.cardSummaryContainer = this.add.container(140, 590)
      .setDepth(70)
      .setVisible(true);

    // Hand Container & Drop Zone
    this.handContainer = this.add.container(600, 700).setDepth(10).setVisible(false)
    this.handContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1200, 200), Phaser.Geom.Rectangle.Contains)

    this.handDropZone = this.add.zone(this.handContainer.x, this.handContainer.y, 1200, 200)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setOrigin(0.5)
      .setVisible(false)

    // Drag events (same as before)
    this.input.on('dragstart', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite) => {

      if (gameObject === this.pendingCardSprite) {
        // Pending card: green tint, no handSprites logic
        gameObject.setTint(0x00ff88);
        return;
      }
      const card = this.handSprites.get(gameObject)
      if (!card) return;

      this.draggedCardData = card;
      const player = this.gameState?.players.find(p => p.isPlayer);
      this.originalIndex = player?.hand.findIndex(c => c.guid === card.guid) ?? -1;
      if (this.originalIndex === -1) return;

      gameObject.setAlpha(0.4);
      gameObject.setTint(0x00ff00);
      gameObject.setScale(0.65);
      this.handContainer.bringToTop(gameObject);

      this.handSprites.delete(gameObject);
    })

    this.input.on('drag', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, dragX: number, dragY: number) => {
      gameObject.x = dragX;
      gameObject.y = dragY;

      if (this.handContainer && this.handSprites.size > 0) {
        const localX = pointer.x - this.handContainer.x;
        const insertIndex = this.getInsertIndexFromLocalX(localX);
        this.updateHandVisualForDrag(insertIndex);
      }
    })

    this.input.on('dragend', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite) => {
      gameObject.clearTint();
      gameObject.setAlpha(1);
      gameObject.setScale(0.6);

      if (this.draggedCardData) {
        this.handSprites.set(gameObject, this.draggedCardData);
      }

      this.updateFromGameState();
      this.draggedCardData = null;
      this.originalIndex = -1;
    })

    this.input.on('drop', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, zone: Phaser.GameObjects.Zone) => {
      if (gameObject === this.pendingCardSprite) {
        if (!this.gameState?.cardOnTable) return;

        if (zone === this.discardZone) {
          // Discard drawn card
          console.log('Drew and discarded:', this.gameState?.cardOnTable);
          
          // TODO: what is this.pendingCardSprite was drawn from the discard pile?

          this.gameState?.discardCardOnTable();
          this.gameState!.endTurn();
        } else if (zone === this.handDropZone) {
          // Keep in hand
          const dropX = pointer.x - this.handContainer.x;
          let insertIndex = this.getInsertIndexFromLocalX(dropX);
          
          console.log('Drew and kept: ', this.gameState?.cardOnTable);
          console.log('Reordered to index:', insertIndex);
          this.gameState?.playerTakesCardOnTable(insertIndex);
        }

        this.updateFromGameState();
        return;
      }
      
      if (!this.draggedCardData || this.originalIndex === -1) return;

      if (zone === this.discardZone) {
        if (!this.gameState?.isPlayerTurn()) {
          console.log('Cannot discard - not your turn!');
          return;
        }

        this.gameState!.discard(this.draggedCardData);
        gameObject.removeInteractive();
        this.updateFromGameState();
        this.gameState!.endTurn();
      } else if (zone === this.handDropZone) {
        const dropX = pointer.x - this.handContainer.x;
        let insertIndex = this.getInsertIndexFromLocalX(dropX);

        const player = this.gameState!.players.find(p => p.isPlayer)!;
        player.hand.splice(this.originalIndex, 1);
        player.hand.splice(insertIndex, 0, this.draggedCardData!);

        console.log('Reordered to index:', insertIndex);
      }

      this.updateFromGameState();
    })
  }

  private updateFromGameState() {
    if (!this.gameState) return;
    
    // Show game components once game state is initialized
    if (!this.drawPileSprite.visible) {
      this.drawPileSprite.setVisible(true);
      this.drawPileText.setVisible(true);
      this.discardContainer.setVisible(true);
      this.discardRect.setVisible(true);
      this.discardZone.setVisible(true);
      this.discardPileText.setVisible(true);
      this.handContainer.setVisible(true);
      this.handDropZone.setVisible(true);
      this.scoreboardContainer.setVisible(true);
      this.scoreboardContainer.x = this.scoreBoardOffset();
    }
    
    if (this.gameState!.cardOnTable === null) {
      this.pendingCardSprite?.destroy();
      this.pendingCardSprite = null;
    } else {
      if(!this.pendingCardSprite && this.gameState!.isPlayerTurn()) {
        this.addPendingCardSprite(this.gameState!.cardOnTable);
      }
    }

    // Human hand
    const player = this.gameState!.players.find(p => p.isPlayer)!;
    this.renderHand(player.hand);

    this.renderCardSummary(player);

    this.renderDiscardPile(this.gameState.discardPile);

    this.renderPlayerName();

    this.renderScoreboard();

    // Render opponent hands (AI or real players)
    this.renderOpponentHands();
  }

  private renderMayIOverlay() {
    const req = this.activeIncomingMayI;
    if (!req) return;

    this.mayIContainer.removeAll(true);
    this.mayIContainer.setVisible(true);

    const bg = this.add.rectangle(0, 0, 520, 120, 0x000000, 0.8).setOrigin(0.5);
    this.mayIContainer.add(bg);

    const text = this.add.text(-240, -45, `${req.player.name} requests ${req.card.suit} ${req.card.rank}`, {
      fontSize: "16px",
      color: "#ffffff"
    });
    this.mayIContainer.add(text);

    // Requested card
    const cardSprite = this.add.sprite(-200, 10, "cards", this.getFrameName(req.card))
      .setScale(0.5);
    this.mayIContainer.add(cardSprite);
    const me = this.gameState!.players.find(p => p.isPlayer)!;

    const isEligible = req.voters.some(v => v.id === me.id);
    const hasResponded = req.responses.some(r => r.player.id === me.id);
    const expected = req.voters[req.nextVoterIndex];
    const isMyTurn = expected?.id === me.id;

    if (!isMyTurn) {
      const waiting = this.add.text(80, 10, "Waiting for other players...", {
        fontSize: "14px",
        color: "#cccccc"
      });
      this.mayIContainer.add(waiting);
    } else {
      console.log("It's your turn to vote on May I request");
    }

    if (isEligible && !hasResponded && isMyTurn) {
      const accept = this.add.text(80, 10, "ACCEPT", { fontSize: "18px", backgroundColor: "#00aa00" })
        .setInteractive();

      const deny = this.add.text(180, 10, "DENY", { fontSize: "18px", backgroundColor: "#aa0000" })
        .setInteractive();

      accept.on("pointerdown", () => {
        this.gameState!.respondToMayI(me, req, true);
      });

      deny.on("pointerdown", () => {
        this.gameState!.respondToMayI(me, req, false);
      });

      this.mayIContainer.add(accept);
      this.mayIContainer.add(deny);
    } else {
      this.renderVoteStatus(req);
    }
  }

  private renderVoteStatus(req: MayIRequest) {
    const voters = this.gameState!.players.filter(p => p.id !== req.player.id);

    voters.forEach((p, i) => {
      const vote = req.responses.find(r => r.player.id === p.id);
      const label = vote ? (vote.accepted ? "YES" : "NO") : "...";

      const text = this.add.text(-50 + i * 90, 40, `${p.name}\n${label}`, {
        fontSize: "12px",
        align: "center",
        color: vote?.accepted ? "#00ff00" : vote ? "#ff0000" : "#cccccc"
      });

      this.mayIContainer.add(text);
    });
  }

  private handleIncomingResolution(req: MayIRequest) {
    this.renderMayIOverlay();

    if (req.responses.every(r => r.accepted)) {
      // Accepted, show two cards
      const bg = this.add.rectangle(0, 0, 520, 120, 0x000000, 0.8).setOrigin(0.5);
      const requested = this.add.sprite(-40, 0, "cards", this.getFrameName(req.card)).setScale(0.5);
      const penalty = this.add.sprite(40, 0, "backs", this.cardBackTexture).setScale(0.5);

      this.mayIContainer.removeAll(true);
      this.mayIContainer.add(bg);
      this.mayIContainer.add(requested);
      this.mayIContainer.add(penalty);

      this.time.delayedCall(1200, () => {
        this.animateCardsToOpponent(req.player, [requested, penalty]);
      });
    } else {
      // Denied
      this.time.delayedCall(1500, () => this.resetMayIUI());
    }
  }

  private animateCardsToOpponent(player: IPlayer, sprites: Phaser.GameObjects.Sprite[]) {
    const opponents = this.gameState!.players.filter(p => !p.isPlayer);
    const index = opponents.findIndex(p => p.id === player.id);
    const targetContainer = this.opponentHandContainers[index];

    // Snapshot target position in world space (do NOT rely on container staying alive)
    const targetX = targetContainer?.x ?? 600;
    const targetY = targetContainer?.y ?? 400;

    let completed = 0;

    sprites.forEach((sprite, i) => {
      // Convert sprite's current position to world coordinates BEFORE removing it
      const worldPos = this.getWorldPos(sprite);

      // Detach from mayIContainer so it no longer inherits visibility/transform
      this.mayIContainer.remove(sprite);

      // Now it's a "world" object in the scene display list, so set to world coords
      sprite.x = worldPos.x;
      sprite.y = worldPos.y;
      sprite.setDepth(200);

      this.tweens.add({
        targets: sprite,
        x: targetX,
        y: targetY,
        scale: 0.35,
        duration: 600,
        ease: 'Power2',
        delay: i * 120,
        onComplete: () => {
          sprite.destroy();
          completed++;

          // Only cleanup UI after all card tweens finish
          if (completed === sprites.length) {
            this.resetMayIUI();
            this.updateFromGameState();
          }
        }
      });
    });
  }

  private getWorldPos(obj: Phaser.GameObjects.Sprite) {
    const mat = obj.getWorldTransformMatrix();
    const out = new Phaser.Math.Vector2();
    mat.transformPoint(0, 0, out);
    return out;
  }
  
  private resetMayIUI() {
    this.activeIncomingMayI = null;
    this.activeMayIRequest = null;
    this.mayIResultMode = false;
    this.mayIContainer.removeAll(true);
    this.mayIContainer.setVisible(false);
  }
  
  private renderMayIUI() {
    if (!this.activeMayIRequest) return;

    const request = this.activeMayIRequest;

    this.mayIContainer.removeAll(true);
    this.mayIContainer.setVisible(true);

    const width = 520;
    const height = 120;

    const bg = this.add.rectangle(-width/2, -height/2, width, height, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xffffff, 0.2);
    this.mayIContainer.add(bg);

    // Always show requested card on left
    const requestedSprite = this.add.sprite(
      -width/2 + 60,
      0,
      'cards',
      this.getFrameName(request.card)
    ).setScale(0.5);

    this.mayIContainer.add(requestedSprite);

    if (this.mayIResultMode) {
      console.log('Rendering May I result mode');
      console.log(request.penaltyCard);
      // RESULT MODE: show penalty card next to it
      if (request.penaltyCard) {
        const penaltySprite = this.add.sprite(
          -width/2 + 140,
          0,
          'cards',
          this.getFrameName(request.penaltyCard)
        ).setScale(0.5);

        this.mayIContainer.add(penaltySprite);
      }

      const label = this.add.text(0, 40, 'Granted', {
        fontSize: '14px',
        color: '#00ff88'
      }).setOrigin(0.5);

      this.mayIContainer.add(label);

      return;
    }

    // Otherwise render normal voting UI
    this.renderMayIVoters(request, width);
  }

  private renderMayIVoters(request: any, width: number) {
    const voters = this.gameState!.players.filter(p => p.id !== request.player.id);

    const startX = -width/2 + 130;
    const spacing = 90;

    voters.forEach((player, i) => {
      const x = startX + i * spacing;
      const response = request.responses.find((r: any) => r.player.id === player.id);

      let color = '#888';
      let status = 'Waiting';

      if (response) {
        color = response.accepted ? '#00ff00' : '#ff4444';
        status = response.accepted ? 'Allow' : 'Deny';
      }

      const plate = this.add.rectangle(x, -20, 80, 28, 0x111111, 0.8)
        .setStrokeStyle(1, 0xffffff, 0.2);
      this.mayIContainer.add(plate);

      const name = this.add.text(x, -20, player.name, {
        fontSize: '11px',
        color: '#ffffff'
      }).setOrigin(0.5);
      this.mayIContainer.add(name);

      const statusText = this.add.text(x, 10, status, {
        fontSize: '11px',
        color
      }).setOrigin(0.5);
      this.mayIContainer.add(statusText);
    });
  }

  private animateMayIResultCards(request: any) {
    const startX = this.mayIContainer.x - 200;
    const startY = this.mayIContainer.y;

    const cards = [
      request.card,
      request.penaltyCard
    ].filter(Boolean);

    const sprites = cards.map((card, i) =>
      this.add.sprite(
        startX + i * 80,
        startY,
        'cards',
        this.getFrameName(card)
      )
        .setScale(0.5)
        .setDepth(200)
    );

    sprites.forEach((sprite, i) => {
      this.tweens.add({
        targets: sprite,
        x: this.handContainer.x + i * 40,
        y: this.handContainer.y,
        scale: 0.4,
        duration: 600,
        ease: 'Back.easeOut',
        delay: i * 120,
        onComplete: () => {
          sprite.destroy();

          if (i === sprites.length - 1) {
            this.finishMayIAnimation();
          }
        }
      });
    });
  }

  private finishMayIAnimation() {
    this.mayIResultMode = false;
    this.activeMayIRequest = null;
    this.mayIContainer.setVisible(false);
    this.updateFromGameState();
  }
  
  private renderScoreboard() {
    if (!this.gameState) return;

    const state: any = this.gameState;
    const rounds = state.roundConfigs ?? [];
    const currentRound: number = state.currentRound ?? 0;
    const players = this.gameState.players;

    this.scoreboardContainer.removeAll(true);

    const firstColWidth = 100;
    const colWidth = 40;
    const rowHeight = 22;
    const totalCols = players.length + 1; // first col for round info
    const totalWidth = firstColWidth + (colWidth * players.length);
    const totalHeight = rowHeight * (rounds.length + 1);

    const bg = this.add.rectangle(0, 0, totalWidth, totalHeight + 6, 0x000000, 0.35).setOrigin(0);
    this.scoreboardContainer.add(bg);

    // Header
    const headerBg = this.add.rectangle(0, 0, totalWidth, rowHeight, 0x1a1a1a, 0.6).setOrigin(0);
    this.scoreboardContainer.add(headerBg);
    this.scoreboardContainer.add(this.add.text(4, 4, 'Round', { fontSize: '12px', color: '#ffffff', fontStyle: 'bold' }));

    const initials = this.computePlayerInitials(players.map(p => p.name));
    players.forEach((p, idx) => {
      const x = firstColWidth + colWidth * idx + 4;
      this.scoreboardContainer.add(this.add.text(x, 4, initials[idx], { fontSize: '12px', color: '#00e6ff' }));
    });

    rounds.forEach((cfg: any, roundIdx: number) => {
      const y = rowHeight * (roundIdx + 1);
      const isCurrent = roundIdx === currentRound;

      if (isCurrent) {
        const highlight = this.add.rectangle(0, y, totalWidth, rowHeight, 0x00aa00, 0.25).setOrigin(0);
        this.scoreboardContainer.add(highlight);
      }

      const roundLabel = this.describeRound(cfg);
      this.scoreboardContainer.add(this.add.text(4, y + 4, roundLabel, { fontSize: '12px', color: '#ffffff' }));

      players.forEach((p, idx) => {
        const x = firstColWidth + colWidth * idx + 4;
        const score = (p as any).currentScore;
        const display = roundIdx === currentRound
          ? (score === undefined || score === null || score === 0 ? '-' : `${score}`)
          : '-';
        this.scoreboardContainer.add(this.add.text(x, y + 4, display, { fontSize: '12px', color: '#ffffff' }));
      });
    });
  }

  private computePlayerInitials(names: string[]): string[] {
    const result: string[] = [];
    const used = new Set<string>();

    names.forEach(name => {
      const parts = name.trim().split(/\s+/);
      let initials = parts.map(p => p[0]?.toUpperCase() || '').join('');
      if (!initials) {
        initials = '?';
      }

      const first = parts[0] || '';
      let extraIdx = 1;
      let candidate = initials;
      while (used.has(candidate) && extraIdx < first.length) {
        candidate = first.slice(0, extraIdx + 1).toUpperCase();
        extraIdx++;
      }

      let suffix = 1;
      let final = candidate;
      while (used.has(final)) {
        final = `${candidate}${suffix}`;
        suffix++;
      }

      used.add(final);
      result.push(final);
    });

    return result;
  }

  private describeRound(cfg: any): string {
    if (!cfg) return '-';
    const parts: string[] = [];
    if (cfg.sets) parts.push(`${cfg.sets} Set${cfg.sets > 1 ? 's' : ''}`);
    if (cfg.runs) parts.push(`${cfg.runs} Run${cfg.runs > 1 ? 's' : ''}`);
    return parts.length ? parts.join(' & ') : '-';
  }

  private addPendingCardSprite(card: Card, fromDiscard: boolean = false) {
    const frameName = this.getFrameName(card)
    const x = fromDiscard ? this.discardContainer.x : this.drawPileSprite.x;
    const y = fromDiscard ? this.discardContainer.y : this.drawPileSprite.y;

    this.pendingCardSprite = this.add.sprite(
      x,
      y,
      'cards',
      frameName
    )
      .setScale(0.6)
      .setDepth(30)
      .setInteractive({ draggable: true });
  }

  private renderDiscardPile(discardPile: Card[]) {
    this.discardContainer.removeAll(true);
    discardPile.forEach((card, index) => {
      const frameName = this.getFrameName(card);
      const offsetX = index * 0.3;
      if(this.wandaMode) {
        if(!card.rotation) {
          card.rotation = Math.random() * Math.PI * 2;
        }
      }
      const sprite = this.add.sprite(offsetX, offsetX, 'cards', frameName)
        .setScale(0.6)
        .setRotation(card.rotation || 0)
        .setDepth(5 + index);

      // Only make the last card interactive
      if (index === discardPile.length - 1) {
        sprite.setInteractive({ draggable: true });

        sprite.on('pointerdown', async (pointer: Phaser.Input.Pointer) => {
          if (!this.gameState?.isPlayerTurn()) {
            console.log(`This will be a may I request for ${card.suit} ${card.rank}`);
            const player = this.gameState!.players.find(p => p.isPlayer)!;
            const accepted = await this.gameState?.mayI(player, card);
            if (accepted) {
              console.log('May I request accepted.');
            } else {
              console.log('May I request denied.');
            }
            return;
          } else {
            const drawn = this.gameState?.drawDiscard();
            if (!drawn) return;
            //this.pendingCardSprite = sprite;
            this.addPendingCardSprite(drawn, true)
          }
        });
      }

      this.discardContainer.add(sprite);
    });
  }

  private renderOpponentHands() {
    // Clear previous
    this.opponentHandContainers.forEach(c => c.destroy());
    this.opponentHandContainers = [];
    this.opponentNameTexts = [];

    const opponents = this.gameState?.players.filter(p => !p.isPlayer) ?? [];
    const numOpponents = opponents.length;
    if (numOpponents === 0) return;

    const centerX = 600;
    const centerY = 400;
    const radius = 300;  // Distance from center to opponent position — tweak this!
    // 270° arc in front: from 135° (top-left) to -45° (top-right), open at bottom
    // In Phaser: 0° = right, positive angles counterclockwise
    const startAngle = Math.PI * 0
    const endAngle = -Math.PI * 1
    const totalArc = startAngle - endAngle;

    // Even spacing between opponents
    const angleStep = numOpponents > 1 ? totalArc / (numOpponents - 1) : 0

    opponents?.forEach((opponent, index) => {
      // Calculate angle for this opponent
      const angle = startAngle - (index * angleStep)

      // Convert polar (angle, radius) to cartesian (x,y)
      const x = centerX + radius * Math.cos(angle)
      const y = centerY + radius * Math.sin(angle)

      // Slight inward tilt for natural look
      const rotation = angle + Math.PI / 2  // Face toward center

      const container = this.add.container(x, y).setRotation(rotation)
      this.opponentHandContainers.push(container)

      // Small fanned backs
      let handSize = opponent.hand.length;
      if (this.gameState!.isPlayerTurn(opponent)) {
        if (this.gameState!.cardOnTable) {
          handSize++;
        }
      }

      for (let i = 0; i < handSize; i++) {
        const back = this.add.sprite(
          i * 10 - (handSize * 5),  // local x offset for fan
          0,
          'backs',
          this.cardBackTexture
        )
          .setScale(0.35)
          .setRotation((i - handSize / 2) * 0.03)

        container.add(back)
      }

      // Optional: Player label
      const currentPlayer = this.gameState?.getCurrentPlayer();
      const isCurrentPlayer = currentPlayer?.id === opponent.id;
      const backgroundColor = isCurrentPlayer ? '#00ff00' : '#000000aa';
      const color = isCurrentPlayer ? '#000' : '#fff';
      
      const nameText = this.add.text(0, 50, opponent.name.toUpperCase(), {
        fontSize: '16px',
        color: color,
        backgroundColor: backgroundColor,
        padding: { x: 10, y: 5 }
      }).setOrigin(0.5);
      
      container.add(nameText);
      this.opponentNameTexts.push(nameText);
    })
  }

  private getInsertIndexFromLocalX(localX: number): number {
    let insertIndex = 0

    for (const sprite of this.handSprites.keys()) {
      const cardLeft = sprite.x - (sprite.width * sprite.scaleX) / 2
      if (localX > cardLeft) {
        insertIndex++
      }
    }

    return insertIndex
  }

  private updateHandVisualForDrag(insertIndex: number) {
    const cardScale = 0.6
    const spacing = 55
    const remaining = this.handSprites.size
    const startX = -(remaining) * spacing / 2

    let visualIndex = 0
    for (const sprite of this.handSprites.keys()) {
      let targetX = startX + visualIndex * spacing
      let targetY = Math.abs(visualIndex - remaining / 2) * 8

      if (visualIndex >= insertIndex) {
        targetX += spacing
      }

      this.tweens.add({
        targets: sprite,
        x: targetX,
        y: targetY,
        duration: 200,
        ease: 'Power2'
      })

      visualIndex++
    }
  }

  private renderHand(hand: Card[]) {
    this.handContainer.removeAll(true)
    this.handSprites.clear()

    const cardScale = 0.6
    const spacing = 55
    const startX = -(hand.length - 1) * spacing / 2

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i]
      const frameName = this.getFrameName(card)
      const yOffset = Math.abs(i - (hand.length - 1) / 2) * 8
      const sprite = this.add.sprite(startX + i * spacing, yOffset, 'cards', frameName)
        .setScale(cardScale)
        .setInteractive({ draggable: true })
        .setDepth(11 + i)

      sprite.setRotation((i - hand.length / 2) * 0.04)

      sprite.on('pointerover', () => sprite.setTint(0xcccccc))
      sprite.on('pointerout', () => sprite.clearTint())

      this.handContainer.add(sprite)
      this.handSprites.set(sprite, card)
    }
  }

  private getFrameName(card: Card): string {
    const rankStr = card.rank === 1 ? 'A' :
      card.rank === 11 ? 'J' :
        card.rank === 12 ? 'Q' :
          card.rank === 13 ? 'K' :
            card.rank.toString()
    return `card${card.suit.charAt(0).toUpperCase() + card.suit.slice(1)}${rankStr}.png`
  }

  private renderPlayerName() {
    const player = this.gameState?.players.find(p => p.isPlayer);
    if (!player) return;

    const isPlayerTurn = this.gameState?.isPlayerTurn(player) ?? false;
    const backgroundColor = isPlayerTurn ? '#00ff00' : '#000000aa';
    const color = isPlayerTurn ? '#000' : '#fff';

    if (!this.playerNameText) {
      this.playerNameText = this.add.text(600, 790, player.name.toUpperCase(), {
        fontSize: '24px',
        color: color,
        backgroundColor: backgroundColor,
        padding: { x: 20, y: 10 }
      }).setOrigin(0.5);
    } else {
      this.playerNameText.setText(player.name.toUpperCase());
      this.playerNameText.setStyle({ backgroundColor: backgroundColor, color: color });
    }
  }

  private animateOpponentDraw(player: IPlayer) {
    const opponents = this.gameState?.players.filter(p => !p.isPlayer) ?? [];
    const opponentIndex = opponents.findIndex(opp => opp.id === player.id);
    if (opponentIndex === -1) return;

    const targetContainer = this.opponentHandContainers[opponentIndex];
    if (!targetContainer) return;

    // Create a temporary card back sprite at the draw pile position
    const cardBack = this.add.sprite(
      this.drawPileSprite.x,
      this.drawPileSprite.y,
      'backs',
      this.cardBackTexture
    )
      .setScale(0.6)
      .setDepth(50);

    // Get the world position of the target container
    const targetX = targetContainer.x;
    const targetY = targetContainer.y;

    // Animate the card from draw pile to opponent's hand
    this.tweens.add({
      targets: cardBack,
      x: targetX,
      y: targetY,
      scale: 0.35,
      duration: 600,
      ease: 'Power2',
      onComplete: () => {
        cardBack.destroy();
        this.updateFromGameState();
      }
    });
  }

  private animateOpponentDiscardDraw(player: IPlayer) {
    const opponents = this.gameState?.players.filter(p => !p.isPlayer) ?? [];
    const opponentIndex = opponents.findIndex(opp => opp.id === player.id);
    if (opponentIndex === -1) return;
    const targetContainer = this.opponentHandContainers[opponentIndex];
    if (!targetContainer) return;
    // Create a card sprite at the discard pile position showing the actual card
    const cardSprite = this.add.sprite(
      this.discardZone.x,
      this.discardZone.y,
      'cards',
      this.getFrameName(this.gameState?.cardOnTable!) // Last card drawn
    )
      .setScale(0.6)
      .setDepth(50);
    // Animate the card from discard pile to opponent's hand
    this.tweens.add({
      targets: cardSprite,
      x: targetContainer.x,
      y: targetContainer.y,
      scale: 0.35,
      duration: 600,
      ease: 'Power2',
      onComplete: () => {
        cardSprite.destroy();
        this.updateFromGameState();
      }
    });
  }

  private animateOpponentDiscard(player: IPlayer, card: Card) {
    const opponents = this.gameState?.players.filter(p => !p.isPlayer) ?? [];
    const opponentIndex = opponents.findIndex(opp => opp.id === player.id);
    if (opponentIndex === -1) return;

    const sourceContainer = this.opponentHandContainers[opponentIndex];
    if (!sourceContainer) return;

    // Create a card sprite at the opponent's hand position showing the actual card
    const cardSprite = this.add.sprite(
      sourceContainer.x,
      sourceContainer.y,
      'cards',
      this.getFrameName(card)
    )
      .setScale(0.35)
      .setDepth(50);

    // Animate the card from opponent's hand to discard pile
    this.tweens.add({
      targets: cardSprite,
      x: this.discardZone.x,
      y: this.discardZone.y,
      scale: 0.6,
      duration: 600,
      ease: 'Power2',
      onComplete: () => {
        cardSprite.destroy();
        this.updateFromGameState();
      }
    });
  }

  private renderCardSummary(player: IPlayer) {
    const { buckets, grandCount, grandTotal } = player!.getHandSummary();

    this.cardSummaryContainer.removeAll(true);

    const width = 260;
    const rowHeight = 26;

    // Background
    const bg = this.add.rectangle(0, 0, width, 190, 0x000000, 0.5)
      .setOrigin(0.5)
      .setStrokeStyle(1, 0xffffff, 0.2);
    this.cardSummaryContainer.add(bg);

    // Headers
    const headerY = -80;
    this.cardSummaryContainer.add(this.add.text(-90, headerY, "", { fontSize: "14px", color: "#ffffff" }));
    this.cardSummaryContainer.add(this.add.text(-10, headerY, "Count", { fontSize: "14px", color: "#ffffff" }));
    this.cardSummaryContainer.add(this.add.text(70, headerY, "Value", { fontSize: "14px", color: "#ffffff" }));

    const rows = [
      { label: "5", ...buckets[5] },
      { label: "10", ...buckets[10] },
      { label: "15", ...buckets[15] },
    ];

    rows.forEach((row, i) => {
      const y = headerY + 30 + i * rowHeight;
      this.cardSummaryContainer.add(this.add.text(-90, y, row.label, { fontSize: "14px", color: "#cccccc" }));
      this.cardSummaryContainer.add(this.add.text(-10, y, `${row.count}`, { fontSize: "14px", color: "#cccccc" }));
      this.cardSummaryContainer.add(this.add.text(70, y, `${row.total}`, { fontSize: "14px", color: "#cccccc" }));
    });

    // Divider
    this.cardSummaryContainer.add(
      this.add.rectangle(0, 60, width - 20, 1, 0xffffff, 0.2)
    );

    // Totals
    this.cardSummaryContainer.add(this.add.text(-90, 75, "TOTAL", { fontSize: "14px", color: "#ffffff" }));
    this.cardSummaryContainer.add(this.add.text(-10, 75, `${grandCount}`, { fontSize: "14px", color: "#ffffff" }));
    this.cardSummaryContainer.add(this.add.text(70, 75, `${grandTotal}`, { fontSize: "14px", color: "#00ff88" }));
  }
}
