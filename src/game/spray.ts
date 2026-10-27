import Phaser from 'phaser';

/** Shared spray-can pieces for the street level and the fight: can colours, the HUD can art, the can stock, the paint mist and the splat decal art. */
export const CAN_COLORS = [0xff2d95, 0x1fd1e0, 0xa6e22e, 0xff8a1f, 0x8a4dff];

/** a spray can drawn in code at 1x logic pixels (14x30), shown at integer scale `s` */
export function drawCan(g: Phaser.GameObjects.Graphics, x: number, y: number, color: number, amount: number, current: boolean, s = 2) {
  const px = (cx: number, cy: number, w: number, h: number, c: number, a = 1) => g.fillStyle(c, a).fillRect(x + cx * s, y + cy * s, w * s, h * s);
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
  if (current && !empty) g.lineStyle(s > 1 ? 2 : 1, 0xffffff, 0.95).strokeRect(x - 3, y - 3, 14 * s + 6, 30 * s + 6);
}

/** the five cans: 1 = full, drained from the first non-empty one */
export class CanStock {
  cans: number[];
  used = 0;
  constructor(from?: number[]) { this.cans = from && from.length === 5 ? from.slice() : [1, 1, 1, 1, 1]; }
  cur() { return this.cans.findIndex((a) => a > 0.001); }
  color() { const i = this.cur(); return i < 0 ? 0x777777 : CAN_COLORS[i]; }
  total() { return this.cans.reduce((s, v) => s + v, 0); }
  consume(a: number) {
    let left = a;
    for (let i = 0; i < this.cans.length && left > 1e-6; i++) { const u = Math.min(this.cans[i], left); this.cans[i] -= u; left -= u; }
    if (this.cans.every((v) => v < 1e-6)) this.cans.fill(0);
    this.used += a - left; return a - left;
  }
}

interface P { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: number; grow: number }
/** square pixel-ish paint mist (same look as the street level) */
export class MistSys {
  p: P[] = [];
  constructor(private g: Phaser.GameObjects.Graphics, private rand: () => number = Math.random) {}
  private rr(a: number, b: number) { return a + this.rand() * (b - a); }
  cone(x: number, y: number, ang: number, half: number, n: number, sp: number, len: number, color: number) {
    for (let i = 0; i < n; i++) {
      const a = ang + this.rr(-half, half), s = this.rr(sp * 0.6, sp * 1.05);
      this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: Math.min(46, len / (s * 0.92)), size: [6, 8, 10, 14][Math.floor(this.rand() * 4)], color, grow: 0.18 });
    }
  }
  puff(x: number, y: number, n: number, color: number) {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, s = this.rr(0.4, 2.6);
      this.p.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.3, life: 0, max: this.rr(14, 26), size: this.rand() < 0.5 ? 6 : 10, color, grow: 0.25 });
    }
  }
  tick() {
    const g = this.g; g.clear();
    for (let i = this.p.length - 1; i >= 0; i--) {
      const m = this.p[i];
      m.x += m.vx; m.y += m.vy; m.vx *= 0.975; m.vy *= 0.975; m.life++; m.size += m.grow;
      if (m.life >= m.max) { this.p.splice(i, 1); continue; }
      const k = 1 - m.life / m.max, s = Math.round(m.size / 2) * 2;
      g.fillStyle(m.color, 0.55 * k + 0.1).fillRect(Math.round(m.x / 2) * 2 - s / 2, Math.round(m.y / 2) * 2 - s / 2, s, s);
    }
  }
}

export const SPLAT_VARIANTS = 4;
/** pixel splat decal textures `splat_<colour>_<variant>` (blob + satellite flecks + drips, snapped to a 4 px grid); returns the key */
export function splatTex(scene: Phaser.Scene, color: number, variant: number): string {
  const key = `splat_${color.toString(16)}_${variant}`;
  if (scene.textures.exists(key)) return key;
  let seed = (variant + 1) * 7919 + (color & 0xffff);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const U = 4, N = 22, S = N * U;               // 22x22 cells of 4 px = 88 px
  const cell = new Uint8Array(N * N);
  const set = (cx: number, cy: number) => { if (cx >= 0 && cy >= 0 && cx < N && cy < N) cell[cy * N + cx] = 1; };
  const cx0 = 11, cy0 = 9 + Math.floor(rnd() * 3), R = 5.2 + variant * 0.5 + rnd();
  // lumpy blob: radius modulated by angle
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - cx0, dy = y - cy0, a = Math.atan2(dy, dx);
    const r = R * (1 + 0.28 * Math.sin(a * 3 + ph[0]) + 0.2 * Math.sin(a * 5 + ph[1]) + 0.12 * Math.sin(a * 7 + ph[2]));
    if (Math.hypot(dx, dy) <= r) set(x, y);
  }
  // spikes / flecks
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d1 = R * 1.25, d2 = R * (1.7 + rnd() * 0.9);
    for (let d = d1; d < d2; d += 1) if (rnd() < 0.5) set(Math.round(cx0 + Math.cos(a) * d), Math.round(cy0 + Math.sin(a) * d));
    set(Math.round(cx0 + Math.cos(a) * (d2 + 1.5)), Math.round(cy0 + Math.sin(a) * (d2 + 1.5)));
  }
  // drips
  const nd = 2 + Math.floor(rnd() * 2);
  for (let i = 0; i < nd; i++) {
    const dx = cx0 + Math.round((rnd() - 0.5) * R * 1.4), len = 3 + Math.floor(rnd() * 6);
    for (let k = 0; k < len; k++) set(dx, cy0 + Math.round(R * 0.7) + k);
    set(dx, cy0 + Math.round(R * 0.7) + len + 1);
  }
  const c = Phaser.Display.Color.IntegerToColor(color);
  const dark = Phaser.Display.Color.GetColor(Math.round(c.red * 0.55), Math.round(c.green * 0.55), Math.round(c.blue * 0.55));
  const lite = Phaser.Display.Color.GetColor(Math.min(255, c.red + 70), Math.min(255, c.green + 70), Math.min(255, c.blue + 70));
  const g = scene.make.graphics({}, false);
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N && cell[y * N + x] === 1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!at(x, y)) continue;
    const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
    g.fillStyle(edge ? dark : color, 1).fillRect(x * U, y * U, U, U);
    if (!edge && !at(x - 1, y - 1) === false && !at(x - 2, y - 2) && x < cx0 && y < cy0) g.fillStyle(lite, 0.9).fillRect(x * U, y * U, U, U);
  }
  g.generateTexture(key, S, S); g.destroy();
  return key;
}
