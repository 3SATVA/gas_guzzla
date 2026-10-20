import Phaser from 'phaser';

const FONT = { fontFamily: 'monospace', fontStyle: 'bold' };

/** Native 1280x720 overlay (zoom 1) so text stays crisp over the 2x gameplay camera. */
export class HudScene extends Phaser.Scene {
  private dist!: Phaser.GameObjects.Text;
  private dbg!: Phaser.GameObjects.Text;
  private flashR!: Phaser.GameObjects.Rectangle;
  private tot!: Phaser.GameObjects.Container;
  private levels = [0, 0, 0];
  private debugOn = false;

  constructor() { super('Hud'); }

  create() {
    this.cameras.main.setZoom(1).setScroll(0, 0);
    this.flashR = this.add.rectangle(0, 0, 1280, 720, 0xffffff, 1).setOrigin(0).setAlpha(0);
    this.dist = this.add.text(1262, 16, '0000 m', { ...FONT, fontSize: '26px', color: '#f2c27a', stroke: '#000', strokeThickness: 6 }).setOrigin(1, 0);

    // level title card
    const t1 = this.add.text(640, 290, 'LEVEL 1', { ...FONT, fontSize: '64px', color: '#f2c27a', stroke: '#000', strokeThickness: 10 }).setOrigin(0.5);
    const t2 = this.add.text(640, 352, 'SMASH THROUGH. DON\'T GET TOTALED.', { ...FONT, fontSize: '22px', color: '#e8dccb', stroke: '#000', strokeThickness: 6 }).setOrigin(0.5);
    const t3 = this.add.text(640, 700, 'ARROWS / WASD fly   \u2022   ram drones & signs   \u2022   D debug   \u2022   R restart   \u2022   ESC menu', { ...FONT, fontSize: '16px', color: '#d9d2c4', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5, 1);
    this.tweens.add({ targets: [t1, t2], alpha: 0, delay: 2200, duration: 500, onComplete: () => { t1.destroy(); t2.destroy(); } });
    this.tweens.add({ targets: t3, alpha: 0, delay: 6000, duration: 800, onComplete: () => t3.destroy() });

    this.dbg = this.add.text(18, 16, '', { ...FONT, fontSize: '18px', color: '#7CFF9A', stroke: '#000', strokeThickness: 5, lineSpacing: 4 }).setVisible(false);

    const a = this.add.text(640, 320, 'TOTALED', { ...FONT, fontSize: '96px', color: '#e2361f', stroke: '#000', strokeThickness: 14 }).setOrigin(0.5);
    const b = this.add.text(640, 410, 'press R', { ...FONT, fontSize: '30px', color: '#f2c27a', stroke: '#000', strokeThickness: 8 }).setOrigin(0.5);
    this.tot = this.add.container(0, 0, [a, b]).setVisible(false);
    this.debugOn = false;
    this.levels = [0, 0, 0];
  }

  setDistance(m: number) { this.dist?.setText(`${String(m).padStart(4, '0')} m`); this.refreshDebug(); }
  setLevels(l: number[]) { this.levels = l.slice(); this.refreshDebug(); }
  setDebug(on: boolean) { this.debugOn = on; this.dbg?.setVisible(on); this.refreshDebug(); }
  private refreshDebug() {
    if (!this.dbg || !this.debugOn) return;
    const [b, mi, f] = this.levels;
    const bar = (n: number) => '\u2588'.repeat(n) + '\u00B7'.repeat(3 - n);
    const lvl = this.scene.get('Level') as any;
    this.dbg.setText([
      'DAMAGE (D to hide)',
      `FRONT  ${bar(f)} ${f}`,
      `MIDDLE ${bar(mi)} ${mi}`,
      `BACK   ${bar(b)} ${b}`,
      `inv ${lvl?.invuln?.toFixed(2) ?? '-'}  spd ${Math.round(lvl?.speed ?? 0)}  fps ${Math.round(this.game.loop.actualFps)}`,
      `smashed ${lvl?.stats?.smashed ?? 0}  broken ${lvl?.stats?.broken ?? 0}  hits ${lvl?.stats?.hits ?? 0}`,
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
