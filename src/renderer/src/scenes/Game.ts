import Phaser from 'phaser'
import io, { Socket } from 'socket.io-client'

interface Card {
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs'
  rank: number // 1=A, 2-10, 11=J, 12=Q, 13=K
}

export default class GameScene extends Phaser.Scene {
  socket!: Socket
  roomId: string = 'test' // Hardcoded for demo
  handContainer!: Phaser.GameObjects.Container
  hand: Card[] = []
  handSprites: Map<Phaser.GameObjects.Sprite, Card> = new Map();
  discardZone!: Phaser.GameObjects.Zone

  constructor() {
    super({ key: 'GameScene' })
  }

  preload() {
    // Load atlases - place PNGs + XMLs in ./src/renderer/public/
    // Rename PNGs to: sheet_cards.png (fronts), sheet_backs.png (backs)
    this.load.atlasXML('cards', '/playingCards.png', '/playingCards.xml')
    this.load.atlasXML('backs', '/playingCardBacks.png', '/playingCardBacks.xml')
  }

  create() {
    // UI Title
    this.add.text(400, 50, 'May I?', {
      fontSize: '32px',
      color: '#fff',
      fontStyle: 'bold'
    }).setOrigin(0.5)

    // Discard Zone (right side, visual rect + zone)
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

    // Hand Container (bottom, scrollable if needed)
    this.handContainer = this.add.container(600, 700).setDepth(10)
    this.handContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1200, 200), Phaser.Geom.Rectangle.Contains)

    // Deal sample hand (local shuffle for demo)
    //this.dealHand()

    // Global drag listeners
    this.input.on('dragstart', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite) => {
      gameObject.setTint(0x00ff00) // Green tint
      this.children.bringToTop(gameObject.parentContainer!) // Bring hand to top? No, individual
    })

    this.input.on('drag', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, dragX: number, dragY: number) => {
      gameObject.x = dragX
      gameObject.y = dragY
    })

    this.input.on('dragend', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite) => {
      gameObject.clearTint()
    })

    this.input.on('drop', (pointer: Phaser.Input.Pointer, gameObject: Phaser.GameObjects.Sprite, zone: Phaser.GameObjects.Zone) => {
      if (zone === this.discardZone) {
        // TODO: Socket emit 'discardCard'
        // Lookup card from sprite map
        const card = this.handSprites.get(gameObject)
        if (card) {
          // Remove from state
          const index = this.hand.findIndex(c => c.suit === card.suit && c.rank === card.rank)
          if (index > -1) this.hand.splice(index, 1)
          
          console.log('Discarded:', card)
          
          // Visual: add to discard pile
          const discardTop = this.add.sprite(1100, 450, 'cards', gameObject.frame.name)
            .setScale(0.6)
            .setDepth(5)
          
          gameObject.destroy()
          this.handSprites.delete(gameObject)  // Clean map
          
          this.renderHand(this.hand)
        }
      } else {
        // Snap back to hand
          this.renderHand(this.hand)
      }
    })

    // Socket for multiplayer (stub - triggers deal on "join")
    const refan = this.add.text(600, 450, ' Refan Hand ', {
      fontSize : '24px',
      color: '#0f0',
      backgroundColor: '#000',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5).setInteractive({ cursor: 'pointer' })

    refan.on('pointerdown', () => {
      this.renderHand(this.hand)
    })

    // Socket for multiplayer (stub - triggers deal on "join")
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
      // TODO: Real socket connect + server deal
      this.socket = io('http://localhost:3001')
      this.socket.emit('joinRoom', this.roomId)
      this.socket.on('gameState', (state: any) => {
        console.log('Server state:', state)
        // TODO: this.updateHandFromState(state)
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

  private dealHand() {
    // Full deck
    const suits: Card['suit'][] = ['spades', 'hearts', 'diamonds', 'clubs']
    const deck: Card[] = []
    for (const suit of suits) {
      for (let rank = 1; rank <= 13; rank++) {
        deck.push({ suit, rank })
      }
    }

    // Fisher-Yates shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
        ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }

    // Deal 11 cards
    this.hand = deck.splice(0, 11)
    this.renderHand(this.hand)
  }

  private renderHand(hand: Card[]) {
    // Clear old safely
    this.handContainer.removeAll(true);  // Destroys all child sprites
    this.handSprites.clear();            // Empty the map

    const cardScale = 0.6;
    const spacing = 55;
    const startX = -(hand.length - 1) * spacing / 2;

    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      const frameName = this.getFrameName(card);
      const sprite = this.add.sprite(startX + i * spacing, 0, 'cards', frameName)
        .setScale(cardScale)
        .setInteractive({ draggable: true })
        .setDepth(11 + i);

      sprite.setRotation((i - hand.length / 2) * 0.04);

      sprite.on('pointerover', () => sprite.setTint(0xcccccc));
      sprite.on('pointerout', () => sprite.clearTint());

      this.handContainer.add(sprite);
      this.handSprites.set(sprite, card);  // Key: sprite reference → Value: Card data
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