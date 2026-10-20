import Phaser from 'phaser';

const FONT = { fontFamily: 'monospace', fontStyle: 'bold' };

/** Native-resolution overlay (zoom 1) so text stays crisp over the 2x gameplay camera. */
export class HudScene extends Phaser.Scene {
  private dist!: Phaser.GameObjects.Text;
  private dbg!: Phaser.GameObjects.Text;
  private flashR!: Phaser.GameObjects.Rectangle;
  private tot!: Phaser.GameObjects.Container;
  private scrapT!: Phaser.GameObjects.Text;
  private scrapIcon!: Phaser.GameObjects.Sprite;
  private spd!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private levels = [0, 0, 0];
  private debugOn = false;
  private shownScrap = -1;
  // phase 4: gas gauge + "how totalled" meter (same bold monospace + black stroke style as the scrap counter)
  private gasIcon!: Phaser.GameObjects.Sprite;
  private gasT!: Phaser.GameObjects.Text;
  private gasG!: Phaser.GameObjects.Graphics;
  private dmgT!: Phaser.GameObjects.Text;
  private dmgG!: Phaser.GameObjects.Graphics;
  private icon!: Phaser.GameObjects.Container;
  private iconSec: Phaser.GameObjects.Image[] = [];
  private drv = 'fade';
  private gas = 100; private gasMax = 100; private gasDry = false; private gasBlink = 0;
  private totSub!: Phaser.GameObjects.Text;

  constructor() { super('Hud'); }

