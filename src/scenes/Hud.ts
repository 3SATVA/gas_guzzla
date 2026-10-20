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

    this.dbg = this.add.text(18, 60, '', { ...FONT, fontSize: '18px', color: '#7CFF9A', stroke: '#000', strokeThickness: 5, lineSpacing: 4 }).setVisible(false);
    const a = this.add.text(W / 2, 320, 'TOTALED', { ...FONT, fontSize: '96px', color: '#e2361f', stroke: '#000', strokeThickness: 14 }).setOrigin(0.5);
    const b = this.add.text(W / 2, 410, 'press R', { ...FONT, fontSize: '30px', color: '#f2c27a', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);
    this.tot = this.add.container(0, 0, [a, b]).setVisible(false);
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
  setLevels(l: number[]) { this.levels = l.slice(); this.refreshDebug(); }
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
  showTotaled() {
    this.tot.setVisible(true).setAlpha(0);
    this.tweens.add({ targets: this.tot, alpha: 1, duration: 200 });
  }
}
