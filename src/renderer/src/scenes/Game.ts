import Phaser from 'phaser';
import io, { Socket } from 'socket.io-client';
import { LocalGameState } from '../models/LocalGameState';
import { MultiplayerGameState } from '../models/MultiplayerGameState';
import { Card, Player, GameState } from '../models/GameState';

export default class GameScene extends Phaser.Scene {
  socket!: Socket;
  roomId: string = 'test';
  handContainer!: Phaser.GameObjects.Container;
  hand: Card[] = [];
  handSprites: Map<Phaser.GameObjects.Sprite, Card> = new Map();
  discardZone!: Phaser.GameObjects.Zone;
  drawPileSprite!: Phaser.GameObjects.Sprite;
  private draggedCardData: Card | null = null;
  private originalIndex: number = -1;
  private gameState!: GameState | null;
  private opponentHandContainers: Phaser.GameObjects.Container[] = [];
  private pendingCardSprite: Phaser.GameObjects.Sprite | null = null;
  private pendingCardData: Card | null = null;

  constructor() {
    super({ key: 'GameScene' })
  }

  preload() {
    this.load.atlasXML('cards', '/playingCards.png', '/playingCards.xml')
    this.load.atlasXML('backs', '/playingCardBacks.png', '/playingCardBacks.xml')
  }

  create() {
    this.add.text(600, 50, 'May I?', {
      fontSize: '48px',
      color: '#fff',
      fontStyle: 'bold'
    }).setOrigin(0.5)

    // Discard Zone
    const discardRect = this.add.rectangle(1100, 450, 84, 114, 0xff0000, 0.3)
      .setOrigin(0.5)
      .setDepth(1)
    this.discardZone = this.add.zone(1100, 450, 100, 130)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setDepth(2)
    this.add.text(1100, 350, 'DISCARD', { fontSize: '20px', color: '#fff' }).setOrigin(0.5)

    this.discardZone.on('pointerover', () => discardRect.setFillStyle(0x00ff00, 0.5))
    this.discardZone.on('pointerout', () => discardRect.setFillStyle(0xff0000, 0.3))

    // Hand Container & Drop Zone
    this.handContainer = this.add.container(600, 700).setDepth(10)
    this.handContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1200, 200), Phaser.Geom.Rectangle.Contains)

    const handDropZone = this.add.zone(600, 700, 1200, 200)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setOrigin(0.5)
    handDropZone.setInteractive(new Phaser.Geom.Rectangle(-600, -100, 1200, 200), Phaser.Geom.Rectangle.Contains)

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
      this.originalIndex = this.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
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
      if (gameObject === this.pendingCardSprite) {
        // Pending card drag ended without drop → auto-add to end of hand
        if (this.pendingCardData) {
          this.hand.push(this.pendingCardData);
          this.renderHand(this.hand);
        }
        this.pendingCardSprite?.destroy();
        this.pendingCardSprite = null;
        this.pendingCardData = null;
        return;
      }

      gameObject.clearTint();
      gameObject.setAlpha(1);
      gameObject.setScale(0.6);

      if (this.draggedCardData) {
        this.handSprites.set(gameObject, this.draggedCardData);
      }

      this.renderHand(this.hand);
      this.draggedCardData = null;
      this.originalIndex = -1;
    })

    this.input.on('drop', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, zone: Phaser.GameObjects.Zone) => {
      if (gameObject === this.pendingCardSprite) {
        // Handle pending card drop
        if (!this.pendingCardData) return;

        if (zone === this.discardZone) {
          // Discard drawn card
          console.log('Drew and discarded:', this.pendingCardData);

          // Visual to discard pile
          this.add.sprite(1100, 450, 'cards', this.getFrameName(this.pendingCardData))
            .setScale(0.6)
            .setDepth(5);
        } else if (zone === handDropZone) {
          // Keep in hand
          this.hand.push(this.pendingCardData);
          console.log('Drew and kept:', this.pendingCardData);
        } // else: dragend handles auto-keep

        this.pendingCardSprite?.destroy();
        this.pendingCardSprite = null;
        this.pendingCardData = null;
        this.renderHand(this.hand);
        return;
      }
      if (!this.draggedCardData || this.originalIndex === -1) return;

      if (zone === this.discardZone) {
        this.hand.splice(this.originalIndex, 1);
        gameObject.removeInteractive();
        this.handContainer.remove(gameObject, true);
        console.log('Discarded:', this.draggedCardData);

        this.add.sprite(1100, 450, 'cards', gameObject.frame.name)
          .setScale(0.6)
          .setDepth(5);
      } else if (zone === handDropZone) {
        const dropX = pointer.x - this.handContainer.x;
        let insertIndex = this.getInsertIndexFromLocalX(dropX);

        this.hand.splice(this.originalIndex, 1);
        this.hand.splice(insertIndex, 0, this.draggedCardData!);

        console.log('Reordered to index:', insertIndex);
      }

      this.renderHand(this.hand);
    })

    // Mode selection
    const joinBtn = this.add.text(600, 150, 'Multiplayer', {
      fontSize: '24px',
      color: '#0f0',
      backgroundColor: '#000',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ cursor: 'pointer' })

    const localBtn = this.add.text(600, 200, 'Single Player', {
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

    localBtn.on('pointerdown', () => {
      this.gameState = new LocalGameState()
      this.updateFromGameState()
      localBtn.destroy()
      joinBtn.destroy()
    })
  }

  private updateFromGameState() {
    if (!this.gameState) return

    // Human hand
    const human = this.gameState.players.find(p => p.isHuman)
    if (human) {
      this.hand = human.hand
      this.renderHand(this.hand)
    }

    // Draw pile (top back card)
    this.drawPileSprite = this.add.sprite(600, 400, 'backs', 'cardBack_blue1.png')
      .setScale(0.6)
      .setInteractive()

    // Draw interaction (local only for now)
    if (this.gameState instanceof LocalGameState) {
      this.drawPileSprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        const drawn = this.gameState?.drawCard('human')
        if (!drawn) return

        this.pendingCardData = drawn

        const frameName = this.getFrameName(drawn)
        this.pendingCardSprite = this.add.sprite(
          this.drawPileSprite.x,
          this.drawPileSprite.y,
          'cards',
          frameName
        )
          .setScale(0.6)
          .setDepth(30)
          .setInteractive({ draggable: true })

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
        })
      })
    }

    // Render opponent hands (AI or real players)
    this.renderOpponentHands()
  }

  private renderOpponentHands() {
    // Clear previous
    this.opponentHandContainers.forEach(c => c.destroy());
    this.opponentHandContainers = [];

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
      const handSize = opponent.hand.length
      for (let i = 0; i < handSize; i++) {
        const back = this.add.sprite(
          i * 10 - (handSize * 5),  // local x offset for fan
          0,
          'backs',
          'cardBack_blue1.png'
        )
          .setScale(0.35)
          .setRotation((i - handSize / 2) * 0.03)

        container.add(back)
      }

      // Optional: Player label
      container.add(
        this.add.text(0, 50, opponent.id.toUpperCase(), {
          fontSize: '16px',
          color: '#fff',
          backgroundColor: '#000000aa'
        }).setOrigin(0.5)
      )
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
}