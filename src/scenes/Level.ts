import Phaser from 'phaser';
import { applyHit, sectionDrawOrder, sectionKey, SECTIONS, carPrefix, currentDriver, Driver } from '../game/damage';
import { maskOf, solidAt, Mask } from '../game/mask';
import { Rng } from '../game/rng';
import type { HudScene } from './Hud';

// Gameplay is authored at 360 rows and drawn at 2x (camera zoom 2). The view is VW wide (640..840, follows the
// screen aspect) and the camera now follows the car vertically through a world that is 2 screens tall:
//   y -360..-170  traffic band (Tesla lanes, tops of the towers)
//   y -170..100   middle band (tunnels through black silhouette blocks, skybridges, gaps)
//   y  100..200+  street band (dense breakables / debris, best scrap)
let VW = 640;
const VH = 360, TOP_Y = -360;
const GROUND_Y = 200;
const CAR_W = 128, CAR_H = 72, CAR_CX = 64, CAR_CY = 36;
const RIG_W = 176, RIG_H = 104, RIG_CX = 88, RIG_CY = 52;
const MAX_SPEED = 150, START_SPEED = 95, REV_SPEED = -MAX_SPEED / 3;
const M = 40;
const LANES = [
  { y: -322, v: -135 }, // oncoming (faces left)
  { y: -282, v: 60 },   // same direction (faces right)
  { y: -242, v: -105 }, // oncoming
];
const SHOP_FIRST = 2400, SHOP_EVERY = 5600, SHOP_W = 236;

