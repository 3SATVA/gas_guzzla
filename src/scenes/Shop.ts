import Phaser from 'phaser';
import { SECTIONS, sectionDrawOrder, Driver } from '../game/damage';

const FONT = { fontFamily: 'monospace', fontStyle: 'bold' };
type View = 'front34' | 'rear34';
const PARTS = [
  { id: 'hook', name: 'HOOK', cost: 0 },
  { id: 'spikes', name: 'SPIKES', cost: 150 },
  { id: 'grappler', name: 'GRAPPLER', cost: 250 },
  { id: 'gun', name: 'MACHINE GUN', cost: 400 },
];
const REPAIR_COST = 15; // scrap hunnids per damage level
const MARGIN = 24, GAP = 56, FLOOR = 700;

/** BODY SHOP mockup. Authored at 1280x720 like the select screen, NO canvas widening / black bars (phase 4): the 3/4 car
 *  layers come from assets/shop_fit/ (each made once from its cleaned master with a Lanczos downscale + light sharpen,
 *  see p4/shop_fit.py) and are composited from the sectional damage layers; the chosen driver stands next to the car at
 *  native size (approved idle sheet, never resampled). */
export class ShopScene extends Phaser.Scene {
  driver: Driver = 'fade';
  view: View = 'front34';
  carLayer!: Phaser.GameObjects.Container;
  scrapT!: Phaser.GameObjects.Text;
  swapB!: Phaser.GameObjects.Text;
  repairB!: Phaser.GameObjects.Text;
  msg!: Phaser.GameObjects.Text;
  slotBs: Phaser.GameObjects.Text[] = [];
  levels = [0, 0, 0];
  scrap = 0;
  bbF: number[] = []; bbR: number[] = []; carLeft = 0; carSlotW = 0; W = 1280;
  drv!: Phaser.GameObjects.Sprite;

  constructor() { super('Shop'); }

  init(data: { driver?: Driver }) {
    this.driver = data?.driver ?? (this.registry.get('driver') === 'seek' ? 'seek' : 'fade');
    this.view = 'front34';
  }

  preload() {
    const loadingT = this.add.text(640, 360, 'OPENING THE BODY SHOP...', { ...FONT, fontSize: '22px', color: '#f2c27a' }).setOrigin(0.5);
    this.load.once('complete', () => loadingT.destroy());
    const d = this.driver;
    for (const v of ['front34', 'rear34'] as View[]) {
      const B = `assets/shop_fit/${d}/${v}/`;
      for (const sec of SECTIONS) for (let l = 0; l <= 3; l++) {
        const k = `shopfit_${d}_${v}_${sec}_${l}`;
        if (!this.textures.exists(k)) this.load.image(k, B + (l === 0 ? `body_sections/${sec}_0.png` : `damage/${sec}_${l}.png`));
      }
      for (const p of ['rear_engine', 'front_gear']) { const k = `shopfit_${d}_${v}_${p}`; if (!this.textures.exists(k)) this.load.image(k, B + p + '.png'); }
    }
  }

