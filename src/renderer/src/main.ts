import Phaser from 'phaser'
import GameScene from './scenes/Game'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 1200,
  height: 800,
  parent: 'body',
  backgroundColor: '#228B22',
  dom: {
    createContainer: true
  },
  scene: GameScene
}

export default new Phaser.Game(config)