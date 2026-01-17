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
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: GameScene
}

export default new Phaser.Game(config)