type Kind = 'solid' | 'breakable';
interface Obstacle {
  kind: Kind; name: string; x: number; y: number; w: number; h: number;
  img: Phaser.GameObjects.Image | null; mask: Mask | null; broken: boolean; tall?: boolean;
}
type DType = 'security' | 'gang';
interface Drone { type: DType; spr: Phaser.GameObjects.Sprite; wx: number; y: number; vx: number; vy: number; hp: number; mode: 'chase' | 'scrap' | 'flee'; target?: Scrap; w: number; h: number; dead: boolean; t: number; stun: number; }
interface Traffic { spr: Phaser.GameObjects.Image; key: string; lane: number; wx: number; y: number; v: number; w: number; h: number; dead: boolean; }
interface Scrap { spr: Phaser.GameObjects.Sprite; wx: number; y: number; value: number; taken: boolean; }
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
  nextX = 0; nextDrone = 0; nextShop = SHOP_FIRST; texN = 0;
  laneState = LANES.map(() => ({ gap: 0, left: 0 }));
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
  state: 'play' | 'totaled' | 'shop' = 'play';
  totaledT = 0; deadVy = 0;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  touch: { x: number; y: number } | null = null;
  autopilot: ((s: LevelScene) => { ix: number; iy: number }) | null = null;
  debug = false;
  dbg!: Phaser.GameObjects.Graphics;
  stats = { smashed: 0, broken: 0, hits: 0, grabbed: 0, stolen: 0, droneWall: 0 };
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
    this.stats = { smashed: 0, broken: 0, hits: 0, grabbed: 0, stolen: 0, droneWall: 0 };
    this.nextX = 700; this.nextDrone = 2.5; this.nextShop = SHOP_FIRST;
    this.laneState = LANES.map(() => ({ gap: 0, left: this.rng.int(2, 4) }));
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
    this.makeWallsTexture();
    this.bg.push(this.makeStrip('p2_walls', -360, 1600, 0.68, 0.68, 4));
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
    this.time.delayedCall(50, () => { this.hud?.setLevels(this.levels); this.hud?.setScrap(this.scrap); });
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
  /** Note 2: a fast "near walls" parallax layer of dark building fronts with gaps that show the city behind. */
  makeWallsTexture() {
    if (this.textures.exists('p2_walls')) return;
    const W = 1600, Hh = 720;
    const ct = this.textures.createCanvas('p2_walls', W, Hh)!;
    const g = ct.getContext();
    const r = new Rng(4242);
    let x = 0;
    const faces = ['#2a2321', '#30282a', '#262022', '#2d2620', '#221e20'];
    while (x < W) {
      const gap = r.int(34, 130), w = Math.min(W - x - gap, r.int(70, 170));
      x += gap;
      if (w < 40) break;
      const top = r.int(210, 520);
      const col = r.pick(faces);
      g.fillStyle = col; g.fillRect(x, top, w, Hh - top);
      // roof clutter: water tank / antenna / parapet steps
      g.fillRect(x + 4, top - 4, w - 8, 4);
      if (r.chance(0.5)) { const ax = x + r.int(8, w - 10); g.fillRect(ax, top - r.int(14, 30), 2, 30); }
      if (r.chance(0.4)) { const tx = x + r.int(6, w - 26); g.fillRect(tx, top - 16, 18, 12); g.fillRect(tx + 3, top - 4, 2, 4); g.fillRect(tx + 13, top - 4, 2, 4); }
      // windows: dim orange / teal, sparse, on a grid
      for (let wy = top + 10; wy < Hh - 6; wy += 12) for (let wx = x + 6; wx < x + w - 8; wx += 10) {
        const k = r.next();
        if (k < 0.12) { g.fillStyle = k < 0.03 ? '#4f6f6c' : '#8a5426'; g.fillRect(wx, wy, 4, 5); }
        else if (k < 0.45) { g.fillStyle = '#1a1617'; g.fillRect(wx, wy, 4, 5); }
      }
      // edge light from the smog
      g.fillStyle = '#4a352a'; g.fillRect(x + w - 2, top, 2, Hh - top);
      // smog haze toward the street
      for (let hy = 360; hy < Hh; hy += 4) { g.fillStyle = `rgba(150,78,34,${Math.min(0.55, (hy - 360) / 520)})`; g.fillRect(x, hy, w, 4); }
      x += w;
    }
    ct.refresh();
    ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
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
    return o;
  }
  /** Pure black silhouette block (tower / tunnel / skybridge deck) drawn into its own canvas; the alpha is the collision mask. */
  addSilhouette(x: number, y: number, w: number, h: number, passages: { y0: number; y1: number }[], roof = true): Obstacle {
    const key = `p2_sil_${this.texN++}`;
    const ct = this.textures.createCanvas(key, w, h)!;
    const g = ct.getContext();
    g.fillStyle = '#000';
    const r = this.rng;
    // jagged roof line with antennas / tanks
    let cx = 0;
    while (cx < w) {
      const seg = Math.min(w - cx, r.int(10, 34));
      const top = roof ? r.int(0, 10) : 0;
      g.fillRect(cx, top + 8, seg, h);
      if (roof && r.chance(0.25)) g.fillRect(cx + r.int(1, Math.max(1, seg - 3)), 0, 2, top + 9);
      cx += seg;
    }
    // passages (tunnels): carve with ragged edges + hanging cables
    for (const p of passages) {
      for (let px = 0; px < w; px += 3) {
        const a = p.y0 + r.int(-2, 2), b = p.y1 + r.int(-2, 2);
        g.clearRect(px, a, 3, b - a);
      }
      g.clearRect(0, p.y0 + 3, w, p.y1 - p.y0 - 6);
      for (let k = 0; k < Math.floor(w / 60); k++) { const hx = r.int(8, w - 8); g.fillRect(hx, p.y0, 1, r.int(4, 12)); }
    }
    ct.refresh();
    ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
    const img = this.add.image(Math.round(x), Math.round(y), key).setOrigin(0).setDepth(11);
    const o: Obstacle = { kind: 'solid', name: key, x: Math.round(x), y: Math.round(y), w, h, img, mask: maskOf(this, key), broken: false, tall: true };
    this.obstacles.push(o);
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
    const spr = this.add.sprite(Math.round(wx), Math.round(y), 'scrap', 0).setOrigin(0.5).setDepth(14);
    spr.play({ key: 'scrap', startFrame: this.rng.int(0, 3) });
    this.scraps.push({ spr, wx, y, value, taken: false });
  }
  /** Note 14: hazy far silhouette of a big tower ahead, drawn between the far and mid skyline layers. */
  addPreview(wx: number, topY: number) {
    if (!this.textures.exists('p2_preview')) {
      const ct = this.textures.createCanvas('p2_preview', 30, 150)!; const g = ct.getContext();
      g.fillStyle = '#5b3a2a'; g.fillRect(4, 10, 22, 140); g.fillRect(0, 30, 30, 120); g.fillRect(13, 0, 3, 12);
      g.fillStyle = '#6e4630'; g.fillRect(24, 30, 6, 120);
      g.fillStyle = '#ff3b2a'; g.fillRect(13, 0, 3, 2);
      ct.refresh(); ct.setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    const img = this.add.image(0, 0, 'p2_preview').setOrigin(0.5, 0).setScrollFactor(0).setDepth(2).setAlpha(0);
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
    }
  }

  // ------------------------------------------------------------------ drones (note 8, 10, 11, 13, 24)
  spawnDrone(type?: DType, behind?: boolean) {
    type = type ?? (this.rng.chance(0.35) ? 'gang' : 'security');
    behind = behind ?? this.rng.chance(0.75);
    const key = `drone_${type}`;
    const h = type === 'gang' ? 26 : 21;
    const wx = behind ? this.scroll - 110 : this.scroll + VW + 20;
    const y = Phaser.Math.Clamp(this.py + this.rng.int(-70, 70), TOP_Y + 10, 200);
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
    else if (d.mode === 'flee') { tx = d.wx + 400; ty = TOP_Y - 80; }
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
  updateTraffic(dt: number) {
    LANES.forEach((ln, i) => {
      const st = this.laneState[i];
      const spawnX = ln.v < 0 || this.speed > ln.v ? this.scroll + VW + 40 : this.scroll - 140;
      const lane = this.traffic.filter((c) => c.lane === i && !c.dead);
      const last = lane.length ? lane.reduce((a, b) => (Math.abs(b.wx - spawnX) < Math.abs(a.wx - spawnX) ? b : a)) : null;
      if (!last || Math.abs(last.wx - spawnX) > st.gap) {
        const key = this.rng.chance(0.55) ? 'hover_white_small' : 'hover_black_small';
        const img = this.add.image(0, 0, key).setOrigin(0).setDepth(19).setFlipX(ln.v > 0);
        const w = key === 'hover_white_small' ? 99 : 100, h = key === 'hover_white_small' ? 26 : 27;
        this.traffic.push({ spr: img, key, lane: i, wx: spawnX, y: ln.y + this.rng.int(-2, 2), v: ln.v * this.rng.range(0.92, 1.08), w, h, dead: false });
        // platoons with Frogger gaps between them (note 12)
        st.left--;
        if (st.left <= 0) { st.left = this.rng.int(3, 5); st.gap = this.rng.int(300, 460); }
        else st.gap = this.rng.int(112, 136);
      }
    });
    for (const c of this.traffic) {
      if (c.dead) continue;
      c.wx += c.v * dt;
      c.spr.setPosition(Math.round(c.wx), Math.round(c.y + Math.sin((this.elapsed + c.wx * 0.01) * 5) * 1));
    }
    this.traffic = this.traffic.filter((c) => {
      if (c.dead) return false;
      if (c.wx < this.scroll - 400 || c.wx > this.scroll + VW + 700) { c.spr.destroy(); return false; }
      return true;
    });
  }
  smashTraffic(c: Traffic, ct: Contact) {
    c.dead = true;
    c.spr.setTexture(c.key + '_smashed');
    this.spark(Math.round(this.px) + ct.sx / ct.n, Math.round(this.py) + ct.sy / ct.n);
    this.time.delayedCall(60, () => {
      const ex = c.spr.x, ey = c.spr.y; c.spr.destroy();
      const s = this.add.sprite(ex - 20, ey - 20, c.key + '_break', 0).setOrigin(0).setDepth(21).setFlipX(c.v > 0).play(c.key + '_break');
      s.once('animationcomplete', () => s.destroy());
      this.explosion(ex + c.w / 2, ey + c.h / 2, 1.5);
      this.burst('fx_debris', ex + c.w / 2, ey + c.h / 2, 12, this.speed, 160);
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
    this.speed *= 0.8;
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
    this.invuln = 1.15;
    this.impact(solid ? 95 : 80, 220, 0.013);
    this.hud?.flash();
    this.car.setTintFill(0xffffff);
    this.time.delayedCall(70, () => this.car.clearTint());
    this.hud?.setLevels(this.levels);
    this.sprV += 60; // struts take the hit
    this.seatFace = 2; this.seatT = 0.7; // note 25: arm up on hits
    if (res.totaled) this.totaled();
  }
  totaled() {
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
    this.time.delayedCall(1300, () => this.hud?.showTotaled());
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
        this.spawnDrone();
        const k = Math.max(0.55, 1 - this.elapsed / 180);
        this.nextDrone = this.rng.range(2.2, 4.2) * k;
      }
    }
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
    const { ix, iy } = this.readInput();
    // ---- notes 4 + 27: throttle. Right = faster, left = slow down to a full hover stop (it locks there for a beat),
    //      keep holding left to reverse at 1/3 speed, all the way back to the start. Releasing keeps the current speed.
    const backL = this.levels[0];
    if (ix > 0) { this.speed = Math.min(MAX_SPEED, this.speed + (this.speed < 0 ? 260 : 120) * ix * dt); this.hoverLock = 0; }
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

    // ---- breakables
    const x0 = this.px - 10, x1 = this.px + CAR_W + 10;
    for (const o of this.obstacles) {
      if (o.kind !== 'breakable' || o.broken || o.x > x1 || o.x + o.w < x0) continue;
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
      const tc = this.contactWithRect(t.wx + 6, t.y + 6, t.w - 12, t.h - 12);
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
        else this.armPrompt = 'SCRAP!  SLOW DOWN TO GRAB IT  (\u25C0)';
      }
    } else if (A.st === 'reach') {
      A.t += dt;
      if (A.t >= A.dur) {
        const s = A.target;
        if (s && !s.taken && near(s, 10)) {
          s.taken = true; this.scrap += s.value; this.stats.grabbed++;
          this.tweens.add({ targets: s.spr, x: Math.round(tipX), y: Math.round(tipY), alpha: 0, duration: 220, onComplete: () => s.spr.destroy() });
          this.floatText(s.wx, s.y - 10, `+${s.value} SCRAP`, '#ffd76a');
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
    for (const o of this.obstacles) { g.lineStyle(1, o.kind === 'solid' ? 0xff3030 : 0x30a0ff, o.broken ? 0.2 : 0.8); g.strokeRect(o.x, o.y, o.w, o.h); }
    g.lineStyle(1, 0xff00ff, 0.9);
    for (const d of this.drones) g.strokeRect(d.wx + 25, d.y + 2, 46, d.h - 4);
    for (const t of this.traffic) g.strokeRect(t.wx + 6, t.y + 6, t.w - 12, t.h - 12);
  }

  // ------------------------------------------------------------------ test hooks (tools/*.mjs)
  setDamage(l: number[]) { this.levels = l.slice(); this.applySectionTextures(); this.hud?.setLevels(this.levels); }
}
