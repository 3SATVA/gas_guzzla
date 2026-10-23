import Phaser from 'phaser';

type Id = 'fade' | 'seek';
interface Slot {
  id: Id; cx: number; hit: Phaser.Geom.Rectangle;
  char: Phaser.GameObjects.Sprite; car: Phaser.GameObjects.Sprite; name: Phaser.GameObjects.Image;
  glow?: Phaser.FX.Glow; lit: number;
}

/** Character select, authored at 1280x720 (camera zoom 1). Fade and Seek stand side by side at native size
 * (v2 idles, never resampled); their cars sit smaller behind them (exact 1/2 composites) to read as further back.
 * Used for both the drive select and the fight pick. */
export class SelectScene extends Phaser.Scene {
  private slots: Slot[] = [];
  private index = 0;
  private leaving = false;
  private mode: 'drive' | 'fight' = 'drive';
  private arrow!: Phaser.GameObjects.Text;
  private pool!: Phaser.GameObjects.Image;
  private goTxt!: Phaser.GameObjects.Text;
  private goBox!: Phaser.GameObjects.Rectangle;

  constructor() { super('Select'); }

  init(data: any) { this.mode = data?.mode === 'fight' ? 'fight' : 'drive'; }

  create() {
    const s2 = this.cache.json.get('sel2');
    this.index = this.registry.get(this.mode === 'fight' ? 'fighter' : 'driver') === 'seek' ? 1 : 0;
    this.leaving = false;
    const off = Math.round((this.scale.width - 1280) / 2);
    this.cameras.main.setZoom(1).setScroll(-off, 0).setBackgroundColor('#000');
    this.cameras.main.fadeIn(250, 0, 0, 0);

    this.add.image(0, 0, 'sel_bg').setOrigin(0);
    this.add.image(-1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.add.image(1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));

    const lite = !!this.registry.get('lite');
    const feetY = 712, carBottom = 566;
    const defs: { id: Id; cx: number }[] = [{ id: 'fade', cx: 330 }, { id: 'seek', cx: 952 }];
    // cars (background, smaller = further back), a light haze over them, then the floor light and characters
    const cars = defs.map(({ id, cx }) => {
      const t = this.textures.get('selc_' + id).get(0);
      return this.add.sprite(cx - Math.round(t.width / 2), carBottom - t.height, 'selc_' + id, 0).setOrigin(0).play('selc_' + id);
    });
    this.add.rectangle(-1280, 0, 3840, 720, 0x0b0a10, 0.22).setOrigin(0);
    this.pool = this.add.image(0, 716, 'sel_spot').setOrigin(0.5, 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.45);
    this.slots = defs.map(({ id, cx }, i) => {
      const d = s2[id];
      const ax = d.feet_anchor_screen[0] - d.screen_pos[0], ay = d.feet_anchor_screen[1] - d.screen_pos[1];
      const x = cx - ax, y = feetY - ay; // integer positions, 1:1 pixels
      const char = this.add.sprite(x, y, `sel2_${id}_a`, 0).setOrigin(0).play(`sel2_${id}`);
      const nt = this.textures.get(id === 'fade' ? 'sel_name_fade' : 'sel_name_seek').get();
      const name = this.add.image(cx - Math.round(nt.width / 2), 28, id === 'fade' ? 'sel_name_fade' : 'sel_name_seek').setOrigin(0);
      let glow: Phaser.FX.Glow | undefined;
      if (!lite && char.preFX) glow = char.preFX.addGlow(0xf2c27a, 0, 0, false, 0.25, 8);
      return { id, cx, char, car: cars[i], name, glow, lit: i === this.index ? 1 : 0,
        hit: new Phaser.Geom.Rectangle(x - 20, y, d.frame[0] + 40, d.frame[1]) };
    });

    // ---- UI
    this.add.image(640 - 149, 8, 'sel_logo1').setOrigin(0);
    const title = this.mode === 'fight' ? 'CHOOSE YOUR FIGHTER' : 'SELECT YOUR DRIVER';
    this.add.text(640, 102, title, { fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5, 0);
    this.arrow = this.add.text(0, 76, '\u25BC', { fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 0);
    this.goBox = this.add.rectangle(640, 612, 188, 60, 0x1a1410, 0.85).setStrokeStyle(3, 0xf2c27a);
    this.goTxt = this.add.text(640, 612, '', { fontFamily: 'monospace', fontSize: '26px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5);
    this.add.text(640, 690, '\u25C0 \u25B6 / TAP  CHOOSE    ENTER  GO    ESC  MENU', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5);
    this.add.text(1262, 24, 'MENU \u21A9', { fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0.5);
    this.tweens.add({ targets: this.arrow, y: 82, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.tweens.add({ targets: this.goBox, alpha: 0.6, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    this.refresh(true);

    // ---- input
    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.pick(0));
    kb.on('keydown-A', () => this.pick(0));
    kb.on('keydown-RIGHT', () => this.pick(1));
    kb.on('keydown-D', () => this.pick(1));
    kb.on('keydown-ENTER', () => this.choose());
    kb.on('keydown-SPACE', () => this.choose());
    kb.on('keydown-ESC', () => this.back());

    let downX = 0, downT = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { downX = p.worldX; downT = p.time; });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const dx = p.worldX - downX;
      if (Math.abs(dx) > 60 && p.time - downT < 600) { this.pick(dx < 0 ? 1 : 0); return; }
      if (p.worldY < 64 && p.worldX > 1110) { this.back(); return; }
      if (this.goBox.getBounds().contains(p.worldX, p.worldY)) { this.choose(); return; }
      const i = this.slots.findIndex((s) => s.hit.contains(p.worldX, p.worldY));
      const j = i >= 0 ? i : p.worldX < 640 ? 0 : 1;
      if (j === this.index) this.choose(); else this.pick(j);
    });
    (window as any).__gg.select = this;
  }

  private onResize() { this.cameras.main.setScroll(-Math.round((this.scale.width - 1280) / 2), 0); }

  /** apply the highlight; each slot's `lit` tweens 0..1 */
  private refresh(instant = false) {
    this.goTxt.setText(`${this.mode === 'fight' ? 'FIGHT' : 'DRIVE'} \u25B6`);
    const cur = this.slots[this.index];
    this.arrow.x = cur.cx;
    this.pool.x = cur.cx;
    for (const [i, s] of this.slots.entries()) {
      const to = i === this.index ? 1 : 0;
      this.tweens.killTweensOf(s);
      if (instant) { s.lit = to; this.paint(s); }
      else this.tweens.add({ targets: s, lit: to, duration: 180, ease: 'Sine.out', onUpdate: () => this.paint(s) });
    }
  }

  private paint(s: Slot) {
    const k = s.lit;
    const c = (lo: number, hi: number) => Math.round(lo + (hi - lo) * k);
    const ch = c(0x66, 0xff); s.char.setTint(Phaser.Display.Color.GetColor(ch, ch, c(0x6e, 0xff)));
    const cr = c(0x5a, 0xb8); s.car.setTint(Phaser.Display.Color.GetColor(cr, cr, c(0x64, 0xc0)));
    s.name.setAlpha(0.45 + 0.55 * k);
    if (s.glow) s.glow.outerStrength = 1.6 * k;
  }

  /** select slot i (0 = Fade, 1 = Seek); swipe(dir) kept for older tools */
  pick(i: number) {
    if (this.leaving || i === this.index || i < 0 || i >= this.slots.length) return;
    this.index = i;
    this.refresh();
  }
  swipe(dir: number) { this.pick(this.index + dir); }

  choose() {
    if (this.leaving) return;
    const who = this.slots[this.index].id;
    this.registry.set(this.mode === 'fight' ? 'fighter' : 'driver', who);
    this.leaving = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.mode === 'fight' ? this.scene.start('Fight', { fighter: who }) : this.scene.start('Level'));
  }

  back() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Menu'));
  }
}
