import Phaser from 'phaser';

/** Main menu: DRIVE (the side-scrolling car game), FIGHT (1v1 vs the CYLOBOT) or STREET (Seek's mock street level). */
export class MenuScene extends Phaser.Scene {
  private idx = 0;
  private items: Phaser.GameObjects.Text[] = [];
  private cursor!: Phaser.GameObjects.Text;
  private leaving = false;
  constructor() { super('Menu'); }

  create() {
    const m = this.cache.json.get('manifest');
    const L = m.select_screen.layout;
    this.leaving = false;
    this.idx = this.registry.get('menu_idx') ?? 0;
    const off = Math.round((this.scale.width - 1280) / 2);
    this.cameras.main.setZoom(1).setScroll(-off, 0).setBackgroundColor('#000').fadeIn(250, 0, 0, 0);
    this.add.image(0, 0, 'sel_bg').setOrigin(0);
    this.add.image(-1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.add.image(1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.add.rectangle(-1280, 0, 3840, 720, 0x000000, 0.45).setOrigin(0);
    this.add.image(640 - L.ui.logo_size[0] / 2, 150, 'sel_logo').setOrigin(0);
    const style = { fontFamily: 'monospace', fontSize: '56px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 8 };
    this.items = [
      this.add.text(640, 400, 'DRIVE', style).setOrigin(0.5),
      this.add.text(640, 490, 'FIGHT', style).setOrigin(0.5),
      this.add.text(640, 580, 'STREET', style).setOrigin(0.5),
    ];
    this.items.forEach((t, i) => {
      t.setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { this.idx = i; this.refresh(); });
      t.on('pointerup', () => { this.idx = i; this.go(); });
    });
    this.cursor = this.add.text(0, 0, '\u25B6', { ...style, fontSize: '44px' }).setOrigin(1, 0.5);
    this.add.text(640, 668, '\u2191 \u2193  +  ENTER   /   TAP', { fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
    const kb = this.input.keyboard!;
    const mv = (d: number) => { this.idx = (this.idx + d + 3) % 3; this.refresh(); };
    kb.on('keydown-UP', () => mv(-1)); kb.on('keydown-W', () => mv(-1));
    kb.on('keydown-DOWN', () => mv(1)); kb.on('keydown-S', () => mv(1));
    kb.on('keydown-ENTER', () => this.go()); kb.on('keydown-SPACE', () => this.go());
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));
    this.refresh();
    (window as any).__gg.menu = this;
  }
  private onResize() { this.cameras.main.setScroll(-Math.round((this.scale.width - 1280) / 2), 0); }
  private refresh() {
    this.items.forEach((t, i) => t.setColor(i === this.idx ? '#ffe9a8' : '#8f7a5c'));
    const t = this.items[this.idx];
    this.cursor.setPosition(Math.round(t.x - t.width / 2 - 16), t.y);
  }
  go(i?: number) {
    if (this.leaving) return;
    if (i !== undefined) this.idx = i;
    this.leaving = true;
    this.registry.set('menu_idx', this.idx);
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.idx === 2 ? this.scene.start('Mock') : this.scene.start('Select', { mode: this.idx === 1 ? 'fight' : 'drive' }));
  }
}
