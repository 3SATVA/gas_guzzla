import Phaser from 'phaser';
import { Box, DEFS, FighterDef, FighterId, Frame, Inp, Move, MoveSet } from './types';

export const FY = 690;          // feet line (screen / world y)
export const STAGE_L = 120, STAGE_R = 1800;

export type State = 'idle' | 'walk' | 'attack' | 'crouch' | 'block' | 'hit' | 'knockdown' | 'getup' | 'ko';

/** One fighter: a frame-exact state machine over the approved move metas (60 Hz ticks, per-frame tick counts). */
export class Fighter {
  def: FighterDef;
  mv: Record<string, Move>;
  x = 0; facing = 1; vx = 0;
  hp = 100; lag = 100; lagDelay = 0;
  state: State = 'idle'; move = 'idle'; fi = 0; ft = 0;
  winActive = false; winHit = false;
  stagger = 0; staggerT = 0; ko = false; rounds = 0; flashT = 0;
  sprite: Phaser.GameObjects.Sprite; smoke: Phaser.GameObjects.Sprite; shadow: Phaser.GameObjects.Image;
  tex: string;

  constructor(scene: Phaser.Scene, public id: FighterId, set: MoveSet, public depth: number) {
    this.def = DEFS[id];
    this.mv = set.moves;
    this.tex = `ft_${id}`;
    const f0 = this.mv.idle.frames[0];
    this.shadow = scene.add.image(0, FY, `shadow_${id}`).setDepth(9);
    this.smoke = scene.add.sprite(0, FY, this.tex, f0.k).setDepth(depth - 0.5).setVisible(false);
    this.sprite = scene.add.sprite(0, FY, this.tex, f0.k).setDepth(depth);
    this.setMove('idle');
  }

  get m(): Move { return this.mv[this.move]; }
  frame(): Frame { return this.m.frames[this.fi]; }
  lying(): boolean { return this.state === 'knockdown' || this.state === 'getup' || this.state === 'ko'; }

  setMove(name: string, fi = 0) {
    this.move = name; this.fi = Math.min(fi, this.mv[name].frames.length - 1); this.ft = this.frame().t;
    this.winActive = false; this.winHit = false;
  }
  toIdle(fi: number | null) {
    this.state = 'idle';
    this.setMove('idle', fi ?? 0);
  }
  reset(x: number, facing: number) {
    this.x = x; this.facing = facing; this.vx = 0; this.hp = 100; this.lag = 100; this.lagDelay = 0;
    this.stagger = 0; this.ko = false; this.flashT = 0; this.toIdle(0);
  }

  /** advance one tick of the current move; returns true when a non-looping move has finished */
  private tickAnim(hold = false): boolean {
    if (hold) return false;
    if (--this.ft > 0) return false;
    const m = this.m;
    if (this.fi + 1 >= m.frames.length) {
      if (!m.loop) return true;
      this.fi = 0;
    } else this.fi++;
    this.ft = this.frame().t;
    return false;
  }

  /** where the body is (camera / push / shadow): the knockdown root motion is baked into the sprites, so the body
   *  travels to end_dx (in facing space) while the anchor stays; get-up then rises there and end_dx is applied at the end. */
  bodyOff(): number {
    const end = this.mv.getup.end_dx;
    if (this.state === 'knockdown') return end * Math.min(1, this.fi / Math.max(1, this.m.frames.length - 6));
    if (this.state === 'getup' || this.state === 'ko') return end;
    return 0;
  }
  bodyX(): number { return this.x + this.bodyOff() * this.facing; }

  attack(name: string) { this.state = 'attack'; this.setMove(name); }

  step(inp: Inp, foe: Fighter) {
    if (this.flashT > 0 && --this.flashT === 0) this.sprite.clearTint();
    if (this.staggerT > 0 && --this.staggerT === 0) this.stagger = Math.max(0, this.stagger - 1), this.staggerT = this.stagger ? 50 : 0;
    // pushback slide
    if (Math.abs(this.vx) > 0.2) { this.x += this.vx; this.vx *= 0.78; } else this.vx = 0;
    const d = this.def;
    switch (this.state) {
      case 'idle': case 'walk': {
        const want = Math.sign(foe.bodyX() - this.x);
        if (want !== 0 && want !== this.facing && Math.abs(foe.bodyX() - this.x) > 8) this.facing = want;
        if (inp.punch) return this.attack(d.punch);
        if (inp.kick && d.kick) return this.attack(d.kick);
        if (inp.block && d.block) { this.state = 'block'; return this.setMove(d.block); }
        if (inp.down && d.crouch) { this.state = 'crouch'; return this.setMove(d.crouch); }
        const w = inp.fwd ? 'walk_fwd' : inp.back ? 'walk_back' : null;
        if (w) {
          if (this.move !== w) this.setMove(w);
          this.state = 'walk';
          const f = this.frame();
          this.x += (f.adv / f.t) * this.facing;
          this.tickAnim();
        } else {
          if (this.state === 'walk') this.toIdle(0);
          this.tickAnim();
        }
        return;
      }
      case 'attack': case 'hit':
        if (this.tickAnim()) this.toIdle(this.m.exit_idle);
        return;
      case 'crouch': case 'block': {
        const holding = this.state === 'crouch' ? inp.down : inp.block;
        const atHold = this.m.hold !== null && this.fi === this.m.hold;
        if (this.tickAnim(atHold && holding)) this.toIdle(this.m.exit_idle);
        return;
      }
      case 'knockdown':
        if (this.tickAnim()) {
          if (this.ko) { this.state = 'ko'; }
          else { this.state = 'getup'; this.setMove('getup'); }
        }
        return;
      case 'getup':
        if (this.tickAnim()) { this.x += this.m.end_dx * this.facing; this.toIdle(this.m.exit_idle); }
        return;
      case 'ko':
        return;
    }
  }

  /** a box in world space (mirrors for facing left) */
  world(b: Box): Box {
    return this.facing > 0
      ? [this.x + b[0], FY + b[1], this.x + b[2], FY + b[3]]
      : [this.x - b[2], FY + b[1], this.x - b[0], FY + b[3]];
  }

  /** the guard is up from the 3rd block frame on (raise -> hold -> lower) */
  guarding(): boolean { return this.state === 'block' && this.fi >= 2 && this.fi < this.m.frames.length - 2; }

  render(cull: boolean) {
    const f = this.frame(), m = this.m;
    const s = this.sprite;
    s.setFrame(f.k);
    s.setDisplayOrigin(m.anchor[0], m.anchor[1]);
    s.setPosition(Math.round(this.x), FY).setScale(this.facing, 1);
    if (f.sk) {
      this.smoke.setVisible(true).setFrame(f.sk);
      this.smoke.setDisplayOrigin(m.anchor[0], m.anchor[1]).setPosition(Math.round(this.x), FY).setScale(this.facing, 1);
    } else this.smoke.setVisible(false);
    const lying = this.state === 'ko' || (this.state === 'knockdown' && f.st === 'lying') || (this.state === 'getup' && f.st === 'lying');
    this.shadow.setTexture(lying ? `shadow_${this.id}_lie` : `shadow_${this.id}`).setPosition(Math.round(this.bodyX()), FY - 2);
    void cull;
  }

  flash() { this.sprite.setTintFill(0xffffff); this.flashT = 3; }
}
