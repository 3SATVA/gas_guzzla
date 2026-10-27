import Phaser from 'phaser';
import { Fighter, FY, STAGE_L, STAGE_R } from '../fight/Fighter';
import { StageFx } from '../fight/StageFx';
import { Box, FighterId, Inp, MoveSet, NO_INPUT } from '../fight/types';
import { isTouch, liteMode } from '../game/lite';

const STAGE_W = 1920;
const TICK = 1000 / 60;
const ROUND_S = 99;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const overlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

type Phase = 'intro' | 'fight' | 'ko' | 'over';
interface TBtn { id: keyof Inp; x: number; y: number; r: number; g: Phaser.GameObjects.Arc; t: Phaser.GameObjects.Text }

/** 1v1 vs the CPU CYLOBOT on the v6 alley: best of 3, MK-style HUD, keyboard + touch. */
export class FightScene extends Phaser.Scene {
  private pid: FighterId = 'fade';
  private from = '';
  private lite = false;
  private P!: Fighter; private C!: Fighter;
  private fx!: StageFx;
  private phase: Phase = 'intro'; private phaseT = 0;
  private round = 1; private timeT = 0; private hitstop = 0; private acc = 0;
  private winner: Fighter | null = null;
  private rMin = 225; private rMax = 260;
  // hud
  private hud!: Phaser.GameObjects.Graphics;
  private timerTxt!: Phaser.GameObjects.Text; private nameP!: Phaser.GameObjects.Text; private nameC!: Phaser.GameObjects.Text;
  private big!: Phaser.GameObjects.Text; private sub!: Phaser.GameObjects.Text;
  private overUi: Phaser.GameObjects.GameObject[] = [];
  private pickBtn!: Phaser.GameObjects.Text; private hint!: Phaser.GameObjects.Text;
  // input
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private buf = { punch: 0, kick: 0 };
  private touch: TBtn[] = []; private touchPrev: Record<string, boolean> = {};
  private useTouch = false;
  // cpu
  private ai = { wait: 0, cool: 40, retreat: 0, evade: 0, evadeDelay: 0, intent: 0, pPrev: 'idle' };

  constructor() { super('Fight'); }

  init(data: any) {
    this.pid = data?.fighter === 'seek' ? 'seek' : 'fade';
    this.from = data?.from === 'mock' ? 'mock' : '';
    this.registry.set('fighter', this.pid);
  }

  preload() {
    this.lite = liteMode(this.game);
    const mode = this.lite ? 'lite' : 'full';
    const W = this.scale.width;
    const bar = this.add.graphics().setScrollFactor(0);
    const txt = this.add.text(W / 2, 330, 'LOADING FIGHT...', { fontFamily: 'monospace', fontSize: '28px', color: '#f2c27a' }).setOrigin(0.5);
    this.load.on('progress', (v: number) => { bar.clear().fillStyle(0x333333).fillRect(W / 2 - 200, 370, 400, 14).fillStyle(0xf2c27a).fillRect(W / 2 - 200, 370, 400 * v, 14); });
    this.load.once('complete', () => { bar.destroy(); txt.destroy(); });
    const F = 'assets/fight/';
    for (const id of [this.pid, 'cylo'] as FighterId[]) {
      if (!this.textures.exists(`ft_${id}`)) this.load.multiatlas(`ft_${id}`, `${F}${id}/${mode}/atlas.json`, `${F}${id}/${mode}/`);
      if (!this.cache.json.exists(`mv_${id}`)) this.load.json(`mv_${id}`, `${F}${id}/${mode}/moves.json`);
    }
    const S = F + 'stage/';
    if (!this.textures.exists('alley_v6')) this.load.image('alley_v6', S + 'alley_v6.png');
    if (!this.cache.json.exists('wind_spec')) this.load.json('wind_spec', S + 'wind_spec.json');
    if (!this.cache.json.exists('bag_spec')) this.load.json('bag_spec', S + 'bag_spawner_spec.json');
    ['far', 'mid', 'near'].forEach((n, i) => { if (!this.textures.exists(`wind_${i}`)) this.load.image(`wind_${i}`, `${S}wind_${n}.png`); });
    for (let i = 0; i < this.streakCount(); i++) if (!this.textures.exists(`streak${i}`)) this.load.spritesheet(`streak${i}`, `${S}streak${i}_sheet_2x.png`, { frameWidth: 768, frameHeight: 64 });
    const loadBags = (meta: any) => {
      for (const id of this.bagIds()) for (const tier of ['S', 'M', 'L', 'XL']) {
        if (tier === 'XL' && this.lite && id !== 0) continue;
        const k = `bag${id}_${tier}`; const t = meta[String(id)].tiers[tier];
        if (!this.textures.exists(k)) this.load.spritesheet(k, S + t.sheet, { frameWidth: t.cell[0], frameHeight: t.cell[1], endFrame: 143 });
      }
    };
    if (this.cache.json.exists('bags_meta')) loadBags(this.cache.json.get('bags_meta'));
    else { this.load.json('bags_meta', S + 'bags_meta.json'); this.load.once('filecomplete-json-bags_meta', (_k: string, _t: string, d: any) => loadBags(d)); }
  }

