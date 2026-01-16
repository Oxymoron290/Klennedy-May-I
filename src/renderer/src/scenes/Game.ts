import Phaser from 'phaser'
import io, { Socket } from 'socket.io-client'

interface Card {
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs'
  rank: number // 1=A, 2-10, 11=J, 12=Q, 13=K
}

export default class GameScene extends Phaser.Scene {
  socket!: Socket;
  roomId: string = 'test'; // Hardcoded for demo
  handContainer!: Phaser.GameObjects.Container;
  hand: Card[] = [];
  handSprites: Map<Phaser.GameObjects.Sprite, Card> = new Map();
  discardZone!: Phaser.GameObjects.Zone;
  private draggedCardData: Card | null = null;  // New: store card data
  private placeholder: Phaser.GameObjects.Sprite | null = null;
  private originalIndex: number = -1;

  constructor() {
    super({ key: 'GameScene' })
  }

  preload() {
    this.load.atlasXML('cards', '/playingCards.png', '/playingCards.xml')
    this.load.atlasXML('backs', '/playingCardBacks.png', '/playingCardBacks.xml')
  }

  create() {
    this.add.text(400, 50, 'May I?', {
      fontSize: '32px',
      color: '#fff',
      fontStyle: 'bold'
    }).setOrigin(0.5)

    const discardRect = this.add.rectangle(1100, 450, 84, 114, 0xff0000, 0.3)
      .setOrigin(0.5)
      .setDepth(1);
    this.discardZone = this.add.zone(1100, 450, 100, 130)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setDepth(2);
    this.add.text(1100, 350, 'DISCARD', { fontSize: '20px', color: '#fff' }).setOrigin(0.5)

    this.discardZone.on('pointerover', () => discardRect.setFillStyle(0x00ff00, 0.5));
    this.discardZone.on('pointerout', () => discardRect.setFillStyle(0xff0000, 0.3));

    this.handContainer = this.add.container(600, 700).setDepth(10)
    this.handContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1200, 200), Phaser.Geom.Rectangle.Contains)

    const handDropZone = this.add.zone(600, 700, 1200, 200)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setOrigin(0.5);

    handDropZone.setInteractive(new Phaser.Geom.Rectangle(-600, -100, 1200, 200), Phaser.Geom.Rectangle.Contains);

    this.input.on('dragstart', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite) => {
      const card = this.handSprites.get(gameObject);
      if (!card) return;

      this.draggedCardData = card;
      this.originalIndex = this.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank);
      if (this.originalIndex === -1) return;

      gameObject.setAlpha(0.4);
      gameObject.setTint(0x00ff00);
      gameObject.setScale(0.65);
      this.handContainer.bringToTop(gameObject);

      // this.placeholder = this.add.sprite(gameObject.x, gameObject.y, 'cards', gameObject.frame.name)
      //   .setScale(0.6)
      //   .setAlpha(0.35)
      //   .setTint(0xffffff)
      //   .setDepth(20);

      // this.handContainer.add(this.placeholder);

      this.handSprites.delete(gameObject);
    });

    this.input.on('drag', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, dragX: number, dragY: number) => {
      gameObject.x = dragX;
      gameObject.y = dragY;

      if (this.placeholder) {
        this.placeholder.x = dragX;
        this.placeholder.y = dragY;
      }

      if (this.handContainer && this.handSprites.size > 0) {
        const localX = pointer.x - this.handContainer.x;
        const insertIndex = this.getInsertIndexFromLocalX(localX);

        this.updateHandVisualForDrag(insertIndex);
      }
    });

    this.input.on('dragend', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite) => {
      gameObject.clearTint();
      gameObject.setAlpha(1);
      gameObject.setScale(0.6);

      if (this.placeholder) {
        this.placeholder.destroy();
        this.placeholder = null;
      }

      // Restore map entry if not dropped (e.g., drag canceled)
      if (this.draggedCardData) {
        this.handSprites.set(gameObject, this.draggedCardData);
      }

      this.renderHand(this.hand);

      this.draggedCardData = null;
      this.originalIndex = -1;
    });

    this.input.on('drop', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, zone: Phaser.GameObjects.Zone) => {
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
        
        // Remove from original position
        this.hand.splice(this.originalIndex, 1);

        // No need for the > originalIndex adjustment anymore!
        // The midpoint comparison handles it naturally
        this.hand.splice(insertIndex, 0, this.draggedCardData!);

        console.log('Reordered to index:', insertIndex);
      }

      this.renderHand(this.hand);
    });

    const joinBtn = this.add.text(600, 150, ' Multiplayer ', {
      fontSize : '24px',
      color: '#0f0',
      backgroundColor: '#000',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ cursor: 'pointer' })

    const localBtn = this.add.text(600, 200, 'Single Player', {
      fontSize : '24px',
      color: '#0f0',
      backgroundColor: '#000',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ cursor: 'pointer' })

    joinBtn.on('pointerdown', () => {
      this.socket = io('http://localhost:3001')
      this.socket.emit('joinRoom', this.roomId)
      this.socket.on('gameState', (state: any) => {
        console.log('Server state:', state)
      })
      localBtn.destroy();
      joinBtn.destroy();
    })

    localBtn.on('pointerdown', () => {
      this.dealHand();
      localBtn.destroy();
      joinBtn.destroy();
    })
  }

  private getInsertIndexFromLocalX(localX: number): number {
    let insertIndex = 0;

    for (const sprite of this.handSprites.keys()) {
      // Use center of each card as boundary
      const cardCenter = sprite.x - ((sprite.width * sprite.scaleX) / 2);

      if (localX > cardCenter) {
        insertIndex++;
      }
    }

    return insertIndex;
  }

  private dealHand() {
    const suits: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs']
    const deck: Card[] = []
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank })
      }
    }

    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }

    this.hand = deck.splice(0, 11)
    this.renderHand(this.hand)
  }

  private updateHandVisualForDrag(insertIndex: number) {
    const cardScale = 0.6;
    const spacing = 55;
    const handLength = this.handSprites.size; // Use map size for remaining
    const startX = -(handLength) * spacing / 2; // Adjust for one less, but add space for placeholder

    let visualIndex = 0;
    for (const sprite of this.handSprites.keys()) {
      let targetX = startX + visualIndex * spacing;
      let targetY = Math.abs(visualIndex - handLength / 2) * 8;

      if (visualIndex >= insertIndex) {
        targetX += spacing; // Shift right for gap
      }

      this.tweens.add({
        targets: sprite,
        x: targetX,
        y: targetY,
        duration: 200,
        ease: 'Power2'
      });

      visualIndex++;
    }
  }

  private renderHand(hand: Card[]) {
    this.handContainer.removeAll(true);
    this.handSprites.clear();

    const cardScale = 0.6;
    const spacing = 55;
    const startX = -(hand.length - 1) * spacing / 2;

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const frameName = this.getFrameName(card);
      const yOffset = Math.abs(i - (hand.length - 1) / 2) * 8;
      const sprite = this.add.sprite(startX + i * spacing, yOffset, 'cards', frameName)
        .setScale(cardScale)
        .setInteractive({ draggable: true })
        .setDepth(11 + i);

      sprite.setRotation((i - hand.length / 2) * 0.04);

      sprite.on('pointerover', () => sprite.setTint(0xcccccc));
      sprite.on('pointerout', () => sprite.clearTint());

      this.handContainer.add(sprite);
      this.handSprites.set(sprite, card);
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