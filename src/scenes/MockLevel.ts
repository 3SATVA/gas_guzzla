import Phaser from 'phaser';
import { Fighter, FY } from '../fight/Fighter';
import { Inp, MoveSet, NO_INPUT } from '../fight/types';
import { isTouch, liteMode } from '../game/lite';

/**
 * MOCK street level for Seek (side-scrolling): walk, tag walls, paint security cameras, spray / kick drones,
 * and at the end meet the CYLOBOT, which hands over to the existing KO-style fight (FightScene).
 * Relaxed art = brawler/v1/seek_sprites_v4 clips (atlas `ml_seek`); guard art = the V1-face fight moves (`ft_seek`).
 * Everything is a 60 Hz tick state machine like the fight; sprites are drawn 1:1 (no resampling).
 */

const TICK = 1000 / 60;
const WORLD_W = 6900;
const START_X = 300;
const BOSS_X = 6000;          // crossing this brings in the CYLOBOT
const CAM_Y = 72;             // security camera mount: 10% below the top of a 720 high screen
const CAM_RANGE: [number, number] = [-120, 270];   // camera x minus hero x: 270 px = about 3 ft at Seek's scale
const WALL_REACH = 160;       // how far from the wall spot SPRAY still starts a tag (she glides to the spot)
const GUARD_DROP = 360;       // 6 s without fighting: guard down
const SPEED = 358 / 85;       // px per tick, = one walk stride per walk cycle (same as the fight walk)
const CAN_COLORS = [0xff2d95, 0x1fd1e0, 0xa6e22e, 0xff8a1f, 0x8a4dff];

interface Clip { frames: string[]; fps: number; loop: boolean; anchor: [number, number]; canvas: [number, number]; tips: ([number, number] | null)[] | null }
interface Step { clip: string; speed?: number; ticks?: number; pp?: [number, number]; onStart?: () => void; onTick?: (t: number, step: Step) => void; onEnd?: () => void; t: number; f: number; started: boolean }
type Mode = 'relaxed' | 'seq' | 'guard' | 'boss';
interface Wall { spot: number; done: boolean; panel: Phaser.GameObjects.Image; tag?: Phaser.GameObjects.Image; kind: number }
interface Cam { x: number; spr: Phaser.GameObjects.Sprite; paint: Phaser.GameObjects.Sprite; drips: Phaser.GameObjects.Graphics; state: 'scan' | 'painted'; f: number; ft: number; dir: number; blink: number; exposure: number; color: number; dripT: number }
interface Drone { x: number; y: number; vx: number; vy: number; rot: number; spin: number; state: 'hover' | 'confused' | 'flee' | 'crash' | 'wreck' | 'gone'; t: number; spr: Phaser.GameObjects.Sprite; paint: Phaser.GameObjects.Sprite; painted: boolean; color: number; exposure: number; baseY: number; slot: number; fi: number; ft: number; seed: number; life: number }
interface Mist { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: number; grow: number }
interface TBtn { id: string; x: number; y: number; r: number; g: Phaser.GameObjects.Arc; t: Phaser.GameObjects.Text }

export class MockLevelScene extends Phaser.Scene {
  private lite = false;
  private clips: Record<string, Clip> = {};
  private props: Record<string, { frames: string[]; anchor: [number, number]; ms: number; loop: boolean }> = {};
  private mode: Mode = 'relaxed';
  private t = 0; private acc = 0;
  // hero
  private hero!: Phaser.GameObjects.Sprite;
  private F!: Fighter; private foe = { bodyX: () => 0 } as Fighter;
  private hx = START_X;
  private move: 'idle' | 'start' | 'loop' = 'idle'; private clipName = 'idle_a'; private cf = 0; private moveDir = 1; private walkT = 0;
  private seq: Step[] = []; private seqDone: (() => void) | null = null;
  private canOut = false;
  private guardT = 0; private guardAt = 0;
  private pending: (() => void) | null = null;
  private lastTip: [number, number] | null = null;
  // world
  private walls: Wall[] = []; private cams: Cam[] = []; private drones: Drone[] = [];
  private waves = [{ x: 2400, n: 2, done: false }, { x: 4300, n: 3, done: false }];
  private mist: Mist[] = []; private mistG!: Phaser.GameObjects.Graphics;
  private scrollX = 0; private lockScroll: number | null = null;
  // cans (amount left, 1 = full)
  private cans = [1, 1, 1, 1, 1];
  private canUsed = 0;
  private stats = { tags: 0, camsPainted: 0, dronesPainted: 0, dronesCrashed: 0 };
  // hud
  private hudG!: Phaser.GameObjects.Graphics; private hudTxt!: Phaser.GameObjects.Text; private hudCount!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text; private help!: Phaser.GameObjects.Text; private banner!: Phaser.GameObjects.Text; private warn!: Phaser.GameObjects.Rectangle;
  private escBtn!: Phaser.GameObjects.Text;
  // input
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private buf = { punch: 0, kick: 0, spray: 0, act: 0 };
  private touch: TBtn[] = []; private touchPrev: Record<string, boolean> = {}; private useTouch = false;
  // boss
  private C!: Fighter; private bossT = -1; private bossGo = false;
  private rng = 12345;

  constructor() { super('Mock'); }

