import Phaser from 'phaser'
import io, { Socket } from 'socket.io-client'

interface Card { suit: string; rank: number }

export default class GameScene extends Phaser.Scene {
  socket!: Socket
  roomId!: string

  constructor() {
    super({ key: 'GameScene' })
  }

  create() {
    this.add.text(100, 100, 'May I Multiplayer - Join Room:', { fontSize: '32px', color: '#fff' })
    const input = this.add.dom(250, 175).createFromHTML(
      '<input type="text" placeholder="Room ID" style="width: 300px; height: 40px; font-size: 18px;" />'
    ) as Phaser.GameObjects.DOMElement
    const joinBtn = this.add.text(450, 150, 'JOIN', { fontSize: '24px', color: '#fff' }).setInteractive()

    joinBtn.on('pointerdown', () => {
      const inputElement = input.getChildByProperty('type', 'text') as HTMLInputElement
      this.roomId = inputElement.value
      this.socket = io('http://localhost:3001')  // Server URL
      this.socket.emit('joinRoom', this.roomId)
      this.socket.on('gameState', (state: any) => console.log('State:', state))  // Update UI here
      this.add.text(100, 250, `Joined ${this.roomId}!`, { fontSize: '24px', color: '#0f0' })
    })

    // Drag zones later
  }
}