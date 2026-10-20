import Phaser from 'phaser';
import { applyHit, sectionDrawOrder, sectionKey, SECTIONS } from '../game/damage';
import { maskOf, solidAt, Mask } from '../game/mask';
import { Rng } from '../game/rng';
import type { HudScene } from './Hud';

// Gameplay is authored at 640x360 and drawn at 2x (camera zoom 2, origin top-left).
const VW = 640, VH = 360;
const GROUND_Y = 200; // ground strip top-left y
const CAR_W = 172, CAR_H = 97, CAR_CX = 86, CAR_CY = 48;
const CORRIDOR = 128; // min vertical gap kept open between solids
const BASE_SPEED = 92, MAX_SPEED = 135;
const RIG_W = 232, RIG_H = 132, RIG_CX = 124, RIG_CY = 66; // car render target (1x world pixels)
const M = 32; // off-screen margin on full-screen layers so camera shake never shows an empty edge

type Kind = 'solid' | 'breakable';
interface Obstacle {
  kind: Kind; name: string; x: number; y: number; w: number; h: number;
  img: Phaser.GameObjects.Image; mask: Mask; broken: boolean; overhang: boolean;
}
type EType = 'drone' | 'hover_white' | 'hover_black';
type Pattern = 'dive' | 'weave' | 'ram' | 'lane';
interface Enemy {
  type: EType; pattern: Pattern; spr: Phaser.GameObjects.Sprite;
  rx: number; y: number; baseY: number; vx: number; vy: number; t: number; phase: number;
  hb: number[]; w: number; h: number; dead: boolean;
}
interface Particle { spr: Phaser.GameObjects.Image; x: number; y: number; vx: number; vy: number; g: number; life: number; flip: number; }
interface Floater { spr: Phaser.GameObjects.Sprite; x: number; y: number; vx: number; vy: number; g: number; }
interface Contact { n: number; sx: number; sy: number; }
/** A repeat-x layer made of plain 1:1 image copies (no resampling), positioned at integer pixels. */
interface Strip { imgs: Phaser.GameObjects.Image[]; w: number; f: number; }

export class LevelScene extends Phaser.Scene {
  m: any;
  rng!: Rng;
  hud!: HudScene;
  // world
  scroll = 0; speed = BASE_SPEED; slow = 1; elapsed = 0;
  bg: Strip[] = [];
  ground!: Strip;
  groundHm: number[] = []; groundStep = 4;
  obstacles: Obstacle[] = [];
  enemies: Enemy[] = [];
  particles: Particle[] = [];
  floaters: Floater[] = [];
  nextX = 0; nextEnemy = 0;
  // player
  car!: Phaser.GameObjects.Image;          // displays the 1x car render target
  rig!: Phaser.GameObjects.Container;      // off-display-list: sections, flame, engine, gear
  carRT!: Phaser.Textures.DynamicTexture;
  secImgs: Phaser.GameObjects.Image[] = [];
  flame!: Phaser.GameObjects.Sprite;
  engine!: Phaser.GameObjects.Image;
  gear!: Phaser.GameObjects.Image;
  carPts: { x: number; y: number }[] = [];
  carBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  sx = 60; py = 120; vx = 0; vy = 0; tilt = 0;
  levels = [0, 0, 0];
  invuln = 0; hitStop = 0; flashT = 0;
  state: 'play' | 'totaled' = 'play';
  totaledT = 0; deadVy = 0;
  // input
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  touch: { x: number; y: number } | null = null;
  autopilot: ((s: LevelScene) => { ix: number; iy: number }) | null = null;
  debug = false;
  dbg!: Phaser.GameObjects.Graphics;
  stats = { smashed: 0, broken: 0, hits: 0 };
  noSpawn = false;
  noEnemies = false;

  constructor() { super('Level'); }

