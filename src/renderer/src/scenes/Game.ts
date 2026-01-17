import Phaser from 'phaser';
import io, { Socket } from 'socket.io-client';
import { LocalGameState } from '../models/LocalGameState';
import { MultiplayerGameState } from '../models/MultiplayerGameState';
import { Card, Player, GameState } from '../models/GameState';

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

  private draggedCardData: Card | null = null;
  private originalIndex: number = -1;
  private opponentHandContainers: Phaser.GameObjects.Container[] = [];
  private opponentNameTexts: Phaser.GameObjects.Text[] = [];
  private pendingCardSprite: Phaser.GameObjects.Sprite | null = null;

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

      this.gameState!.onOpponentDraw((player: Player) => {
        console.log(`${player.name} drew a card.`);
        this.animateOpponentDraw(player);
      });
      this.gameState!.onOpponentDrawFromDiscard((player: Player, card: Card) => {
        console.log(`${player.name} drew from discard: ${card?.suit} ${card?.rank}`);
        this.animateOpponentDiscardDraw(player);
      });
      this.gameState!.onOpponentDiscard((player: Player, card: Card) => {
        console.log(`${player.name} discarded ${card?.suit} ${card?.rank}`);
        this.animateOpponentDiscard(player, card);
      });
      this.gameState!.onTurnAdvance(() => {
        const currentPlayer = this.gameState!.getCurrentPlayer();
        console.log(`It's now ${currentPlayer?.name}'s turn.`);
        this.updateFromGameState();
      });

      this.updateFromGameState();
      localBtn.destroy();
      if (joinBtn) joinBtn.destroy();
    })

    // Draw pile (top back card)
    this.drawPileSprite = this.add.sprite(550, 400, 'backs', this.cardBackTexture)
      .setScale(0.6)
      .setInteractive();
      
    this.add.text(this.drawPileSprite.x, this.drawPileSprite.y - 80, 'DRAW', { fontSize: '20px', color: '#fff' }).setOrigin(0.5)
      
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
    this.discardContainer = this.add.container(700, 400).setDepth(10);
    const discardRect = this.add.rectangle(this.discardContainer.x, this.discardContainer.y, 84, 114, 0xff0000, 0.3)
      .setOrigin(0.5)
      .setDepth(2);
    this.discardZone = this.add.zone(this.discardContainer.x, this.discardContainer.y, 100, 130)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setDepth(3);
    this.add.text(this.discardContainer.x, this.discardContainer.y - 80, 'DISCARD', { fontSize: '20px', color: '#fff' }).setOrigin(0.5)
    
    // Hand Container & Drop Zone
    this.handContainer = this.add.container(600, 700).setDepth(10)
    this.handContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, 1200, 200), Phaser.Geom.Rectangle.Contains)

    const handDropZone = this.add.zone(this.handContainer.x, this.handContainer.y, 1200, 200)
      .setDropZone()
      .setInteractive({ cursor: 'pointer' })
      .setOrigin(0.5)

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
      this.originalIndex = this.gameState?.getPlayerHand().findIndex(c => c.guid === card.guid) ?? -1;
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
        } else if (zone === handDropZone) {
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
      } else if (zone === handDropZone) {
        const dropX = pointer.x - this.handContainer.x;
        let insertIndex = this.getInsertIndexFromLocalX(dropX);

        this.gameState?.getPlayerHand().splice(this.originalIndex, 1);
        this.gameState?.getPlayerHand().splice(insertIndex, 0, this.draggedCardData!);

        console.log('Reordered to index:', insertIndex);
      }

      this.updateFromGameState();
    })
  }

  private updateFromGameState() {
    if (!this.gameState) return;
    
    if (this.gameState!.cardOnTable === null) {
      this.pendingCardSprite?.destroy();
      this.pendingCardSprite = null;
    } else {
      if(!this.pendingCardSprite && this.gameState!.isPlayerTurn()) {
        this.addPendingCardSprite(this.gameState!.cardOnTable);
      }
    }

    // Human hand
    this.renderHand(this.gameState.getPlayerHand());

    this.renderDiscardPile(this.gameState.discardPile);

    this.renderPlayerName();

    // Render opponent hands (AI or real players)
    this.renderOpponentHands();
  }

  private addPendingCardSprite(card: Card) {
    const frameName = this.getFrameName(card)
    this.pendingCardSprite = this.add.sprite(
      this.drawPileSprite.x,
      this.drawPileSprite.y,
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

        sprite.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
          if (!this.gameState?.isPlayerTurn()) {
            console.log('This will be a may I request.');
            return;
          } else {
            const drawn = this.gameState?.drawDiscard();
            if (!drawn) return;
            this.pendingCardSprite = sprite;
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
    const player = this.gameState?.getPlayer();
    if (!player) return;

    const isPlayerTurn = this.gameState?.isPlayerTurn() ?? false;
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

  private animateOpponentDraw(player: Player) {
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

  private animateOpponentDiscardDraw(player: Player) {
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

  private animateOpponentDiscard(player: Player, card: Card) {
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
}