  private rand() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }
  private rr(a: number, b: number) { return a + this.rand() * (b - a); }

  // ------------------------------------------------------------------ loading
  preload() {
    this.lite = liteMode(this.game);
    const mode = this.lite ? 'lite' : 'full';
    const W = this.scale.width;
    const bar = this.add.graphics();
    const txt = this.add.text(W / 2, 330, 'LOADING STREET...', { fontFamily: 'monospace', fontSize: '28px', color: '#f2c27a' }).setOrigin(0.5);
    this.load.on('progress', (v: number) => { bar.clear().fillStyle(0x333333).fillRect(W / 2 - 200, 370, 400, 14).fillStyle(0xf2c27a).fillRect(W / 2 - 200, 370, 400 * v, 14); });
    this.load.once('complete', () => { bar.destroy(); txt.destroy(); });
    const M = 'assets/mock/', F = 'assets/fight/';
    if (!this.textures.exists('ml_seek')) this.load.multiatlas('ml_seek', `${M}seek/${mode}/atlas.json`, `${M}seek/${mode}/`);
    if (!this.cache.json.exists('ml_clips')) this.load.json('ml_clips', `${M}seek/${mode}/clips.json`);
    if (!this.textures.exists('ml_props')) this.load.multiatlas('ml_props', `${M}props/atlas.json`, `${M}props/`);
    if (!this.cache.json.exists('ml_props_j')) this.load.json('ml_props_j', `${M}props/props.json`);
    for (const t of ['seek_throwup_mike', 'seek_3d_v3']) if (!this.textures.exists('mt_' + t)) this.load.image('mt_' + t, `${M}tags/${t}.png`);
    if (!this.textures.exists('ml_wall')) this.load.image('ml_wall', `${M}wall_panel.png`);
    for (const id of ['seek', 'cylo']) {
      if (!this.textures.exists(`ft_${id}`)) this.load.multiatlas(`ft_${id}`, `${F}${id}/${mode}/atlas.json`, `${F}${id}/${mode}/`);
      if (!this.cache.json.exists(`mv_${id}`)) this.load.json(`mv_${id}`, `${F}${id}/${mode}/moves.json`);
    }
    if (!this.textures.exists('alley_v6')) this.load.image('alley_v6', F + 'stage/alley_v6.png');
  }

  private shadowTex(key: string, w: number) {
    if (this.textures.exists(key)) return;
    const h = 18;
    const c = this.textures.createCanvas(key, w, h)!;
    const ctx = c.getContext();
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(w / 2, h / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    c.refresh();
  }

  // ------------------------------------------------------------------ create
  create() {
    const W = this.scale.width;
    this.mode = 'relaxed'; this.t = 0; this.acc = 0; this.hx = START_X; this.canOut = false; this.guardT = 0; this.guardAt = 0; this.pending = null;
    this.seq = []; this.seqDone = null; this.walls = []; this.cams = []; this.drones = []; this.mist = [];
    this.waves.forEach((w) => (w.done = false)); this.cans = [1, 1, 1, 1, 1]; this.canUsed = 0; this.lockScroll = null; this.bossT = -1; this.bossGo = false;
    this.stats = { tags: 0, camsPainted: 0, dronesPainted: 0, dronesCrashed: 0 };
    this.buf = { punch: 0, kick: 0, spray: 0, act: 0 }; this.touch = []; this.touchPrev = {}; this.rng = 12345; this.move = 'idle'; this.clipName = 'idle_a'; this.cf = 0;
    this.clips = (this.cache.json.get('ml_clips') as any).clips;
    this.props = (this.cache.json.get('ml_props_j') as any).props;
    const cam = this.cameras.main;
    cam.setZoom(1).setBounds(0, 0, WORLD_W, 720).setBackgroundColor('#000').fadeIn(250, 0, 0, 0);

    // street: the alley plate tiled with alternate mirroring so the seams match
    for (let i = 0; i * 1920 < WORLD_W; i++) this.add.image(i * 1920, 0, 'alley_v6').setOrigin(0).setFlipX(i % 2 === 1).setDepth(0);
    // walls to tag
    [{ spot: 1000, kind: 0 }, { spot: 3000, kind: 1 }].forEach((w) => {
      const panel = this.add.image(w.spot + 200, 170, 'ml_wall').setOrigin(0.5, 0).setDepth(2);
      this.walls.push({ spot: w.spot, kind: w.kind, done: false, panel });
    });
    // security cameras on the back wall
    [1900, 3700, 5100].forEach((x, i) => this.cams.push(this.mkCam(x, i)));

    // hero
    for (const id of ['seek', 'cylo']) { const w = id === 'cylo' ? 210 : 136; this.shadowTex(`shadow_${id}`, w); this.shadowTex(`shadow_${id}_lie`, Math.round(w * 1.9)); }
    this.F = new Fighter(this, 'seek', this.cache.json.get('mv_seek') as MoveSet, 11);
    this.F.reset(this.hx, 1); this.F.sprite.setVisible(false); this.F.smoke.setVisible(false);
    this.foe = { bodyX: () => this.F.x + 1000 } as Fighter;
    this.hero = this.add.sprite(this.hx, FY, 'ml_seek', this.clips.idle_a.frames[0]).setDepth(11);
    this.C = new Fighter(this, 'cylo', this.cache.json.get('mv_cylo') as MoveSet, 10);
    this.C.reset(WORLD_W, -1); this.C.sprite.setVisible(false); this.C.shadow.setVisible(false); this.C.smoke.setVisible(false);
    this.mistG = this.add.graphics().setDepth(15);

    this.buildHud(); this.buildInput();
    this.scrollX = Phaser.Math.Clamp(this.hx - this.focusX(), 0, WORLD_W - W);
    cam.setScroll(this.scrollX, 0);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      for (const k of ['ml_seek', 'ml_props']) if (this.textures.exists(k)) this.textures.remove(k);
    });
    (window as any).__gg.mock = this;
  }

  private onResize() { this.layoutHud(); }
  private focusX() { return Math.round(this.scale.width * 0.34); }

  // ------------------------------------------------------------------ builders
  private mkCam(x: number, i: number): Cam {
    const p = this.props.cam_angle;
    const f0 = p.frames[5];
    const spr = this.add.sprite(x, CAM_Y, 'ml_props', f0).setOrigin(0, 0).setDepth(4).setDisplayOrigin(p.anchor[0], p.anchor[1]);
    const paint = this.add.sprite(x, CAM_Y, 'ml_props', f0).setOrigin(0, 0).setDepth(4.1).setDisplayOrigin(p.anchor[0], p.anchor[1]).setVisible(false);
    const drips = this.add.graphics().setDepth(4.2);
    return { x, spr, paint, drips, state: 'scan', f: 5, ft: 0, dir: i % 2 ? -1 : 1, blink: 30 + i * 17, exposure: 0, color: 0, dripT: 0 };
  }

  private buildHud() {
    const W = this.scale.width;
    const ui = <T extends Phaser.GameObjects.GameObject>(o: T) => { (o as any).setScrollFactor(0).setDepth(70); return o; };
    this.hudG = ui(this.add.graphics());
    this.hudTxt = ui(this.add.text(26, 14, 'AEROSOL ARSENAL', { fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 4 }));
    this.hudCount = ui(this.add.text(0, 0, '', { fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 4 }));
    this.prompt = ui(this.add.text(W / 2, 640, '', { fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 6, backgroundColor: '#00000066', padding: { x: 12, y: 4 } }).setOrigin(0.5));
    const pn = 'KICK';
    this.help = ui(this.add.text(W / 2, 712, `\u2190\u2192/A D move   J/Z PUNCH   K/X KICK   SPACE/L SPRAY   E CAN (draw/stow)   ESC menu`, { fontFamily: 'monospace', fontSize: '15px', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 1));
    void pn;
    this.banner = ui(this.add.text(W / 2, 300, '', { fontFamily: 'monospace', fontSize: '110px', fontStyle: 'bold', color: '#ff3b30', stroke: '#000', strokeThickness: 14 }).setOrigin(0.5).setVisible(false).setDepth(80));
    this.warn = ui(this.add.rectangle(0, 0, W, 720, 0xff0000, 0).setOrigin(0).setDepth(79)) as Phaser.GameObjects.Rectangle;
    this.escBtn = ui(this.add.text(W - 14, 14, 'MENU \u21a9', { fontFamily: 'monospace', fontSize: '18px', color: '#f2c27a', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0));
    this.escBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.leave());
    this.layoutHud();
  }
  private layoutHud() {
    const W = this.scale.width;
    this.prompt?.setX(W / 2); this.help?.setX(W / 2); this.banner?.setX(W / 2); this.escBtn?.setX(W - 14);
    this.warn?.setSize(W, 720);
  }

  /** a spray can drawn in code at 1x logic pixels (14x30), shown at integer scale 2 */
  private drawCan(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, amount: number, current: boolean) {
    const s = 2, px = (cx: number, cy: number, w: number, h: number, c: number, a = 1) => g.fillStyle(c, a).fillRect(x + cx * s, y + cy * s, w * s, h * s);
    const empty = amount <= 0.001;
    const dim = amount < 0.999 ? 0.62 : 1;
    px(5, 0, 4, 3, 0xe4e4e4, dim); px(6, 0, 2, 1, 0x222222, dim);        // nozzle
    px(2, 3, 10, 6, 0x2a2e36, dim); px(2, 3, 10, 1, 0x4a505c, dim);       // cap
    px(1, 9, 12, 21, empty ? 0x5d6168 : 0xb9bfc7, dim);                  // body
    px(1, 9, 2, 21, 0x8b919a, dim); px(11, 9, 1, 21, 0xe5e9ee, dim);      // shade / highlight
    px(3, 12, 8, 15, 0x14161a, dim);                                     // label window
    const h = Math.round(15 * Phaser.Math.Clamp(amount, 0, 1));
    if (h > 0) px(3, 27 - h, 8, h, color, dim);
    if (amount > 0.001 && amount < 0.999) px(3, 12 + 7, 8, 1, 0xffffff, 0.45); // half mark
    px(1, 28, 12, 2, 0x6a7078, dim);
    if (current && !empty) { g.lineStyle(2, 0xffffff, 0.95).strokeRect(x - 3, y - 3, 14 * s + 6, 30 * s + 6); }
  }

  private drawHud() {
    const g = this.hudG; g.clear();
    const px0 = 14, py0 = 8, n = this.cans.length, pitch = 46;
    g.fillStyle(0x000000, 0.5).fillRoundedRect(px0, py0, 18 + n * pitch + 70, 92, 8).lineStyle(2, 0xf2c27a, 0.7).strokeRoundedRect(px0, py0, 18 + n * pitch + 70, 92, 8);
    const cur = this.curCan();
    this.cans.forEach((a, i) => this.drawCan(g, 32 + i * pitch, 36, CAN_COLORS[i], a, i === cur));
    const tot = this.cans.reduce((s, v) => s + v, 0);
    this.hudCount.setPosition(32 + n * pitch + 6, 52).setText(`${(Math.round(tot * 2) / 2).toFixed(1)}`).setColor(tot <= 0.001 ? '#ff5050' : '#fff');
  }

  // ------------------------------------------------------------------ input
  private buildInput() {
    const kb = this.input.keyboard!;
    for (const k of ['LEFT', 'RIGHT', 'A', 'D', 'J', 'K', 'Z', 'X', 'L', 'E', 'SPACE', 'ESC'])
      this.keys[k] = kb.addKey(Phaser.Input.Keyboard.KeyCodes[k as keyof typeof Phaser.Input.Keyboard.KeyCodes], true);
    const on = (ks: string[], f: () => void) => ks.forEach((k) => kb.on('keydown-' + k, f));
    on(['J', 'Z'], () => (this.buf.punch = 8)); on(['K', 'X'], () => (this.buf.kick = 8));
    on(['SPACE', 'L'], () => (this.buf.spray = 10)); on(['E'], () => (this.buf.act = 10));
    on(['ESC'], () => this.leave());
    this.useTouch = isTouch() || new URLSearchParams(location.search).get('touch') === '1';
    if (!this.useTouch) return;
    this.input.addPointer(3);
    const mk = (id: string, x: number, y: number, r: number, label: string) => {
      const g = this.add.circle(x, y, r, 0x000000, 0.35).setStrokeStyle(3, 0xf2c27a, 0.8).setScrollFactor(0).setDepth(65);
      const t = this.add.text(x, y, label, { fontFamily: 'monospace', fontSize: label.length > 2 ? '16px' : '26px', fontStyle: 'bold', color: '#f2c27a' }).setOrigin(0.5).setScrollFactor(0).setDepth(66);
      this.touch.push({ id, x, y, r, g, t });
    };
    mk('back', 86, 590, 50, '\u25c0'); mk('fwd', 236, 590, 50, '\u25b6');
    mk('punch', 0, 640, 46, 'PUNCH'); mk('kick', 0, 520, 44, 'KICK'); mk('spray', 0, 600, 56, 'SPRAY'); mk('act', 0, 470, 38, 'CAN');
  }

  private touchState(): Record<string, boolean> {
    const s: Record<string, boolean> = {};
    if (!this.useTouch) return s;
    const W = this.scale.width;
    const px: Record<string, number> = { punch: W - 240, kick: W - 250, spray: W - 100, act: W - 100 };
    for (const b of this.touch) { if (px[b.id] !== undefined) b.x = px[b.id]; b.g.setX(b.x); b.t.setX(b.x); }
    for (const p of this.input.manager.pointers) {
      if (!p || !p.isDown) continue;
      for (const b of this.touch) if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + 14) s[b.id] = true;
    }
    for (const b of this.touch) b.g.setFillStyle(s[b.id] ? 0xf2c27a : 0x000000, s[b.id] ? 0.5 : 0.35);
    const edge = (id: string) => s[id] && !this.touchPrev[id];
    if (edge('punch')) this.buf.punch = 8; if (edge('kick')) this.buf.kick = 8;
    if (edge('spray')) this.buf.spray = 10; if (edge('act')) this.buf.act = 10;
    this.touchPrev = s;
    return s;
  }

  private leave() {
    if ((this as any)._leaving) return; (this as any)._leaving = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { (this as any)._leaving = false; this.scene.start('Menu'); });
  }

  // ------------------------------------------------------------------ cans
  private curCan() { return this.cans.findIndex((a) => a > 0.001); }
  private canColor() { const i = this.curCan(); return i < 0 ? 0x777777 : CAN_COLORS[i]; }
  private totalCans() { return this.cans.reduce((s, v) => s + v, 0); }
  /** take paint from the current can (spilling into the next one); returns the amount actually used */
  private consume(a: number) {
    let left = a;
    for (let i = 0; i < this.cans.length && left > 1e-6; i++) { const u = Math.min(this.cans[i], left); this.cans[i] -= u; left -= u; }
    if (this.cans.every((v) => v < 1e-6)) this.cans.fill(0);
    this.canUsed += a - left; return a - left;
  }

  // ------------------------------------------------------------------ hero animation
  private clip(n: string) { return this.clips[n]; }
  private setClip(name: string, f = 0) { this.clipName = name; this.cf = f; }
  private idleClip() { this.setClip(this.rand() < 0.5 ? 'idle_a' : 'idle_b'); }

  /** advance a looping/one-shot clip by `speed`; returns true when a non-looping clip has finished */
  private advance(speed: number, dir = 1): boolean {
    const c = this.clip(this.clipName), n = c.frames.length;
    this.cf += (c.fps * speed * dir) / 60;
    if (this.cf >= n - 1 && dir > 0) { if (c.loop) { this.cf -= n; return true; } this.cf = n - 1; return true; }
    if (this.cf < 0) { if (c.loop) this.cf += n; else this.cf = 0; }
    return false;
  }

  private drawHero(visible: boolean) {
    const c = this.clip(this.clipName), fi = Phaser.Math.Clamp(Math.floor(this.cf), 0, c.frames.length - 1);
    this.hero.setVisible(visible);
    if (visible) { this.hero.setFrame(c.frames[fi]).setDisplayOrigin(c.anchor[0], c.anchor[1]).setPosition(Math.round(this.hx), FY); }
    this.lastTip = c.tips ? c.tips[fi] : null;
  }

  /** the can nozzle in world space for the current clip frame */
  private tipWorld(): [number, number] | null {
    const c = this.clip(this.clipName); if (!this.lastTip) return null;
    return [this.hx + this.lastTip[0] - c.anchor[0], FY + this.lastTip[1] - c.anchor[1]];
  }

  // ------------------------------------------------------------------ sequences
  private S(clip: string, o: Partial<Step> = {}): Step { return { clip, t: 0, f: 0, started: false, ...o }; }
  private runSeq(steps: Step[], done: () => void) { this.mode = 'seq'; this.seq = steps; this.seqDone = done; }
  private tickSeq() {
    const st = this.seq[0];
    if (!st) { this.endSeq(); return; }
    if (!st.started) { st.started = true; this.setClip(st.pp ? st.clip : st.clip, st.pp ? st.pp[0] : 0); st.onStart?.(); }
    let fin = false;
    if (st.pp) {
      // ping-pong between two frames of the clip (held pose with a little life)
      const c = this.clip(st.clip), spd = (c.fps * (st.speed ?? 1)) / 60;
      st.f += spd; const span = st.pp[1] - st.pp[0] + 1, ph = st.f % (span * 2 - 2 || 1);
      this.cf = st.pp[0] + (ph < span ? ph : span * 2 - 2 - ph);
      fin = st.ticks !== undefined && st.t + 1 >= st.ticks;
    } else if (st.ticks !== undefined) { this.advance(st.speed ?? 1); fin = st.t + 1 >= st.ticks; }
    else fin = this.advance(st.speed ?? 1);
    st.onTick?.(st.t, st);
    st.t++;
    if (fin) { st.onEnd?.(); this.seq.shift(); }
  }
  private endSeq() { const d = this.seqDone; this.seqDone = null; this.seq = []; this.mode = 'relaxed'; this.move = 'idle'; this.idleClip(); d?.(); }

  private raiseGuard(then?: () => void) {
    this.runSeq([this.S('guard_up', { speed: 3 })], () => {
      this.mode = 'guard'; this.F.x = this.hx; this.F.facing = 1; this.F.toIdle(0); this.guardAt = this.t; this.guardT = 0; this.move = 'idle';
      then?.();
    });
  }
  private lowerGuard(then?: () => void) {
    this.F.vx = 0;
    this.runSeq([this.S('guard_down', { speed: 3 })], () => { this.move = 'idle'; this.idleClip(); then?.(); });
  }

  // ---- graffiti: turn_to_wall -> spray -> turn_away_toss
  private startTag(w: Wall) {
    const spot = w.spot, x0 = this.hx;
    const tagKey = 'mt_' + (w.kind === 0 ? 'seek_throwup_mike' : 'seek_3d_v3');
    const SPRAY = 150;
    const tag = this.add.image(spot - 90, 560, tagKey).setOrigin(0, 1).setDepth(3).setVisible(false);
    w.tag = tag; w.done = true;
    const tw = tag.width;
    this.runSeq([
      this.S('turn_to_wall', { speed: 1.5, onTick: (t) => { this.hx = x0 + (spot - x0) * Phaser.Math.Easing.Sine.InOut(Math.min(1, t / 26)); } }),
      this.S('turn_to_wall', { pp: [66, 72], speed: 0.9, ticks: SPRAY,
        onStart: () => tag.setVisible(true).setCrop(0, 0, 0, tag.height),
        onTick: (t) => {
          const p = Math.min(1, t / (SPRAY - 20));
          tag.setCrop(0, 0, Math.round(tw * p), tag.height);
          const tp = this.tipWorld();
          if (tp) { this.puff(tp[0], tp[1], 2); if (t % 2 === 0) this.puff(tag.x + tw * p, 560 - this.rr(30, 340), 1, true); }
          this.consume(1 / SPRAY);
        } }),
      this.S('turn_away_toss', { speed: 2, onEnd: () => { this.canOut = false; this.stats.tags++; } }),
    ], () => {});
  }

  // ---- camera: [pocket_draw] -> cam_spray_raise -> hold -> return
  private startCamSpray(c: Cam) {
    const HOLD = 64;
    const steps: Step[] = [];
    if (!this.canOut) steps.push(this.S('pocket_draw', { speed: 2, onEnd: () => (this.canOut = true) }));
    steps.push(this.S('cam_spray_raise', { speed: 1.5 }));
    steps.push(this.S('cam_spray_hold', { ticks: HOLD,
      onTick: (t) => {
        const tp = this.tipWorld(); if (!tp) return;
        const tx = c.x, ty = CAM_Y + 80;
        const ang = Math.atan2(ty - tp[1], tx - tp[0]);
        if (t < HOLD - 8) this.cone(tp[0], tp[1], ang, 0.14, 3, 11, Math.hypot(tx - tp[0], ty - tp[1]));
        this.consume(0.5 / HOLD);
        if (t >= 14 && c.state === 'scan') { c.exposure++; if (c.exposure >= 22) this.paintCam(c); }
      } }));
    steps.push(this.S('cam_spray_return', { speed: 1.5 }));
    this.runSeq(steps, () => {});
  }

  // ---- straight-ahead spray for drones
  private startFwdSpray() {
    const HOLD = 74;
    const steps: Step[] = [];
    if (!this.canOut) steps.push(this.S('pocket_draw', { speed: 2, onEnd: () => (this.canOut = true) }));
    steps.push(this.S('fwd_spray_raise', { speed: 1.5 }));
    steps.push(this.S('fwd_spray_hold', { ticks: HOLD,
      onTick: (t) => {
        const tp = this.tipWorld(); if (!tp) return;
        if (t < HOLD - 6) this.cone(tp[0], tp[1], 0, 0.2, 4, 15, 520);
        this.consume(0.5 / HOLD);
        for (const d of this.drones) {
          if (d.painted || (d.state !== 'hover' && d.state !== 'confused' && d.state !== 'flee')) continue;
          const dx = d.x - tp[0], dy = d.y - tp[1];
          if (dx > 0 && dx < 640 && Math.abs(dy) < 45 + 0.5 * dx) { d.exposure++; if (d.exposure >= 12) this.paintDrone(d); }
        }
      } }));
    steps.push(this.S('fwd_spray_return', { speed: 1.5 }));
    this.runSeq(steps, () => {});
  }

  private startCanToggle() {
    if (!this.canOut) this.runSeq([this.S('pocket_draw', { speed: 1.6, onEnd: () => (this.canOut = true) })], () => {});
    else this.runSeq([this.S('pocket_stow', { speed: 1.6, onEnd: () => (this.canOut = false) })], () => {});
  }

  /** SPRAY is context sensitive: a wall in reach, else a camera in range, else straight ahead */
  private sprayTarget(): { kind: 'wall'; w: Wall } | { kind: 'cam'; c: Cam } | { kind: 'fwd' } | null {
    if (this.totalCans() <= 0.001) return null;
    const w = this.walls.find((q) => !q.done && Math.abs(q.spot - this.hx) <= WALL_REACH);
    if (w) return { kind: 'wall', w };
    const c = this.cams.find((q) => q.state === 'scan' && q.x - this.hx >= CAM_RANGE[0] && q.x - this.hx <= CAM_RANGE[1]);
    if (c) return { kind: 'cam', c };
    return { kind: 'fwd' };
  }
  private doSpray() {
    const tg = this.sprayTarget();
    if (!tg) { this.flash('OUT OF CANS'); return; }
    if (tg.kind === 'wall') this.startTag(tg.w); else if (tg.kind === 'cam') this.startCamSpray(tg.c); else this.startFwdSpray();
  }
  private flashT = 0;
  private flash(s: string) { this.prompt.setText(s).setColor('#ff5050'); this.flashT = 60; }

  // ------------------------------------------------------------------ mist
  private puff(x: number, y: number, n: number, wall = false) {
    const col = this.canColor();
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, s = this.rr(0.4, wall ? 1.8 : 2.6);
      this.mist.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.3, life: 0, max: this.rr(14, 26), size: this.rand() < 0.5 ? 6 : 10, color: col, grow: 0.25 });
    }
  }
  /** a cone of paint mist: n particles per tick from (x,y) along `ang`, half-angle `half` rad, reach about `len` px */
  private cone(x: number, y: number, ang: number, half: number, n: number, sp: number, len: number) {
    const col = this.canColor();
    for (let i = 0; i < n; i++) {
      const a = ang + this.rr(-half, half), s = this.rr(sp * 0.6, sp * 1.05);
      this.mist.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: Math.min(46, len / (s * 0.92)), size: [6, 8, 10, 14][Math.floor(this.rand() * 4)], color: col, grow: 0.18 });
    }
  }
  private tickMist() {
    const g = this.mistG; g.clear();
    for (let i = this.mist.length - 1; i >= 0; i--) {
      const m = this.mist[i];
      m.x += m.vx; m.y += m.vy; m.vx *= 0.975; m.vy *= 0.975; m.life++; m.size += m.grow;
      if (m.life >= m.max) { this.mist.splice(i, 1); continue; }
      const k = 1 - m.life / m.max;
      const s = Math.round(m.size / 2) * 2;
      g.fillStyle(m.color, 0.55 * k + 0.1).fillRect(Math.round(m.x / 2) * 2 - s / 2, Math.round(m.y / 2) * 2 - s / 2, s, s);
    }
  }

  // ------------------------------------------------------------------ paint effects
  private paintCam(c: Cam) {
    c.state = 'painted'; c.color = this.canColor(); this.stats.camsPainted++;
    c.paint.setVisible(true).setTintFill(c.color).setAlpha(0.48); c.dripT = 0;
    this.setCamFrame(c, true);
  }
  private setCamFrame(c: Cam, off: boolean) {
    const p = this.props[off ? 'cam_ledoff' : 'cam_angle'];
    const k = p.frames[Phaser.Math.Clamp(c.f, 0, p.frames.length - 1)];
    c.spr.setFrame(k); c.paint.setFrame(k);
  }
  private tickCams() {
    const hx = this.hx;
    for (const c of this.cams) {
      if (c.state === 'scan') {
        // tracking spec: frame = round(clamp((player_x - cam_x)/480,-1,1)*5+5), one frame per 4 ticks; idle: ping-pong at 8 ticks per frame
        const near = Math.abs(hx - c.x) < 760;
        if (++c.ft >= (near ? 4 : 8)) {
          c.ft = 0;
          if (near) { const want = Math.round(Phaser.Math.Clamp((hx - c.x) / 480, -1, 1) * 5 + 5); c.f += Math.sign(want - c.f); }
          else { c.f += c.dir; if (c.f >= 10) c.dir = -1; if (c.f <= 0) c.dir = 1; c.f = Phaser.Math.Clamp(c.f, 0, 10); }
        }
        c.blink--; const led = c.blink < 0 && c.blink > -8; if (c.blink < -8) c.blink = 50;
        this.setCamFrame(c, led);
      } else {
        c.dripT++;
        c.drips.clear();
        for (let i = 0; i < 4; i++) {
          const len = Math.min(10 + i * 7, 4 + c.dripT * (0.5 - i * 0.07));
          c.drips.fillStyle(c.color, 0.85).fillRect(c.x - 38 + i * 22, CAM_Y + 96 + (i % 2) * 10, 4, Math.max(0, Math.round(len / 2) * 2));
        }
      }
    }
  }

  private paintDrone(d: Drone) {
    d.painted = true; d.color = this.canColor(); d.state = 'confused'; d.t = 0; this.stats.dronesPainted++;
    d.paint.setVisible(true).setTintFill(d.color).setAlpha(0.5);
  }

  // ------------------------------------------------------------------ drones
  private spawnWave(n: number) {
    const W = this.scale.width;
    for (let i = 0; i < n; i++) {
      const p = this.props.drone_hover, k = p.frames[0];
      const x = this.scrollX + W + 120 + i * 170, y = this.rr(255, 335);
      const spr = this.add.sprite(x, y, 'ml_props', k).setDepth(14);
      const paint = this.add.sprite(x, y, 'ml_props', k).setDepth(14.1).setVisible(false);
      this.drones.push({ x, y, vx: 0, vy: 0, rot: 0, spin: 0, state: 'hover', t: 0, spr, paint, painted: false, color: 0, exposure: 0, baseY: y, slot: i, fi: i * 5, ft: 0, seed: this.rand() * 100, life: 0 });
    }
  }

  private droneFrame(d: Drone, set: string, loop: boolean, advance = true) {
    const p = this.props[set], ms = p.ms;
    if (advance && ++d.ft >= Math.max(1, Math.round(ms / TICK))) { d.ft = 0; d.fi = loop ? (d.fi + 1) % p.frames.length : Math.min(d.fi + 1, p.frames.length - 1); }
    const k = p.frames[Math.min(d.fi, p.frames.length - 1)];
    for (const s of [d.spr, d.paint]) s.setFrame(k).setDisplayOrigin(p.anchor[0], p.anchor[1]).setPosition(Math.round(d.x), Math.round(d.y)).setRotation(d.rot);
  }

  private hitDrone(d: Drone, dir: number) {
    d.state = 'crash'; d.t = 0; d.fi = 0; d.ft = 0; d.vx = dir * 7; d.vy = -4.5; d.spin = dir * 0.1; this.stats.dronesCrashed++;
    d.spr.clearTint(); this.cameras.main.shake(70, 0.002);
  }

  private tickDrones() {
    const W = this.scale.width, right = this.scrollX + W;
    for (let i = this.drones.length - 1; i >= 0; i--) {
      const d = this.drones[i]; d.t++; d.life++;
      switch (d.state) {
        case 'hover': {
          const home = this.hx + 255 + d.slot * 170 + Math.sin(d.life / 55 + d.seed) * 25;
          d.x += (home - d.x) * 0.035 + (d.x > right ? -3 : 0);
          d.y += (d.baseY + Math.sin(d.life / 28 + d.seed) * 18 - d.y) * 0.1;
          d.rot = Math.sin(d.life / 40 + d.seed) * 0.05;
          this.droneFrame(d, 'drone_hover', true);
          if (d.life > 60 * 16) { d.state = 'flee'; d.vx = 2; d.vy = -1; }   // never dealt with: it loses interest and leaves
          break;
        }
        case 'confused': {
          // erratic: random-walk velocity, big tilting, bobbing
          d.vx += this.rr(-0.9, 0.9); d.vy += this.rr(-0.8, 0.8); d.vx *= 0.9; d.vy *= 0.9;
          d.x += d.vx; d.y += d.vy + Math.sin(d.t / 3) * 1.4; d.y = Phaser.Math.Clamp(d.y, 140, 520);
          d.rot = Math.sin(d.t / 5) * 0.55 + Math.sin(d.t / 2.3) * 0.15;
          this.droneFrame(d, 'drone_hover', true);
          if (d.t > 140) { d.state = 'flee'; d.t = 0; d.vx = this.rr(1, 2.5); d.vy = -1.5; }
          break;
        }
        case 'flee': {
          d.vx += 0.22; d.vy -= 0.1; d.x += d.vx; d.y += d.vy; d.rot += (0.35 - d.rot) * 0.05;
          this.droneFrame(d, 'drone_hover', true);
          if (d.x > right + 400 || d.y < -300 || d.life > 60 * 40) d.state = 'gone';
          break;
        }
        case 'crash': {
          d.vy += 0.5; d.vx *= 0.985; d.x += d.vx; d.y += d.vy; d.rot += d.spin;
          this.droneFrame(d, 'drone_hit', false);
          if (d.y >= FY - 28) { d.y = FY - 28; d.state = 'wreck'; d.t = 0; d.fi = 0; d.ft = 0; d.rot = 0; d.vx = 0; this.cameras.main.shake(110, 0.004); this.puff(d.x, d.y + 10, 6); }
          break;
        }
        case 'wreck': {
          this.droneFrame(d, 'drone_destroy', false);
          if (d.t > 60 * 2.2 + 110) { const a = Math.max(0, 1 - (d.t - (60 * 2.2 + 110)) / 40); d.spr.setAlpha(a); d.paint.setAlpha(a * 0.6); if (a <= 0) d.state = 'gone'; }
          break;
        }
        case 'gone': break;
      }
      if (d.state === 'gone') { d.spr.destroy(); d.paint.destroy(); this.drones.splice(i, 1); }
    }
  }

  /** kicks / punches (kick_b) connect with drones through the fight hit boxes */
  private checkMelee() {
    const F = this.F;
    if (F.state !== 'attack') return;
    const f = F.frame(); if (!f.hb) return;
    const hb = F.world(f.hb);
    for (const d of this.drones) {
      if (d.state === 'crash' || d.state === 'wreck' || d.state === 'gone') continue;
      if (hb[0] < d.x + 75 && hb[2] > d.x - 75 && hb[1] < d.y + 52 && hb[3] > d.y - 52) {
        this.hitDrone(d, 1);
        this.puff(d.x - 30, d.y, 5);
      }
    }
  }

  // ------------------------------------------------------------------ boss
  private startBoss() {
    this.bossGo = true; this.bossT = 0; this.lockScroll = this.scrollX; this.pending = null;
    this.C.reset(this.scrollX + this.scale.width + 160, -1);
    this.C.sprite.setVisible(true); this.C.shadow.setVisible(true);
    if (this.mode === 'relaxed') { this.move = 'idle'; this.raiseGuard(); }
    this.mode = this.mode === 'seq' ? 'seq' : this.mode;
    this.banner.setText('CYLOBOT').setVisible(false);
  }
  private tickBoss() {
    this.bossT++;
    const C = this.C, T = this.bossT;
    const inp: Inp = { ...NO_INPUT };
    const stop = this.hx + 560;
    if (C.x > stop) inp.fwd = true;
    C.step(inp, this.F); C.facing = -1;
    this.warn.setFillStyle(0xff0000, T < 150 ? 0.16 * Math.max(0, Math.sin(T / 6)) : 0);
    if (T === 40) this.prompt.setText('\u26a0 WARNING  \u2022  CYLOBOT APPROACHING').setColor('#ff5050');
    if (T === 150) { this.banner.setVisible(true).setScale(1.6); this.tweens.add({ targets: this.banner, scale: 1, duration: 260, ease: 'Back.Out' }); this.cameras.main.shake(300, 0.006); }
    if (T === 150) this.prompt.setText('');
    if (T === 330) { this.cameras.main.fadeOut(350, 0, 0, 0); this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Fight', { fighter: 'seek', from: 'mock' })); }
  }

  // ------------------------------------------------------------------ main loop
  private tick() {
    this.t++;
    for (const k of ['punch', 'kick', 'spray', 'act'] as const) if (this.buf[k] > 0) this.buf[k]--;
    const ts = this.touchState();
    const k = this.keys;
    const left = k.LEFT.isDown || k.A.isDown || !!ts.back, right = k.RIGHT.isDown || k.D.isDown || !!ts.fwd;
    const dir = right && !left ? 1 : left && !right ? -1 : 0;

    // level triggers
    if (!this.bossGo && this.hx >= BOSS_X && (this.mode === 'relaxed' || this.mode === 'guard')) this.startBoss();
    for (const w of this.waves) if (!w.done && this.hx >= w.x) { w.done = true; this.spawnWave(w.n); }

    if (this.bossGo) {
      this.tickBoss();
      if (this.mode === 'seq') this.tickSeq();
      else if (this.mode === 'guard') { this.F.step(NO_INPUT, this.foe); this.hx = this.F.x; }
    } else if (this.mode === 'seq') {
      this.tickSeq();
      this.F.x = this.hx;
    } else if (this.mode === 'relaxed') {
      const wantAtk = this.buf.punch > 0 || this.buf.kick > 0;
      if (this.buf.spray > 0) { this.buf.spray = 0; this.doSpray(); }
      else if (this.buf.act > 0) { this.buf.act = 0; this.startCanToggle(); }
      else if (wantAtk) { const p = this.buf.punch > 0; this.raiseGuard(() => { if (p) this.buf.punch = 8; else this.buf.kick = 8; }); }
      else this.tickRelaxed(dir);
      this.F.x = this.hx;
    } else if (this.mode === 'guard') {
      if (this.buf.spray > 0 || this.buf.act > 0) {
        const sp = this.buf.spray > 0; this.buf.spray = 0; this.buf.act = 0;
        this.lowerGuard(() => { if (sp) this.doSpray(); else this.startCanToggle(); });
      } else {
        const inp: Inp = { ...NO_INPUT, fwd: dir > 0, back: dir < 0, punch: this.buf.punch > 0, kick: this.buf.kick > 0 };
        const wasAtk = this.F.state === 'attack';
        this.F.step(inp, this.foe);
        if (this.F.state === 'attack' && this.F.fi === 0 && !wasAtk) { this.buf.punch = 0; this.buf.kick = 0; this.guardAt = this.t; }
        if (this.F.state === 'attack') this.guardAt = this.t;
        this.F.x = Phaser.Math.Clamp(this.F.x, 120, WORLD_W - 80); this.hx = this.F.x;
        this.checkMelee();
        if (this.t - this.guardAt > GUARD_DROP && this.F.state !== 'attack') this.lowerGuard();
      }
    }
    this.hx = Phaser.Math.Clamp(this.hx, 120, WORLD_W - 80);
    this.tickCams(); this.tickDrones(); this.tickMist();
  }

  private tickRelaxed(dir: number) {
    // relaxed locomotion: idle loops -> walk_start -> walk_loop; left walks the loop backwards
    if (dir !== 0) {
      this.moveDir = dir;
      if (this.move === 'idle') { this.move = 'start'; this.setClip('walk_start'); this.walkT = 0; }
      if (this.move === 'start') {
        const done = this.advance(2, 1); this.walkT++;
        if (done) { this.move = 'loop'; this.setClip('walk_loop', 0); }
      } else if (this.move === 'loop') this.advance(1, dir);
      const ease = this.move === 'start' ? Math.min(1, this.walkT / 22) : 1;
      this.hx += dir * SPEED * ease * (dir < 0 ? 0.8 : 1);
    } else {
      if (this.move !== 'idle') { this.move = 'idle'; this.idleClip(); }
      else if (this.advance(1)) this.idleClip();
    }
  }

  // ------------------------------------------------------------------ render / hud
  private updatePrompt() {
    if (this.flashT > 0) { this.flashT--; return; }
    if (this.bossGo) return;
    let s = '';
    if (this.mode === 'relaxed' || this.mode === 'guard') {
      const tg = this.sprayTarget();
      if (this.totalCans() <= 0.001) s = 'OUT OF CANS';
      else if (tg?.kind === 'wall') s = 'SPRAY: TAG THE WALL  (1 can)';
      else if (tg?.kind === 'cam') s = 'SPRAY: PAINT THE CAMERA  (1/2 can)';
      else if (this.drones.some((d) => !d.painted && d.state === 'hover')) s = 'SPRAY the drones (1/2 can)  or  PUNCH / KICK them';
      else if (this.walls.some((w) => !w.done && w.spot - this.hx > 0 && w.spot - this.hx < 420)) s = 'A blank wall \u2192';
    }
    this.prompt.setText(s).setColor(s === 'OUT OF CANS' ? '#ff5050' : '#ffffff').setVisible(!!s);
  }

  update(_t: number, dms: number) {
    this.acc = Math.min(this.acc + dms, TICK * 5);
    let n = 0;
    while (this.acc >= TICK && n < 5) { this.acc -= TICK; n++; this.tick(); }
    const W = this.scale.width, cam = this.cameras.main;
    const tgt = this.lockScroll ?? Phaser.Math.Clamp(this.hx - this.focusX(), 0, WORLD_W - W);
    this.scrollX += (tgt - this.scrollX) * (this.lockScroll !== null ? 0.2 : 0.12);
    if (Math.abs(tgt - this.scrollX) < 0.5) this.scrollX = tgt;
    this.scrollX = Math.round(this.scrollX);
    cam.setScroll(this.scrollX, 0);
    // draw
    const guard = this.mode === 'guard' || (this.bossGo && this.mode !== 'seq' && this.mode !== 'relaxed');
    const F = this.F;
    F.render(false);
    F.sprite.setVisible(guard); if (!guard) F.smoke.setVisible(false);
    this.drawHero(!guard);
    if (this.bossGo) this.C.render(false);
    this.drawHud();
    this.updatePrompt();
    this.help.setVisible(!this.useTouch && this.t < 60 * 14);
  }

  // ------------------------------------------------------------------ debug / tests
  dbg() {
    return {
      t: this.t, mode: this.mode, x: Math.round(this.hx), scrollX: this.scrollX, clip: this.clipName, fstate: this.F.state, fmove: this.F.move,
      canOut: this.canOut, cans: this.cans.map((v) => +v.toFixed(2)), total: +this.totalCans().toFixed(2), used: +this.canUsed.toFixed(2),
      guardIn: this.mode === 'guard' ? Math.max(0, GUARD_DROP - (this.t - this.guardAt)) : 0, seq: this.seq.map((s) => s.clip),
      walls: this.walls.map((w) => ({ spot: w.spot, done: w.done })), cams: this.cams.map((c) => ({ x: c.x, state: c.state })),
      drones: this.drones.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), state: d.state, painted: d.painted })),
      stats: this.stats, boss: this.bossGo, bossT: this.bossT, target: (() => { const t = this.sprayTarget(); return t ? t.kind : null; })(), lite: this.lite,
    };
  }
  dbgTeleport(x: number) { if (this.mode === 'relaxed') this.hx = x; else if (this.mode === 'guard') this.F.x = this.hx = x; }
}
