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
  private spdG!: Phaser.GameObjects.Graphics;
  private prompt!: Phaser.GameObjects.Text;
  private hint: Phaser.GameObjects.Text | null = null;
  private plate!: Phaser.GameObjects.Graphics;
  private levels = [0, 0, 0];
  private debugOn = false;
  private shownScrap = -1;
  // phase 4: gas gauge + "how totaled" meter (same bold monospace + black stroke style as the scrap counter)
  private gasIcon!: Phaser.GameObjects.Sprite;
  private gasT!: Phaser.GameObjects.Text;
  private gasG!: Phaser.GameObjects.Graphics;
  private dmgT!: Phaser.GameObjects.Text;
  private dmgG!: Phaser.GameObjects.Graphics;
  private icon!: Phaser.GameObjects.Container;
  private iconSec: Phaser.GameObjects.Image[] = [];
  private drv = 'fade';
  private gas = 100; private gasMax = 100; private gasDry = false;
  private spdV = 0; private spdMax = 150;
  private totSub!: Phaser.GameObjects.Text;
  // phase 5 layout: one top strip (wraps to two rows only if it cannot fit). Pixel art is scaled by integers only.
  private L = { phone: false, gas: { x: 0, y: 0, cw: 12, ch: 12, gap: 3, n: 15 }, dmg: { x: 0, y: 0, cw: 22, ch: 12, gap: 3, n: 9 }, spd: { x: 0, y: 0, cw: 10, ch: 12, gap: 3, n: 10 }, iconX: 0, iconY: 0, shortScrap: false, cssScale: 1 };
  private lastKey = '';

  constructor() { super('Hud'); }

  create() {
    const W = this.scale.width;
    this.cameras.main.setZoom(1).setScroll(0, 0);
    this.flashR = this.add.rectangle(0, 0, 1700, 720, 0xffffff, 1).setOrigin(0).setAlpha(0);
    this.plate = this.add.graphics();
    const txt = (color: string) => this.add.text(0, 0, '', { ...FONT, fontSize: '24px', color, stroke: '#000', strokeThickness: 6 });
    this.dist = txt('#f2c27a').setOrigin(1, 0.5).setText('0000 m');
    // hunnids icon = the rubber-banded stack of dirty $100 bills (pickup art, integer 3x nearest)
    this.scrapIcon = this.add.sprite(0, 0, 'scrap', 6).setScale(3).play('scrap_3');
    this.scrapT = txt('#ffd76a').setOrigin(0, 0.5);
    this.spd = txt('#9fd8ff');
    this.spdG = this.add.graphics();
    this.prompt = this.add.text(W / 2, 640, '', { ...FONT, fontSize: '20px', color: '#ffe6a8', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);

    const t1 = this.add.text(W / 2, 290, 'LEVEL 1', { ...FONT, fontSize: '64px', color: '#f2c27a', stroke: '#000', strokeThickness: 10 }).setOrigin(0.5);
    const t2 = this.add.text(W / 2, 352, 'SMASH THROUGH. GRAB HUNNIDS. DON\'T GET TOTALED.', { ...FONT, fontSize: '22px', color: '#e8dccb', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);
    const t3 = this.add.text(W / 2, 700, '\u2191\u2193 / W S fly   \u2022   \u2192 faster   \u2022   \u2190 slow / hover / reverse   \u2022   hover near hunnids to grab   \u2022   R restart   \u2022   ESC menu   \u2022   F full screen', { ...FONT, fontSize: '15px', color: '#d9d2c4', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 1);
    this.hint = t3;
    this.tweens.add({ targets: [t1, t2], alpha: 0, delay: 2200, duration: 500, onComplete: () => { t1.destroy(); t2.destroy(); } });
    this.tweens.add({ targets: t3, alpha: 0, delay: 7000, duration: 800, onComplete: () => { t3.destroy(); this.hint = null; } });

    // ---- GAS: barrel icon (generated art, integer nearest scale) + label + 15-cell bar
    this.gasIcon = this.add.sprite(0, 0, 'barrel', 0).setScale(3);
    this.gasT = txt('#ffb347');
    this.gasG = this.add.graphics();
    // ---- HOW TOTALED: the car itself (64x36 = exact 20:1 of the side masters, cracks per section, shown at 2x) + 9-cell bar
    const lvl = this.scene.get('Level') as any;
    this.drv = lvl?.driver === 'seek' ? 'seek' : 'fade';
    this.iconSec = [0, 1, 2].map(() => this.make.image({ x: 0, y: 0, key: `hud_${this.drv}_back_0`, origin: 0 }, false));
    this.icon = this.add.container(0, 0, [...this.iconSec, this.make.image({ x: 0, y: 0, key: `hud_${this.drv}_rear_engine`, origin: 0 }, false), this.make.image({ x: 0, y: 0, key: `hud_${this.drv}_front_gear`, origin: 0 }, false)]).setScale(2);
    this.dmgT = txt('#e8dccb');
    this.dmgG = this.add.graphics();
    this.gas = 100; this.gasMax = 100; this.gasDry = false;

    this.dbg = this.add.text(18, 190, '', { ...FONT, fontSize: '18px', color: '#7CFF9A', stroke: '#000', strokeThickness: 5, lineSpacing: 4 }).setVisible(false);
    const a = this.add.text(W / 2, 320, 'TOTALED', { ...FONT, fontSize: '96px', color: '#e2361f', stroke: '#000', strokeThickness: 14 }).setOrigin(0.5);
    this.totSub = this.add.text(W / 2, 250, '', { ...FONT, fontSize: '40px', color: '#ffb347', stroke: '#000', strokeThickness: 10 }).setOrigin(0.5);
    const b = this.add.text(W / 2, 410, 'press R', { ...FONT, fontSize: '30px', color: '#f2c27a', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);
    this.tot = this.add.container(0, 0, [this.totSub, a, b]).setVisible(false);
    this.debugOn = false; this.levels = [0, 0, 0]; this.shownScrap = -1; this.lastKey = '';
    this.layout();
    this.scale.on('resize', this.layout, this);
    const onWin = () => this.layout();
    window.addEventListener('resize', onWin);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.scale.off('resize', this.layout, this); window.removeEventListener('resize', onWin); });
  }
  update() {
    // the CSS size can change without a game resize (fullscreen, rotation): re-check a couple of times a second
    if (this.game.loop.frame % 30 === 0) this.layout();
  }
  /** phone (canvas shown at < 0.75 css px per canvas px): bigger text + chunkier bars so text reads at ~16+ css px */
  private layout() {
    const W = this.scale.width;
    const cssScale = (this.game.canvas.getBoundingClientRect().height || 720) / 720;
    const phone = cssScale < 0.75;
    const key = `${W}|${phone}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const L = this.L; L.phone = phone; L.cssScale = cssScale;
    const big = phone ? 32 : 28, lab = phone ? 30 : 24, st = phone ? 7 : 6;
    for (const t of [this.dist, this.scrapT]) t.setFontSize(big).setStroke('#000', st);
    for (const t of [this.gasT, this.dmgT, this.spd]) t.setFontSize(lab).setStroke('#000', st);
    L.gas = phone ? { x: 0, y: 0, cw: 16, ch: 14, gap: 4, n: 15 } : { x: 0, y: 0, cw: 12, ch: 12, gap: 3, n: 15 };
    L.dmg = phone ? { x: 0, y: 0, cw: 30, ch: 14, gap: 4, n: 9 } : { x: 0, y: 0, cw: 22, ch: 12, gap: 3, n: 9 };
    L.spd = phone ? { x: 0, y: 0, cw: 12, ch: 14, gap: 3, n: 10 } : { x: 0, y: 0, cw: 10, ch: 12, gap: 3, n: 10 };
    const barW = (b: { cw: number; gap: number; n: number }) => b.n * (b.cw + b.gap) - b.gap;
    const M = 14, GAPB = phone ? 30 : 26, RH = 76, PAD = 6;
    const measure = (t: Phaser.GameObjects.Text, s: string) => { const o = t.text; t.setText(s); const w = t.width; t.setText(o); return w; };
    const wScrap = (_short: boolean) => 60 + 10 + measure(this.scrapT, 'HUNNIDS 9999');
    const wGas = 42 + 10 + Math.max(barW(L.gas), measure(this.gasT, 'GAS 100% LOW!'));
    const wDmg = 128 + 10 + Math.max(barW(L.dmg), measure(this.dmgT, 'TOTALED 100%'));
    const wSpd = Math.max(barW(L.spd), measure(this.spd, 'REV 50')), wDist = measure(this.dist, '0000 m');
    const wRight = wSpd + 18 + wDist;
    let short = false, rows = 1;
    const total = (sh: boolean) => wScrap(sh) + wGas + wDmg + wRight + 3 * GAPB;
    if (total(false) > W - 2 * M) { short = true; if (total(true) > W - 2 * M) rows = 2; }
    L.shortScrap = short;
    const rowY = (r: number) => PAD + r * RH;
    const block = (x: number, y0: number, iconW: number, t: Phaser.GameObjects.Text, b: { x: number; y: number; ch: number }) => {
      const h = lab + 6 + b.ch, top = y0 + Math.round((RH - h) / 2);
      t.setPosition(x + iconW + 10, top - 4); b.x = x + iconW + 10; b.y = top + lab + 4;
    };
    // row 0: scrap ... right: speed + distance
    let x = M; const y0 = rowY(0), cy0 = y0 + RH / 2;
    this.scrapIcon.setPosition(x + 30, Math.round(cy0)); this.scrapT.setPosition(x + 70, Math.round(cy0));
    x += wScrap(short) + GAPB;
    let x2 = rows === 2 ? M : x; const yr = rowY(rows - 1);
    this.gasIcon.setPosition(x2 + 21, Math.round(yr + RH / 2)); block(x2, yr, 42, this.gasT, L.gas); x2 += wGas + GAPB;
    L.iconX = x2; L.iconY = Math.round(yr + (RH - 72) / 2); this.icon.setPosition(L.iconX, L.iconY); block(x2, yr, 128, this.dmgT, L.dmg);
    this.dist.setPosition(W - M, Math.round(cy0));
    const sx = W - M - wDist - 18 - wSpd;
    block(sx - 10, y0, 0, this.spd, L.spd);
    // translucent strip behind the HUD (keeps it readable, leaves the play area open)
    this.plate.clear().fillStyle(0x000000, 0.4).fillRect(0, 0, W, PAD + rows * RH + 2).fillStyle(0xffd76a, 0.16).fillRect(0, PAD + rows * RH + 2, W, 2);
    // light card behind the car icon so a black car (Seek's) still reads against the dark strip
    this.plate.fillStyle(0x8a7464, 0.5).fillRoundedRect(L.iconX - 4, L.iconY - 2, 136, 76, 6);
    this.dbg.setY(PAD + rows * RH + 16);
    // prompt / hint / totaled overlay
    this.prompt.setFontSize(phone ? 32 : 22).setStroke('#000', phone ? 7 : 6).setPosition(W / 2, phone ? 620 : 640);
    if (this.hint) { let fs = phone ? 24 : 15; this.hint.setFontSize(fs); while (this.hint.width > W - 24 && fs > 10) this.hint.setFontSize(--fs); this.hint.setX(W / 2); }
    this.tot?.list.forEach((o: any) => o.setX(W / 2));
    this.flashR.setSize(W + 40, 720);
    const n = this.shownScrap; this.shownScrap = -2; this.setScrap(Math.max(0, n));
    this.setSpeed(this.spdV, this.spdMax); this.drawGas(); this.drawDamage();
  }

  setDistance(m: number) { this.dist?.setText(`${String(m).padStart(4, '0')} m`); this.refreshDebug(); }
  setLevels(l: number[]) {
    const hit = l.some((v, i) => v > this.levels[i]);
    this.levels = l.slice(); this.refreshDebug(); this.drawDamage();
    if (hit && this.icon) { this.tweens.killTweensOf(this.icon); this.icon.setPosition(this.L.iconX, this.L.iconY); this.tweens.add({ targets: this.icon, x: { from: this.L.iconX + 6, to: this.L.iconX }, duration: 160, ease: 'Bounce.easeOut' }); }
  }
  /** car icon cracks (real damage layers per section) and reddens per section; bar = 9 damage levels */
  private drawDamage() {
    if (!this.dmgG) return;
    const order = [0, 1, 2].map((i) => ({ i, l: this.levels[i] })).sort((a, b) => a.l - b.l || a.i - b.i);
    const SEC = ['back', 'middle', 'front'], RED = [0xffffff, 0xffc8b8, 0xff8f7a, 0xff4a3a];
    order.forEach((o, k) => this.iconSec[k].setTexture(`hud_${this.drv}_${SEC[o.i]}_${o.l}`).setTint(RED[o.l]));
    const n = this.levels.reduce((a, b) => a + b, 0), pct = Math.round((n / 9) * 100);
    this.dmgT.setText(`TOTALED ${pct}%`).setColor(n >= 7 ? '#ff5a4a' : n >= 4 ? '#ffd76a' : '#e8dccb');
    const g = this.dmgG; g.clear();
    const { x: X, y: Y, cw: CW, ch: CH, gap: GAP } = this.L.dmg;
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
    if (refill) { this.tweens.killTweensOf(this.gasIcon); this.gasIcon.setScale(3); this.tweens.add({ targets: this.gasIcon, scale: 4, yoyo: true, duration: 90, onComplete: () => this.gasIcon.setScale(3) }); }
    if (changed || v / max < 0.25) this.drawGas();
  }
  private drawGas() {
    if (!this.gasG) return;
    const f = this.gas / this.gasMax, low = f < 0.25;
    const blinkOn = !low || Math.floor(this.time.now / 260) % 2 === 0;
    this.gasT.setText(this.gasDry ? 'OUT OF GAS!' : low ? `GAS ${Math.ceil(f * 100)}% LOW!` : `GAS ${Math.ceil(f * 100)}%`)
      .setColor(this.gasDry || low ? (blinkOn ? '#ff5a4a' : '#ffd76a') : '#ffb347');
    const g = this.gasG; g.clear();
    const { x: X, y: Y, cw: CW, ch: CH, gap: GAP, n: N } = this.L.gas, lit = Math.ceil(f * N - 0.001);
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
    this.shownScrap = n; this.scrapT.setText(`HUNNIDS ${n}`);
    if (up) this.tweens.add({ targets: this.scrapT, scale: 1.15, yoyo: true, duration: 90, onComplete: () => this.scrapT.setScale(1) });
  }
  setSpeed(v: number, max: number) {
    if (!this.spd) return;
    this.spdV = v; this.spdMax = max;
    const s = Math.abs(v) < 2 ? 'HOVER' : v < 0 ? `REV ${Math.round(-v)}` : `SPD ${Math.round(v)}`;
    if (this.spd.text !== s) this.spd.setText(s);
    const col = Math.abs(v) < 2 ? 0x7cff9a : v < 0 ? 0xff9a6a : 0x9fd8ff;
    this.spd.setColor('#' + col.toString(16).padStart(6, '0'));
    const { x: X, y: Y, cw: CW, ch: CH, gap: GAP, n: N } = this.L.spd, lit = Math.round((Math.abs(v) / max) * N);
    const g = this.spdG; g.clear();
    g.fillStyle(0x000000, 1).fillRect(X - 3, Y - 3, N * (CW + GAP) - GAP + 6, CH + 6);
    for (let i = 0; i < N; i++) {
      g.fillStyle(i < lit ? col : 0x2a2220, 1).fillRect(X + i * (CW + GAP), Y, CW, CH);
      if (i < lit) g.fillStyle(0xffffff, 0.35).fillRect(X + i * (CW + GAP), Y, CW, 2);
    }
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
