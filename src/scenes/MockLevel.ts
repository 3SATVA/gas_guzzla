import Phaser from 'phaser';
import { Fighter, FY } from '../fight/Fighter';
import { Box, Inp, MoveSet, NO_INPUT } from '../fight/types';
import { isTouch, liteMode } from '../game/lite';
import { CAN_COLORS, SPLAT_VARIANTS, drawCan, splatTex } from '../game/spray';

/**
 * MOCK street level for Seek (side-scrolling): walk, tag walls, paint security cameras, spray / kick drones,
 * and at the end meet the CYLOBOT: the fight happens IN the street (no scene switch, no loading screen): camera locks, both
 * fighters use the Fight scene's frame-exact Fighter + CPU + spray/stun/splat logic, one KO decides it.
 * Relaxed art = brawler/v1/seek_sprites_v4 clips (atlas `ml_seek`); guard art = the V1-face fight moves (`ft_seek`).
 * Everything is a 60 Hz tick state machine like the fight; sprites are drawn 1:1 (no resampling).
 */

const TICK = 1000 / 60;
const WORLD_W = 6900;
const START_X = 300;
const BOSS_X = 6000;          // crossing this brings in the CYLOBOT
const CAM_Y = 72;             // security camera mount: 10% below the top of a 720 high screen
const CAM_RANGE: [number, number] = [-120, 270];   // camera x minus hero x: 270 px = about 3 ft at Seek's scale
const WALL_REACH: [number, number] = [-420, 200];   // hero x minus the wall's centre: SPRAY inside this walks her to the centre of the wall, then she tags
const TAG_W = 800, TAG_H = 400, TAG_BANDS = 8, TAG_BASE_Y = 560;
const GUARD_DROP = 360;       // 6 s without fighting: guard down
const DRONE_DMG = 6, IFRAMES = 90;   // a drone bump: damage and invulnerability window (ticks)
const WALL_NEAR = 1400;       // the wall-tag art (about half of Seek's street memory) loads when an untagged wall is this close ahead
const CYLO_LOAD_X = 3400;     // the CYLOBOT's fight art streams in the background once she is past here and the wall art is gone
const STUN_TICKS = 60, STUN_COOL = 150, SPRAY_CAN = 0.5;   // spray vs CYLOBOT: frozen 1 s on its current frame, 2.5 s apart (same numbers as the Fight scene)
const overlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const SPEED = 358 / 85;       // px per tick, = one walk stride per walk cycle (same as the fight walk)