  create() {
    // layout: [car (shrunk once from the masters to fit 1280)][clear gap][native driver], centred on the canvas.
    if (!this.cache.json.exists('shopfit')) throw new Error('shopfit meta missing');
    const fit = this.cache.json.get('shopfit')[this.driver];
    const sh = this.cache.json.get('p2').shop[this.driver];
    this.bbF = fit.front34; this.bbR = fit.rear34;
    const carW = Math.max(this.bbF[2] - this.bbF[0], this.bbR[2] - this.bbR[0]);
    const db = sh.driver_bbox, drvW = db[2] - db[0];
    const W = this.scale.width; this.W = W;
    const need = carW + GAP + drvW;
    const left = Math.max(MARGIN, Math.round((W - need) / 2));
    this.carLeft = left; this.carSlotW = carW;
    const cam = this.cameras.main;
    cam.setZoom(1).setBackgroundColor('#000').setScroll(0, 0);
    cam.fadeIn(250, 0, 0, 0);
    this.levels = ((this.registry.get('levels') as number[]) ?? [0, 0, 0]).slice();
    this.scrap = Number(this.registry.get('scrap') ?? 0);
    // garage backdrop (approved select background, 1:1; mirrored copies fill the extra width)
    this.add.image(0, 0, 'sel_bg').setOrigin(0);
    this.add.image(1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.add.rectangle(0, 0, 2560, 720, 0x000000, 0.35).setOrigin(0);

    this.carLayer = this.add.container(0, 0);
    this.drawCar();
    // driver beside the car with clear space (native, approved idle sheet, never resampled)
    const idle = this.driver === 'fade' ? 'sel_fade_idle' : 'sel_seek_idle';
    const fh = this.driver === 'fade' ? 619 : 609;
    this.drv = this.add.sprite(this.carLeft + carW + GAP - db[0], 712 - fh + 7, idle, 0).setOrigin(0).play(idle);
    // UI
    this.add.text(24, 12, 'BODY SHOP', { ...FONT, fontSize: '46px', color: '#ff4fa0', stroke: '#2a0010', strokeThickness: 8 });
    this.add.text(300, 30, `${this.driver.toUpperCase()}'S RIDE  \u2022  MOCKUP`, { ...FONT, fontSize: '16px', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 });
    this.add.sprite(40, 88, 'scrap', 6).setScale(2).play('scrap_3'); // stack of $100 bills, integer 2x
    this.scrapT = this.add.text(66, 74, '', { ...FONT, fontSize: '26px', color: '#ffd76a', stroke: '#000', strokeThickness: 6 });
    this.swapB = this.button(24, 118, '', () => this.swap());
    this.repairB = this.button(24, 166, '', () => this.repair());
    this.button(W - 24, 18, 'CONTINUE \u25B6', () => this.leave(), '#7CFF9A').setOrigin(1, 0);
    this.add.text(24, 232, 'FRONT SLOT:', { ...FONT, fontSize: '18px', color: '#e8dccb', stroke: '#000', strokeThickness: 5 }).setOrigin(0, 0.5);
    this.slotBs = PARTS.map((p, i) => this.button(0, 216, p.name, () => this.buy(i), undefined, 15));
    this.msg = this.add.text(24, 272, '', { ...FONT, fontSize: '20px', color: '#ffe6a8', stroke: '#000', strokeThickness: 6 }).setOrigin(0, 0);
    this.refresh();

    const kb = this.input.keyboard!;
    kb.on('keydown-V', () => this.swap());
    kb.on('keydown-SPACE', () => this.swap());
    kb.on('keydown-R', () => this.repair());
    kb.on('keydown-ENTER', () => this.leave());
    kb.on('keydown-ESC', () => this.leave());
    (window as any).__gg.shop = this;
  }

  button(x: number, y: number, label: string, fn: () => void, color = '#f2c27a', size = 18) {
    const t = this.add.text(x, y, label, { ...FONT, fontSize: `${size}px`, color, backgroundColor: '#1b1210', padding: { x: 10, y: 7 }, stroke: '#000', strokeThickness: 3 })
      .setInteractive({ useHandCursor: true });
    t.on('pointerover', () => t.setBackgroundColor('#3a2216'));
    t.on('pointerout', () => t.setBackgroundColor('#1b1210'));
    t.on('pointerup', fn);
    return t;
  }

  drawCar() {
    this.carLayer.removeAll(true);
    const d = this.driver, v = this.view;
    const bb = v === 'front34' ? this.bbF : this.bbR;
    // right-align each view's bbox to the slot edge next to the driver, so the gap stays the same in both views
    this.carLayer.x = this.carLeft + this.carSlotW - bb[2];
    this.carLayer.y = FLOOR - bb[3];
    for (const o of sectionDrawOrder(this.levels)) this.carLayer.add(this.add.image(0, 0, `shopfit_${d}_${v}_${o.sec}_${o.level}`).setOrigin(0));
    this.carLayer.add(this.add.image(0, 0, `shopfit_${d}_${v}_rear_engine`).setOrigin(0));
    this.carLayer.add(this.add.image(0, 0, `shopfit_${d}_${v}_front_gear`).setOrigin(0));
  }

  refresh() {
    const dmg = this.levels.reduce((a, b) => a + b, 0);
    this.scrapT.setText(`HUNNIDS  ${this.scrap}`);
    this.swapB.setText(`\u21C4 SWAP VIEW:  ${this.view === 'front34' ? 'FRONT 3/4  \u25B8 back' : 'BACK 3/4  \u25B8 front'}   [V]`);
    this.repairB.setText(dmg ? `\u2692 REPAIR  ${dmg} dmg x ${REPAIR_COST} = ${dmg * REPAIR_COST}   [R]` : '\u2692 REPAIR  (no damage)');
    this.repairB.setColor(dmg && this.scrap >= REPAIR_COST ? '#f2c27a' : '#8a7f70');
    const eq = (this.registry.get('frontSlot') as string) ?? 'hook';
    PARTS.forEach((p, i) => {
      const own = p.id === eq;
      this.slotBs[i].setText(own ? `${p.name} \u2714` : `${p.name}  ${p.cost}`);
      this.slotBs[i].setColor(own ? '#7CFF9A' : this.scrap >= p.cost ? '#f2c27a' : '#8a7f70');
    });
    let x = 160;
    for (const b of this.slotBs) { b.setX(x); x += b.width + 10; }
  }

  say(s: string) { this.msg.setText(s).setAlpha(1); this.tweens.killTweensOf(this.msg); this.tweens.add({ targets: this.msg, alpha: 0, delay: 1600, duration: 400 }); }

  swap() { this.view = this.view === 'front34' ? 'rear34' : 'front34'; this.drawCar(); this.refresh(); }

  repair() {
    let fixed = 0;
    while (this.scrap >= REPAIR_COST && this.levels.some((l) => l > 0)) {
      const i = this.levels.indexOf(Math.max(...this.levels));
      this.levels[i]--; this.scrap -= REPAIR_COST; fixed++;
    }
    if (!fixed) { this.say(this.levels.some((l) => l > 0) ? 'NOT ENOUGH HUNNIDS' : 'NOTHING TO FIX'); return; }
    this.say(`FIXED ${fixed} DAMAGE LEVEL${fixed > 1 ? 'S' : ''}  -${fixed * REPAIR_COST}`);
    this.registry.set('levels', this.levels.slice()); this.registry.set('scrap', this.scrap);
    this.drawCar(); this.refresh();
  }

  buy(i: number) {
    const p = PARTS[i];
    if (p.id === 'hook') { this.say('HOOK IS EQUIPPED'); return; }
    this.say(this.scrap >= p.cost ? `${p.name}: COMING SOON (mockup, nothing spent)` : `${p.name}: NEED ${p.cost - this.scrap} MORE HUNNIDS`);
  }

  leave() {
    this.registry.set('levels', this.levels.slice()); this.registry.set('scrap', this.scrap);
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.stop(); this.scene.resume('Level');
    });
  }
}