  private streakCount() { return this.lite ? 3 : 6; }
  private bagIds() { return this.lite ? [0, 1] : [0, 1, 2, 3]; }

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

  create() {
    const W = this.scale.width;
    const q = new URLSearchParams(location.search);
    this.phase = 'intro'; this.phaseT = 0; this.round = 1; this.hitstop = 0; this.acc = 0; this.winner = null; this.overUi = [];
    this.buf = { punch: 0, kick: 0 }; this.touch = []; this.touchPrev = {};
    const cam = this.cameras.main;
    cam.setZoom(1).setBounds(0, 0, STAGE_W, 720).setBackgroundColor('#000').fadeIn(250, 0, 0, 0);
    this.add.image(0, 0, 'alley_v6').setOrigin(0).setDepth(0);
    for (const id of [this.pid, 'cylo'] as FighterId[]) {
      const w = id === 'cylo' ? 210 : id === 'seek' ? 136 : 150;
      this.shadowTex(`shadow_${id}`, w); this.shadowTex(`shadow_${id}_lie`, Math.round(w * 1.9));
    }
    this.fx = new StageFx(this, this.lite, this.bagIds(), this.streakCount(), q.get('bag') === 'front');
    this.P = new Fighter(this, this.pid, this.cache.json.get(`mv_${this.pid}`) as MoveSet, 11);
    this.C = new Fighter(this, 'cylo', this.cache.json.get('mv_cylo') as MoveSet, 10);
    this.computeReach();
    this.buildHud();
    this.buildInput();
    this.startRound();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const id of [this.pid, 'cylo']) { if (this.textures.exists(`ft_${id}`)) this.textures.remove(`ft_${id}`); this.cache.json.remove(`mv_${id}`); }
    });
    (window as any).__gg.fight = this;
  }

  /** CPU punch range from the data: the farthest feet-to-feet distance where a punch hitbox meets the player's idle hurtbox */
  private computeReach() {
    const hu = this.P.mv.idle.frames[0].hu ?? [-60, -500, 60, 0];
    let best = 0;
    for (const f of this.C.mv[this.C.def.punch].frames) if (f.hb && f.hb[1] < hu[3] && hu[1] < f.hb[3]) best = Math.max(best, f.hb[2] + hu[2]);
    this.rMin = this.P.def.push + this.C.def.push;
    this.rMax = Math.max(this.rMin + 20, best);
  }

  // ------------------------------------------------------------------ HUD
  private buildHud() {
    const W = this.scale.width;
    const ui = (o: any) => o.setScrollFactor(0).setDepth(60);
    this.hud = ui(this.add.graphics());
    const ns = { fontFamily: 'monospace', fontSize: '20px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 5 };
    this.nameP = ui(this.add.text(0, 62, this.P.def.name, ns));
    this.nameC = ui(this.add.text(0, 62, this.C.def.name, ns).setOrigin(1, 0));
    this.timerTxt = ui(this.add.text(W / 2, 43, '99', { fontFamily: 'monospace', fontSize: '44px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5));
    this.big = ui(this.add.text(W / 2, 300, '', { fontFamily: 'monospace', fontSize: '96px', fontStyle: 'bold', color: '#f2d21b', stroke: '#300', strokeThickness: 12 }).setOrigin(0.5).setDepth(70));
    this.sub = ui(this.add.text(W / 2, 390, '', { fontFamily: 'monospace', fontSize: '34px', fontStyle: 'bold', color: '#ffffff', stroke: '#000', strokeThickness: 7 }).setOrigin(0.5).setDepth(70));
    this.pickBtn = ui(this.add.text(W - 14, 108, this.from === 'mock' ? 'STREET \u21a9' : 'PICK \u21a9', { fontFamily: 'monospace', fontSize: '18px', color: '#f2c27a', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0));
    this.pickBtn.setInteractive({ useHandCursor: true }).on('pointerdown', () => this.backToPick());
    const pn = this.pid === 'seek' ? 'KICK' : 'PUNCH', kn = this.pid === 'seek' ? 'HIGH KICK' : 'KICK';
    this.hint = ui(this.add.text(W / 2, 712, `\u2190\u2192/A D move   \u2193/S crouch   J/Z ${pn}   K/X ${kn}   L/C/SHIFT block   ESC pick`,
      { fontFamily: 'monospace', fontSize: '13px', color: '#ddd', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 1));
  }

  private drawHud() {
    const W = this.scale.width, g = this.hud;
    const gap = 150, h = 26, y = 30;
    const bw = Math.min(520, Math.floor((W - gap) / 2) - 30);
    const lx = W / 2 - gap / 2, rx = W / 2 + gap / 2; // inner (timer-side) edges
    g.clear();
    const bar = (inner: number, dir: number, f: Fighter) => {
      const x0 = dir < 0 ? inner - bw : inner;
      g.fillStyle(0x000000, 0.85).fillRect(x0 - 4, y - 4, bw + 8, h + 8);
      g.fillStyle(0x3a0b0b).fillRect(x0, y, bw, h);
      const lw = Math.round((bw * f.lag) / 100), hw = Math.round((bw * f.hp) / 100);
      g.fillStyle(0xc8161b).fillRect(dir < 0 ? inner - lw : inner, y, lw, h);
      g.fillStyle(0xf2d21b).fillRect(dir < 0 ? inner - hw : inner, y, hw, h);
      g.fillStyle(0xfff3a0).fillRect(dir < 0 ? inner - hw : inner, y + 3, hw, 4);
      g.lineStyle(3, 0xd9a441).strokeRect(x0 - 2, y - 2, bw + 4, h + 4);
      for (let i = 0; i < 2; i++) {
        const cx = dir < 0 ? inner - 14 - i * 26 : inner + 14 + i * 26;
        g.fillStyle(0x000000).fillCircle(cx, y + h + 22, 9);
        g.fillStyle(i < f.rounds ? 0xf2d21b : 0x444444).fillCircle(cx, y + h + 22, 6);
      }
      return x0;
    };
    const p0 = bar(lx, -1, this.P); bar(rx, 1, this.C);
    this.nameP.setPosition(p0, 62 + 18).setOrigin(0, 0);
    this.nameC.setPosition(rx + bw, 62 + 18);
    this.timerTxt.setPosition(W / 2, 43).setText(String(Math.max(0, Math.ceil(ROUND_S - this.timeT / 60))).padStart(2, '0'));
    this.big.setX(W / 2); this.sub.setX(W / 2); this.hint.setX(W / 2); this.pickBtn.setX(W - 14);
  }

  // ------------------------------------------------------------------ input
  private buildInput() {
    const kb = this.input.keyboard!;
    for (const k of ['LEFT', 'RIGHT', 'DOWN', 'A', 'D', 'S', 'J', 'K', 'L', 'Z', 'X', 'C', 'SHIFT', 'R', 'ESC', 'ENTER'])
      this.keys[k] = kb.addKey(Phaser.Input.Keyboard.KeyCodes[k as keyof typeof Phaser.Input.Keyboard.KeyCodes], true);
    kb.on('keydown-J', () => (this.buf.punch = 8)); kb.on('keydown-Z', () => (this.buf.punch = 8));
    kb.on('keydown-K', () => (this.buf.kick = 8)); kb.on('keydown-X', () => (this.buf.kick = 8));
    kb.on('keydown-ESC', () => this.backToPick());
    kb.on('keydown-R', () => { if (this.phase === 'over') this.rematch(); });
    kb.on('keydown-ENTER', () => { if (this.phase === 'over') this.rematch(); });
    this.useTouch = isTouch() || new URLSearchParams(location.search).get('touch') === '1';
    if (!this.useTouch) return;
    this.input.addPointer(3);
    const W = this.scale.width, seek = this.pid === 'seek';
    const mk = (id: keyof Inp, x: number, y: number, r: number, label: string) => {
      const g = this.add.circle(x, y, r, 0x000000, 0.35).setStrokeStyle(3, 0xf2c27a, 0.8).setScrollFactor(0).setDepth(65);
      const t = this.add.text(x, y, label, { fontFamily: 'monospace', fontSize: label.length > 2 ? '15px' : '26px', fontStyle: 'bold', color: '#f2c27a' })
        .setOrigin(0.5).setScrollFactor(0).setDepth(66);
      this.touch.push({ id, x, y, r, g, t });
    };
    mk('back', 86, 590, 50, '\u25c0'); mk('fwd', 236, 590, 50, '\u25b6'); mk('down', 161, 668, 44, '\u25bc');
    mk('punch', W - 250, 600, 52, seek ? 'KICK' : 'PUNCH'); mk('kick', W - 100, 560, 52, seek ? 'HIGH' : 'KICK'); mk('block', W - 170, 672, 44, 'BLOCK');
  }

  /** touch state: 'back'/'fwd' are screen left/right here; converted to facing below */
  private touchState(): Record<string, boolean> {
    const s: Record<string, boolean> = {};
    if (!this.useTouch) return s;
    const W = this.scale.width;
    for (const b of this.touch) { if (b.id === 'punch') b.x = W - 250; if (b.id === 'kick') b.x = W - 100; if (b.id === 'block') b.x = W - 170; b.g.setX(b.x); b.t.setX(b.x); }
    for (const p of this.input.manager.pointers) {
      if (!p || !p.isDown) continue;
      for (const b of this.touch) if (Math.hypot(p.x - b.x, p.y - b.y) < b.r + 14) s[b.id] = true;
    }
    for (const b of this.touch) b.g.setFillStyle(s[b.id] ? 0xf2c27a : 0x000000, s[b.id] ? 0.5 : 0.35);
    if (s.punch && !this.touchPrev.punch) this.buf.punch = 8;
    if (s.kick && !this.touchPrev.kick) this.buf.kick = 8;
    this.touchPrev = s;
    return s;
  }

  private playerInput(ts: Record<string, boolean>): Inp {
    const k = this.keys;
    const left = k.LEFT.isDown || k.A.isDown || !!ts.back, right = k.RIGHT.isDown || k.D.isDown || !!ts.fwd;
    const f = this.P.facing;
    return {
      fwd: f > 0 ? right && !left : left && !right,
      back: f > 0 ? left && !right : right && !left,
      down: k.DOWN.isDown || k.S.isDown || !!ts.down,
      block: k.L.isDown || k.C.isDown || k.SHIFT.isDown || !!ts.block,
      punch: this.buf.punch > 0, kick: this.buf.kick > 0,
    };
  }

  // ------------------------------------------------------------------ rounds
  private startRound() {
    this.P.reset(730, 1); this.C.reset(1190, -1);
    this.timeT = 0; this.hitstop = 0; this.phase = 'intro'; this.phaseT = 0; this.winner = null;
    this.fx.frontEnabled = true;
    this.ai = { wait: 30, cool: 40, retreat: 0, evade: 0, evadeDelay: 0, intent: 0, pPrev: 'idle' };
    this.big.setText(`ROUND ${this.round}`).setVisible(true); this.sub.setText('').setVisible(false);
  }

  private endRound() {
    if (this.winner) this.winner.rounds++;
    if (this.P.rounds >= 2 || this.C.rounds >= 2 || this.round >= 5) return this.showOver();
    this.round++;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { this.startRound(); this.cameras.main.fadeIn(200, 0, 0, 0); });
    this.phase = 'over'; this.phaseT = -9999; // frozen until the fade completes
  }

  private showOver() {
    this.phase = 'over'; this.phaseT = 0;
    const W = this.scale.width;
    const champ = this.P.rounds > this.C.rounds ? this.P : this.C.rounds > this.P.rounds ? this.C : null;
    this.big.setVisible(false); this.sub.setVisible(false);
    const ui = (o: any) => { o.setScrollFactor(0).setDepth(80); this.overUi.push(o); return o; };
    ui(this.add.rectangle(0, 0, W, 720, 0x000000, 0.6).setOrigin(0));
    ui(this.add.text(W / 2, 230, champ ? `${champ.def.name} WINS` : 'DRAW', { fontFamily: 'monospace', fontSize: '84px', fontStyle: 'bold', color: champ === this.P ? '#f2d21b' : '#e04040', stroke: '#000', strokeThickness: 12 }).setOrigin(0.5));
    ui(this.add.text(W / 2, 318, champ === this.P ? 'YOU WIN' : champ ? 'YOU LOSE' : '', { fontFamily: 'monospace', fontSize: '26px', color: '#ddd', stroke: '#000', strokeThickness: 5 }).setOrigin(0.5));
    const bs = { fontFamily: 'monospace', fontSize: '40px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 8, backgroundColor: '#00000088', padding: { x: 18, y: 8 } };
    const b1 = ui(this.add.text(W / 2, 430, 'REMATCH  [R]', bs).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    const b2 = ui(this.add.text(W / 2, 520, 'BACK TO PICK  [ESC]', bs).setOrigin(0.5).setInteractive({ useHandCursor: true }));
    b1.on('pointerdown', () => this.rematch()); b2.on('pointerdown', () => this.backToPick());
  }

  private rematch() {
    for (const o of this.overUi) o.destroy();
    this.overUi = []; this.P.rounds = 0; this.C.rounds = 0; this.round = 1;
    this.startRound();
  }

  private backToPick() {
    if ((this as any)._leaving) return; (this as any)._leaving = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => { (this as any)._leaving = false; this.scene.start(this.from === 'mock' ? 'Mock' : 'Select', this.from === 'mock' ? undefined : { mode: 'fight' }); });
  }

  // ------------------------------------------------------------------ CPU
  private cpuInput(): Inp {
    const c = this.C, p = this.P, a = this.ai;
    const pAtk = p.state === 'attack' && a.pPrev !== 'attack'; a.pPrev = p.state;
    if (this.phase !== 'fight' || (c.state !== 'idle' && c.state !== 'walk')) return NO_INPUT;
    const dist = Math.abs(p.bodyX() - c.bodyX());
    const mv = (d: number): Inp => ({ ...NO_INPUT, fwd: d > 0, back: d < 0 });
    if (p.lying()) return mv(dist < 430 ? -1 : 0);
    // "block" substitute: the Cylobot has no block art, so it sometimes steps out of an incoming attack
    if (pAtk && dist < this.rMax + 80 && Math.random() < 0.3) a.evadeDelay = Math.round(rnd(5, 11));
    if (a.evadeDelay > 0 && --a.evadeDelay === 0) a.evade = Math.round(rnd(18, 28));
    if (a.evade > 0) { a.evade--; return mv(-1); }
    if (a.retreat > 0) { a.retreat--; return mv(-1); }
    a.cool--;
    if (--a.wait > 0) return mv(a.intent);
    a.wait = Math.round(rnd(12, 20));
    const crouching = p.state === 'crouch';
    if (dist <= this.rMax - 6 && a.cool <= 0 && Math.random() < (crouching ? 0.35 : 0.75)) {
      a.cool = Math.round(rnd(50, 90)); a.intent = 0;
      return { ...NO_INPUT, punch: true };
    }
    if (dist < this.rMax + 60 && Math.random() < 0.22) { a.retreat = Math.round(rnd(20, 35)); a.intent = -1; return mv(-1); }
    a.intent = dist > this.rMax - 14 ? 1 : dist < this.rMin + 6 ? -1 : 0;
    return mv(a.intent);
  }

  // ------------------------------------------------------------------ combat
  /** does A's current attack frame connect with D this tick? one hit per contiguous active window */
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

  private applyHit(A: Fighter, D: Fighter, at: Box | null, forceDmg?: number) {
    A.winHit = true;
    const away = Math.sign(D.bodyX() - A.bodyX()) || -D.facing;
    const facingA = Math.sign(A.bodyX() - D.bodyX()) === D.facing;
    if (forceDmg === undefined && D.guarding() && facingA) {
      D.hp = Math.max(1, D.hp - 1); D.lagDelay = 32; D.vx = 7 * away; this.hitstop = Math.max(this.hitstop, 3);
      if (at) this.spark(at, 0.6);
      return;
    }
    const dmg = forceDmg ?? (A.def.dmg[A.move] ?? 8);
    D.hp = Math.max(0, D.hp - dmg); D.lagDelay = 32;
    D.stagger += A.def.stag[A.move] ?? 1; D.staggerT = 50;
    D.flash(); if (at) this.spark(at, 1);
    D.vx = 5 * away;
    if (D.hp <= 0) {
      D.ko = true; this.knock(D, A); this.hitstop = 16;
      this.cameras.main.shake(260, 0.008);
      this.phase = 'ko'; this.phaseT = 0; this.winner = A; this.fx.frontEnabled = false;
      this.big.setText('K.O.').setVisible(true);
    } else if (D.stagger >= 4) {
      D.stagger = 0; this.knock(D, A); this.hitstop = 8; this.cameras.main.shake(140, 0.005);
    } else {
      // crouch-hit art is deferred: a hit while crouching/blocking plays the standing hit reaction
      D.state = 'hit'; D.setMove('hit'); this.hitstop = Math.max(this.hitstop, 5); this.cameras.main.shake(90, 0.003);
    }
  }

  private knock(D: Fighter, A: Fighter) {
    D.facing = Math.sign(A.bodyX() - D.bodyX()) || D.facing;
    D.state = 'knockdown'; D.setMove('knockdown'); D.vx = 0;
  }

  private spark(b: Box, s: number) {
    const x = (b[0] + b[2]) / 2, y = (b[1] + b[3]) / 2;
    if (!this.anims.exists('fx_spark')) return;
    const sp = this.add.sprite(Math.round(x), Math.round(y), 'fx_spark', 0).setScale(s >= 1 ? 2 : 1).setDepth(13);
    sp.play('fx_spark'); sp.once('animationcomplete', () => sp.destroy());
  }

  private collide() {
    const P = this.P, C = this.C, W = this.scale.width;
    const clamp = (f: Fighter) => {
      const off = f.bodyX() - f.x;
      const lo = STAGE_L, hi = STAGE_R;
      const bx = f.bodyX();
      if (f.lying()) { if (bx < lo) f.x += Math.min(6, lo - bx); else if (bx > hi) f.x -= Math.min(6, bx - hi); }
      else f.x = Phaser.Math.Clamp(bx, lo, hi) - off;
    };
    if (!P.lying() && !C.lying()) {
      const min = P.def.push + C.def.push;
      const d = C.bodyX() - P.bodyX(), ad = Math.abs(d);
      if (ad < min) {
        const s = Math.sign(d) || (P.facing > 0 ? 1 : -1), push = (min - ad) / 2;
        P.x -= push * s; C.x += push * s;
      }
    }
    clamp(P); clamp(C);
    if (!P.lying() && !C.lying()) {
      const min = P.def.push + C.def.push;
      const d = C.bodyX() - P.bodyX();
      if (Math.abs(d) < min - 0.5) {
        // one is pinned at a wall: the other takes the whole push
        const s = Math.sign(d) || 1;
        const need = min - Math.abs(d);
        const pinnedP = P.bodyX() <= STAGE_L + 0.5 || P.bodyX() >= STAGE_R - 0.5;
        if (pinnedP) C.x += need * s; else P.x -= need * s;
      }
    }
    // keep both on one screen
    const maxSep = W - 260;
    const sep = C.bodyX() - P.bodyX();
    if (Math.abs(sep) > maxSep) {
      const ex = (Math.abs(sep) - maxSep) * Math.sign(sep);
      if (!P.lying() && P.state === 'walk') P.x += ex; else if (!C.lying() && C.state === 'walk') C.x -= ex; else { P.x += ex / 2; C.x -= ex / 2; }
    }
  }

  private tick() {
    const P = this.P, C = this.C;
    this.phaseT++;
    if (this.buf.punch > 0) this.buf.punch--;
    if (this.buf.kick > 0) this.buf.kick--;
    // fighter lag bars
    for (const f of [P, C]) { if (f.lagDelay > 0) f.lagDelay--; else if (f.lag > f.hp) f.lag = Math.max(f.hp, f.lag - 0.6); if (f.lag < f.hp) f.lag = f.hp; }
    if (this.phase === 'intro') {
      if (this.phaseT === 70) this.big.setText('FIGHT!');
      if (this.phaseT >= 115) { this.big.setVisible(false); this.phase = 'fight'; this.phaseT = 0; }
    }
    if (this.hitstop > 0) { this.hitstop--; return; }
    const ts = this.touchState();
    const pin = this.phase === 'fight' ? this.playerInput(ts) : NO_INPUT;
    const cin = this.cpuInput();
    P.step(pin, C); C.step(cin, P);
    if (P.state === 'attack' && P.fi === 0) { this.buf.punch = 0; this.buf.kick = 0; }
    if (this.phase === 'fight' || this.phase === 'ko') {
      const hp = this.phase === 'fight' ? this.probe(P, C) : null, hc = this.phase === 'fight' ? this.probe(C, P) : null;
      if (hp) this.applyHit(P, C, hp);
      if (hc && this.phase === 'fight') this.applyHit(C, P, hc);
      else if (hc) { this.applyHit(C, P, hc); }
    }
    this.collide();
    P.sprite.setDepth(P.state === 'attack' ? 12 : 11); C.sprite.setDepth(C.state === 'attack' ? 12 : 10);
    P.smoke.setDepth(P.sprite.depth - 0.5); C.smoke.setDepth(C.sprite.depth - 0.5);
    if (this.phase === 'fight') {
      this.timeT++;
      if (this.timeT >= ROUND_S * 60) {
        this.phase = 'ko'; this.phaseT = 0; this.fx.frontEnabled = false;
        this.winner = P.hp > C.hp ? P : C.hp > P.hp ? C : null;
        this.big.setText('TIME').setVisible(true);
      }
    } else if (this.phase === 'ko') {
      const loser = this.winner === P ? C : this.winner === C ? P : null;
      if (this.phaseT === 60 && this.winner) this.sub.setText(`${this.winner.def.name} WINS`).setVisible(true);
      if (this.phaseT >= 210 && (!loser || !loser.ko || loser.state === 'ko')) this.endRound();
    }
  }

  update(_t: number, dms: number) {
    this.acc = Math.min(this.acc + dms, TICK * 5);
    let n = 0;
    while (this.acc >= TICK && n < 5) { this.acc -= TICK; n++; this.tick(); }
    const W = this.scale.width, cam = this.cameras.main;
    const mid = (this.P.bodyX() + this.C.bodyX()) / 2;
    const target = Phaser.Math.Clamp(mid - W / 2, 0, Math.max(0, STAGE_W - W));
    cam.scrollX += (target - cam.scrollX) * 0.12;
    cam.scrollX = Math.round(cam.scrollX);
    this.fx.update(dms / 1000, cam.scrollX);
    this.P.render(false); this.C.render(false);
    this.drawHud();
  }

  // ------------------------------------------------------------------ debug / tests
  dbg() {
    const f = (x: Fighter) => ({ id: x.id, x: Math.round(x.x), bx: Math.round(x.bodyX()), hp: x.hp, lag: +x.lag.toFixed(1), state: x.state, move: x.move, fi: x.fi, facing: x.facing, rounds: x.rounds });
    return { phase: this.phase, round: this.round, time: Math.ceil(ROUND_S - this.timeT / 60), lite: this.lite, rMin: this.rMin, rMax: this.rMax, P: f(this.P), C: f(this.C), fx: this.fx.stats(), FY };
  }
  dbgHit(who: 'c' | 'p', dmg: number) { const [A, D] = who === 'c' ? [this.P, this.C] : [this.C, this.P]; if (this.phase === 'intro') { this.phase = 'fight'; this.big.setVisible(false); } this.applyHit(A, D, null, dmg); }
  dbgFront() { this.fx.forceFront(); }
}
