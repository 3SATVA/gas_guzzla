import Phaser from 'phaser';
import { applyHit, sectionDrawOrder, sectionKey, SECTIONS, carPrefix, currentDriver, Driver } from '../game/damage';
import { maskOf, solidAt, Mask, dropMask } from '../game/mask';
import { Rng } from '../game/rng';
import type { HudScene } from './Hud';

// Gameplay is authored at 360 rows and drawn at 2x (camera zoom 2). The view is VW wide (640..840, follows the
// screen aspect) and the camera now follows the car vertically through a world that is 2 screens tall:
//   y -540..-360  TRAFFIC CEILING (phase 4): lanes get denser / faster / gapless toward the top = no way over it
//   y -360..-170  traffic band (Tesla lanes with Frogger gaps, tops of the towers)
//   y -170..100   middle band (tunnels through black silhouette blocks, skybridges, gaps)
//   y  100..200+  street band (dense breakables / debris, best scrap)
let VW = 640;
const VH = 360, TOP_Y = -540, BAND_TOP = -360;
const GROUND_Y = 200;
const CAR_W = 128, CAR_H = 72, CAR_CX = 64, CAR_CY = 36;
const RIG_W = 176, RIG_H = 104, RIG_CX = 88, RIG_CY = 52;
const MAX_SPEED = 150, START_SPEED = 95, REV_SPEED = -MAX_SPEED / 3;
const M = 40;
// note 5 + phase 5: AI-driven Teslas on straight RAILS. Every car in a lane sits exactly on the lane line (no bob, no
// random y), all cars in a lane share one constant speed, and they run in a fixed repeating convoy pattern:
// n cars spaced s px apart (centre to centre), then a gap of G px to the next convoy (lower lanes: Frogger gaps).
interface Lane { y: number; v: number; s: number; n: number; G: number; ceil: boolean; }
const BASE_LANES: Lane[] = [
  { y: -346, v: -150, s: 80, n: 4, G: 300 }, // oncoming (faces left)
  { y: -324, v: 74, s: 84, n: 3, G: 320 },   // same direction (faces right)
  { y: -302, v: -126, s: 86, n: 3, G: 360 },
  { y: -280, v: 60, s: 88, n: 2, G: 380 },
  { y: -256, v: -108, s: 90, n: 2, G: 440 },
  { y: -228, v: 86, s: 90, n: 1, G: 520 },
  { y: -192, v: -96, s: 90, n: 1, G: 760 },
].map((l) => ({ ...l, ceil: false }));
// phase 4 TRAFFIC CEILING: 10 more lanes stacked every 18 px above the old top (Teslas are 16 px tall). Going up, every
// lane is faster, its convoys longer and tighter, and the gap between convoys shrinks below the car's length -> a
// solid wall at the top.
const CEIL_LANES: Lane[] = Array.from({ length: 10 }, (_, i) => {
  const t = i / 9, lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return { y: -366 - i * 18, v: (i % 2 ? 1 : -1) * lerp(165, 290), s: lerp(72, 62), n: lerp(4, 40), G: lerp(200, 64), ceil: true };
});
const LANES: Lane[] = [...BASE_LANES, ...CEIL_LANES];
// phase 4 GAS (units: tank = 100)
const GAS_MAX = 100, GAS_BASE = 0.9, GAS_BOOST = 0.9, GAS_CLIMB = 1.6, GAS_LOW = 25;
const BARREL_GAP: [number, number] = [1100, 1700];
// phase 4 drones: fewer
const DRONE_MAX = 2, DRONE_EVERY: [number, number] = [5.5, 8.5], DRONE_FIRST = 6;
const SHOP_FIRST = 2400, SHOP_EVERY = 5600, SHOP_W = 236;

/** Obstacle tags (phase 4):
 *   'solid'     HURTS  - thick walls / buildings / overhang decks / black silhouette blocks / the street
 *   'breakable' SAFE   - street props from the manifest (billboard, antenna mast, hanging sign, signal tower, street
 *                         sign, thin wall/fence, cable span): smash through them, the car takes NO damage
 *   'thin'      SAFE   - thin bits (antenna, pole, pipe, cable, wire): they SNAP, spark and fall away, NO damage
 *  Drones and Tesla traffic (not obstacles) also HURT. */
type Kind = 'solid' | 'breakable' | 'thin';
type ThinKind = 'antenna' | 'pole' | 'pipe' | 'cable' | 'wire';
interface Obstacle {
  kind: Kind; name: string; x: number; y: number; w: number; h: number;
  img: Phaser.GameObjects.Image | null; mask: Mask | null; broken: boolean; tall?: boolean;
  thin?: ThinKind; key?: string; parent?: Obstacle;
}
interface Barrel { spr: Phaser.GameObjects.Sprite; glow: Phaser.GameObjects.Image; wx: number; y: number; value: number; taken: boolean; zone: string; ph: number; }
interface Falling { spr: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle; x: number; y: number; vx: number; vy: number; vr: number; g: number; life: number; life0: number; }
type DType = 'security' | 'gang';
interface Drone { type: DType; spr: Phaser.GameObjects.Sprite; wx: number; y: number; vx: number; vy: number; hp: number; mode: 'chase' | 'scrap' | 'flee'; target?: Scrap; w: number; h: number; dead: boolean; t: number; stun: number; }
interface Traffic { spr: Phaser.GameObjects.Image; key: string; lane: number; wx: number; y: number; v: number; w: number; h: number; dead: boolean; margin: number; }
interface Scrap { spr: Phaser.GameObjects.Sprite; wx: number; y: number; value: number; taken: boolean; ph?: number; }
interface Particle { spr: Phaser.GameObjects.Image; x: number; y: number; vx: number; vy: number; g: number; life: number; flip: number; }
interface Contact { n: number; sx: number; sy: number; }
interface Strip { imgs: Phaser.GameObjects.Image[]; w: number; f: number; fy: number; y0: number; }
interface Preview { img: Phaser.GameObjects.Image; wx: number; }
interface Shop { x: number; used: boolean; sign: Phaser.GameObjects.Text; }

export class LevelScene extends Phaser.Scene {
  m: any; p2: any;
  driver: Driver = 'fade';
  cp: any; P = 'sm_fade';
  rng!: Rng;
  hud!: HudScene;
  scroll = 0; speed = START_SPEED; elapsed = 0; hoverLock = 0;
  camY = 0;
  bg: Strip[] = [];
  ground!: Strip;
  groundHm: number[] = []; groundStep = 4;
  obstacles: Obstacle[] = [];
  drones: Drone[] = [];
  traffic: Traffic[] = [];
  scraps: Scrap[] = [];
  particles: Particle[] = [];
  previews: Preview[] = [];
  shops: Shop[] = [];
  barrels: Barrel[] = []; falling: Falling[] = []; nextBarrel = 900;
  gas = GAS_MAX; dry = 0; dead: 'wreck' | 'gas' = 'wreck';
  nextX = 0; nextDrone = 0; nextShop = SHOP_FIRST; texN = 0;
  laneState = LANES.map(() => ({ k: 0 }));
  laneDots: Phaser.GameObjects.TileSprite[] = [];
  // player rig
  car!: Phaser.GameObjects.Image;
  rig!: Phaser.GameObjects.Container;
  carRT!: Phaser.Textures.DynamicTexture;
  secImgs: Phaser.GameObjects.Image[] = [];
  engRig!: Phaser.GameObjects.Container; flame!: Phaser.GameObjects.Sprite; engine!: Phaser.GameObjects.Image;
  gearRig!: Phaser.GameObjects.Container; gear!: Phaser.GameObjects.Image;
  seat!: Phaser.GameObjects.Image;
  carPts: { x: number; y: number }[] = [];
  carBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  sx = 70; py = 110; vx = 0; vy = 0; tilt = 0;
  levels = [0, 0, 0];
  scrap = 0;
  invuln = 0; hitStop = 0;
  engAng = 0; engExt = 0; sprX = 0; sprV = 0; lastVy = 0;
  arm: { st: 'idle' | 'reach' | 'retract'; t: number; dur: number; target: Scrap | null } = { st: 'idle', t: 0, dur: 0.3, target: null };
  seatFace = 0; seatT = 0; nearT = 0;
  shopHold = 0;
  wind: { img: Phaser.GameObjects.Image; x: number; y0: number; k: number; a: number; w: number }[] = [];
  fog: { img: Phaser.GameObjects.Image; x: number; row: number }[] = [];
  windV = 0;
  state: 'play' | 'totaled' | 'shop' = 'play';
  totaledT = 0; deadVy = 0;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  touch: { x: number; y: number } | null = null;
  autopilot: ((s: LevelScene) => { ix: number; iy: number }) | null = null;
  debug = false;
  dbg!: Phaser.GameObjects.Graphics;
  stats = { smashed: 0, broken: 0, hits: 0, grabbed: 0, stolen: 0, droneWall: 0, snapped: 0, barrels: 0 };
  noSpawn = false; noEnemies = false;
  lastIx = 0;

  constructor() { super('Level'); }

  get VW() { return VW; }