  create() {
    const W = this.scale.width;
    this.cameras.main.setZoom(1).setScroll(0, 0);
    this.flashR = this.add.rectangle(0, 0, 1700, 720, 0xffffff, 1).setOrigin(0).setAlpha(0);
    this.dist = this.add.text(W - 18, 16, '0000 m', { ...FONT, fontSize: '26px', color: '#f2c27a', stroke: '#000', strokeThickness: 6 }).setOrigin(1, 0);
    this.scrapIcon = this.add.sprite(30, 30, 'scrap', 6).setScale(2).play('scrap_3');
    this.scrapT = this.add.text(54, 16, 'SCRAP HUNNIDS  0', { ...FONT, fontSize: '24px', color: '#ffd76a', stroke: '#000', strokeThickness: 6 });
    this.spd = this.add.text(W - 18, 50, '', { ...FONT, fontSize: '18px', color: '#9fd8ff', stroke: '#000', strokeThickness: 5 }).setOrigin(1, 0);
    this.prompt = this.add.text(W / 2, 640, '', { ...FONT, fontSize: '20px', color: '#ffe6a8', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);

    const t1 = this.add.text(W / 2, 290, 'LEVEL 1', { ...FONT, fontSize: '64px', color: '#f2c27a', stroke: '#000', strokeThickness: 10 }).setOrigin(0.5);
    const t2 = this.add.text(W / 2, 352, 'SMASH THROUGH. GRAB SCRAP. DON\'T GET TOTALED.', { ...FONT, fontSize: '22px', color: '#e8dccb', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);
    const t3 = this.add.text(W / 2, 700, '\u2191\u2193 / W S fly   \u2022   \u2192 faster   \u2022   \u2190 slow / hover / reverse   \u2022   hover near scrap to grab   \u2022   R restart   \u2022   ESC menu   \u2022   F full screen', { ...FONT, fontSize: '15px', color: '#d9d2c4', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 1);
    this.tweens.add({ targets: [t1, t2], alpha: 0, delay: 2200, duration: 500, onComplete: () => { t1.destroy(); t2.destroy(); } });
    this.tweens.add({ targets: t3, alpha: 0, delay: 7000, duration: 800, onComplete: () => t3.destroy() });

    // backing plate for the top-left cluster (keeps the small icons readable on a phone)
    const plate = this.add.graphics().setDepth(-1);
    plate.fillStyle(0x000000, 0.42).fillRect(6, 6, 318, 138);
    plate.fillStyle(0xffd76a, 0.18).fillRect(6, 6, 318, 2);
    // ---- GAS: barrel icon (generated art, 2x nearest) + label + 15-cell bar
    this.gasIcon = this.add.sprite(31, 70, 'barrel', 0).setScale(2);
    this.gasT = this.add.text(60, 52, 'GAS', { ...FONT, fontSize: '20px', color: '#ffb347', stroke: '#000', strokeThickness: 6 });
    this.gasG = this.add.graphics();
    // ---- HOW TOTALLED: the car itself (64x36 = exact 20:1 of the side masters, cracks per section) + 9-cell bar
    const lvl = this.scene.get('Level') as any;
    this.drv = lvl?.driver === 'seek' ? 'seek' : 'fade';
    this.iconSec = [0, 1, 2].map(() => this.make.image({ x: 0, y: 0, key: `hud_${this.drv}_back_0`, origin: 0 }, false));
    this.icon = this.add.container(14, 100, [...this.iconSec, this.make.image({ x: 0, y: 0, key: `hud_${this.drv}_rear_engine`, origin: 0 }, false), this.make.image({ x: 0, y: 0, key: `hud_${this.drv}_front_gear`, origin: 0 }, false)]);
    this.dmgT = this.add.text(86, 102, 'TOTALLED 0%', { ...FONT, fontSize: '18px', color: '#e8dccb', stroke: '#000', strokeThickness: 6 });
    this.dmgG = this.add.graphics();
    this.gas = 100; this.gasMax = 100; this.gasDry = false;
    this.drawGas(); this.drawDamage();

    this.dbg = this.add.text(18, 150, '', { ...FONT, fontSize: '18px', color: '#7CFF9A', stroke: '#000', strokeThickness: 5, lineSpacing: 4 }).setVisible(false);
    const a = this.add.text(W / 2, 320, 'TOTALED', { ...FONT, fontSize: '96px', color: '#e2361f', stroke: '#000', strokeThickness: 14 }).setOrigin(0.5);
    this.totSub = this.add.text(W / 2, 250, '', { ...FONT, fontSize: '40px', color: '#ffb347', stroke: '#000', strokeThickness: 10 }).setOrigin(0.5);
    const b = this.add.text(W / 2, 410, 'press R', { ...FONT, fontSize: '30px', color: '#f2c27a', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);
    this.tot = this.add.container(0, 0, [this.totSub, a, b]).setVisible(false);
    this.debugOn = false; this.levels = [0, 0, 0]; this.shownScrap = -1;
    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.layout, this));
  }
  private layout() {
    const W = this.scale.width;
    this.dist?.setX(W - 18); this.spd?.setX(W - 18); this.prompt?.setX(W / 2);
    this.tot?.list.forEach((o: any) => o.setX(W / 2));
  }

  setDistance(m: number) { this.dist?.setText(`${String(m).padStart(4, '0')} m`); this.refreshDebug(); }
  setLevels(l: number[]) {
    const hit = l.some((v, i) => v > this.levels[i]);
    this.levels = l.slice(); this.refreshDebug(); this.drawDamage();
    if (hit && this.icon) { this.tweens.killTweensOf(this.icon); this.icon.setPosition(14, 100); this.tweens.add({ targets: this.icon, x: { from: 18, to: 14 }, duration: 160, ease: 'Bounce.easeOut' }); }
  }
  /** car icon cracks (real damage layers per section) and reddens per section; bar = 9 damage levels */
  private drawDamage() {
    if (!this.dmgG) return;
    const order = [0, 1, 2].map((i) => ({ i, l: this.levels[i] })).sort((a, b) => a.l - b.l || a.i - b.i);
    const SEC = ['back', 'middle', 'front'], RED = [0xffffff, 0xffc8b8, 0xff8f7a, 0xff4a3a];
    order.forEach((o, k) => this.iconSec[k].setTexture(`hud_${this.drv}_${SEC[o.i]}_${o.l}`).setTint(RED[o.l]));
    const n = this.levels.reduce((a, b) => a + b, 0), pct = Math.round((n / 9) * 100);
    this.dmgT.setText(`TOTALLED ${pct}%`).setColor(n >= 7 ? '#ff5a4a' : n >= 4 ? '#ffd76a' : '#e8dccb');
    const g = this.dmgG; g.clear();
    const X = 86, Y = 126, CW = 22, CH = 10, GAP = 3;
    g.fillStyle(0x000000, 1).fillRect(X - 3, Y - 3, 9 * (CW + GAP) - GAP + 6, CH + 6);
    for (let i = 0; i < 9; i++) {
      const on = i < n, col = i < 3 ? 0xffd76a : i < 6 ? 0xff9a3a : 0xe2361f;
      g.fillStyle(on ? col : 0x2a2220, 1).fillRect(X + i * (CW + GAP), Y, CW, CH);
      if (on) g.fillStyle(0xffffff, 0.35).fillRect(X + i * (CW + GAP), Y, CW, 2);
    }
  }
  setGas(v: number, max: number, dry: boolean, refill = false) {
    if (!this.gasG) return;
    const changed = Math.round((v / max) * 60) !== Math.round((this.gas / this.gasMax) * 60) || dry !== this.gasDry || refill;
    this.gas = v; this.gasMax = max; this.gasDry = dry;
    if (refill) { this.tweens.killTweensOf(this.gasIcon); this.gasIcon.setScale(2); this.tweens.add({ targets: this.gasIcon, scale: 3, yoyo: true, duration: 90, onComplete: () => this.gasIcon.setScale(2) }); }
    if (changed || v / max < 0.25) this.drawGas();
  }
  private drawGas() {
    const f = this.gas / this.gasMax, low = f < 0.25;
    const blinkOn = !low || Math.floor(this.time.now / 260) % 2 === 0;
    this.gasT.setText(this.gasDry ? 'OUT OF GAS!' : low ? `GAS ${Math.ceil(f * 100)}%  LOW!` : `GAS ${Math.ceil(f * 100)}%`)
      .setColor(this.gasDry || low ? (blinkOn ? '#ff5a4a' : '#ffd76a') : '#ffb347');
    const g = this.gasG; g.clear();
    const X = 60, Y = 78, CW = 12, CH = 10, GAP = 3, N = 15, lit = Math.ceil(f * N - 0.001);
    g.fillStyle(0x000000, 1).fillRect(X - 3, Y - 3, N * (CW + GAP) - GAP + 6, CH + 6);
    for (let i = 0; i < N; i++) {
      const on = i < lit, col = f < 0.25 ? (blinkOn ? 0xe2361f : 0x7a1a10) : f < 0.5 ? 0xffd76a : 0xffb347;
      g.fillStyle(on ? col : 0x2a2220, 1).fillRect(X + i * (CW + GAP), Y, CW, CH);
      if (on) g.fillStyle(0xffffff, 0.35).fillRect(X + i * (CW + GAP), Y, CW, 2);
    }
  }
  setScrap(n: number) {
    if (!this.scrapT || n === this.shownScrap) return;
    const up = n > this.shownScrap && this.shownScrap >= 0;
    this.shownScrap = n; this.scrapT.setText(`SCRAP HUNNIDS  ${n}`);
    if (up) this.tweens.add({ targets: this.scrapT, scale: 1.15, yoyo: true, duration: 90 });
  }
  setSpeed(v: number, max: number) {
    if (!this.spd) return;
    const s = Math.abs(v) < 2 ? 'HOVER' : v < 0 ? `REVERSE ${Math.round(-v)}` : `${Math.round(v)}`;
    const bars = Math.round((Math.max(0, v) / max) * 10);
    this.spd.setText(`SPD ${s}  ${'\u2588'.repeat(bars)}${'\u00B7'.repeat(10 - bars)}`);
    this.spd.setColor(Math.abs(v) < 2 ? '#7CFF9A' : v < 0 ? '#ff9a6a' : '#9fd8ff');
  }
  setPrompt(s: string) { if (this.prompt && this.prompt.text !== s) this.prompt.setText(s); }
  setDebug(on: boolean) { this.debugOn = on; this.dbg?.setVisible(on); this.refreshDebug(); }
  private refreshDebug() {
    if (!this.dbg || !this.debugOn) return;
    const [b, mi, f] = this.levels;
    const bar = (n: number) => '\u2588'.repeat(n) + '\u00B7'.repeat(3 - n);
    const lvl = this.scene.get('Level') as any;
    this.dbg.setText([
      'DAMAGE (G to hide)',
      `FRONT  ${bar(f)} ${f}`,
      `MIDDLE ${bar(mi)} ${mi}`,
      `BACK   ${bar(b)} ${b}`,
      `inv ${lvl?.invuln?.toFixed(2) ?? '-'}  spd ${Math.round(lvl?.speed ?? 0)}  fps ${Math.round(this.game.loop.actualFps)}`,
      `smashed ${lvl?.stats?.smashed ?? 0}  broken ${lvl?.stats?.broken ?? 0}  hits ${lvl?.stats?.hits ?? 0}  grabbed ${lvl?.stats?.grabbed ?? 0}  stolen ${lvl?.stats?.stolen ?? 0}  drone-wall ${lvl?.stats?.droneWall ?? 0}`,
    ].join('\n'));
  }
  flash(alpha = 0.55) {
    this.tweens.killTweensOf(this.flashR);
    this.flashR.setAlpha(alpha);
    this.tweens.add({ targets: this.flashR, alpha: 0, duration: 150, ease: 'Quad.easeOut' });
  }
  showTotaled(why: 'wreck' | 'gas' = 'wreck') {
    this.totSub.setText(why === 'gas' ? 'OUT OF GAS' : '');
    this.tot.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.tot, alpha: 1, duration: 200 });
  }
}