  create() {
    this.m = this.cache.json.get('manifest');
    const q = new URLSearchParams(location.search);
    const seed = Number(q.get('seed')) || (Date.now() & 0xffffff);
    this.rng = new Rng(seed);
    this.noSpawn = q.get('nospawn') === '1';
    this.noEnemies = q.get('noenemies') === '1';
    this.scroll = 0; this.speed = BASE_SPEED; this.slow = 1; this.elapsed = 0;
    this.obstacles = []; this.enemies = []; this.particles = []; this.floaters = []; this.bg = [];
    this.levels = [0, 0, 0]; this.invuln = 0; this.hitStop = 0; this.state = 'play'; this.totaledT = 0;
    this.sx = 60; this.py = 110; this.vx = 0; this.vy = 0; this.tilt = 0;
    this.stats = { smashed: 0, broken: 0, hits: 0 };
    this.nextX = 760; this.nextEnemy = 3.0;
    this.anims.globalTimeScale = 1;

    const cam = this.cameras.main;
    cam.setOrigin(0, 0).setZoom(2).setScroll(0, 0).setRoundPixels(true).setBackgroundColor('#1e1919'); // = sky top row
    cam.fadeIn(300, 0, 0, 0);

    // ---- parallax (a sky .1, b far .25, c mid .5, d near .8)
    this.m.parallax.layers.forEach((l: any, i: number) => {
      const key = ['bg_a', 'bg_b', 'bg_c', 'bg_d'][i];
      this.bg.push(this.makeStrip(key, l.y, l.size[0], l.speed_factor, i));
    });
    // ---- black silhouette collision layer: ground strip (1.0)
    const gs = this.m.collision_layer.pieces.ground_strip;
    this.groundHm = gs.heightmap_top_y; this.groundStep = gs.heightmap_step;
    this.ground = this.makeStrip('ground_strip', GROUND_Y, gs.size[0], 1, 12);
    this.add.rectangle(-M, VH, VW + 2 * M, M, 0x000000).setOrigin(0).setScrollFactor(0).setDepth(12);

    // ---- player car: one layer per section (sorted by level), flame, rear engine, front gear
    // The car is composed and tilted at 1x into a small render target, which is then drawn at 2x
    // like everything else, so the tilt never breaks the 640x360 pixel grid.
    this.rig = this.make.container({ x: 0, y: 0 }, false);
    this.secImgs = [];
    for (let i = 0; i < 3; i++) this.secImgs.push(this.make.image({ x: -CAR_CX, y: -CAR_CY, key: sectionKey(SECTIONS[i], 0), origin: 0 }, false));
    const fl = this.m.player_car_fade.flame;
    const np = this.m.player_car_fade.engine_nozzle_point;
    this.flame = this.make.sprite({ x: -CAR_CX + np[0] - fl.anchor_in_frame[0], y: -CAR_CY + np[1] - fl.anchor_in_frame[1], key: 'car_flame', origin: 0 }, false);
    this.flame.play('car_flame');
    this.engine = this.make.image({ x: -CAR_CX, y: -CAR_CY, key: 'car_rear_engine', origin: 0 }, false);
    this.gear = this.make.image({ x: -CAR_CX, y: -CAR_CY, key: 'car_front_gear', origin: 0 }, false);
    this.rig.add([...this.secImgs, this.flame, this.engine, this.gear]);
    const rt = this.textures.exists('car_rt') ? (this.textures.get('car_rt') as Phaser.Textures.DynamicTexture) : this.textures.addDynamicTexture('car_rt', RIG_W, RIG_H)!;
    rt.setFilter(Phaser.Textures.FilterMode.NEAREST);
    this.carRT = rt;
    this.car = this.add.image(0, 0, 'car_rt').setOrigin(0).setDepth(30);
    this.applySectionTextures();
    this.buildCarPoints();

    this.dbg = this.add.graphics().setDepth(100);

    // ---- input
    const kb = this.input.keyboard!;
    this.cursors = kb.createCursorKeys();
    this.keys = kb.addKeys('W,A,S,D,R,ENTER,ESC,SHIFT') as any;
    kb.on('keydown-D', () => { this.debug = !this.debug; this.hud?.setDebug(this.debug); });
    kb.on('keydown-R', () => this.restart());
    kb.on('keydown-ESC', () => this.toSelect());
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.state === 'totaled' && this.totaledT > 1.2) { this.restart(); return; }
      this.touch = { x: p.x / 2, y: p.y / 2 };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) this.touch = { x: p.x / 2, y: p.y / 2 }; });
    this.input.on('pointerup', () => (this.touch = null));

    this.scene.launch('Hud');
    this.hud = this.scene.get('Hud') as HudScene;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.scene.stop('Hud'); this.rig.destroy(); this.secImgs = []; });

    this.generateUntil(VW + 400);
    (window as any).__gg.level = this;
  }

  makeStrip(key: string, y: number, w: number, f: number, depth: number): Strip {
    const n = Math.ceil((VW + 2 * M) / w) + 2;
    const imgs = [];
    for (let i = 0; i < n; i++) imgs.push(this.add.image(0, y, key).setOrigin(0).setScrollFactor(0).setDepth(depth));
    return { imgs, w, f };
  }
  placeStrip(st: Strip, sc: number) {
    const off = ((Math.floor(sc * st.f) % st.w) + st.w) % st.w;
    let x0 = -off;
    if (x0 > -M) x0 -= st.w;
    st.imgs.forEach((im, i) => (im.x = x0 + i * st.w));
  }

  restart() { this.scene.restart(); }
  toSelect() { this.scene.stop('Hud'); this.scene.start('Select'); }

  // ------------------------------------------------------------------ car layers
  applySectionTextures() {
    const order = sectionDrawOrder(this.levels);
    order.forEach((o, i) => this.secImgs[i].setTexture(sectionKey(o.sec, o.level)));
  }

  buildCarPoints() {
    const mk = maskOf(this, 'car_composite');
    this.carPts = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let y = 0; y < mk.h; y += 2) for (let x = 0; x < mk.w; x += 2) {
      if (mk.a[y * mk.w + x]) {
        this.carPts.push({ x, y });
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    this.carBox = { x0, y0, x1, y1 };
  }

  get px() { return this.scroll + this.sx; }

  sectionAtLocalX(lx: number): number {
    const r = this.m.player_car_fade.section_x_ranges_suggestion;
    if (lx < r.middle[0]) return 0;
    if (lx < r.front[0]) return 1;
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
  solidsIn(x0: number, x1: number, overhang: boolean) {
    return this.obstacles.filter((o) => o.kind === 'solid' && o.overhang === overhang && o.x < x1 && o.x + o.w > x0);
  }
  lowestOverhangBottom(x0: number, x1: number) { return this.solidsIn(x0, x1, true).reduce((m, o) => Math.max(m, o.y + o.h), 20); }
  highestBuildingTop(x0: number, x1: number) {
    return Math.min(this.groundMin(x0, x1), this.solidsIn(x0, x1, false).reduce((m, o) => Math.min(m, o.y), 1e9));
  }

  addPiece(name: string, x: number, y: number, depth: number): Obstacle {
    const p = this.m.collision_layer.pieces[name];
    const img = this.add.image(Math.round(x), Math.round(y), name).setOrigin(0).setDepth(depth);
    const o: Obstacle = { kind: p.tag, name, x: Math.round(x), y: Math.round(y), w: p.size[0], h: p.size[1], img, mask: maskOf(this, name), broken: false, overhang: name.startsWith('solid_overhang') };
    this.obstacles.push(o);
    return o;
  }

  addBuilding(x: number, name?: string): Obstacle | null {
    name = name ?? `solid_bldg_${this.rng.int(1, 5)}`;
    const [w, h] = this.m.collision_layer.pieces[name].size;
    const above = this.lowestOverhangBottom(x - 90, x + w + 90);
    const minTop = Math.max(20 + CORRIDOR, above + CORRIDOR);
    let bottom = this.rng.int(332, 350);
    if (bottom - h < minTop) bottom = minTop + h;
    if (bottom - h > 280) return null; // would be hidden behind the ground anyway
    return this.addPiece(name, x, bottom - h, 11);
  }

  addOverhang(x: number): Obstacle | null {
    const name = `solid_overhang_${this.rng.int(1, 5)}`;
    const [w, h] = this.m.collision_layer.pieces[name].size;
    const below = this.highestBuildingTop(x - 90, x + w + 90);
    const maxBottom = below - CORRIDOR;
    let bottom = this.rng.int(70, Math.min(h, 165));
    bottom = Math.min(bottom, maxBottom);
    if (bottom < 40) return null;
    return this.addPiece(name, x, bottom - h, 11);
  }

  roofY(b: Obstacle, wx0: number, wx1: number) {
    let m = 1e9;
    for (let x = Math.max(b.x, wx0); x <= Math.min(b.x + b.w - 1, wx1); x++) {
      const t = b.mask.top[x - b.x];
      if (t >= 0) m = Math.min(m, b.y + t);
    }
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
    // roof under the middle of the piece; the base sinks behind the building silhouette
    const roof = this.roofY(b, x + w * 0.3, x + w * 0.7);
    if (roof > 1e8) return null;
    return this.addPiece(name, x, roof + 4 - h, 10);
  }

  generateUntil(limit: number) {
    while (this.nextX < limit) {
      const x = this.nextX;
      const r = this.rng.next();
      let used = 80;
      if (r < 0.24) {
        const b = this.addBuilding(x); used = b ? b.w : 60;
        if (b && this.rng.chance(0.35)) this.addBreakableOnRoof(b);
      } else if (r < 0.46) {
        const o = this.addOverhang(x); used = o ? o.w : 60;
      } else if (r < 0.62) {
        // building + overhang staggered: forces a weave but keeps a CORRIDOR-high gap
        const b = this.addBuilding(x);
        const o = this.addOverhang(x + (b ? b.w : 60) + this.rng.int(70, 130));
        used = (o ? o.x + o.w : x + 140) - x;
      } else if (r < 0.80) {
        const k = this.rng.int(1, 2);
        let cx = x;
        for (let i = 0; i < k; i++) { const p = this.addBreakableOnGround(cx); cx += p.w + this.rng.int(20, 80); }
        used = cx - x;
      } else if (r < 0.92) {
        // cable span strung between two buildings
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
      } else {
        // thin wall + sign low on the deck (dip to smash them)
        const p = this.addBreakableOnGround(x, 'brk_thin_wall');
        const q = this.addBreakableOnGround(x + p.w + this.rng.int(30, 90));
        used = q.x + q.w - x;
      }
      this.nextX = x + used + this.rng.int(70, 190);
    }
  }

  // ------------------------------------------------------------------ enemies
  spawnEnemy(type?: EType, pattern?: Pattern, rx = VW + 10, y?: number) {
    type = type ?? (this.rng.chance(0.6) ? 'drone' : this.rng.pick(['hover_white', 'hover_black'] as EType[]));
    const isDrone = type === 'drone';
    pattern = pattern ?? (isDrone ? this.rng.pick(['dive', 'weave', 'dive'] as Pattern[]) : this.rng.pick(['ram', 'lane'] as Pattern[]));
    const em = this.m.enemies[type];
    const [w, h] = isDrone ? em.fly.frame_size : em.idle.size;
    const pc = this.py + CAR_CY;
    const yy = y ?? (pattern === 'ram' ? Phaser.Math.Clamp(pc - h / 2 + 10, 30, 230) : pattern === 'dive' ? this.rng.int(18, 80) : this.rng.int(40, 200));
    const spr = this.add.sprite(0, 0, isDrone ? 'drone_fly' : type, 0).setOrigin(0).setDepth(20);
    if (isDrone) spr.play({ key: 'drone_fly', startFrame: this.rng.int(0, 3) });
    const e: Enemy = { type, pattern, spr, rx, y: yy, baseY: yy, vx: 0, vy: 0, t: 0, phase: 0, hb: em.hitbox_suggestion_xywh, w, h, dead: false };
    this.enemies.push(e);
    this.placeEnemy(e);
    return e;
  }

  placeEnemy(e: Enemy) {
    let bob = 0;
    if (e.type !== 'drone') bob = Math.round(Math.sin((e.t / 1.2) * Math.PI * 2) * 1.5);
    e.spr.setPosition(Math.round(this.scroll + e.rx), Math.round(e.y) + bob);
  }

  updateEnemy(e: Enemy, dt: number) {
    e.t += dt;
    const pcx = this.sx + CAR_CX, pcy = this.py + CAR_CY;
    switch (e.pattern) {
      case 'weave':
        e.rx -= 85 * dt;
        e.y = e.baseY + Math.sin(e.t * 2.6) * 34;
        break;
      case 'dive':
        if (e.phase === 0) { // approach high
          e.rx -= 120 * dt; e.y = e.baseY + Math.sin(e.t * 4) * 4;
          if (e.rx < 470 || e.rx < pcx + 170) { e.phase = 1; e.t = 0; }
        } else if (e.phase === 1) { // hover + wobble (telegraph)
          e.y = e.baseY + Math.sin(e.t * 30) * 2;
          if (e.t > 0.45) {
            const tx = pcx - (e.rx + e.w / 2), ty = pcy - (e.y + e.h / 2);
            const d = Math.hypot(tx, ty) || 1;
            e.vx = (tx / d) * 230; e.vy = (ty / d) * 230; e.phase = 2;
          }
        } else { e.rx += e.vx * dt; e.y += e.vy * dt; e.vy += 40 * dt; }
        break;
      case 'ram':
        if (e.phase === 0) {
          e.rx -= 110 * dt; e.y += Phaser.Math.Clamp(pcy - (e.y + e.h / 2), -60 * dt, 60 * dt);
          if (e.rx < 520) { e.phase = 1; e.t = 0; }
        } else if (e.phase === 1) { // rev up: little shudder
          e.rx += Math.sin(e.t * 60) * 0.6;
          if (e.t > 0.5) { e.phase = 2; e.vx = -120; }
        } else {
          e.vx = Math.max(-340, e.vx - 500 * dt); e.rx += e.vx * dt;
          e.y += Phaser.Math.Clamp(pcy - (e.y + e.h / 2), -45 * dt, 45 * dt);
        }
        break;
      case 'lane':
        e.rx -= 150 * dt;
        if (e.t > 0.9 && e.phase === 0) { e.phase = 1; e.baseY = Phaser.Math.Clamp(pcy - e.h / 2, 30, 230); }
        e.y += Phaser.Math.Clamp(e.baseY - e.y, -70 * dt, 70 * dt);
        break;
    }
    this.placeEnemy(e);
  }

  // ------------------------------------------------------------------ collision helpers
  contactWithMask(o: { x: number; y: number; w: number; h: number; mask: Mask }): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py);
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (cx + this.carBox.x1 < o.x || cx + this.carBox.x0 > o.x + o.w || cy + this.carBox.y1 < o.y || cy + this.carBox.y0 > o.y + o.h) return c;
    for (const p of this.carPts) {
      if (solidAt(o.mask, cx + p.x - o.x, cy + p.y - o.y)) { c.n++; c.sx += p.x; c.sy += p.y; }
    }
    return c;
  }
  contactWithGround(): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py);
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (cy + this.carBox.y1 < GROUND_Y) return c;
    for (const p of this.carPts) if (cy + p.y >= this.groundTopAt(cx + p.x)) { c.n++; c.sx += p.x; c.sy += p.y; }
    return c;
  }
  contactWithRect(x: number, y: number, w: number, h: number): Contact {
    const cx = Math.round(this.px), cy = Math.round(this.py);
    const c: Contact = { n: 0, sx: 0, sy: 0 };
    if (cx + this.carBox.x1 < x || cx + this.carBox.x0 > x + w || cy + this.carBox.y1 < y || cy + this.carBox.y0 > y + h) return c;
    for (const p of this.carPts) {
      const X = cx + p.x, Y = cy + p.y;
      if (X >= x && X < x + w && Y >= y && Y < y + h) { c.n++; c.sx += p.x; c.sy += p.y; }
    }
    return c;
  }
  solidContacts(): { c: Contact; push: number } {
    const all: Contact = { n: 0, sx: 0, sy: 0 };
    let push = 0;
    const g = this.contactWithGround();
    if (g.n) { all.n += g.n; all.sx += g.sx; all.sy += g.sy; push -= g.n; }
    const x0 = this.px - 10, x1 = this.px + CAR_W + 10;
    for (const o of this.obstacles) {
      if (o.kind !== 'solid' || o.x > x1 || o.x + o.w < x0) continue;
      const c = this.contactWithMask(o);
      if (c.n) { all.n += c.n; all.sx += c.sx; all.sy += c.sy; push += o.overhang ? c.n : -c.n; }
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
      const s = this.add.sprite(Math.round(x), Math.round(y), 'fx_explosion', 0).setOrigin(0.5).setScale(scale).setDepth(42).play('fx_explosion');
      s.once('animationcomplete', () => s.destroy());
    });
  }
  burst(key: 'black_shards' | 'fx_debris', x: number, y: number, n: number, vx0: number, spread: number, depth = 41) {
    for (let i = 0; i < n; i++) {
      const spr = this.add.image(Math.round(x), Math.round(y), key, this.rng.int(0, 15)).setOrigin(0.5).setDepth(depth);
      this.particles.push({ spr, x, y, vx: vx0 + this.rng.range(-spread, spread), vy: this.rng.range(-230, -30), g: 650, life: this.rng.range(0.9, 1.6), flip: this.rng.range(0.05, 0.15) });
    }
  }

  impact(ms: number, shakeMs: number, intensity: number) {
    this.hitStop = Math.max(this.hitStop, ms);
    this.cameras.main.shake(shakeMs, intensity, true);
  }

  // ------------------------------------------------------------------ events
  breakPiece(o: Obstacle, c: Contact) {
    o.broken = true;
    o.img.setVisible(false);
    const b = this.m.collision_layer.pieces[o.name].break;
    const s = this.add.sprite(o.x + b.offset_from_piece_origin[0], o.y + b.offset_from_piece_origin[1], o.name + '_break', 0).setOrigin(0).setDepth(15).play(o.name + '_break');
    s.once('animationcomplete', () => s.destroy());
    const wx = Math.round(this.px) + c.sx / c.n, wy = Math.round(this.py) + c.sy / c.n;
    this.spark(wx, wy);
    this.burst('black_shards', wx + 6, wy, 14, this.speed + 60, 120, 16);
    this.slow = 0.55;
    this.vx -= 35;
    this.impact(45, 110, 0.004);
    this.stats.broken++;
  }

  smashEnemy(e: Enemy, c: Contact | null) {
    e.dead = true;
    const em = this.m.enemies[e.type];
    const isDrone = e.type === 'drone';
    e.spr.stop();
    e.spr.setTexture(isDrone ? 'drone_smashed' : e.type + '_smashed');
    const ex = e.spr.x, ey = e.spr.y;
    if (c && c.n) this.spark(Math.round(this.px) + c.sx / c.n, Math.round(this.py) + c.sy / c.n);
    this.time.delayedCall(70, () => {
      const off = isDrone ? em.break.offset_from_sprite_origin : em.break.offset_from_sprite_origin;
      e.spr.destroy();
      const s = this.add.sprite(ex + off[0], ey + off[1], e.type + '_break', 0).setOrigin(0).setDepth(21).play(e.type + '_break');
      this.floaters.push({ spr: s, x: s.x, y: s.y, vx: this.speed * 0.55, vy: -40, g: 220 });
      s.once('animationcomplete', () => s.destroy());
      const cx = ex + e.w / 2, cy = ey + e.h / 2;
      this.explosion(cx, cy, isDrone ? 1 : 2);
      this.burst('fx_debris', cx, cy, isDrone ? 9 : 14, this.speed + 40, 150);
    });
    this.impact(75, 160, 0.008);
    this.stats.smashed++;
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
    this.carTint(70);
    this.hud?.setLevels(this.levels);
    if (res.totaled) this.totaled();
  }

  carTint(ms: number) {
    this.car.setTintFill(0xffffff);
    this.time.delayedCall(ms, () => this.car.clearTint());
  }

  totaled() {
    this.state = 'totaled';
    this.totaledT = 0;
    this.deadVy = -60;
    this.flame.setVisible(false);
    const cx = Math.round(this.px) + CAR_CX, cy = Math.round(this.py) + CAR_CY;
    this.explosion(cx, cy, 2, 0);
    this.explosion(cx - 48, cy + 4, 1, 120);
    this.explosion(cx + 50, cy - 6, 1, 220);
    this.explosion(cx - 10, cy - 14, 2, 380);
    this.explosion(cx + 24, cy + 10, 1, 560);
    this.burst('fx_debris', cx, cy, 22, this.speed, 220);
    this.burst('black_shards', cx, cy, 14, this.speed, 200);
    this.time.delayedCall(30, () => this.cameras.main.shake(650, 0.014, true));
    this.hud?.flash(0.8);
    this.time.delayedCall(1300, () => this.hud?.showTotaled());
  }

  // ------------------------------------------------------------------ main loop
  update(_t: number, dms: number) {
    let dt = Math.min(dms, 50) / 1000;
    if (this.hitStop > 0) {
      this.hitStop -= dms;
      this.anims.globalTimeScale = 0;
      return;
    }
    this.anims.globalTimeScale = 1;
    this.elapsed += dt;

    // ---- scroll
    if (this.state === 'play') {
      this.speed = Math.min(MAX_SPEED, BASE_SPEED + this.elapsed * 0.45);
      this.slow = Math.min(1, this.slow + dt * 1.4);
    } else {
      this.totaledT += dt;
      this.speed = Math.max(0, this.speed - 90 * dt);
    }
    const ds = this.speed * this.slow * dt;
    this.scroll += ds;
    const sc = Math.floor(this.scroll);
    this.cameras.main.scrollX = sc;
    for (const l of this.bg) this.placeStrip(l, sc);
    this.placeStrip(this.ground, sc);

    // ---- player
    if (this.state === 'play') this.updatePlayer(dt);
    else this.updateWreck(dt);

    // ---- world spawn / cull
    if (!this.noSpawn) this.generateUntil(sc + VW + 300);
    this.obstacles = this.obstacles.filter((o) => {
      if (o.x + o.w < sc - 40) { o.img.destroy(); return false; }
      return true;
    });
    if (this.state === 'play' && !this.noSpawn && !this.noEnemies) {
      this.nextEnemy -= dt;
      if (this.nextEnemy <= 0) {
        this.spawnEnemy();
        const k = Math.max(0.55, 1 - this.elapsed / 180);
        this.nextEnemy = this.rng.range(1.7, 3.3) * k;
      }
    }
    for (const e of this.enemies) if (!e.dead) this.updateEnemy(e, dt);
    this.enemies = this.enemies.filter((e) => {
      if (e.dead) return false;
      if (e.rx < -220 || e.y > VH + 40 || e.y < -120) { e.spr.destroy(); return false; }
      return true;
    });

    // ---- particles / floaters (world space)
    this.particles = this.particles.filter((p) => {
      p.life -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.spr.setPosition(Math.round(p.x), Math.round(p.y));
      p.flip -= dt; if (p.flip <= 0) { p.flip = 0.09; p.spr.setFlipX(!p.spr.flipX); if (Math.random() < 0.5) p.spr.setFlipY(!p.spr.flipY); }
      if (p.life <= 0 || p.y > VH + 20) { p.spr.destroy(); return false; }
      return true;
    });
    this.floaters = this.floaters.filter((f) => {
      if (!f.spr.active) return false;
      f.vy += f.g * dt; f.x += f.vx * dt; f.y += f.vy * dt;
      f.spr.setPosition(Math.round(f.x), Math.round(f.y));
      return true;
    });

    this.hud?.setDistance(Math.floor(this.scroll / 8));
    if (this.debug) this.drawDebug(); else this.dbg.clear();
  }

  readInput(): { ix: number; iy: number } {
    if (this.autopilot) return this.autopilot(this);
    const k = this.keys, c = this.cursors;
    let ix = (c.right.isDown || k.D.isDown ? 1 : 0) - (c.left.isDown || k.A.isDown ? 1 : 0);
    let iy = (c.down.isDown || k.S.isDown ? 1 : 0) - (c.up.isDown || k.W.isDown ? 1 : 0);
    if (this.touch) {
      ix = Phaser.Math.Clamp((this.touch.x - (this.sx + CAR_CX)) / 40, -1, 1);
      iy = Phaser.Math.Clamp((this.touch.y - (this.py + CAR_CY)) / 30, -1, 1);
    }
    return { ix, iy };
  }

  updatePlayer(dt: number) {
    const { ix, iy } = this.readInput();
    // weighty hover: velocity eases toward the stick target, slower to start than to stop
    const tvx = ix * 125, tvy = iy * 170;
    const ax = 1 - Math.exp(-dt * (ix ? 3.2 : 4.5));
    const ay = 1 - Math.exp(-dt * (iy ? 4.2 : 5.5));
    this.vx += (tvx - this.vx) * ax;
    this.vy += (tvy - this.vy) * ay;
    // gentle drift back toward the left third when idle
    if (!ix) this.vx += (90 - this.sx) * 0.15 * dt;
    this.sx = Phaser.Math.Clamp(this.sx + this.vx * dt, 8, 330);
    this.py = Phaser.Math.Clamp(this.py + this.vy * dt, -this.carBox.y0 + 2, 300);
    if (this.sx <= 8 || this.sx >= 330) this.vx *= 0.5;

    // ---- solids: damage + push out toward open air
    const { c, push } = this.solidContacts();
    if (c.n) {
      const dir = push >= 0 ? 1 : -1;
      if (this.invuln <= 0) {
        this.damageCar(c, true);
        this.vy = dir * 150; this.vx = Math.min(this.vx, 0) - 70; this.slow = Math.min(this.slow, 0.75);
      }
      for (let i = 0; i < 28; i++) {
        this.py += dir;
        if (!this.solidContacts().c.n) break;
        if (i === 27) this.sx = Math.max(8, this.sx - 4);
      }
      if (Math.sign(this.vy) !== dir) this.vy *= 0.3;
    }
    if (this.state !== 'play') return;

    // ---- breakables
    const x0 = this.px - 10, x1 = this.px + CAR_W + 10;
    for (const o of this.obstacles) {
      if (o.kind !== 'breakable' || o.broken || o.x > x1 || o.x + o.w < x0) continue;
      const bc = this.contactWithMask(o);
      if (bc.n > 1) this.breakPiece(o, bc);
    }
    // ---- enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      const ec = this.contactWithRect(e.spr.x + e.hb[0], e.spr.y + e.hb[1], e.hb[2], e.hb[3]);
      if (ec.n) {
        this.smashEnemy(e, ec);
        if (this.invuln <= 0) { this.damageCar(ec, false); this.vx -= 40; if (this.state !== 'play') return; }
      }
    }

    // ---- presentation
    this.invuln = Math.max(0, this.invuln - dt);
    this.car.setAlpha(this.invuln > 0 && this.invuln < 5 && Math.floor(this.invuln * 14) % 2 === 0 ? 0.35 : 1);
    const targetTilt = (this.vy / 170) * 5 - (this.vx / 125) * 1.2;
    this.tilt += (targetTilt - this.tilt) * (1 - Math.exp(-dt * 8));
    const bob = Math.round(Math.sin(this.elapsed * 2.4) * 1.2);
    this.flame.anims.timeScale = ix > 0 ? 1.6 : ix < 0 ? 0.6 : 1;
    this.drawCar(bob);
  }

  updateWreck(dt: number) {
    this.car.setAlpha(1);
    let gsum = 0, gn = 0;
    for (let x = this.px + 30; x <= this.px + 150; x += 4) { gsum += this.groundTopAt(x); gn++; }
    const floor = gsum / gn - 66; // body bottom (~row 66) rests on the average deck height
    if (this.py < floor) {
      this.deadVy += 420 * dt; this.py = Math.min(floor, this.py + this.deadVy * dt);
      this.tilt += (12 - this.tilt) * dt * 2;
    } else { this.deadVy = 0; this.tilt += (4 - this.tilt) * dt * 4; }
    this.sx -= this.speed * this.slow * dt * 0; // wreck stays with the (slowing) camera
    this.drawCar(0);
  }

  /** Compose the car at 1x (with tilt) into the render target and place it on integer world pixels. */
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
    const r = this.m.player_car_fade.section_x_ranges_suggestion;
    g.lineStyle(1, 0xffff00, 0.8);
    for (const k of ['middle', 'front']) g.lineBetween(cx + r[k][0], cy + 20, cx + r[k][0], cy + 80);
    for (const o of this.obstacles) {
      g.lineStyle(1, o.kind === 'solid' ? 0xff3030 : 0x30a0ff, o.broken ? 0.2 : 0.8);
      g.strokeRect(o.x, o.y, o.w, o.h);
    }
    g.lineStyle(1, 0xff00ff, 0.9);
    for (const e of this.enemies) g.strokeRect(e.spr.x + e.hb[0], e.spr.y + e.hb[1], e.hb[2], e.hb[3]);
    g.lineStyle(1, 0xff8800, 0.7);
    const sc = Math.floor(this.scroll);
    g.beginPath();
    for (let x = sc; x <= sc + VW; x += 4) { const y = this.groundTopAt(x); if (x === sc) g.moveTo(x, y); else g.lineTo(x, y); }
    g.strokePath();
  }

  // ------------------------------------------------------------------ test hooks (used by tools/play.mjs)
  setDamage(l: number[]) { this.levels = l.slice(); this.applySectionTextures(); this.hud?.setLevels(this.levels); }
}