  create() {
    this.m = this.cache.json.get('manifest');
    this.p2 = this.cache.json.get('p2');
    VW = Math.round(this.scale.width / 2);
    const q = new URLSearchParams(location.search);
    this.rng = new Rng(Number(q.get('seed')) || (Date.now() & 0xffffff));
    this.noSpawn = q.get('nospawn') === '1';
    this.noEnemies = q.get('noenemies') === '1';
    this.driver = currentDriver(this.registry);
    this.cp = this.p2[this.driver];
    this.P = carPrefix(this.driver);
    this.scroll = 0; this.speed = START_SPEED; this.elapsed = 0; this.hoverLock = 0; this.camY = 0;
    this.obstacles = []; this.drones = []; this.traffic = []; this.scraps = []; this.particles = []; this.previews = []; this.shops = []; this.bg = [];
    this.levels = (this.registry.get('levels') as number[] | undefined)?.slice() ?? [0, 0, 0];
    if (this.levels.every((l) => l >= 3)) this.levels = [0, 0, 0];
    this.scrap = Number(this.registry.get('scrap') ?? 0);
    this.invuln = 0; this.hitStop = 0; this.state = 'play'; this.totaledT = 0;
    this.sx = 70; this.py = 100; this.vx = 0; this.vy = 0; this.tilt = 0;
    this.stats = { smashed: 0, broken: 0, hits: 0, grabbed: 0, stolen: 0, droneWall: 0, snapped: 0, barrels: 0 };
    this.nextX = 700; this.nextDrone = DRONE_FIRST; this.nextShop = SHOP_FIRST;
    this.barrels = []; this.falling = []; this.nextBarrel = 900; this.gas = GAS_MAX; this.dry = 0; this.dead = 'wreck';
    if (q.get('gas')) this.gas = Phaser.Math.Clamp(Number(q.get('gas')), 0, GAS_MAX);
    this.laneState = LANES.map((ln) => ({ k: this.rng.int(0, ln.n - 1) }));
    this.arm = { st: 'idle', t: 0, dur: 0.3, target: null };
    this.anims.globalTimeScale = 1;

    const cam = this.cameras.main;
    cam.setOrigin(0, 0).setZoom(2).setScroll(0, 0).setRoundPixels(true).setBackgroundColor('#1e1919');
    cam.fadeIn(300, 0, 0, 0);

    // ---- parallax: sky .1, far .25, [preview towers], mid .5, near walls .7 (new), near shacks .8
    const L = this.m.parallax.layers;
    const fy = [0.1, 0.25, 0.5, 0.8];
    L.forEach((l: any, i: number) => {
      const key = ['bg_a', 'bg_b', 'bg_c', 'bg_d'][i];
      const depth = [0, 1, 3, 5][i];
      this.bg.push(this.makeStrip(key, l.y, l.size[0], l.speed_factor, fy[i], depth));
    });
    // note 2: near wall = generated graffiti tenements (reference: Michael's GASGUZLA/background.jpg), native size, with gaps
    const nw = this.p2.near_wall;
    this.bg.push(this.makeStrip('p3_near_wall', -360, nw.size[0], 0.68, 0.68, 4));
    this.makeWind();
    const gs = this.m.collision_layer.pieces.ground_strip;
    this.groundHm = gs.heightmap_top_y; this.groundStep = gs.heightmap_step;
    this.ground = this.makeStrip('ground_strip', GROUND_Y, gs.size[0], 1, 1, 12);

    // ---- player rig: sections (sorted by level) -> engine pod on struts (+ anti-grav glow) -> front arm -> driver (open seat)
    this.rig = this.make.container({ x: 0, y: 0 }, false);
    this.secImgs = [];
    for (let i = 0; i < 3; i++) this.secImgs.push(this.make.image({ x: -CAR_CX, y: -CAR_CY, key: sectionKey(SECTIONS[i], 0, this.driver), origin: 0 }, false));
    const ep = this.cp.engine_pivot, gp = this.cp.gear_pivot, nz = this.cp.engine_nozzle, ga = this.cp.glow.anchor;
    this.engRig = this.make.container({ x: -CAR_CX + ep[0], y: -CAR_CY + ep[1] }, false);
    this.flame = this.make.sprite({ x: nz[0] - ep[0] - ga[0] + 2, y: nz[1] - ep[1] - ga[1], key: `${this.P}_flame`, origin: 0 }, false);
    this.flame.play(`${this.P}_flame`);
    this.engine = this.make.image({ x: -ep[0], y: -ep[1], key: `${this.P}_rear_engine`, origin: 0 }, false);
    this.engRig.add([this.flame, this.engine]);
    this.gearRig = this.make.container({ x: -CAR_CX + gp[0], y: -CAR_CY + gp[1] }, false);
    this.gear = this.make.image({ x: -gp[0], y: -gp[1], key: `${this.P}_front_gear`, origin: 0 }, false);
    this.gearRig.add(this.gear);
    const st = this.cp.driver_seat;
    this.seat = this.make.image({ x: -CAR_CX + st[0], y: -CAR_CY + st[1], key: `${this.P}_driver`, frame: 0, origin: 0 }, false);
    this.rig.add([...this.secImgs, this.engRig, this.gearRig, this.seat]);
    const rtKey = 'car_rt_p2';
    const rt = this.textures.exists(rtKey) ? (this.textures.get(rtKey) as Phaser.Textures.DynamicTexture) : this.textures.addDynamicTexture(rtKey, RIG_W, RIG_H)!;
    rt.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.carRT = rt;
    this.car = this.add.image(0, 0, rtKey).setOrigin(0).setDepth(30);
    this.applySectionTextures();
    this.buildCarPoints();
    this.dbg = this.add.graphics().setDepth(100);

    // ---- input
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,S,D,R,ENTER,ESC,SHIFT,G,B') as any;
    kb.on('keydown-G', () => { this.debug = !this.debug; this.hud?.setDebug(this.debug); });
    kb.on('keydown-R', () => this.restart());
    kb.on('keydown-ESC', () => this.toSelect());
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.state === 'totaled' && this.totaledT > 1.2) { this.restart(); return; }
      this.touch = { x: p.x / 2, y: p.y / 2 };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) this.touch = { x: p.x / 2, y: p.y / 2 }; });
    this.input.on('pointerup', () => (this.touch = null));
    this.scale.on('resize', this.onResize, this);

    this.scene.launch('Hud');
    this.hud = this.scene.get('Hud') as HudScene;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.scene.stop('Hud'); this.rig.destroy(); this.secImgs = [];
      for (let i = 0; i < this.texN; i++) if (this.textures.exists(`p2_sil_${i}`)) this.textures.remove(`p2_sil_${i}`);
      this.texN = 0;
    });
    this.events.on(Phaser.Scenes.Events.RESUME, (_s: any, data: any) => this.onShopClosed(data));

    this.generateUntil(VW + 500);
    (window as any).__gg.level = this;
    this.time.delayedCall(50, () => { this.hud?.setLevels(this.levels); this.hud?.setScrap(this.scrap); this.hud?.setGas(this.gas, GAS_MAX, false); });
    if (!this.textures.exists('p4_glow')) {
      const ct = this.textures.createCanvas('p4_glow', 20, 8)!; const g = ct.getContext(); const im = g.createImageData(20, 8);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 20; x++) { const dx = (x - 9.5) / 9.5, dy = (y - 3.5) / 3.5, a = Math.max(0, 1 - (dx * dx + dy * dy)); const i = (y * 20 + x) * 4; im.data[i] = 255; im.data[i + 1] = 176; im.data[i + 2] = 72; im.data[i + 3] = Math.round(200 * a * a); }
      g.putImageData(im, 0, 0); ct.refresh();
    }
    if (q.get('scene') === 'shop' && !this.registry.get('shopOpened')) { this.registry.set('shopOpened', true); this.time.delayedCall(400, () => this.openShop()); }
  }

  onResize() { VW = Math.round(this.scale.width / 2); }

  // ------------------------------------------------------------------ backgrounds
  makeStrip(key: string, y: number, w: number, f: number, fy: number, depth: number): Strip {
    const n = Math.ceil((840 + 2 * M) / w) + 2;
    const imgs = [];
    for (let i = 0; i < n; i++) imgs.push(this.add.image(0, y, key).setOrigin(0).setScrollFactor(0).setDepth(depth));
    return { imgs, w, f, fy, y0: y };
  }
  placeStrip(st: Strip, sc: number, scy: number) {
    const off = ((Math.floor(sc * st.f) % st.w) + st.w) % st.w;
    let x0 = -off;
    if (x0 > -M) x0 -= st.w;
    const y = st.y0 - Math.round(scy * st.fy);
    st.imgs.forEach((im, i) => { im.x = x0 + i * st.w; im.y = y; });
  }
  /** SPEED WIND: soft haze wisps + a drifting fog band between the near wall and the cars/player. Procedural soft alpha,
   *  drawn at native size (never scaled). They stream past faster the faster you go, settle to almost still at a hover
   *  stop and drift backward when reversing. Kept faint for readability. */
  makeWind() {
    const mk = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
      if (this.textures.exists(key)) return;
      const ct = this.textures.createCanvas(key, w, h)!; draw(ct.getContext()); ct.refresh();
    };
    const wisp = (w: number, h: number, seed: number) => (g: CanvasRenderingContext2D) => {
      const r = new Rng(seed); const img = g.createImageData(w, h);
      const ph = r.range(0, 6.28), bend = r.range(-0.35, 0.35);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const env = Math.pow(Math.sin(Math.PI * u), 1.6) * (0.75 + 0.25 * Math.sin(u * 9 + ph)); // tapered both ends, slightly lumpy
        const cy = h / 2 + bend * h * (u - 0.5) * 2 * (u - 0.5);
        for (let y = 0; y < h; y++) {
          const d = (y - cy) / (h * 0.28);
          const a = env * Math.exp(-d * d);
          const i = (y * w + x) * 4;
          img.data[i] = 236; img.data[i + 1] = 206; img.data[i + 2] = 172; img.data[i + 3] = Math.round(255 * a);
        }
      }
      g.putImageData(img, 0, 0);
    };
    mk('p3_wisp_0', 150, 10, wisp(150, 10, 11));
    mk('p3_wisp_1', 240, 14, wisp(240, 14, 22));
    mk('p3_wisp_2', 340, 18, wisp(340, 18, 33));
    mk('p3_wisp_3', 110, 8, wisp(110, 8, 44));
    // fog band: soft lumpy haze, tiles horizontally (wraps at the edges)
    mk('p3_fog', 512, 120, (g) => {
      const W = 512, H = 120, img = g.createImageData(W, H); const r = new Rng(909);
      const blobs = Array.from({ length: 26 }, () => ({ x: r.range(0, W), y: r.range(30, 90), rx: r.range(40, 110), ry: r.range(12, 30), a: r.range(0.4, 1) }));
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let a = 0;
        for (const b of blobs) for (const ox of [-W, 0, W]) { const dx = (x - b.x - ox) / b.rx, dy = (y - b.y) / b.ry; a += b.a * Math.exp(-(dx * dx + dy * dy)); }
        const i = (y * W + x) * 4; img.data[i] = 214; img.data[i + 1] = 170; img.data[i + 2] = 132; img.data[i + 3] = Math.round(255 * Math.min(1, a) * Math.min(1, Math.sin((Math.PI * y) / H) * 1.4));
      }
      g.putImageData(img, 0, 0);
    });
    this.wind = [];
    const r = this.rng;
    for (let i = 0; i < 18; i++) {
      const k = r.int(0, 3);
      const img = this.add.image(0, 0, `p3_wisp_${k}`).setOrigin(0, 0.5).setScrollFactor(0).setDepth(5.5);
      this.wind.push({ img, x: r.range(-200, 900), y0: r.range(-340, 330), k: r.range(0.95, 1.6), a: r.range(0.55, 1), w: img.width });
    }
    this.fog = [0, 1, 2, 3, 4, 5].map((i) => ({ img: this.add.image(0, 0, 'p3_fog').setOrigin(0).setScrollFactor(0).setDepth(5.5), x: (i % 3) * 512 + (i >= 3 ? 256 : 0), row: i >= 3 ? 1 : 0 }));
    this.windV = this.speed;
  }
  updateWind(dt: number, scy: number) {
    // smoothed speed so the haze eases in and out (hover = almost still, reverse = drifts back)
    this.windV += (this.speed - this.windV) * (1 - Math.exp(-dt * 2.2));
    const v = this.windV, sp = Math.min(1, Math.abs(v) / MAX_SPEED);
    const drift = -4; // a whisper of air movement even at a dead hover
    const span = VW + 420;
    for (const w of this.wind) {
      w.x += (-v * w.k + drift) * dt;
      if (w.x < -w.w - 20) w.x += span; else if (w.x > VW + 400) w.x -= span;
      const y = ((((w.y0 - scy * 0.85 + 360) % 720) + 720) % 720) - 360; // world-ish vertical parallax, wraps over the 2-screen world
      w.img.setPosition(Math.round(w.x), Math.round(y + 0));
      w.img.setAlpha(0.3 * w.a * (0.12 + 0.88 * sp));
    }
    for (const f of this.fog) {
      f.x += (-v * 0.75 + drift * 0.5) * dt;
      while (f.x < -512) f.x += 3 * 512; while (f.x > 3 * 512 - 512) f.x -= 3 * 512;
      f.img.setPosition(Math.round(f.x), Math.round(150 + f.row * 140 - scy * 0.8));
      f.img.setAlpha(0.12 * (0.4 + 0.6 * sp));
    }
  }

  restart() { this.registry.set('levels', [0, 0, 0]); this.scene.restart(); }
  toSelect() { this.scene.stop('Hud'); this.scene.start('Select'); }

  // ------------------------------------------------------------------ car layers
  applySectionTextures() {
    const order = sectionDrawOrder(this.levels);
    order.forEach((o, i) => this.secImgs[i].setTexture(sectionKey(o.sec, o.level, this.driver)));
    this.seat.setVisible(this.levels[1] >= 2); // note 20: door/middle smashed off -> driver visible in the seat
  }
  buildCarPoints() {
    const mk = maskOf(this, `${this.P}_composite`);
    this.carPts = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let y = 0; y < mk.h; y += 2) for (let x = 0; x < mk.w; x += 2) {
      if (mk.a[y * mk.w + x]) { this.carPts.push({ x, y }); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    }
    this.carBox = { x0, y0, x1, y1 };
  }
  get px() { return this.scroll + this.sx; }
  sectionAtLocalX(lx: number): number {
    const r = this.cp.section_x;
    if (lx < r.middle) return 0;
    if (lx < r.front) return 1;
    return 2;
  }

  // ------------------------------------------------------------------ level generation
  groundTopAt(wx: number) {
    const n = this.groundHm.length * this.groundStep;
    const lx = ((Math.floor(wx) % n) + n) % n;
    return GROUND_Y + this.groundHm[Math.floor(lx / this.groundStep)];
  }
  groundMin(x0: number, x1: number) { let m = 1e9; for (let x = x0; x <= x1; x += 4) m = Math.min(m, this.groundTopAt(x)); return m; }
  groundMax(x0: number, x1: number) { let m = -1e9; for (let x = x0; x <= x1; x += 4) m = Math.max(m, this.groundTopAt(x)); return m; }

  addPiece(name: string, x: number, y: number, depth: number): Obstacle {
    const p = this.m.collision_layer.pieces[name];
    const img = this.add.image(Math.round(x), Math.round(y), name).setOrigin(0).setDepth(depth);
    const o: Obstacle = { kind: p.tag, name, x: Math.round(x), y: Math.round(y), w: p.size[0], h: p.size[1], img, mask: maskOf(this, name), broken: false };
    this.obstacles.push(o);
    const th = this.p2.thin?.[name]?.thin as any[] | undefined;
    th?.forEach((t, i) => {
      const key = `${name}_thin_${i}`;
      const kind: ThinKind = t.kind === 'pole' ? (t.y < 12 ? 'antenna' : 'pole') : t.kind;
      this.addThin(key, o.x + t.x, o.y + t.y, t.w, t.h, kind, depth, o);
    });
    return o;
  }
  addThin(key: string, x: number, y: number, w: number, h: number, kind: ThinKind, depth: number, parent?: Obstacle): Obstacle {
    const img = this.add.image(Math.round(x), Math.round(y), key).setOrigin(0).setDepth(depth);
    const o: Obstacle = { kind: 'thin', name: key, key, x: Math.round(x), y: Math.round(y), w, h, img, mask: maskOf(this, key), broken: false, thin: kind, parent };
    this.obstacles.push(o);
    return o;
  }
  /** procedural black thin bit (roof antenna, tunnel cable / wire) on its own canvas so it can snap off on its own */
  addThinProc(x: number, y: number, w: number, h: number, kind: ThinKind, draw: (g: CanvasRenderingContext2D) => void, depth = 11) {
    const key = `p2_sil_${this.texN++}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    dropMask(key);
    const ct = this.textures.createCanvas(key, w, h)!; const g = ct.getContext(); g.fillStyle = '#000'; draw(g); ct.refresh();
    ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
    return this.addThin(key, x, y, w, h, kind, depth);
  }
  /** Pure black silhouette block (tower / tunnel / skybridge deck) drawn into its own canvas; the alpha is the collision mask. */
  addSilhouette(x: number, y: number, w: number, h: number, passages: { y0: number; y1: number }[], roof = true): Obstacle {
    const key = `p2_sil_${this.texN++}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    dropMask(key);
    const ct = this.textures.createCanvas(key, w, h)!;
    const g = ct.getContext();
    g.fillStyle = '#000';
    const r = this.rng;
    const X = Math.round(x), Y = Math.round(y);
    const thins: (() => void)[] = [];
    // jagged roof line; the antennas on it are THIN (they snap off, no damage)
    let cx = 0;
    while (cx < w) {
      const seg = Math.min(w - cx, r.int(10, 34));
      const top = roof ? r.int(0, 10) : 0;
      g.fillRect(cx, top + 8, seg, h);
      if (roof && r.chance(0.3)) {
        const ax = cx + r.int(1, Math.max(1, seg - 3)), ah = top + 9 + r.int(0, 14), cross = r.chance(0.5);
        thins.push(() => this.addThinProc(X + ax - 3, Y + top + 9 - ah, 8, ah, 'antenna', (q) => {
          q.fillRect(3, 0, 2, ah); if (cross) { q.fillRect(0, 3, 8, 1); q.fillRect(1, 7, 6, 1); }
        }));
      }
      cx += seg;
    }
    // passages (tunnels): carve with ragged edges; hanging cables + sagging wires across are THIN
    for (const p of passages) {
      for (let px = 0; px < w; px += 3) {
        const a = p.y0 + r.int(-2, 2), b = p.y1 + r.int(-2, 2);
        g.clearRect(px, a, 3, b - a);
      }
      g.clearRect(0, p.y0 + 3, w, p.y1 - p.y0 - 6);
      for (let k = 0; k < Math.floor(w / 60); k++) {
        const hx = r.int(8, w - 8), hl = r.int(6, 16);
        thins.push(() => this.addThinProc(X + hx - 1, Y + p.y0 + 1, 3, hl + 2, 'cable', (q) => { q.fillRect(1, 0, 1, hl); q.fillRect(0, hl, 3, 2); }));
      }
      // sagging power / data wires strung across the tunnel
      for (let k = 0; k < Math.floor(w / 140); k++) {
        const ww = r.int(50, 90), wx0 = r.int(10, Math.max(11, w - ww - 10)), sag = r.int(4, 12), wy = p.y0 + r.int(6, 18);
        thins.push(() => this.addThinProc(X + wx0, Y + wy, ww, sag + 3, 'wire', (q) => {
          for (let i = 0; i < ww; i++) { const u = i / (ww - 1); q.fillRect(i, Math.round(4 * sag * u * (1 - u)), 1, 1); }
          q.fillRect(0, 0, 2, 2); q.fillRect(ww - 2, 0, 2, 2);
        }));
      }
    }
    ct.refresh();
    ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const img = this.add.image(Math.round(x), Math.round(y), key).setOrigin(0).setDepth(11);
    const o: Obstacle = { kind: 'solid', name: key, x: Math.round(x), y: Math.round(y), w, h, img, mask: maskOf(this, key), broken: false, tall: true };
    this.obstacles.push(o);
    for (const t of thins) t();
    return o;
  }
  addBuilding(x: number, name?: string): Obstacle | null {
    name = name ?? `solid_bldg_${this.rng.int(1, 5)}`;
    const [, h] = this.m.collision_layer.pieces[name].size;
    let bottom = this.rng.int(332, 350);
    if (bottom - h > 280) return null;
    return this.addPiece(name, x, bottom - h, 11);
  }
  roofY(b: Obstacle, wx0: number, wx1: number) {
    let m = 1e9;
    if (!b.mask) return b.y;
    for (let x = Math.max(b.x, wx0); x <= Math.min(b.x + b.w - 1, wx1); x++) { const t = b.mask.top[x - b.x]; if (t >= 0) m = Math.min(m, b.y + t); }
    return m;
  }
  addBreakableOnGround(x: number, name?: string) {
    name = name ?? this.rng.pick(['brk_billboard', 'brk_antenna_mast', 'brk_hanging_sign', 'brk_signal_tower', 'brk_street_sign', 'brk_thin_wall']);
    const [w, h] = this.m.collision_layer.pieces[name].size;
    const bottom = this.groundMax(x + 4, x + w - 4) + 3;
    return this.addPiece(name, x, bottom - h, 10);
  }
  addBreakableOnRoof(b: Obstacle) {
    const name = this.rng.pick(['brk_antenna_mast', 'brk_signal_tower', 'brk_street_sign', 'brk_thin_wall', 'brk_billboard', 'brk_hanging_sign']);
    const [w, h] = this.m.collision_layer.pieces[name].size;
    if (w > b.w + 10) return null;
    const x = b.x + Math.round((b.w - w) / 2) + this.rng.int(-6, 6);
    const roof = this.roofY(b, x + w * 0.3, x + w * 0.7);
    if (roof > 1e8) return null;
    return this.addPiece(name, x, roof + 4 - h, 10);
  }
  addScrap(wx: number, y: number, value: number) {
    const v = this.rng.int(0, 3);
    const spr = this.add.sprite(Math.round(wx), Math.round(y), 'scrap', v * 2).setOrigin(0.5).setDepth(14);
    spr.play({ key: `scrap_${v}`, startFrame: this.rng.int(0, 1) });
    this.scraps.push({ spr, wx, y, value, taken: false, ph: this.rng.range(0, 6.28) });
  }
  /** Note 14: hazy far silhouette of a big tower ahead, drawn between the far and mid skyline layers. */
  addPreview(wx: number, topY: number) {
    const img = this.add.image(0, 0, 'p3_towers', this.rng.int(0, this.p2.towers.frames - 1)).setOrigin(0.5, 0).setScrollFactor(0).setDepth(2).setAlpha(0);
    img.setData('top', topY);
    this.previews.push({ img, wx });
  }
  addShop(x: number) {
    // black garage silhouette on the street with a lit bay and a neon sign (decor, no collision)
    const key = `p2_sil_${this.texN++}`;
    const w = SHOP_W, h = 150;
    const ct = this.textures.createCanvas(key, w, h)!; const g = ct.getContext();
    g.fillStyle = '#000'; g.fillRect(0, 26, w, h); g.fillRect(20, 10, 60, 20); g.fillRect(150, 0, 4, 30);
    g.fillStyle = '#3a1c0c'; g.fillRect(70, 70, 110, 80);
    g.fillStyle = '#7a3a12'; for (let yy = 74; yy < 150; yy += 6) g.fillRect(72, yy, 106, 1);
    g.fillStyle = '#ffb347'; g.fillRect(70, 66, 110, 3);
    ct.refresh(); ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const base = this.groundMax(x, x + w) + 4;
    this.add.image(x, base - h, key).setOrigin(0).setDepth(9);
    const sign = this.add.text(x + w / 2, base - h + 44, 'BODY SHOP', { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#ff4fa0', stroke: '#2a0010', strokeThickness: 3 }).setOrigin(0.5).setDepth(9).setResolution(1);
    this.tweens.add({ targets: sign, alpha: 0.55, yoyo: true, repeat: -1, duration: 420, ease: 'Stepped' });
    this.shops.push({ x, used: false, sign });
  }

  generateUntil(limit: number) {
    while (this.nextX < limit) {
      const x = this.nextX;
      if (x + 260 > this.nextShop) {
        this.addShop(this.nextShop);
        this.addScrap(this.nextShop - 40, this.groundTopAt(this.nextShop - 40) - 20, 20);
        this.nextX = this.nextShop + SHOP_W + 140; this.nextShop += SHOP_EVERY;
        continue;
      }
      const r = this.rng.next();
      let used = 80;
      if (r < 0.17) {
        // building + roof debris (middle/low)
        const b = this.addBuilding(x); used = b ? b.w : 60;
        if (b && this.rng.chance(0.45)) this.addBreakableOnRoof(b);
      } else if (r < 0.36) {
        // note 3 / 9: tunnel through a fully black silhouette block (middle band), best scrap inside
        const w = this.rng.int(240, 440);
        const roof = this.rng.int(-175, -60);
        const c = this.rng.int(Math.max(roof + 70, -40), 120);
        const half = this.rng.int(44, 54);
        const o = this.addSilhouette(x, roof, w, 380 - roof, [{ y0: c - half - roof, y1: c + half - roof }]);
        if (this.rng.chance(0.75)) this.addScrap(x + this.rng.int(60, w - 60), c + this.rng.int(-10, 18), 30);
        this.addPreview(x + w / 2, roof);
        used = o.w;
      } else if (r < 0.49) {
        // note 7: a tower that forces a climb into the Tesla lanes
        const w = this.rng.int(66, 112);
        const top = this.rng.int(-262, -196);
        const o = this.addSilhouette(x, top, w, 380 - top, []);
        this.addPreview(x + w / 2, top);
        used = o.w;
      } else if (r < 0.72) {
        // note 6 / 9: dense street debris, scrap in between
        const k = this.rng.int(2, 4);
        let cx = x;
        for (let i = 0; i < k; i++) {
          const p = this.addBreakableOnGround(cx);
          cx += p.w + this.rng.int(16, 60);
          if (this.rng.chance(0.4)) this.addScrap(cx - this.rng.int(6, 14), this.groundTopAt(cx) - this.rng.int(14, 30), 20);
        }
        used = cx - x;
      } else if (r < 0.82) {
        // cable span between two buildings
        const b1 = this.addBuilding(x, `solid_bldg_${this.rng.pick([1, 2, 4, 5])}`);
        if (b1) {
          const hookX = b1.x + Math.round(b1.w * 0.55);
          const n2 = `solid_bldg_${this.rng.pick([1, 2, 4, 5])}`;
          const w2 = this.m.collision_layer.pieces[n2].size[0];
          const b2 = this.addBuilding(hookX + 198 - Math.round(w2 * 0.45), n2);
          if (b2) {
            const hy = Math.max(this.roofY(b1, hookX - 2, hookX + 2), this.roofY(b2, hookX + 196, hookX + 200)) + 6;
            if (hy < 1e8) this.addPiece('brk_cable_span', hookX - 1, hy, 9);
            used = b2.x + b2.w - x;
          } else used = b1.w + 120;
        }
      } else if (r < 0.92) {
        // skybridge: overhang underside + black deck, open air above and below
        const name = `solid_overhang_${this.rng.int(1, 5)}`;
        const [w, h] = this.m.collision_layer.pieces[name].size;
        const bottom = this.rng.int(-30, 60);
        const o = this.addPiece(name, x, bottom - h, 11);
        this.addSilhouette(x - 30, o.y - 18, w + 60, 26, [], false);
        if (this.rng.chance(0.5)) this.addScrap(x + w / 2, bottom + 16, 10);
        used = w + 60;
      } else {
        const p = this.addBreakableOnGround(x, 'brk_thin_wall');
        const q = this.addBreakableOnGround(x + p.w + this.rng.int(30, 90));
        used = q.x + q.w - x;
      }
      this.nextX = x + used + this.rng.int(60, 170);
      while (this.nextBarrel < this.nextX - 40) { this.placeBarrel(this.nextBarrel); this.nextBarrel += this.rng.int(BARREL_GAP[0], BARREL_GAP[1]); }
    }
  }

  // ------------------------------------------------------------------ gas barrels (phase 4): risk / reward by height band
  blockedAt(x: number, y: number) {
    if (y >= this.groundTopAt(x) - 4) return true;
    for (const o of this.obstacles) {
      if (o.kind !== 'solid' || !o.mask || x < o.x - 12 || x > o.x + o.w + 12 || y < o.y - 14 || y > o.y + o.h + 14) continue;
      for (const [dx, dy] of [[0, 0], [-10, -12], [10, -12], [-10, 12], [10, 12], [0, -14], [0, 14]]) if (solidAt(o.mask, x + dx - o.x, y + dy - o.y)) return true;
    }
    return false;
  }
  placeBarrel(x: number) {
    // zone weights: ceiling (deadly, big refill) / traffic lanes (risky) / mid air + tunnels / street (safe, small)
    const zones: [string, number, number, number, number][] = [
      ['ceiling', 0.1, -430, -372, 60], ['traffic', 0.27, -340, -200, 45], ['mid', 0.33, -150, 60, 30], ['street', 0.3, 100, 170, 25],
    ];
    let r = this.rng.next();
    let zi = zones.findIndex((z) => (r -= z[1]) < 0); if (zi < 0) zi = 2;
    for (let tries = 0; tries < 24; tries++) {
      const z = zones[(zi + Math.floor(tries / 6)) % zones.length];
      const xx = x + this.rng.int(-60, 60);
      const yy = z[0] === 'street' ? this.groundTopAt(xx) - this.rng.int(22, 46) : this.rng.int(z[2], z[3]);
      if (this.blockedAt(xx, yy)) continue;
      this.addBarrel(xx, yy, z[4], z[0]);
      return;
    }
  }
  addBarrel(wx: number, y: number, value: number, zone: string) {
    const v = this.rng.int(0, 3);
    const glow = this.add.image(Math.round(wx), Math.round(y + 10), 'p4_glow').setOrigin(0.5).setDepth(13).setBlendMode(Phaser.BlendModes.ADD);
    const spr = this.add.sprite(Math.round(wx), Math.round(y), 'barrel', v * 2).setOrigin(0.5).setDepth(14);
    spr.play({ key: `barrel_${v}`, startFrame: this.rng.int(0, 1) });
    const b: Barrel = { spr, glow, wx, y, value, taken: false, zone, ph: this.rng.range(0, 6.28) };
    this.barrels.push(b);
    return b;
  }
  updateBarrels() {
    const cx = Math.round(this.px), cy = Math.round(this.py);
    for (const b of this.barrels) {
      if (b.taken) continue;
      const vis = b.wx > this.scroll - 40 && b.wx < this.scroll + VW + 40;
      b.spr.setVisible(vis); b.glow.setVisible(vis);
      if (!vis) continue;
      const bob = Math.round(Math.sin(this.elapsed * 2.6 + b.ph) * 2);
      b.spr.setPosition(Math.round(b.wx), Math.round(b.y) + bob);
      b.glow.setPosition(Math.round(b.wx), Math.round(b.y) + 11 + bob).setAlpha(0.45 + 0.25 * Math.sin(this.elapsed * 7 + b.ph));
      if (this.state !== 'play') continue;
      if (cx + this.carBox.x1 < b.wx - 7 || cx + this.carBox.x0 > b.wx + 7) continue;
      if (this.contactWithRect(b.wx - 7, b.y - 9, 14, 18).n) this.takeBarrel(b);
    }
  }
  takeBarrel(b: Barrel) {
    b.taken = true; this.stats.barrels++;
    const was = this.gas;
    this.gas = Math.min(GAS_MAX, this.gas + b.value);
    if (this.dry) { this.dry = 0; this.flame.setVisible(true); }
    this.tweens.add({ targets: [b.spr, b.glow], y: '-=10', alpha: 0, duration: 220, onComplete: () => { b.spr.destroy(); b.glow.destroy(); } });
    this.floatText(b.wx, b.y - 12, `+${Math.round(this.gas - was)} GAS`, '#ffb347');
    this.hud?.setGas(this.gas, GAS_MAX, false, true);
  }
  /** empty tank: the sinking car hits the street / a wall and wrecks (game over) */
  gasCrash(c: Contact | null) {
    if (c && c.n) this.spark(Math.round(this.px) + c.sx / c.n, Math.round(this.py) + c.sy / c.n);
    this.levels = [3, 3, 3]; this.applySectionTextures(); this.hud?.setLevels(this.levels);
    this.hud?.setGas(0, GAS_MAX, true);
    this.totaled('gas');
  }
  /** fuel burn per second: idle/cruise + boosting (holding right) + climbing (scaled by climb rate) */
  burnGas(dt: number, ix: number) {
    const climb = Math.max(0, -this.vy / 170);
    const rate = GAS_BASE + (ix > 0 ? GAS_BOOST : 0) + GAS_CLIMB * climb;
    this.gas = Math.max(0, this.gas - rate * dt);
    if (this.gas <= 0 && !this.dry) { this.dry = 0.001; this.floatText(this.px + CAR_CX, this.py - 4, 'OUT OF GAS!', '#ff6a5a'); this.hud?.flash(0.25); }
    if (this.dry) this.dry += dt;
    if (this.dry > 9 && this.state === 'play') this.gasCrash(null);
    this.hud?.setGas(this.gas, GAS_MAX, this.dry > 0);
  }

  // ------------------------------------------------------------------ drones (note 8, 10, 11, 13, 24)
  spawnDrone(type?: DType, behind?: boolean) {
    type = type ?? (this.rng.chance(0.35) ? 'gang' : 'security');
    behind = behind ?? this.rng.chance(0.75);
    const key = `drone_${type}`;
    const h = type === 'gang' ? 26 : 21;
    const wx = behind ? this.scroll - 110 : this.scroll + VW + 20;
    const y = Phaser.Math.Clamp(this.py + this.rng.int(-70, 70), BAND_TOP + 10, 200);
    const spr = this.add.sprite(0, 0, key + '_fly', 0).setOrigin(0).setDepth(20);
    spr.play({ key: key + '_fly', startFrame: this.rng.int(0, 3) });
    const d: Drone = { type, spr, wx, y, vx: behind ? this.speed + 40 : -60, vy: 0, hp: type === 'gang' ? 2 : 1, mode: 'chase', w: 95, h, dead: false, t: 0, stun: 0 };
    // gang drones race you for visible scrap
    if (type === 'gang' && this.rng.chance(0.6)) {
      const s = this.scraps.find((s) => !s.taken && s.wx > this.px + 40 && s.wx < this.scroll + VW + 120);
      if (s) { d.mode = 'scrap'; d.target = s; }
    }
    this.drones.push(d);
    return d;
  }
  updateDrone(d: Drone, dt: number) {
    d.t += dt;
    const gang = d.type === 'gang';
    const maxS = gang ? 235 : 185, acc = gang ? 250 : 190;
    let tx: number, ty: number;
    if (d.mode === 'scrap' && d.target && !d.target.taken) { tx = d.target.wx; ty = d.target.y; }
    else if (d.mode === 'flee') { tx = d.wx + 400; ty = BAND_TOP - 80; }
    else {
      d.mode = 'chase';
      // lead the player by 0.6 s of their current motion: a sudden hover stop makes them overshoot (note 10)
      tx = this.px + CAR_CX + this.speed * 0.6; ty = this.py + CAR_CY + this.vy * 0.35;
    }
    const cx = d.wx + d.w / 2, cy = d.y + d.h / 2;
    const dx = tx - cx, dy = ty - cy, dist = Math.hypot(dx, dy) || 1;
    const dvx = (dx / dist) * maxS - d.vx, dvy = (dy / dist) * maxS * 0.8 - d.vy;
    const dl = Math.hypot(dvx, dvy) || 1, a = Math.min(acc * dt, dl);
    if (d.stun > 0) d.stun -= dt;
    else { d.vx += (dvx / dl) * a; d.vy += (dvy / dl) * a; }
    d.wx += d.vx * dt; d.y += d.vy * dt;
    d.spr.setFlipX(d.vx > 0);
    d.spr.setPosition(Math.round(d.wx), Math.round(d.y));
    // grab scrap first?
    if (d.mode === 'scrap' && d.target && !d.target.taken && Math.abs(cx - d.target.wx) < 14 && Math.abs(cy - d.target.y) < 12) {
      d.target.taken = true; d.target.spr.destroy(); this.stats.stolen++;
      this.floatText(d.target.wx, d.target.y - 10, 'STOLEN!', '#ff6a5a');
      d.mode = 'flee';
    }
    // note 11: drones that clip the black walls are destroyed
    if (this.droneHitsSolid(d)) { this.stats.droneWall++; this.killDrone(d, null, true); return; }
    // drones that blunder into traffic die too
    for (const c of this.traffic) {
      if (c.dead) continue;
      if (cx > c.wx + 6 && cx < c.wx + c.w - 6 && cy > c.y + 4 && cy < c.y + c.h - 4) { this.killDrone(d, null, true); return; }
    }
  }
  droneHitsSolid(d: Drone) {
    const pts = [[18, d.h / 2], [d.w / 2, d.h / 2], [d.w - 18, d.h / 2], [d.w / 2, 3]];
    for (const [ox, oy] of pts) {
      const X = d.wx + ox, Y = d.y + oy;
      if (Y >= this.groundTopAt(X)) return true;
      for (const o of this.obstacles) {
        if (o.kind !== 'solid' || !o.mask || X < o.x || X >= o.x + o.w || Y < o.y || Y >= o.y + o.h) continue;
        if (solidAt(o.mask, X - o.x, Y - o.y)) return true;
      }
    }
    return false;
  }
  killDrone(d: Drone, c: Contact | null, wall = false) {
    d.dead = true;
    const key = `drone_${d.type}`;
    d.spr.stop(); d.spr.setTexture(key + '_smashed');
    if (c && c.n) this.spark(Math.round(this.px) + c.sx / c.n, Math.round(this.py) + c.sy / c.n);
    this.time.delayedCall(60, () => {
      const ex = d.spr.x, ey = d.spr.y;
      d.spr.setVisible(false);
      const s = this.add.sprite(ex - 22, ey - 22, key + '_break', 0).setOrigin(0).setDepth(21).setFlipX(d.spr.flipX).play(key + '_break');
      s.once('animationcomplete', () => { s.destroy(); d.spr.destroy(); });
      this.explosion(ex + d.w / 2, ey + d.h / 2, 1);
      this.burst('fx_debris', ex + d.w / 2, ey + d.h / 2, 8, d.vx * 0.5, 140);
    });
    if (!wall) { this.impact(70, 150, 0.008); this.stats.smashed++; }
  }

  // ------------------------------------------------------------------ traffic (note 5, 7, 12)
  /** next centre-to-centre distance in the lane's repeating convoy pattern */
  laneStep(i: number) { const ln = LANES[i], st = this.laneState[i]; st.k = (st.k + 1) % ln.n; return st.k === 0 ? ln.G : ln.s; }
  addTesla(i: number, wx: number) {
    const ln = LANES[i];
    const t = this.rng.chance(0.55) ? this.p2.traffic.hover_white : this.p2.traffic.hover_black;
    const img = this.add.image(Math.round(wx), ln.y, t.key).setOrigin(0).setDepth(19).setFlipX(ln.v > 0);
    const c: Traffic = { spr: img, key: t.key, lane: i, wx, y: ln.y, v: ln.v, w: t.size[0], h: t.size[1], dead: false, margin: t.margin };
    this.traffic.push(c);
    return c;
  }
  updateTraffic(dt: number) {
    const camTop = this.camY - 60, camBot = this.camY + VH + 60;
    const x0 = this.scroll - 80, x1 = this.scroll + VW + 30;
    // faint AI lane guide dots (world space, under the cars)
    if (!this.laneDots.length) {
      if (!this.textures.exists('p5_lane_dot')) { const ct = this.textures.createCanvas('p5_lane_dot', 12, 1)!; const g = ct.getContext(); g.fillStyle = '#9fe8ff'; g.fillRect(0, 0, 2, 1); ct.refresh(); }
      this.laneDots = LANES.map((ln) => this.add.tileSprite(0, ln.y + 17, VW + 48, 1, 'p5_lane_dot').setOrigin(0).setDepth(18).setAlpha(ln.ceil ? 0.32 : 0.22));
    }
    this.laneDots.forEach((d) => { d.width = VW + 48; d.x = Math.floor(this.scroll / 12) * 12 - 24; });
    LANES.forEach((ln, i) => {
      // ceiling lanes far off-screen (below the camera) do not need cars yet; they fill in as soon as you climb
      if (ln.ceil && (ln.y < camTop - 200 || ln.y > camBot)) { this.traffic.filter((c) => c.lane === i).forEach((c) => { c.spr.destroy(); c.dead = true; }); return; }
      const lane = this.traffic.filter((c) => c.lane === i && !c.dead);
      if (!lane.length) {
        // empty lane (start / just climbed into it): lay the whole visible rail out in its pattern at once
        for (let x = x0 - this.rng.int(0, ln.G); x < x1; x += this.laneStep(i)) this.addTesla(i, x);
        return;
      }
      // cars enter on the side the lane flows in from; each new one sits exactly one pattern step behind the last
      const fromRight = ln.v < 0 || this.speed > ln.v;
      const edge = fromRight ? lane.reduce((a, b) => (b.wx > a.wx ? b : a)) : lane.reduce((a, b) => (b.wx < a.wx ? b : a));
      let guard = 0;
      if (fromRight) { let x = edge.wx; while (x < x1 && guard++ < 60) { x += this.laneStep(i); this.addTesla(i, x); } }
      else { let x = edge.wx; while (x > x0 && guard++ < 60) { x -= this.laneStep(i); this.addTesla(i, x); } }
    });
    for (const c of this.traffic) {
      if (c.dead) continue;
      c.wx += c.v * dt;
      c.spr.setPosition(Math.round(c.wx), c.y);
    }
    this.traffic = this.traffic.filter((c) => {
      if (c.dead) return false;
      if (c.wx < this.scroll - 1000 || c.wx > this.scroll + VW + 1000) { c.spr.destroy(); return false; }
      return true;
    });
  }
  smashTraffic(c: Traffic, ct: Contact) {
    c.dead = true;
    c.spr.setTexture(c.key + '_smashed');
    this.spark(Math.round(this.px) + ct.sx / ct.n, Math.round(this.py) + ct.sy / ct.n);
    this.time.delayedCall(60, () => {
      const ex = c.spr.x, ey = c.spr.y; c.spr.destroy();
      const s = this.add.sprite(ex - c.margin, ey - c.margin, c.key + '_break', 0).setOrigin(0).setDepth(21).setFlipX(c.v > 0).play(c.key + '_break');
      s.once('animationcomplete', () => s.destroy());
      this.explosion(ex + c.w / 2, ey + c.h / 2, 1);
      this.burst('fx_debris', ex + c.w / 2, ey + c.h / 2, 7, this.speed, 140);
    });
    this.stats.smashed++;
  }

  // ------------------------------------------------------------------ collision helpers
  contactWithMask(o: { x: number; y: number; w: number; h: number; mask: Mask | null }, dy = 0): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py) + dy;
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (!o.mask) return c;
    if (cx + this.carBox.x1 < o.x || cx + this.carBox.x0 > o.x + o.w || cy + this.carBox.y1 < o.y || cy + this.carBox.y0 > o.y + o.h) return c;
    for (const p of this.carPts) if (solidAt(o.mask, cx + p.x - o.x, cy + p.y - o.y)) { c.n++; c.sx += p.x; c.sy += p.y; }
    return c;
  }
  contactWithGround(dy = 0): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py) + dy;
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (cy + this.carBox.y1 < GROUND_Y) return c;
    for (const p of this.carPts) if (cy + p.y >= this.groundTopAt(cx + p.x)) { c.n++; c.sx += p.x; c.sy += p.y; }
    return c;
  }
  contactWithRect(x: number, y: number, w: number, h: number): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py);
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (cx + this.carBox.x1 < x || cx + this.carBox.x0 > x + w || cy + this.carBox.y1 < y || cy + this.carBox.y0 > y + h) return c;
    for (const p of this.carPts) { const X = cx + p.x, Y = cy + p.y; if (X >= x && X < x + w && Y >= y && Y < y + h) { c.n++; c.sx += p.x; c.sy += p.y; } }
    return c;
  }
  solidContacts(dy = 0): { c: Contact; push: number } {
    const all: Contact = { n: 0, sx: 0, sy: 0 };
    let push = 0;
    const g = this.contactWithGround(dy);
    if (g.n) { all.n += g.n; all.sx += g.sx; all.sy += g.sy; push -= g.n; }
    const x0 = this.px - 10, x1 = this.px + CAR_W + 10;
    for (const o of this.obstacles) {
      if (o.kind !== 'solid' || o.x > x1 || o.x + o.w < x0) continue;
      const c = this.contactWithMask(o, dy);
      if (c.n) {
        all.n += c.n; all.sx += c.sx; all.sy += c.sy;
        // push toward whichever side of the solid is closer (up over it or down under it)
        const midY = c.sy / c.n + Math.round(this.py) + dy;
        push += midY < o.y + 30 || (o.tall && midY < o.y + o.h / 2 && this.vy < 0) ? -c.n : c.n;
      }
    }
    return { c: all, push };
  }

  // ------------------------------------------------------------------ fx
  spark(x: number, y: number, depth = 40) {
    const a = this.m.fx.impact_spark_shards.anchor;
    const s = this.add.sprite(Math.round(x - a[0]), Math.round(y - a[1]), 'fx_spark', 0).setOrigin(0).setDepth(depth).play('fx_spark');
    s.once('animationcomplete', () => s.destroy());
  }
  explosion(x: number, y: number, scale = 1, delay = 0) {
    this.time.delayedCall(delay, () => {
      const s = this.add.sprite(Math.round(x), Math.round(y), 'fx_explosion', 0).setOrigin(0.5).setScale(Math.max(1, Math.round(scale))).setDepth(42).play('fx_explosion');
      s.once('animationcomplete', () => s.destroy());
    });
  }
  burst(key: 'black_shards' | 'fx_debris', x: number, y: number, n: number, vx0: number, spread: number, depth = 41) {
    for (let i = 0; i < n; i++) {
      const spr = this.add.image(Math.round(x), Math.round(y), key, this.rng.int(0, 15)).setOrigin(0.5).setDepth(depth);
      this.particles.push({ spr, x, y, vx: vx0 + this.rng.range(-spread, spread), vy: this.rng.range(-230, -30), g: 650, life: this.rng.range(0.9, 1.6), flip: this.rng.range(0.05, 0.15) });
    }
  }
  floatText(x: number, y: number, s: string, color = '#f2c27a') {
    const t = this.add.text(Math.round(x), Math.round(y), s, { fontFamily: 'monospace', fontSize: '10px', fontStyle: 'bold', color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(60).setResolution(2);
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }
  impact(ms: number, shakeMs: number, intensity: number) {
    this.hitStop = Math.max(this.hitStop, ms);
    this.cameras.main.shake(shakeMs, intensity, true);
  }

  /** THIN obstacles: snap at the contact point, both halves spin and fall away, electric sparks. No damage. */
  snapThin(o: Obstacle, c: Contact) {
    o.broken = true; o.img?.setVisible(false); this.stats.snapped++;
    const wx = Math.round(this.px) + c.sx / c.n, wy = Math.round(this.py) + c.sy / c.n;
    const key = o.key ?? o.name;
    const horiz = o.w > o.h;
    const cut = horiz ? Phaser.Math.Clamp(Math.round(wx - o.x), 1, o.w - 1) : Phaser.Math.Clamp(Math.round(wy - o.y), 1, o.h - 1);
    const halves: [number, number, number, number][] = horiz ? [[0, 0, cut, o.h], [cut, 0, o.w - cut, o.h]] : [[0, 0, o.w, cut], [0, cut, o.w, o.h - cut]];
    halves.forEach(([hx, hy, hw, hh], i) => {
      if (hw <= 0 || hh <= 0) return;
      const spr = this.add.image(o.x, o.y, key).setOrigin(0).setDepth(16).setCrop(hx, hy, hw, hh);
      // rotate around the middle of the kept half
      spr.setOrigin((hx + hw / 2) / o.w, (hy + hh / 2) / o.h);
      const px0 = o.x + hx + hw / 2, py0 = o.y + hy + hh / 2;
      const away = horiz ? (i === 0 ? -1 : 1) : 1;
      this.falling.push({ spr, x: px0, y: py0, vx: this.speed * 0.55 + away * this.rng.range(10, 50), vy: this.rng.range(-110, -40), vr: (i ? 1 : -1) * this.rng.range(240, 620), g: 620, life: 1.4, life0: 1.4 });
    });
    this.spark(wx, wy, 41);
    for (let i = 0; i < 12; i++) {
      const col = this.rng.chance(0.5) ? 0xfff2a0 : this.rng.chance(0.5) ? 0x9fe8ff : 0xffb347;
      const spr = this.add.rectangle(wx, wy, 1, 1, col).setOrigin(0).setDepth(42);
      this.falling.push({ spr, x: wx, y: wy, vx: this.speed * 0.4 + this.rng.range(-120, 160), vy: this.rng.range(-170, 40), vr: 0, g: 420, life: this.rng.range(0.2, 0.5), life0: 0.5 });
    }
    this.burst('black_shards', wx, wy, 3, this.speed + 30, 70, 16);
    if (this.rng.chance(0.6)) this.floatText(wx, wy - 8, this.rng.pick(['SNAP!', 'SNAP!', 'ZZT!', 'CRACK!']), '#9fe8ff');
    this.speed *= 0.985;
    this.impact(18, 70, 0.0025);
  }
  updateFalling(dt: number) {
    this.falling = this.falling.filter((f) => {
      f.life -= dt; f.vy += f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
      f.spr.setPosition(Math.round(f.x), Math.round(f.y));
      if (f.vr) (f.spr as Phaser.GameObjects.Image).setAngle(((f.spr as Phaser.GameObjects.Image).angle + f.vr * dt));
      f.spr.setAlpha(Math.min(1, f.life / Math.min(0.35, f.life0)));
      if (f.life <= 0 || f.y > VH + 30) { f.spr.destroy(); return false; }
      return true;
    });
  }
  /** contact for 1-2 px wide bits: probe each car point and its 2x2 neighbourhood (car points are sampled every 2 px) */
  contactThin(o: Obstacle): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py);
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (!o.mask) return c;
    if (cx + this.carBox.x1 < o.x || cx + this.carBox.x0 > o.x + o.w || cy + this.carBox.y1 < o.y || cy + this.carBox.y0 > o.y + o.h) return c;
    for (const p of this.carPts) {
      const X = cx + p.x - o.x, Y = cy + p.y - o.y;
      if (solidAt(o.mask, X, Y) || solidAt(o.mask, X + 1, Y) || solidAt(o.mask, X, Y + 1) || solidAt(o.mask, X + 1, Y + 1)) { c.n++; c.sx += p.x; c.sy += p.y; }
    }
    return c;
  }

  // ------------------------------------------------------------------ events
  breakPiece(o: Obstacle, c: Contact) {
    o.broken = true;
    o.img?.setVisible(false);
    const b = this.m.collision_layer.pieces[o.name].break;
    const s = this.add.sprite(o.x + b.offset_from_piece_origin[0], o.y + b.offset_from_piece_origin[1], o.name + '_break', 0).setOrigin(0).setDepth(15).play(o.name + '_break');
    s.once('animationcomplete', () => s.destroy());
    const wx = Math.round(this.px) + c.sx / c.n, wy = Math.round(this.py) + c.sy / c.n;
    this.spark(wx, wy);
    this.burst('black_shards', wx + 6, wy, 14, this.speed + 60, 120, 16);
    this.speed *= 0.88;
    this.impact(45, 110, 0.004);
    this.stats.broken++;
  }
  damageCar(c: Contact, solid: boolean) {
    const lx = c.sx / c.n;
    const sec = this.sectionAtLocalX(lx);
    const res = applyHit(this.levels, sec);
    this.applySectionTextures();
    this.stats.hits++;
    this.spark(Math.round(this.px) + lx, Math.round(this.py) + c.sy / c.n);
    // in the traffic ceiling the grace period is short, so camping up there totals you fast
    this.invuln = this.py < BAND_TOP ? 0.55 : 1.15;
    this.impact(solid ? 95 : 80, 220, 0.013);
    this.hud?.flash();
    this.car.setTintFill(0xffffff);
    this.time.delayedCall(70, () => this.car.clearTint());
    this.hud?.setLevels(this.levels);
    this.sprV += 60; // struts take the hit
    this.seatFace = 2; this.seatT = 0.7; // note 25: arm up on hits
    if (res.totaled) this.totaled();
  }
  totaled(why: 'wreck' | 'gas' = 'wreck') {
    this.dead = why;
    this.state = 'totaled';
    this.totaledT = 0;
    this.deadVy = -60;
    this.flame.setVisible(false);
    const cx = Math.round(this.px) + CAR_CX, cy = Math.round(this.py) + CAR_CY;
    this.explosion(cx, cy, 2, 0);
    this.explosion(cx - 40, cy + 4, 1, 120);
    this.explosion(cx + 40, cy - 6, 1, 220);
    this.explosion(cx - 10, cy - 12, 2, 380);
    this.burst('fx_debris', cx, cy, 22, this.speed, 220);
    this.burst('black_shards', cx, cy, 14, this.speed, 200);
    this.time.delayedCall(30, () => this.cameras.main.shake(650, 0.014, true));
    this.hud?.flash(0.8);
    this.registry.set('levels', [0, 0, 0]);
    this.time.delayedCall(1300, () => this.hud?.showTotaled(why));
  }

  // ------------------------------------------------------------------ body shop (phase 2 mockup)
  openShop() {
    if (this.state !== 'play') return;
    this.state = 'shop';
    this.registry.set('levels', this.levels.slice());
    this.registry.set('scrap', this.scrap);
    this.scene.pause();
    this.scene.sleep('Hud');
    this.scene.launch('Shop', { driver: this.driver });
  }
  onShopClosed(_data: any) {
    this.scene.wake('Hud');
    this.levels = ((this.registry.get('levels') as number[]) ?? this.levels).slice();
    this.scrap = Number(this.registry.get('scrap') ?? this.scrap);
    this.applySectionTextures();
    this.hud?.setLevels(this.levels); this.hud?.setScrap(this.scrap);
    this.state = 'play'; this.invuln = 1.5; this.speed = 40; this.shopHold = 0;
    const s = this.shops.find((s) => !s.used && Math.abs(s.x - this.px) < 400); if (s) s.used = true;
    this.cameras.main.fadeIn(250, 0, 0, 0);
  }

  // ------------------------------------------------------------------ main loop
  update(_t: number, dms: number) {
    const dt = Math.min(dms, 50) / 1000;
    if (this.hitStop > 0) { this.hitStop -= dms; this.anims.globalTimeScale = 0; return; }
    this.anims.globalTimeScale = 1;
    this.elapsed += dt;

    if (this.state === 'totaled') { this.totaledT += dt; this.speed = Math.max(0, this.speed - 90 * dt); }
    this.scroll = Math.max(0, this.scroll + this.speed * dt);
    if (this.scroll <= 0 && this.speed < 0) this.speed = 0; // the level start is a hard stop when reversing
    const sc = Math.floor(this.scroll);
    const cam = this.cameras.main;
    // note 1: vertical camera follow
    const ty = Phaser.Math.Clamp(this.py + CAR_CY - VH * 0.48, TOP_Y, 0);
    this.camY += (ty - this.camY) * (1 - Math.exp(-dt * 4.5));
    const scy = Math.round(this.camY);
    cam.scrollX = sc; cam.scrollY = scy;
    for (const l of this.bg) this.placeStrip(l, sc, scy);
    this.updateWind(dt, scy);
    this.placeStrip(this.ground, sc, scy);
    for (const pv of this.previews) {
      const rel = pv.wx - this.scroll;
      pv.img.x = Math.round(260 + rel * 0.42); pv.img.y = Math.round(140 + (pv.img.getData('top') as number) * 0.3 - scy * 0.3);
      pv.img.setAlpha(rel > VW + 1400 || rel < VW - 60 ? 0 : Math.min(0.9, (rel - (VW - 60)) / 260));
    }

    if (this.state === 'play') this.updatePlayer(dt);
    else if (this.state === 'totaled') this.updateWreck(dt);

    if (!this.noSpawn) this.generateUntil(sc + VW + 500);
    // keep the world (you can reverse to the start) but only show what is near the camera
    for (const o of this.obstacles) if (o.img && !o.broken) o.img.setVisible(o.x + o.w > sc - 60 && o.x < sc + VW + 60);
    if (this.state === 'play' && !this.noSpawn && !this.noEnemies) {
      this.updateTraffic(dt);
      this.nextDrone -= dt;
      if (this.nextDrone <= 0) {
        if (this.drones.filter((d) => !d.dead).length < DRONE_MAX) this.spawnDrone();
        const k = Math.max(0.75, 1 - this.elapsed / 240);
        this.nextDrone = this.rng.range(DRONE_EVERY[0], DRONE_EVERY[1]) * k;
      }
    }
    this.updateBarrels();
    // hunnids hover-bob (2 px, whole pixels)
    for (const h of this.scraps) if (!h.taken && h.wx > sc - 30 && h.wx < sc + VW + 30) h.spr.y = Math.round(h.y) + Math.round(Math.sin(this.elapsed * 2.2 + (h.ph ?? 0)) * 2);
    this.updateFalling(dt);
    for (const d of this.drones) if (!d.dead) this.updateDrone(d, dt);
    this.drones = this.drones.filter((d) => {
      if (d.dead) return false;
      if (d.wx < this.scroll - 600 || d.wx > this.scroll + VW + 600 || d.y < TOP_Y - 160 || d.y > VH + 40) { d.spr.destroy(); return false; }
      return true;
    });
    this.particles = this.particles.filter((p) => {
      p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.spr.setPosition(Math.round(p.x), Math.round(p.y));
      p.flip -= dt; if (p.flip <= 0) { p.flip = 0.09; p.spr.setFlipX(!p.spr.flipX); }
      if (p.life <= 0 || p.y > VH + 20) { p.spr.destroy(); return false; }
      return true;
    });
    this.hud?.setDistance(Math.floor(this.scroll / 8));
    this.hud?.setSpeed(this.speed, MAX_SPEED);
    if (this.debug) this.drawDebug(); else this.dbg.clear();
  }

  readInput(): { ix: number; iy: number } {
    if (this.autopilot) return this.autopilot(this);
    const k = this.keys, c = this.cursors;
    let ix = (c.right.isDown || k.D.isDown ? 1 : 0) - (c.left.isDown || k.A.isDown ? 1 : 0);
    let iy = (c.down.isDown || k.S.isDown ? 1 : 0) - (c.up.isDown || k.W.isDown ? 1 : 0);
    if (this.touch) {
      ix = Phaser.Math.Clamp((this.touch.x - (this.sx + CAR_CX)) / 50, -1, 1);
      iy = Phaser.Math.Clamp((this.touch.y + this.camY - (this.py + CAR_CY)) / 30, -1, 1);
      if (Math.abs(ix) < 0.25) ix = 0;
    }
    return { ix, iy };
  }

  updatePlayer(dt: number) {
    const inp = this.readInput();
    const ix = inp.ix;
    let iy = inp.iy;
    this.burnGas(dt, ix);
    // OUT OF GAS: no lift. You can still steer down, but the car sinks, sputters and loses speed until it crashes
    if (this.dry) {
      iy = Math.max(iy, 0.45 + Math.min(0.55, this.dry * 0.2));
      this.speed += (Math.min(this.speed, 40) - this.speed) * (1 - Math.exp(-dt * 0.8));
    }
    // ---- notes 4 + 27: throttle. Right = faster, left = slow down to a full hover stop (it locks there for a beat),
    //      keep holding left to reverse at 1/3 speed, all the way back to the start. Releasing keeps the current speed.
    const backL = this.levels[0];
    if (ix > 0 && !this.dry) { this.speed = Math.min(MAX_SPEED, this.speed + (this.speed < 0 ? 260 : 120) * ix * dt); this.hoverLock = 0; }
    else if (ix < 0) {
      if (this.speed > 0) { this.speed = Math.max(0, this.speed + 200 * ix * dt); if (this.speed === 0) this.hoverLock = 0.45; }
      else if (this.hoverLock > 0) this.hoverLock -= dt;
      else this.speed = Math.max(REV_SPEED, this.speed + 90 * ix * dt);
    }
    this.lastIx = ix;
    // the car leans forward on screen with speed (stays in the left third)
    const tsx = 64 + (this.speed / MAX_SPEED) * 40;
    this.sx += (tsx - this.sx) * (1 - Math.exp(-dt * 3));
    // vertical: weighty hover
    const tvy = iy * 170;
    const ay = 1 - Math.exp(-dt * (iy ? 4.2 : 5.5));
    this.vy += (tvy - this.vy) * ay;
    // note 23: rear damage -> engine wobble / drift
    if (backL) this.vy += Math.sin(this.elapsed * (2.1 + backL)) * backL * 26 * dt;
    this.py = Phaser.Math.Clamp(this.py + this.vy * dt, TOP_Y - this.carBox.y0 + 2, 300);

    // ---- solids: damage + push out toward open air
    const { c } = this.solidContacts();
    if (c.n && this.dry) { this.gasCrash(c); return; }
    if (c.n) {
      // push out toward the nearest open air (up over it, or down under a ceiling / into a tunnel passage)
      let dir = 0;
      for (let k = 2; k <= 44 && !dir; k += 2) {
        if (!this.solidContacts(-k).c.n) dir = -1;
        else if (!this.solidContacts(k).c.n) dir = 1;
      }
      if (!dir) dir = -1;
      if (this.invuln <= 0) {
        this.damageCar(c, true);
        this.vy = dir * 150; this.speed = Math.min(this.speed, 0) * 0.5 + Math.max(0, this.speed) * 0.55;
      }
      for (let i = 0; i < 40; i++) {
        this.py += dir;
        if (!this.solidContacts().c.n) break;
        if (i === 39) { this.scroll = Math.max(0, this.scroll - 4); }
      }
      if (Math.sign(this.vy) !== dir) this.vy *= 0.3;
    } else if (Math.floor(this.elapsed * 30) % 3 === 0 && this.invuln <= 0) {
      // note 25: near-miss -> the driver flinches
      if (this.solidContacts(-6).c.n || this.solidContacts(6).c.n) { if (this.seatT <= 0) { this.seatFace = 1; this.seatT = 0.4; } }
    }
    if (this.state !== 'play') return;

    // ---- breakables + thin bits (never damage the car)
    const x0 = this.px - 10, x1 = this.px + CAR_W + 10;
    for (const o of this.obstacles) {
      if (o.kind === 'solid' || o.broken || o.x > x1 || o.x + o.w < x0) continue;
      if (o.kind === 'thin') { const tc = this.contactThin(o); if (tc.n) this.snapThin(o, tc); continue; }
      const bc = this.contactWithMask(o);
      if (bc.n > 1) this.breakPiece(o, bc);
    }
    // ---- drones
    for (const d of this.drones) {
      if (d.dead) continue;
      const ec = this.contactWithRect(d.wx + 25, d.y + 2, 46, d.h - 4);
      if (ec.n) {
        if (d.hp > 1 && d.stun <= 0) { d.hp--; d.stun = 0.5; d.vx = this.speed - 260; d.vy = (d.y + d.h / 2 < this.py + CAR_CY ? -1 : 1) * 160; this.spark(Math.round(this.px) + ec.sx / ec.n, Math.round(this.py) + ec.sy / ec.n); }
        else if (d.stun <= 0 || d.hp <= 1) this.killDrone(d, ec);
        if (this.invuln <= 0) { this.damageCar(ec, false); if (this.state !== 'play') return; }
      }
    }
    // ---- traffic
    for (const t of this.traffic) {
      if (t.dead) continue;
      const tc = this.contactWithRect(t.wx + 3, t.y + 3, t.w - 6, t.h - 6);
      if (tc.n) { this.smashTraffic(t, tc); if (this.invuln <= 0) { this.damageCar(tc, false); if (this.state !== 'play') return; } }
    }
    // ---- notes 19, 21, 22: the front arm grabs scrap hunnids (only when slow / hovering, takes a beat)
    this.updateArm(dt);
    // ---- body shop: hover-stop in front of the bay
    let inShop = false;
    for (const s of this.shops) {
      if (s.used) continue;
      const cx = this.px + CAR_CX;
      if (cx > s.x + 40 && cx < s.x + SHOP_W - 20 && this.py + CAR_CY > 40) {
        inShop = true;
        if (Math.abs(this.speed) < 12) { this.shopHold += dt; if (this.shopHold > 0.6) { this.openShop(); return; } }
        else this.shopHold = 0;
      }
    }
    if (!inShop) this.shopHold = 0;
    this.hud?.setPrompt(inShop ? (Math.abs(this.speed) < 12 ? 'ENTERING BODY SHOP...' : 'HOVER STOP HERE  (\u25C0 hold)  TO ENTER THE BODY SHOP') : this.armPrompt);

    // ---- presentation
    this.invuln = Math.max(0, this.invuln - dt);
    this.car.setAlpha(this.invuln > 0 && this.invuln < 5 && Math.floor(this.invuln * 14) % 2 === 0 ? 0.35 : 1);
    const targetTilt = (this.vy / 170) * 5 - (ix * 1.5);
    this.tilt += (targetTilt - this.tilt) * (1 - Math.exp(-dt * 8));
    this.updateEngine(dt, ix);
    if (this.seatT > 0) { this.seatT -= dt; if (this.seatT <= 0) this.seatFace = 0; }
    this.seat.setFrame(this.seatFace);
    const bob = Math.round(Math.sin(this.elapsed * 2.4) * 1.2);
    this.flame.anims.timeScale = ix > 0 ? 1.7 : Math.abs(this.speed) < 5 ? 0.7 : 1;
    // sputter: low gas = the flame coughs now and then; empty = it mostly dies
    const sput = this.dry ? 0.72 : this.gas < GAS_LOW ? 0.12 * (1 - this.gas / GAS_LOW) + 0.03 : 0;
    this.flame.setVisible(!(sput && this.rng.next() < sput));
    if (this.dry && this.rng.chance(dt * 6)) this.burst('fx_debris', this.px + 8, this.py + 40, 1, this.speed - 60, 30, 29);
    this.drawCar(bob);
  }

  armPrompt = '';
  updateArm(dt: number) {
    const gb = this.cp.gear_bbox; // [x0,y0,x1,y1] in car coords
    const tipX = this.px + gb[2], tipY = this.py + gb[3];
    const near = (s: Scrap, pad: number) => s.wx > tipX - 10 - pad && s.wx < tipX + 30 + pad && s.y > tipY - 26 - pad && s.y < tipY + 22 + pad;
    const slow = Math.abs(this.speed) <= 40;
    this.armPrompt = '';
    const A = this.arm;
    const frontL = this.levels[2];
    if (A.st === 'idle') {
      const s = this.scraps.find((s) => !s.taken && near(s, 0));
      if (s) {
        if (slow) { A.st = 'reach'; A.t = 0; A.dur = 0.32 * (1 + 0.6 * frontL); A.target = s; } // note 23: front damage = slower grabs
        else this.armPrompt = 'HUNNIDS!  SLOW DOWN TO GRAB IT  (\u25C0)';
      }
    } else if (A.st === 'reach') {
      A.t += dt;
      if (A.t >= A.dur) {
        const s = A.target;
        if (s && !s.taken && near(s, 10)) {
          s.taken = true; this.scrap += s.value; this.stats.grabbed++;
          this.tweens.add({ targets: s.spr, x: Math.round(tipX), y: Math.round(tipY), alpha: 0, duration: 220, onComplete: () => s.spr.destroy() });
          this.floatText(s.wx, s.y - 10, `+${s.value} HUNNIDS`, '#ffd76a');
          this.hud?.setScrap(this.scrap);
        }
        A.st = 'retract'; A.t = 0;
      }
    } else if (A.st === 'retract') {
      A.t += dt; if (A.t >= A.dur) { A.st = 'idle'; A.t = 0; A.target = null; }
    }
    const k = A.st === 'reach' ? A.t / A.dur : A.st === 'retract' ? 1 - A.t / A.dur : 0;
    const e = Phaser.Math.Easing.Sine.InOut(Phaser.Math.Clamp(k, 0, 1));
    this.gearRig.x = -CAR_CX + this.cp.gear_pivot[0] + Math.round(e * 12);
    this.gearRig.y = -CAR_CY + this.cp.gear_pivot[1] + Math.round(e * 5);
    this.gearRig.setAngle(-e * 18);
  }

  /** Note 18: the rear engine pod tilts on the axle and its spring struts extend/compress with the actual motion. */
  updateEngine(dt: number, ix: number) {
    const ayc = (this.vy - this.lastVy) / Math.max(dt, 1e-3); this.lastVy = this.vy;
    // spring (struts): driven by vertical acceleration
    this.sprV += (-60 * this.sprX - 9 * this.sprV - ayc * 0.012) * dt;
    this.sprX += this.sprV * dt;
    const climb = Phaser.Math.Clamp(-this.vy / 170, -1, 1);
    // thrust forward -> pod swings back; climbing -> nozzle aims down-back; diving -> nozzle up
    let ang = ix * 9 + (this.speed < 0 ? -10 : 0) - climb * 16;
    const bl = this.levels[0];
    if (bl) ang += Math.sin(this.elapsed * 13) * bl * 3 + (this.rng.next() - 0.5) * bl * 2; // note 23 wobble
    this.engAng += (ang - this.engAng) * (1 - Math.exp(-dt * 7));
    const ext = Phaser.Math.Clamp(climb * 2.5 + this.sprX, -1.5, 4);
    this.engExt += (ext - this.engExt) * (1 - Math.exp(-dt * 10));
    this.engRig.setAngle(Math.round(this.engAng));
    this.engRig.y = -CAR_CY + this.cp.engine_pivot[1] + Math.round(this.engExt);
  }

  updateWreck(dt: number) {
    this.car.setAlpha(1);
    let gsum = 0, gn = 0;
    for (let x = this.px + 20; x <= this.px + 110; x += 4) { gsum += this.groundTopAt(x); gn++; }
    const floor = gsum / gn - 50;
    if (this.py < floor) { this.deadVy += 420 * dt; this.py = Math.min(floor, this.py + this.deadVy * dt); this.tilt += (12 - this.tilt) * dt * 2; }
    else { this.deadVy = 0; this.tilt += (4 - this.tilt) * dt * 4; }
    this.drawCar(0);
  }

  drawCar(bob: number) {
    this.flame.anims.update(this.time.now, this.game.loop.delta * this.anims.globalTimeScale);
    this.rig.setAngle(Math.round(this.tilt * 2) / 2);
    this.carRT.clear();
    this.carRT.draw(this.rig, RIG_CX, RIG_CY);
    this.car.setPosition(Math.round(this.px) + CAR_CX - RIG_CX, Math.round(this.py) + CAR_CY - RIG_CY + bob);
  }

  drawDebug() {
    const g = this.dbg; g.clear();
    const cx = Math.round(this.px), cy = Math.round(this.py);
    g.lineStyle(1, 0x00ff66, 0.8);
    g.strokeRect(cx + this.carBox.x0, cy + this.carBox.y0, this.carBox.x1 - this.carBox.x0, this.carBox.y1 - this.carBox.y0);
    const r = this.cp.section_x;
    g.lineStyle(1, 0xffff00, 0.8);
    for (const k of ['middle', 'front']) g.lineBetween(cx + r[k], cy + 14, cx + r[k], cy + 60);
    for (const o of this.obstacles) { g.lineStyle(1, o.kind === 'solid' ? 0xff3030 : o.kind === 'thin' ? 0x30ffe0 : 0x30a0ff, o.broken ? 0.2 : 0.8); g.strokeRect(o.x, o.y, o.w, o.h); }
    g.lineStyle(1, 0xffb347, 0.9);
    for (const b of this.barrels) if (!b.taken) g.strokeRect(b.wx - 7, b.y - 9, 14, 18);
    g.lineStyle(1, 0xff00ff, 0.9);
    for (const d of this.drones) g.strokeRect(d.wx + 25, d.y + 2, 46, d.h - 4);
    for (const t of this.traffic) g.strokeRect(t.wx + 3, t.y + 3, t.w - 6, t.h - 6);
  }

  // ------------------------------------------------------------------ test hooks (tools/*.mjs)
  setDamage(l: number[]) { this.levels = l.slice(); this.applySectionTextures(); this.hud?.setLevels(this.levels); }
}
