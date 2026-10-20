import Phaser from 'phaser';
export class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() { this.load.json('manifest', 'assets/manifest.json'); this.load.json('p2', 'assets/phase2.json'); this.load.json('shopfit', 'assets/shop_fit/fit.json'); }
  create() { this.scene.start('Preload'); }
}
