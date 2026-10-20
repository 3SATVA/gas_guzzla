import Phaser from 'phaser';
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() { this.load.json('manifest', 'assets/manifest.json'); }
  create() { this.scene.start('Preload'); }
}