interface Clip { tex: string; frames: string[]; fps: number; loop: boolean; anchor: [number, number]; canvas: [number, number]; tips: ([number, number] | null)[] | null }
interface Step { clip: string; speed?: number; ticks?: number; pp?: [number, number]; onStart?: () => void; onTick?: (t: number, step: Step) => void; onEnd?: () => void; t: number; f: number; started: boolean }
type Mode = 'relaxed' | 'seq' | 'guard' | 'boss';
interface Wall { spot: number; cx: number; done: boolean; panel: Phaser.GameObjects.Image; tag?: Phaser.GameObjects.Image[]; kind: number }
interface Cam { x: number; spr: Phaser.GameObjects.Sprite; paint: Phaser.GameObjects.Sprite; drips: Phaser.GameObjects.Graphics; state: 'scan' | 'painted'; f: number; ft: number; dir: number; blink: number; exposure: number; color: number; dripT: number }
interface Drone { x: number; y: number; vx: number; vy: number; rot: number; spin: number; state: 'hover' | 'swoop' | 'confused' | 'flee' | 'crash' | 'wreck' | 'gone'; next: number; sw: number; dvx: number; dvy: number; t: number; spr: Phaser.GameObjects.Sprite; paint: Phaser.GameObjects.Sprite; painted: boolean; color: number; exposure: number; baseY: number; slot: number; fi: number; ft: number; seed: number; life: number }
interface Mist { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: number; grow: number }
interface Splat { u: number; v: number; sc: number; flip: number; spr: Phaser.GameObjects.Image; age: number }
interface BgGroup { key: string; atlas: string; base: string; json: string; jsonKey: string; state: 'none' | 'loading' | 'ready' }
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
  private move: 'idle' | 'loop' = 'idle'; private clipName = 'idle_a'; private cf = 0; private moveDir = 1;
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
  // boss / in-street fight
  private C!: Fighter; private bossT = -1; private bossGo = false;
  private fphase: 'none' | 'enter' | 'fight' | 'ko' = 'none'; private fT = 0; private hitstop = 0;
  private arenaL = 0; private arenaR = 0; private cIn = false; private fightCans: number[] = [];
  private ai = { wait: 0, cool: 40, retreat: 0, evade: 0, evadeDelay: 0, intent: 0, pPrev: 'idle' };
  private rMin = 225; private rMax = 260;
  private stun = { t: 0, cool: 0 }; private splats: Splat[] = []; private sprayHit = false; private face = 1;
  private result: 'win' | 'lose' | null = null; private endT = 0; private overUi: Phaser.GameObjects.GameObject[] = []; private overShown = false; private vic = false;
  private iframes = 0; private tagging = false; private fstats = { bumps: 0, sprays: 0, hits: 0, stuns: 0 };
  // lazily streamed art (memory): the wall-tag clips and the CYLOBOT fight atlas
  private wallG: BgGroup = { key: 'ml_wallseek', atlas: '', base: '', json: '', jsonKey: 'ml_wall_clips', state: 'none' };
  private cyloG: BgGroup = { key: 'ft_cylo', atlas: '', base: '', json: '', jsonKey: 'mv_cylo', state: 'none' };
  private hpName!: Phaser.GameObjects.Text; private hpNameC!: Phaser.GameObjects.Text; private cBar = 0;
  private restarting = false; private loadBar?: Phaser.GameObjects.Graphics; private loadTxt?: Phaser.GameObjects.Text;
  private rng = 12345;

  private carry: number[] | undefined; private approach: Wall | null = null;
  constructor() { super('Mock'); }
  init(data: any) { this.carry = Array.isArray(data?.cans) ? data.cans : undefined; this.restarting = !!data?.restart; }

  private rand() { this.rng = (this.rng * 1664525 + 1013904223) >>> 0; return this.rng / 4294967296; }
  private rr(a: number, b: number) { return a + this.rand() * (b - a); }

  // ------------------------------------------------------------------ loading
  preload() {
    this.lite = liteMode(this.game);
    const mode = this.lite ? 'lite' : 'full';
    const W = this.scale.width;
    const bar = this.add.graphics(); this.loadBar = bar;
    const txt = this.add.text(W / 2, 330, 'LOADING STREET...', { fontFamily: 'monospace', fontSize: '28px', color: '#f2c27a' }).setOrigin(0.5); this.loadTxt = txt;
    const prog = (v: number) => { bar.clear().fillStyle(0x333333).fillRect(W / 2 - 200, 370, 400, 14).fillStyle(0xf2c27a).fillRect(W / 2 - 200, 370, 400 * v, 14); };
    this.load.on('progress', prog);
    this.load.once('complete', () => { this.load.off('progress', prog); bar.destroy(); txt.destroy(); });
    const M = 'assets/mock/', F = 'assets/fight/';
    Object.assign(this.wallG, { atlas: `${M}seek_wall/${mode}/atlas.json`, base: `${M}seek_wall/${mode}/`, json: `${M}seek_wall/${mode}/clips.json` });
    Object.assign(this.cyloG, { atlas: `${F}cylo/${mode}/atlas.json`, base: `${F}cylo/${mode}/`, json: `${F}cylo/${mode}/moves.json` });
    if (!this.textures.exists('ml_seek')) this.load.multiatlas('ml_seek', `${M}seek/${mode}/atlas.json`, `${M}seek/${mode}/`);
    if (!this.cache.json.exists('ml_clips')) this.load.json('ml_clips', `${M}seek/${mode}/clips.json`);
    if (!this.textures.exists('ml_props')) this.load.multiatlas('ml_props', `${M}props/atlas.json`, `${M}props/`);
    if (!this.cache.json.exists('ml_props_j')) this.load.json('ml_props_j', `${M}props/props.json`);
    for (const t of ['seek_throwup_mike', 'seek_3d_v3']) if (!this.textures.exists('mt_' + t)) this.load.image('mt_' + t, `${M}tags/${t}.png`);
    if (!this.textures.exists('ml_wall')) this.load.image('ml_wall', `${M}wall_panel.png`);
    // Seek's fight art is always needed (guard moves); the CYLOBOT's is streamed in later (see bgLoad)
    if (!this.textures.exists('ft_seek')) this.load.multiatlas('ft_seek', `${F}seek/${mode}/atlas.json`, `${F}seek/${mode}/`);
    if (!this.cache.json.exists('mv_seek')) this.load.json('mv_seek', `${F}seek/${mode}/moves.json`);
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
    this.loadBar?.destroy(); this.loadTxt?.destroy(); (this as any).C = undefined;
    this.mode = 'relaxed'; this.t = 0; this.acc = 0; this.hx = START_X; this.canOut = false; this.guardT = 0; this.guardAt = 0; this.pending = null;
    this.seq = []; this.seqDone = null; this.walls = []; this.cams = []; this.drones = []; this.mist = [];
    this.waves.forEach((w) => (w.done = false)); this.cans = this.carry ? this.carry.slice() : [1, 1, 1, 1, 1]; this.canUsed = 0; this.approach = null; this.lockScroll = null; this.bossT = -1; this.bossGo = false;
    this.fphase = 'none'; this.fT = 0; this.hitstop = 0; this.cIn = false; this.stun = { t: 0, cool: 0 }; this.splats = []; this.sprayHit = false; this.face = 1; this.result = null; this.endT = 0; this.overUi = []; this.overShown = false; this.vic = false; this.iframes = 0; this.tagging = false; this.fstats = { bumps: 0, sprays: 0, hits: 0, stuns: 0 }; this.cBar = 0;
    this.wallG.state = this.textures.exists(this.wallG.key) ? 'ready' : 'none'; this.cyloG.state = this.textures.exists(this.cyloG.key) ? 'ready' : 'none';
    if (this.restarting) { this.unloadGroup(this.wallG); this.unloadGroup(this.cyloG); this.restarting = false; }
    this.stats = { tags: 0, camsPainted: 0, dronesPainted: 0, dronesCrashed: 0 };
    this.buf = { punch: 0, kick: 0, spray: 0, act: 0 }; this.touch = []; this.touchPrev = {}; this.rng = 12345; this.move = 'idle'; this.clipName = 'idle_a'; this.cf = 0;
    this.clips = (this.cache.json.get('ml_clips') as any).clips;
    for (const c of Object.values(this.clips)) c.tex = 'ml_seek';
    this.props = (this.cache.json.get('ml_props_j') as any).props;
    const cam = this.cameras.main;
    cam.setZoom(1).setBounds(0, 0, WORLD_W, 720).setBackgroundColor('#000').fadeIn(250, 0, 0, 0);

    // street: the alley plate tiled with alternate mirroring so the seams match
    for (let i = 0; i * 1920 < WORLD_W; i++) this.add.image(i * 1920, 0, 'alley_v6').setOrigin(0).setFlipX(i % 2 === 1).setDepth(0);
    // walls to tag
    [{ spot: 1000, kind: 0 }, { spot: 3000, kind: 1 }].forEach((w) => {
      const panel = this.add.image(w.spot + 200, 170, 'ml_wall').setOrigin(0.5, 0).setDepth(2);
      this.walls.push({ spot: w.spot, cx: w.spot + 200, kind: w.kind, done: false, panel });
    });
    // security cameras on the back wall
    [1900, 3700, 5100].forEach((x, i) => this.cams.push(this.mkCam(x, i)));

    // hero
    for (const id of ['seek', 'cylo']) { const w = id === 'cylo' ? 210 : 136; this.shadowTex(`shadow_${id}`, w); this.shadowTex(`shadow_${id}_lie`, Math.round(w * 1.9)); }
    this.F = new Fighter(this, 'seek', this.cache.json.get('mv_seek') as MoveSet, 11);
    this.F.reset(this.hx, 1); this.F.sprite.setVisible(false); this.F.smoke.setVisible(false);
    this.foe = { bodyX: () => this.F.x + 1000 } as Fighter;
    this.hero = this.add.sprite(this.hx, FY, 'ml_seek', this.clips.idle_a.frames[0]).setDepth(11);
    this.mistG = this.add.graphics().setDepth(15);

    this.buildHud(); this.buildInput();
    this.scrollX = Phaser.Math.Clamp(this.hx - this.focusX(), 0, WORLD_W - W);
    cam.setScroll(this.scrollX, 0);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      if (!this.restarting) {
        for (const k of ['ml_seek', 'ml_props', 'ml_wallseek', 'ft_seek', 'ft_cylo']) if (this.textures.exists(k)) this.textures.remove(k);
        for (const k of ['ml_clips', 'ml_wall_clips', 'mv_seek', 'mv_cylo']) this.cache.json.remove(k);
      }
      for (const k of this.textures.getTextureKeys()) if (k.startsWith('splat_')) this.textures.remove(k);
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
    this.help = ui(this.add.text(W / 2, 712, `\u2190\u2192/A D move   J/Z PUNCH   K/X KICK   SPACE/L SPRAY   E CAN   \u2193/S crouch   C/SHIFT block   ESC menu`, { fontFamily: 'monospace', fontSize: '15px', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5, 1));
    void pn;
    this.banner = ui(this.add.text(W / 2, 300, '', { fontFamily: 'monospace', fontSize: '110px', fontStyle: 'bold', color: '#ff3b30', stroke: '#000', strokeThickness: 14 }).setOrigin(0.5).setVisible(false).setDepth(80));
    this.warn = ui(this.add.rectangle(0, 0, W, 720, 0xff0000, 0).setOrigin(0).setDepth(79)) as Phaser.GameObjects.Rectangle;
    const nm = { fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#fff', stroke: '#000', strokeThickness: 4 };
    this.hpName = ui(this.add.text(24, 108, 'SEEK', nm)).setDepth(71) as Phaser.GameObjects.Text;
    this.hpNameC = ui(this.add.text(W - 24, 54, 'CYLOBOT', nm)).setOrigin(1, 0).setDepth(71) as Phaser.GameObjects.Text;
    this.escBtn = ui(this.add.text(W - 14, 14, 'MENU \u21a9', { fontFamily: 'monospace', fontSize: '18px', color: '#f2c27a', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0));
    this.escBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.leave());
    this.layoutHud();
  }
  private layoutHud() {
    const W = this.scale.width;
    this.prompt?.setX(W / 2); this.help?.setX(W / 2); this.banner?.setX(W / 2); this.escBtn?.setX(W - 14);
    this.warn?.setSize(W, 720);
  }

  private drawCan(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, amount: number, current: boolean) { drawCan(g, x, y, color, amount, current, 2); }

  private drawHud() {
    const g = this.hudG; g.clear();
    const px0 = 14, py0 = 8, n = this.cans.length, pitch = 46;
    g.fillStyle(0x000000, 0.5).fillRoundedRect(px0, py0, 18 + n * pitch + 70, 92, 8).lineStyle(2, 0xf2c27a, 0.7).strokeRoundedRect(px0, py0, 18 + n * pitch + 70, 92, 8);
    const cur = this.curCan();
    this.cans.forEach((a, i) => this.drawCan(g, 32 + i * pitch, 36, CAN_COLORS[i], a, i === cur));
    const tot = this.cans.reduce((s, v) => s + v, 0);
    this.hudCount.setPosition(32 + n * pitch + 6, 52).setText(`${(Math.round(tot * 2) / 2).toFixed(1)}`).setColor(tot <= 0.001 ? '#ff5050' : '#fff');
    // health bars: Seek's directly under the can panel, the CYLOBOT's top right once he is on screen
    const bar = (x0: number, y0: number, w: number, h: number, f: Fighter, fromRight: boolean, a: number) => {
      const lw = Math.round((w * f.lag) / 100), hw = Math.round((w * f.hp) / 100), ax = (v: number) => (fromRight ? x0 + w - v : x0);
      g.fillStyle(0x000000, 0.85 * a).fillRect(x0 - 4, y0 - 4, w + 8, h + 8);
      g.fillStyle(0x3a0b0b, a).fillRect(x0, y0, w, h);
      g.fillStyle(0xc8161b, a).fillRect(ax(lw), y0, lw, h);
      g.fillStyle(0xf2d21b, a).fillRect(ax(hw), y0, hw, h);
      g.fillStyle(0xfff3a0, a).fillRect(ax(hw), y0 + 3, hw, 3);
      g.lineStyle(3, 0xd9a441, a).strokeRect(x0 - 2, y0 - 2, w + 4, h + 4);
    };
    const pw = 18 + n * pitch + 70;
    bar(px0, 106, pw, 20, this.F, false, 1);
    const W = this.scale.width, showC = this.bossGo && !!this.C && this.C.x < this.scrollX + W + 40;
    this.cBar = Phaser.Math.Clamp(this.cBar + (showC ? 0.06 : 0), 0, 1);
    if (this.cBar > 0) bar(W - 14 - 420, 54, 420, 22, this.C, true, this.cBar);
    this.hpNameC.setVisible(this.cBar > 0).setAlpha(this.cBar).setX(W - 24).setY(57);
  }

  // ------------------------------------------------------------------ input
  private buildInput() {
    const kb = this.input.keyboard!;
    for (const k of ['LEFT', 'RIGHT', 'DOWN', 'A', 'D', 'S', 'J', 'K', 'Z', 'X', 'L', 'C', 'SHIFT', 'E', 'R', 'ENTER', 'SPACE', 'ESC'])
      this.keys[k] = kb.addKey(Phaser.Input.Keyboard.KeyCodes[k as keyof typeof Phaser.Input.Keyboard.KeyCodes], true);
    const on = (ks: string[], f: () => void) => ks.forEach((k) => kb.on('keydown-' + k, f));
    on(['J', 'Z'], () => (this.buf.punch = 8)); on(['K', 'X'], () => (this.buf.kick = 8));
    on(['SPACE', 'L'], () => (this.buf.spray = 10)); on(['E'], () => (this.buf.act = 10));
    on(['ESC'], () => this.leave()); on(['R', 'ENTER'], () => this.overAction());
    this.useTouch = isTouch() || new URLSearchParams(location.search).get('touch') === '1';
    if (!this.useTouch) return;
    this.input.addPointer(3);
    const mk = (id: string, x: number, y: number, r: number, label: string) => {
      const g = this.add.circle(x, y, r, 0x000000, 0.35).setStrokeStyle(3, 0xf2c27a, 0.8).setScrollFactor(0).setDepth(65);
      const t = this.add.text(x, y, label, { fontFamily: 'monospace', fontSize: label.length > 2 ? '16px' : '26px', fontStyle: 'bold', color: '#f2c27a' }).setOrigin(0.5).setScrollFactor(0).setDepth(66);
      this.touch.push({ id, x, y, r, g, t });
    };
    mk('back', 86, 590, 50, '\u25c0'); mk('fwd', 236, 590, 50, '\u25b6');
    mk('down', 161, 668, 40, '\u25bc'); mk('block', 0, 664, 40, 'BLOCK'); mk('punch', 0, 640, 46, 'PUNCH'); mk('kick', 0, 520, 44, 'KICK'); mk('spray', 0, 600, 56, 'SPRAY'); mk('act', 0, 470, 38, 'CAN');
  }

  private touchState(): Record<string, boolean> {
    const s: Record<string, boolean> = {};
    if (!this.useTouch) return s;
    const W = this.scale.width;
    const px: Record<string, number> = { punch: W - 240, kick: W - 250, spray: W - 100, act: W - 100, block: W - 370 };
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
  private idleClip() { this.setClip('idle_a'); }   // ping-pong breathing loop (the only idle after the edit)

  /** advance a looping/one-shot clip by `speed`; returns true when a non-looping clip has finished */
  private advance(speed: number, dir = 1): boolean {
    const c = this.clip(this.clipName), n = c.frames.length;
    if (n <= 1) { this.cf = 0; return !c.loop; }   // a frozen pose (spray hold): nothing to advance
    this.cf += (c.fps * speed * dir) / 60;
    if (this.cf >= n - 1 && dir > 0) { if (c.loop) { this.cf -= n; return true; } this.cf = n - 1; return true; }
    if (this.cf < 0) { if (c.loop) this.cf += n; else this.cf = 0; }
    return false;
  }

  private drawHero(visible: boolean) {
    const c = this.clip(this.clipName), fi = Phaser.Math.Clamp(Math.floor(this.cf), 0, c.frames.length - 1);
    this.hero.setVisible(visible);
    if (visible) {
      if (this.hero.texture.key !== c.tex) this.hero.setTexture(c.tex, c.frames[fi]); else this.hero.setFrame(c.frames[fi]);
      this.hero.setDisplayOrigin(c.anchor[0], c.anchor[1]).setPosition(Math.round(this.hx), FY).setScale(this.face, 1);
    }
    this.lastTip = c.tips ? c.tips[fi] : null;
  }

  /** the can nozzle in world space for the current clip frame */
  private tipWorld(): [number, number] | null {
    const c = this.clip(this.clipName); if (!this.lastTip) return null;
    return [this.hx + this.face * (this.lastTip[0] - c.anchor[0]), FY + this.lastTip[1] - c.anchor[1]];
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
  private endSeq() { const d = this.seqDone; this.seqDone = null; this.seq = []; this.tagging = false; this.mode = 'relaxed'; this.move = 'idle'; this.idleClip(); d?.(); }

  private raiseGuard(then?: () => void) {
    this.runSeq([this.S('guard_up', { speed: 1.8 })], () => {
      this.mode = 'guard'; this.F.x = this.hx; this.F.facing = 1; this.F.toIdle(0); this.guardAt = this.t; this.guardT = 0; this.move = 'idle';
      then?.();
    });
  }
  private lowerGuard(then?: () => void) {
    this.F.vx = 0;
    this.runSeq([this.S('guard_down', { speed: 1 })], () => { this.move = 'idle'; this.idleClip(); then?.(); });
  }

  // ---- graffiti: walk to the centre of the wall -> turn_to_wall -> the full long squat spray -> turn_away_toss.
  // The tag grows outward from her, equally to the left and right, in horizontal bands that the can hand favours
  // (high strokes reveal the top, the squat reveals the bottom), and every band is finished by the end of the clip.
  private startTag(w: Wall) {
    const cx = w.cx, x0 = this.hx;
    const tagKey = 'mt_' + (w.kind === 0 ? 'seek_throwup_mike' : 'seek_3d_v3');
    const tagX = cx - TAG_W / 2, tagTop = TAG_BASE_Y - TAG_H, bh = TAG_H / TAG_BANDS, half = TAG_W / 2;
    const bands: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < TAG_BANDS; i++) bands.push(this.add.image(tagX, tagTop, tagKey).setOrigin(0, 0).setDepth(3).setVisible(false));
    w.tag = bands; w.done = true; this.tagging = true;
    const hw = new Array(TAG_BANDS).fill(0), extra = new Array(TAG_BANDS).fill(0);
    const show = () => bands.forEach((b, i) => {
      const h = Math.round(Math.min(half, hw[i]) / 2) * 2;
      if (h < 2) { b.setVisible(false); return; }
      b.setVisible(true).setCrop(half - h, Math.round(i * bh), h * 2, Math.round(bh));
    });
    // Michael's edit, ordered by frame-diff seams (tools/seek_edl.py): turn -> shake the can (fwd, back, fwd) -> squat down (his squat clip
    // reversed) -> spray in the squat -> rise spraying high (his other squat clip reversed) -> a mid-height spray -> turn away.
    // The tag reveal is driven by the elapsed spray ticks, so it is finished exactly when the last spray step ends.
    let prevP = 0, sprayN = 0;
    const SPRAY_TICKS = 281;     // 17 * 2.5 (squat down) + 105 (squat spray) + 23 * 2.5 (rise) + 75 (mid spray)
    const sprayTick = () => {
      sprayN++;
      const p = Math.min(1, sprayN / SPRAY_TICKS);
      const tp = this.tipWorld();
      const base = Math.min(1, p / 0.8) * 0.55 * half;                 // everybody grows evenly...
      const fin = Phaser.Math.Easing.Sine.InOut(Phaser.Math.Clamp((p - 0.8) / 0.18, 0, 1));
      for (let i = 0; i < TAG_BANDS; i++) {
        if (tp) { const d = (tp[1] - (tagTop + bh * (i + 0.5))) / 90; extra[i] += 1.1 * Math.exp(-d * d); }   // ...plus the band her hand is at
        const v = Math.min(half, base + extra[i]);
        hw[i] = v + (half - v) * fin;
      }
      show();
      if (tp) {
        this.puff(tp[0], tp[1], 2);
        if (this.t % 3 === 0) {
          const bi = Phaser.Math.Clamp(Math.floor((tp[1] - tagTop) / bh), 0, TAG_BANDS - 1), by = tagTop + bh * (bi + 0.5) + this.rr(-22, 22);
          if (hw[bi] > 4 && hw[bi] < half - 2) { this.puff(cx - hw[bi], by, 1, true); this.puff(cx + hw[bi], by, 1, true); }
        }
      }
      this.consume(Math.max(0, p - prevP)); prevP = p;
    };
    this.runSeq([
      this.S('turn_to_wall', { speed: 1, onTick: (t) => { this.hx = x0 + (cx - x0) * Phaser.Math.Easing.Sine.InOut(Math.min(1, t / 30)); } }),
      this.S('wall_shake', { speed: 1 }),
      this.S('wall_squat_dn', { speed: 1, onTick: sprayTick }),
      this.S('wall_squat_hold', { speed: 1, ticks: 105, onTick: sprayTick }),
      this.S('wall_squat_up', { speed: 1, onTick: sprayTick }),
      this.S('wall_spray_mid', { speed: 1, ticks: 75, onTick: sprayTick, onEnd: () => { hw.fill(half); show(); } }),
      this.S('turn_away_toss', { speed: 1, onEnd: () => { this.canOut = false; this.stats.tags++; } }),
    ], () => {});
  }

  // ---- camera: [pocket_draw] -> cam_spray_raise -> hold -> return
  private startCamSpray(c: Cam) {
    const HOLD = 64;
    const steps: Step[] = [];
    if (!this.canOut) steps.push(this.S('pocket_draw', { speed: 1, onEnd: () => (this.canOut = true) }));
    steps.push(this.S('cam_spray_raise', { speed: 1 }));
    steps.push(this.S('cam_spray_hold', { ticks: HOLD,
      onTick: (t) => {
        const tp = this.tipWorld(); if (!tp) return;
        const tx = c.x, ty = CAM_Y + 80;
        const ang = Math.atan2(ty - tp[1], tx - tp[0]);
        if (t < HOLD - 8) this.cone(tp[0], tp[1], ang, 0.14, 3, 11, Math.hypot(tx - tp[0], ty - tp[1]));
        this.consume(0.5 / HOLD);
        if (t >= 14 && c.state === 'scan') { c.exposure++; if (c.exposure >= 22) this.paintCam(c); }
      } }));
    steps.push(this.S('cam_spray_return', { speed: 1 }));
    this.runSeq(steps, () => {});
  }

  // ---- straight-ahead spray for drones
  private startFwdSpray() {
    const HOLD = 74;
    const steps: Step[] = [];
    if (!this.canOut) steps.push(this.S('pocket_draw', { speed: 1, onEnd: () => (this.canOut = true) }));
    steps.push(this.S('fwd_spray_raise', { speed: 1 }));
    steps.push(this.S('fwd_spray_hold', { ticks: HOLD,
      onTick: (t) => {
        const tp = this.tipWorld(); if (!tp) return;
        if (t < HOLD - 6) this.cone(tp[0], tp[1], 0, 0.2, 4, 15, 520);
        this.consume(0.5 / HOLD);
        for (const d of this.drones) {
          if (d.painted || (d.state !== 'hover' && d.state !== 'swoop' && d.state !== 'confused' && d.state !== 'flee')) continue;
          const dx = d.x - tp[0], dy = d.y - tp[1];
          if (dx > 0 && dx < 640 && Math.abs(dy) < 45 + 0.5 * dx) { d.exposure++; if (d.exposure >= 12) this.paintDrone(d); }
        }
      } }));
    steps.push(this.S('fwd_spray_return', { speed: 1 }));
    this.runSeq(steps, () => {});
  }

  private startCanToggle() {
    if (!this.canOut) this.runSeq([this.S('pocket_draw', { speed: 1, onEnd: () => (this.canOut = true) })], () => {});
    else this.runSeq([this.S('pocket_stow', { speed: 1, onEnd: () => (this.canOut = false) })], () => {});
  }

  /** SPRAY is context sensitive: a wall in reach, else a camera in range, else straight ahead */
  private sprayTarget(): { kind: 'wall'; w: Wall } | { kind: 'cam'; c: Cam } | { kind: 'fwd' } | null {
    if (this.totalCans() <= 0.001) return null;
    const w = this.walls.find((q) => !q.done && this.hx - q.cx >= WALL_REACH[0] && this.hx - q.cx <= WALL_REACH[1]);
    if (w) return { kind: 'wall', w };
    const c = this.cams.find((q) => q.state === 'scan' && q.x - this.hx >= CAM_RANGE[0] && q.x - this.hx <= CAM_RANGE[1]);
    if (c) return { kind: 'cam', c };
    return { kind: 'fwd' };
  }
  private doSpray() {
    const tg = this.sprayTarget();
    if (!tg) { this.flash('OUT OF CANS'); return; }
    if (tg.kind === 'wall' && this.wallG.state !== 'ready') { this.flash('WALL ART LOADING...'); return; }
    if (tg.kind === 'wall') this.approach = tg.w; else if (tg.kind === 'cam') this.startCamSpray(tg.c); else this.startFwdSpray();
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
      this.drones.push({ x, y, vx: 0, vy: 0, rot: 0, spin: 0, state: 'hover', t: 0, spr, paint, painted: false, color: 0, exposure: 0, baseY: y, slot: i, fi: i * 5, ft: 0, seed: this.rand() * 100, life: 0, next: 240 + i * 100 + Math.floor(this.rand() * 120), sw: 0, dvx: 0, dvy: 0 });
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
          // every few seconds a drone winds up (rises, tilts, flashes red) and then dives at her
          if (--d.next <= 0 && !this.tagging && !this.bossGo && !this.result && this.iframes <= 0 && d.x < right - 40 && d.x > this.scrollX + 260) { d.state = 'swoop'; d.sw = 0; d.t = 0; }
          if (d.life > 60 * 16) { d.state = 'flee'; d.vx = 2; d.vy = -1; d.spr.clearTint(); }   // never dealt with: it loses interest and leaves
          break;
        }
        case 'swoop': {
          d.sw++;
          if (d.sw < 30) {
            if (d.sw === 1) d.spr.setTint(0xff6a5a);
            d.y += (d.baseY - 45 - d.y) * 0.14; d.x += 0.9 + Math.sin(d.sw * 2.2) * 1.6; d.rot = -0.35 * Math.min(1, d.sw / 12) + Math.sin(d.sw * 1.7) * 0.05;
            if (d.sw === 29) { const a = Math.atan2(FY - 300 - d.y, this.hx - d.x); d.dvx = Math.cos(a) * 10.5; d.dvy = Math.sin(a) * 10.5; d.rot = a + Math.PI; }
          } else {
            d.x += d.dvx; d.y = Math.min(d.y + d.dvy, FY - 130);
            if (d.sw > 70 || d.x < this.hx - 300) { d.state = 'hover'; d.next = 330 + Math.floor(this.rand() * 220); d.spr.clearTint(); d.dvx = d.dvy = 0; }
          }
          this.droneFrame(d, 'drone_hover', true);
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
      // contact: a drone that touches her hurts her (short invulnerability window afterwards)
      if ((d.state === 'hover' || d.state === 'swoop' || d.state === 'confused' || d.state === 'flee') && this.iframes <= 0 && !this.result && !this.tagging && !this.F.lying()) {
        const hb: Box = [this.hx - 70, FY - 500, this.hx + 75, FY - 5];
        if (overlap([d.x - 55, d.y - 38, d.x + 55, d.y + 38], hb)) {
          this.hurt(DRONE_DMG, d.x); this.puff(d.x, d.y, 5);
          if (d.state === 'swoop') { d.state = 'hover'; d.next = 260; d.spr.clearTint(); d.x += 60; d.dvx = d.dvy = 0; }
        }
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

  // ------------------------------------------------------------------ lazy art (memory)
  /** stream one atlas group in the background (one at a time) */
  private bgLoad(g: BgGroup) {
    if (g.state !== 'none' || this.load.isLoading()) return;
    g.state = 'loading';
    if (!this.textures.exists(g.key)) this.load.multiatlas(g.key, g.atlas, g.base);
    if (!this.cache.json.exists(g.jsonKey)) this.load.json(g.jsonKey, g.json);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      g.state = 'ready';
      if (g === this.wallG) { const j = (this.cache.json.get(g.jsonKey) as any).clips; for (const c of Object.values(j) as Clip[]) c.tex = g.key; Object.assign(this.clips, j); }
    });
    this.load.start();
  }
  private unloadGroup(g: BgGroup) {
    if (this.textures.exists(g.key)) this.textures.remove(g.key);
    if (g !== this.cyloG) this.cache.json.remove(g.jsonKey);
    g.state = 'none';
  }
  private tickLoads() {
    const wg = this.wallG, cg = this.cyloG;
    const near = this.walls.some((w) => !w.done && w.cx - this.hx < WALL_NEAR && this.hx - w.cx < 500);
    if (near && wg.state === 'none' && cg.state !== 'loading') this.bgLoad(wg);
    else if (!near && wg.state === 'ready' && (this.mode === 'relaxed' || this.mode === 'guard') && !this.approach && this.hero.texture.key !== wg.key) this.unloadGroup(wg);
    if (!this.bossGo && this.hx >= CYLO_LOAD_X && wg.state === 'none' && cg.state === 'none') this.bgLoad(cg);
  }

  // ------------------------------------------------------------------ in-street fight
  private computeReach() {
    const F = this.F, C = this.C;
    const hu = F.mv.idle.frames[0].hu ?? [-60, -500, 60, 0];
    let best = 0;
    for (const f of C.mv[C.def.punch].frames) if (f.hb && f.hb[1] < hu[3] && hu[1] < f.hb[3]) best = Math.max(best, f.hb[2] + hu[2]);
    this.rMin = F.def.push + C.def.push;
    this.rMax = Math.max(this.rMin + 20, best);
  }

  private startBoss() {
    const F = this.F;
    if (!this.C) this.C = new Fighter(this, 'cylo', this.cache.json.get('mv_cylo') as MoveSet, 10);
    this.bossGo = true; this.bossT = 0; this.lockScroll = this.scrollX; this.pending = null; this.approach = null;
    const W = this.scale.width;
    this.arenaL = this.scrollX + 110; this.arenaR = this.scrollX + W - 110;
    this.computeReach();
    this.fightCans = this.cans.slice();
    for (const d of this.drones) if (d.state === 'hover' || d.state === 'swoop' || d.state === 'confused') { d.state = 'flee'; d.t = 0; d.vx = 2; d.vy = -1; d.spr.clearTint(); }
    this.enterBoss();
    void F;
  }
  /** the CYLOBOT walks in from the right edge (also used by retry) */
  private enterBoss() {
    const C = this.C, W = this.scale.width;
    C.reset(this.lockScroll! + W + 160, -1); C.sprite.setVisible(true); C.shadow.setVisible(true); C.smoke.setVisible(false);
    this.fphase = 'enter'; this.fT = 0; this.cIn = false; this.stun = { t: 0, cool: 0 }; this.hitstop = 0; this.cBar = 0;
    this.ai = { wait: 30, cool: 40, retreat: 0, evade: 0, evadeDelay: 0, intent: 0, pPrev: 'idle' };
    this.banner.setVisible(false);
  }

  private playerInp(ts: Record<string, boolean>): Inp {
    const k = this.keys;
    const left = k.LEFT.isDown || k.A.isDown || !!ts.back, right = k.RIGHT.isDown || k.D.isDown || !!ts.fwd;
    const f = this.F.facing;
    return {
      fwd: f > 0 ? right && !left : left && !right,
      back: f > 0 ? left && !right : right && !left,
      down: k.DOWN.isDown || k.S.isDown || !!ts.down,
      block: k.C.isDown || k.SHIFT.isDown || !!ts.block,
      punch: this.buf.punch > 0, kick: this.buf.kick > 0,
    };
  }

  /** drop whatever she is doing (spray, can, camera...) and stand in the fight guard */
  private interrupt() {
    this.seq = []; this.seqDone = null; this.mode = 'guard'; this.canOut = false; this.approach = null; this.face = 1; this.tagging = false;
    this.F.x = this.hx; this.F.toIdle(0); this.guardAt = this.t;
  }

  /** a hit on Seek that is not a CYLOBOT attack (a drone bump): damage, flinch (her hit anim), invulnerability window */
  private hurt(dmg: number, fromX: number) {
    const F = this.F;
    if (this.iframes > 0 || this.result || this.tagging || F.lying()) return;
    if (this.mode !== 'guard') this.interrupt();
    const guarded = F.guarding();
    this.iframes = IFRAMES; this.fstats.bumps++;
    F.hp = Math.max(0, F.hp - (guarded ? 1 : dmg)); F.lagDelay = 32; F.flash();
    F.vx = (fromX > F.x ? -1 : 1) * (guarded ? 3 : 5);
    this.cameras.main.shake(90, 0.003);
    if (F.hp <= 0) { this.koSeek(); return; }
    if (!guarded) { F.state = 'hit'; F.setMove('hit'); }
  }
  private koSeek() {
    const F = this.F;
    F.ko = true; F.state = 'knockdown'; F.setMove('knockdown'); F.vx = 0; this.hitstop = 0;
    this.setResult('lose');
  }
  private setResult(r: 'win' | 'lose') {
    this.result = r; this.endT = 0;
    if (this.bossGo) this.fphase = 'ko';
    this.cameras.main.shake(260, 0.008);
    this.banner.setText('K.O.').setVisible(true).setScale(1.6); this.tweens.add({ targets: this.banner, scale: 1, duration: 260, ease: 'Back.Out' });
  }

  /** after beating the CYLOBOT Seek holds the final spray frame (the same pose a spray freezes on) as her K.O. / victory pose */
  private tickVictory() {
    if (this.vic) return;
    const F = this.F, hold = () => this.S('fwd_spray_hold', { ticks: 1e9 });
    if (this.mode === 'seq') {
      // she is mid-spray: let it run to the frozen frame, then never reverse it
      const st = this.seq[0];
      if (st && st.clip === 'fwd_spray_return') { this.seq = [hold()]; this.vic = true; }
    } else if (this.mode === 'guard' && (F.state === 'idle' || F.state === 'walk')) {
      this.face = F.facing; this.hx = F.x; F.toIdle(0); this.vic = true;
      this.runSeq([this.S('fwd_spray_raise', { speed: 1 }), hold()], () => {});
    }
  }

  private tickResult() {
    if (!this.result) return;
    this.endT++;
    const loser = this.result === 'win' ? this.C : this.F;
    if (!this.overShown && this.endT >= 150 && (loser.state === 'ko' || this.endT >= 420)) this.showOver();
  }
  private showOver() {
    this.overShown = true;
    const W = this.scale.width, win = this.result === 'win';
    const ui = <T extends Phaser.GameObjects.GameObject>(o: T) => { (o as any).setScrollFactor(0).setDepth(85); this.overUi.push(o); return o; };
    this.banner.setVisible(false);
    ui(this.add.rectangle(0, 0, W, 720, 0x000000, 0.6).setOrigin(0));
    ui(this.add.text(W / 2, 230, win ? 'YOU WIN' : 'GAME OVER', { fontFamily: 'monospace', fontSize: '96px', fontStyle: 'bold', color: win ? '#f2d21b' : '#e04040', stroke: '#000', strokeThickness: 12 }).setOrigin(0.5));
    ui(this.add.text(W / 2, 318, win ? 'CYLOBOT DESTROYED' : this.bossGo ? 'CYLOBOT TOOK YOU DOWN  \u2022  ONE TRY' : 'THE DRONES GOT YOU', { fontFamily: 'monospace', fontSize: '26px', color: '#ddd', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5));
    const bs = { fontFamily: 'monospace', fontSize: '40px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 8, backgroundColor: '#00000088', padding: { x: 18, y: 8 } };
    const b1 = ui(this.add.text(W / 2, 430, win ? 'PLAY AGAIN  [R]' : 'RETRY  [R]', bs).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    const b2 = ui(this.add.text(W / 2, 520, 'MENU  [ESC]', bs).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    b1.on('pointerdown', () => this.overAction()); b2.on('pointerdown', () => this.leave());
  }
  private overAction() { if (!this.overShown) return; if (this.result === 'win') this.playAgain(); else this.retry(); }
  private playAgain() {
    if ((this as any)._leaving) return; (this as any)._leaving = true;
    this.cameras.main.fadeOut(250, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { (this as any)._leaving = false; this.restarting = true; this.scene.restart({ restart: true }); });
  }
  /** one try per run: RETRY starts the fight (or, after a drone KO, the street) again at full health, no loading */
  private retry() {
    for (const o of this.overUi) o.destroy();
    this.overUi = []; this.overShown = false; this.vic = false; this.result = null; this.endT = 0; this.banner.setVisible(false); this.tweens.killTweensOf(this.banner);
    const F = this.F;
    if (this.bossGo) { this.hx = this.arenaL + 220; this.cans = this.fightCans.slice(); this.clearSplats(); }
    F.sprite.clearTint(); F.reset(this.hx, 1);
    this.mode = 'guard'; this.seq = []; this.seqDone = null; this.canOut = false; this.guardAt = this.t; this.iframes = 120; this.face = 1; this.tagging = false;
    for (const d of this.drones) if (d.state !== 'crash' && d.state !== 'wreck') { d.state = 'flee'; d.t = 0; d.vx = 2; d.vy = -1; d.spr.clearTint(); }
    if (this.bossGo) this.enterBoss();
  }

  private cpuInput(): Inp {
    const c = this.C, p = this.F, a = this.ai;
    const pAtk = p.state === 'attack' && a.pPrev !== 'attack'; a.pPrev = p.state;
    if (this.fphase !== 'fight' || (c.state !== 'idle' && c.state !== 'walk')) return NO_INPUT;
    const dist = Math.abs(p.bodyX() - c.bodyX());
    const mv = (d: number): Inp => ({ ...NO_INPUT, fwd: d > 0, back: d < 0 });
    if (p.lying()) return mv(dist < 430 ? -1 : 0);
    if (pAtk && dist < this.rMax + 80 && Math.random() < 0.3) a.evadeDelay = Math.round(this.rr(5, 11));
    if (a.evadeDelay > 0 && --a.evadeDelay === 0) a.evade = Math.round(this.rr(18, 28));
    if (a.evade > 0) { a.evade--; return mv(-1); }
    if (a.retreat > 0) { a.retreat--; return mv(-1); }
    a.cool--;
    if (--a.wait > 0) return mv(a.intent);
    a.wait = Math.round(this.rr(12, 20));
    const crouching = p.state === 'crouch';
    if (dist <= this.rMax - 6 && a.cool <= 0 && Math.random() < (crouching ? 0.35 : 0.75)) { a.cool = Math.round(this.rr(50, 90)); a.intent = 0; return { ...NO_INPUT, punch: true }; }
    if (dist < this.rMax + 60 && Math.random() < 0.22) { a.retreat = Math.round(this.rr(20, 35)); a.intent = -1; return mv(-1); }
    a.intent = dist > this.rMax - 14 ? 1 : dist < this.rMin + 6 ? -1 : 0;
    return mv(a.intent);
  }
  private probe(A: Fighter, D: Fighter): Box | null {
    const f = A.frame();
    if (A.state !== 'attack' || !f.hb) { A.winHit = false; return null; }
    if (A.winHit) return null;
    const df = D.frame();
    if (df.inv || !df.hu || D.lying()) return null;
    const hb = A.world(f.hb), hu = D.world(df.hu);
    if (!overlap(hb, hu)) return null;
    return [Math.max(hb[0], hu[0]), Math.max(hb[1], hu[1]), Math.min(hb[2], hu[2]), Math.min(hb[3], hu[3])];
  }
  private applyHit(A: Fighter, D: Fighter, at: Box | null) {
    A.winHit = true;
    if (D === this.C) this.stun.t = 0;
    if (D === this.F && this.mode !== 'guard') this.interrupt();
    const away = Math.sign(D.bodyX() - A.bodyX()) || -D.facing;
    const facingA = Math.sign(A.bodyX() - D.bodyX()) === D.facing;
    if (D.guarding() && facingA) {
      D.hp = Math.max(1, D.hp - 1); D.lagDelay = 32; D.vx = 7 * away; this.hitstop = Math.max(this.hitstop, 3);
      if (at) this.spark(at, 0.6);
      return;
    }
    const dmg = A.def.dmg[A.move] ?? 8;
    D.hp = Math.max(0, D.hp - dmg); D.lagDelay = 32;
    D.stagger += A.def.stag[A.move] ?? 1; D.staggerT = 50;
    D.flash(); if (at) this.spark(at, 1);
    D.vx = 5 * away;
    if (D.hp <= 0) {
      D.ko = true; D.facing = Math.sign(A.bodyX() - D.bodyX()) || D.facing; D.state = 'knockdown'; D.setMove('knockdown'); D.vx = 0; this.hitstop = 16;
      this.setResult(A === this.F ? 'win' : 'lose');
    } else if (D.stagger >= 4) {
      D.stagger = 0; D.facing = Math.sign(A.bodyX() - D.bodyX()) || D.facing; D.state = 'knockdown'; D.setMove('knockdown'); D.vx = 0; this.hitstop = 8; this.cameras.main.shake(140, 0.005);
    } else { D.state = 'hit'; D.setMove('hit'); this.hitstop = Math.max(this.hitstop, 5); this.cameras.main.shake(90, 0.003); }
  }
  private spark(b: Box, s: number) {
    const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2;
    if (!this.anims.exists('fx_spark')) return;
    const sp = this.add.sprite(Math.round(x), Math.round(y), 'fx_spark', 0).setScale(s >= 1 ? 2 : 1).setDepth(13);
    sp.play('fx_spark'); sp.once('animationcomplete', () => sp.destroy());
  }
  private collide() {
    const P = this.F, C = this.C;
    const clamp = (f: Fighter, lo: number, hi: number) => {
      const off = f.bodyX() - f.x, bx = f.bodyX();
      if (f.lying()) { if (bx < lo) f.x += Math.min(6, lo - bx); else if (bx > hi) f.x -= Math.min(6, bx - hi); }
      else f.x = Phaser.Math.Clamp(bx, lo, hi) - off;
    };
    const cLo = this.cIn ? this.arenaL : -1e9, cHi = this.cIn ? this.arenaR : 1e9;
    if (!P.lying() && !C.lying() && this.cIn) {
      const min = P.def.push + C.def.push, d = C.bodyX() - P.bodyX(), ad = Math.abs(d);
      if (ad < min) { const s = Math.sign(d) || (P.facing > 0 ? 1 : -1), push = (min - ad) / 2; P.x -= push * s; C.x += push * s; }
    }
    clamp(P, this.arenaL, this.arenaR); clamp(C, cLo, cHi);
    if (!P.lying() && !C.lying() && this.cIn) {
      const min = P.def.push + C.def.push, d = C.bodyX() - P.bodyX();
      if (Math.abs(d) < min - 0.5) {
        const s = Math.sign(d) || 1, need = min - Math.abs(d);
        const pinnedP = P.bodyX() <= this.arenaL + 0.5 || P.bodyX() >= this.arenaR - 0.5;
        if (pinnedP) C.x += need * s; else P.x -= need * s;
      }
    }
  }

  /** spray against the CYLOBOT: world area of a fighter's current hurtbox (stays glued to the animation) */
  private bodyBox(f: Fighter): Box {
    const fr = f.frame();
    if (fr.hu) return f.world(fr.hu);
    if (f.lying()) { const cx = f.x + f.facing * fr.bcx; return [cx - 190, FY - 230, cx + 190, FY - 10]; }
    return f.world(f.mv.idle.frames[0].hu ?? [-120, -560, 120, 0]);
  }
  private sprayReaches(tp: [number, number]): boolean {
    const C = this.C; if (C.lying() || C.state === 'ko') return false;
    const wb = this.bodyBox(C), f = this.face;
    const ahead = f > 0 ? wb[2] > tp[0] && wb[0] < tp[0] + 560 : wb[0] < tp[0] && wb[2] > tp[0] - 560;
    return ahead && wb[1] < tp[1] + 70 && wb[3] > tp[1] - 70;
  }
  private hitCylo(tp: [number, number]) {
    const C = this.C, col = this.canColor();
    this.fstats.hits++;
    const count = 3 + Math.floor(this.rand() * 2);
    for (let i = 0; i < count; i++) {
      const v = Math.floor(this.rand() * SPLAT_VARIANTS);
      const spr = this.add.image(0, 0, splatTex(this, col, v)).setDepth(C.sprite.depth + 0.4);
      this.splats.push({ u: this.rr(0.2, 0.8), v: this.rr(0.14, 0.82), sc: [0.8, 1, 1.25, 1.5][Math.floor(this.rand() * 4)], flip: this.rand() < 0.5 ? -1 : 1, spr, age: 0 });
    }
    while (this.splats.length > 40) this.splats.shift()!.spr.destroy();
    this.puff(Phaser.Math.Clamp(this.bodyBox(C)[this.face > 0 ? 0 : 2], tp[0] - 300, tp[0] + 600), tp[1], 6);
    if (this.stun.cool <= 0 && !C.lying() && C.state !== 'hit') {
      this.stun.t = STUN_TICKS; this.stun.cool = STUN_COOL; this.fstats.stuns++;
      if (C.flashT > 0) { C.flashT = 0; C.sprite.clearTint(); }
    }
  }
  private clearSplats() { for (const s of this.splats) s.spr.destroy(); this.splats = []; }
  private renderSplats() {
    if (!this.splats.length || !this.C) return;
    const C = this.C, b = this.bodyBox(C), w = b[2] - b[0], h = b[3] - b[1], f = C.facing;
    for (const s of this.splats) {
      s.age++;
      const x = f > 0 ? b[0] + s.u * w : b[2] - s.u * w, y = b[1] + s.v * h;
      const pop = s.age < 7 ? 1 + 0.35 * (1 - s.age / 7) : 1;
      s.spr.setPosition(Math.round(x), Math.round(y)).setScale(s.sc * pop * s.flip, s.sc * pop).setDepth(C.sprite.depth + 0.4).setVisible(C.sprite.visible);
    }
  }

  /** straight spray in the fight: no pocket draw, same raise / hold / return clips as the street and the Fight scene */
  private startBossSpray() {
    if (this.totalCans() <= 0.001) { this.flash('OUT OF CANS'); return; }
    const HOLD = 74, F = this.F;
    this.face = F.facing; this.hx = F.x; F.toIdle(0); this.sprayHit = false; this.fstats.sprays++;
    this.runSeq([
      this.S('fwd_spray_raise', { speed: 1 }),
      this.S('fwd_spray_hold', { ticks: HOLD, onTick: (t) => {
        const tp = this.tipWorld(); if (!tp) return;
        if (t < HOLD - 6) this.cone(tp[0], tp[1], this.face > 0 ? 0 : Math.PI, 0.2, 4, 15, 520);
        this.consume(SPRAY_CAN / HOLD);
        if (!this.sprayHit && t >= 14 && this.C && this.sprayReaches(tp)) { this.sprayHit = true; this.hitCylo(tp); }
      } }),
      this.S('fwd_spray_return', { speed: 1 }),
    ], () => { this.mode = 'guard'; this.F.x = this.hx; this.F.toIdle(0); this.guardAt = this.t; this.face = 1; });
  }

  private tickFight(ts: Record<string, boolean>) {
    const F = this.F, C = this.C;
    this.bossT++; this.fT++;
    if (this.mode === 'relaxed') this.raiseGuard();
    const T = this.fT;
    if (this.fphase === 'enter') this.warn.setFillStyle(0xff0000, T < 150 ? 0.16 * Math.max(0, Math.sin(T / 6)) : 0); else this.warn.setFillStyle(0xff0000, 0);
    if (this.stun.cool > 0) this.stun.cool--;
    if (this.hitstop > 0) { this.hitstop--; return; }
    const locked = !!this.result;
    if (this.result === 'win') this.tickVictory();
    // Seek
    if (this.mode === 'seq') { this.tickSeq(); F.x = this.hx; }
    else if (this.mode === 'guard') {
      if (!locked && this.buf.spray > 0 && (F.state === 'idle' || F.state === 'walk')) { this.buf.spray = 0; this.startBossSpray(); }
      else {
        const wasAtk = F.state === 'attack';
        F.step(locked ? NO_INPUT : this.playerInp(ts), C);
        if (F.state === 'attack' && F.fi === 0 && !wasAtk) { this.buf.punch = 0; this.buf.kick = 0; }
        this.hx = F.x;
      }
    }
    // CYLOBOT
    const stunned = this.stun.t > 0 && !C.lying() && C.state !== 'hit';
    if (!stunned) this.stun.t = 0;
    let cin: Inp = NO_INPUT;
    if (this.fphase === 'enter') {
      if (C.x > Math.min(this.arenaR - 20, F.bodyX() + 520)) cin = { ...NO_INPUT, fwd: true };
      else if (T >= 120) {
        this.fphase = 'fight'; this.fT = 0;
        this.banner.setText('FIGHT!').setVisible(true).setScale(1.6); this.tweens.add({ targets: this.banner, scale: 1, duration: 260, ease: 'Back.Out' });
        this.cameras.main.shake(300, 0.006);
      }
    } else if (this.fphase === 'fight' && !stunned) cin = this.cpuInput();
    if (stunned) this.stun.t--; else C.step(cin, F);   // stunned: stuck on its current frame, then resumes from there
    if (C.x <= this.arenaR) this.cIn = true;
    if (this.fphase === 'fight' && this.fT === 60) this.banner.setVisible(false);
    if (this.fphase === 'fight') {
      const hp = this.probe(F, C), hc = !stunned ? this.probe(C, F) : null;
      if (hp) this.applyHit(F, C, hp);
      if (hc) this.applyHit(C, F, hc);
    }
    this.collide();
    this.hx = F.x;
    F.sprite.setDepth(F.state === 'attack' ? 12 : 11); C.sprite.setDepth(C.state === 'attack' ? 12 : 10);
    F.smoke.setDepth(F.sprite.depth - 0.5); C.smoke.setDepth(C.sprite.depth - 0.5);
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
    this.tickLoads();
    if (!this.bossGo && !this.result && this.hx >= BOSS_X && this.cyloG.state === 'ready' && (this.mode === 'relaxed' || this.mode === 'guard')) this.startBoss();
    if (this.iframes > 0) this.iframes--;
    for (const f of this.bossGo ? [this.F, this.C] : [this.F]) { if (f.lagDelay > 0) f.lagDelay--; else if (f.lag > f.hp) f.lag = Math.max(f.hp, f.lag - 0.6); if (f.lag < f.hp) f.lag = f.hp; }
    this.tickResult();
    for (const w of this.waves) if (!w.done && this.hx >= w.x) { w.done = true; this.spawnWave(w.n); }

    if (this.bossGo) {
      this.tickFight(ts);
    } else if (this.mode === 'seq') {
      this.tickSeq();
      this.F.x = this.hx;
    } else if (this.mode === 'relaxed') {
      const wantAtk = this.buf.punch > 0 || this.buf.kick > 0;
      if (this.approach) {
        // walk to the centre of the wall first, then start the tag
        const w = this.approach, d = w.cx - this.hx;
        if (Math.abs(d) <= SPEED) { this.hx = w.cx; this.approach = null; this.move = 'idle'; this.startTag(w); }
        else this.tickRelaxed(Math.sign(d));
      }
      else if (this.buf.spray > 0) { this.buf.spray = 0; this.doSpray(); }
      else if (this.buf.act > 0) { this.buf.act = 0; this.startCanToggle(); }
      else if (wantAtk) { const p = this.buf.punch > 0; this.raiseGuard(() => { if (p) this.buf.punch = 8; else this.buf.kick = 8; }); }
      else this.tickRelaxed(dir);
      this.F.x = this.hx;
    } else if (this.mode === 'guard') {
      const free = this.F.state === 'idle' || this.F.state === 'walk';
      if (!this.result && free && (this.buf.spray > 0 || this.buf.act > 0)) {
        const sp = this.buf.spray > 0; this.buf.spray = 0; this.buf.act = 0;
        this.lowerGuard(() => { if (sp) this.doSpray(); else this.startCanToggle(); });
      } else {
        const inp = this.result ? NO_INPUT : this.playerInp(ts);
        const wasAtk = this.F.state === 'attack';
        this.F.step(inp, this.foe);
        if (this.F.state === 'attack' && this.F.fi === 0 && !wasAtk) { this.buf.punch = 0; this.buf.kick = 0; this.guardAt = this.t; }
        if (this.F.state === 'attack') this.guardAt = this.t;
        this.F.x = Phaser.Math.Clamp(this.F.x, 120, WORLD_W - 80); this.hx = this.F.x;
        this.checkMelee();
        if (this.t - this.guardAt > GUARD_DROP && this.F.state === 'idle' && !this.result) this.lowerGuard();
      }
    }
    if (!this.bossGo) this.hx = Phaser.Math.Clamp(this.hx, 120, WORLD_W - 80);
    this.tickCams(); this.tickDrones(); this.tickMist();
  }

  private tickRelaxed(dir: number) {
    // relaxed locomotion: idle loops -> walk_loop at once (walk_start was removed); left walks the loop backwards
    if (dir !== 0) {
      this.moveDir = dir;
      if (this.move === 'idle') { this.move = 'loop'; this.setClip('walk_loop', 0); }
      this.advance(1, dir);
      this.hx += dir * SPEED * (dir < 0 ? 0.8 : 1);
    } else {
      if (this.move !== 'idle') { this.move = 'idle'; this.idleClip(); }
      else if (this.advance(1)) this.idleClip();
    }
  }

  // ------------------------------------------------------------------ render / hud
  private updatePrompt() {
    if (this.flashT > 0) { this.flashT--; return; }
    if (this.bossGo) { const w = this.fphase === 'enter' ? '\u26a0 WARNING  \u2022  CYLOBOT APPROACHING' : ''; this.prompt.setText(w).setColor('#ff5050').setVisible(!!w); return; }
    let s = '';
    if (this.mode === 'relaxed' || this.mode === 'guard') {
      const tg = this.sprayTarget();
      if (this.totalCans() <= 0.001) s = 'OUT OF CANS';
      else if (tg?.kind === 'wall') s = 'SPRAY: TAG THE WALL  (1 can, she stands in the middle)';
      else if (tg?.kind === 'cam') s = 'SPRAY: PAINT THE CAMERA  (1/2 can)';
      else if (this.drones.some((d) => !d.painted && d.state === 'hover')) s = 'SPRAY the drones (1/2 can)  or  PUNCH / KICK them';
      else if (this.walls.some((w) => !w.done && w.cx - this.hx > 0 && w.cx - this.hx < 760)) s = 'A blank wall \u2192';
      if (this.hx >= BOSS_X - 150 && this.cyloG.state !== 'ready') s = 'LOADING CYLOBOT...';
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
    const blink = this.iframes > 0 && (this.iframes >> 2) % 2 === 1 ? 0.45 : 1;
    F.sprite.setAlpha(blink); this.hero.setAlpha(blink);
    if (this.bossGo) { this.C.render(false); this.renderSplats(); }
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
      walls: this.walls.map((w) => ({ spot: w.spot, cx: w.cx, done: w.done })), cams: this.cams.map((c) => ({ x: c.x, state: c.state })),
      drones: this.drones.map((d) => ({ x: Math.round(d.x), y: Math.round(d.y), state: d.state, painted: d.painted })),
      approach: !!this.approach, cf: Math.round(this.cf), stats: this.stats, boss: this.bossGo, bossT: this.bossT,
      fight: { phase: this.fphase, result: this.result, endT: this.endT, over: this.overShown, hp: Math.round(this.F.hp), cHp: this.C ? Math.round(this.C.hp) : null, cState: this.C?.state ?? null, cX: this.C ? Math.round(this.C.x) : null, cMove: this.C?.move ?? null, stunT: this.stun.t, splats: this.splats.length, iframes: this.iframes, cIn: this.cIn, cBar: +this.cBar.toFixed(2), arena: [this.arenaL, this.arenaR], ...this.fstats },
      art: { wall: this.wallG.state, cylo: this.cyloG.state, heroTex: this.hero.texture.key }, target: (() => { const t = this.sprayTarget(); return t ? t.kind : null; })(), lite: this.lite,
    };
  }
  dbgHp(who: 'seek' | 'cylo', hp: number) { const f = who === 'seek' ? this.F : this.C; f.hp = hp; f.lag = Math.max(f.lag, hp); }
  dbgSwoop() { for (const d of this.drones) if (d.state === 'hover') d.next = 0; }
  dbgRefill() { this.cans = [1, 1, 1, 1, 1]; }
  dbgTeleport(x: number) { if (this.mode === 'relaxed') this.hx = x; else if (this.mode === 'guard') this.F.x = this.hx = x; }
}
