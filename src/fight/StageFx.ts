import Phaser from 'phaser';

/** Wind v2 (haze tiles + baked gust streaks + gust envelope) and the plastic-bag spawner, per
 *  stage/wind/out/wind/wind_spec.json v2 and bags/bag_spawner_spec.json. Everything is integer nearest-neighbour:
 *  haze tiles are 2x already, streak sheets are the _2x ones, bags are drawn at scale 2. Only the near haze tile is
 *  stretched (tileScaleX 1 -> 1.35 on gusts, as the spec asks; it is soft alpha with no hard pixels). */
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (t: number) => t * t * (3 - 2 * t);

export const FX_DEPTH: Record<string, number> = {
  'bags:far': 1, 'wind:0': 2, 'streaks:far': 3, 'bags:mid': 4, 'wind:1': 5, 'wind:2': 6, 'streaks:near': 7, 'bags:near': 8,
  'bags:front': 14,
};

interface Haze { imgs: Phaser.GameObjects.Image[]; spec: any; off: number; phase: number; idx: number }
interface Streak { s: Phaser.GameObjects.Sprite; cls: any; px: number; y: number; speed: number; rate: number; age: number; alive: boolean }
interface Bag { s: Phaser.GameObjects.Sprite; cls: any; px: number; y0: number; amp: number; per: number; ph: number; drift: number;
  rate: number; fr: number; t: number; speed: number; cellW: number }

export class StageFx {
  wind: any; bagsSpec: any; bagsMeta: any;
  t = 0;
  // gust envelope
  private gStart = 0; private gHold = 1; gnorm = 0; gust = 1;
  private haze: Haze[] = [];
  private streaks: Streak[] = [];
  private streakNext: number[] = [0, 0];
  private bags: Bag[] = [];
  private bagNext: Record<string, number> = {};
  frontEnabled = true;

  constructor(private scene: Phaser.Scene, private lite: boolean, private bagIds: number[], private streakSheets: number, forceFront = false) {
    this.wind = scene.cache.json.get('wind_spec');
    this.bagsSpec = scene.cache.json.get('bag_spec');
    this.bagsMeta = scene.cache.json.get('bags_meta');
    const W = scene.scale.width;
    this.wind.layers.forEach((L: any, i: number) => {
      const n = Math.ceil(W / 1024) + 2;
      const imgs: Phaser.GameObjects.Image[] = [];
      for (let k = 0; k < n; k++) imgs.push(scene.add.image(0, 0, `wind_${i}`).setOrigin(0).setScrollFactor(0).setDepth(FX_DEPTH[`wind:${i}`]));
      this.haze.push({ imgs, spec: L, off: 0, phase: Math.random() * 6.28, idx: i });
    });
    const st = this.wind.streaks;
    for (let i = 0; i < st.pool; i++) {
      const s = scene.add.sprite(0, 0, 'streak0', 0).setOrigin(0, 1).setVisible(false);
      this.streaks.push({ s, cls: null, px: 0, y: 0, speed: 0, rate: 1, age: 0, alive: false });
    }
    this.streakNext = st.classes.map(() => rnd(0, 0.4));
    for (const c of this.bagsSpec.classes) this.bagNext[c.name] = c.name === 'front' ? (forceFront ? 2.5 : rnd(c.spawn_every_s[0], c.spawn_every_s[1])) : rnd(0.5, c.spawn_every_s[0]);
    this.nextGust(rnd(1.5, 4));
  }

  private nextGust(inS: number) { this.gStart = this.t + inS; this.gHold = rnd(this.wind.gust.hold_s[0], this.wind.gust.hold_s[1]); }

  private envelope() {
    const g = this.wind.gust;
    const u = this.t - this.gStart;
    let e = 0;
    if (u < 0) e = 0;
    else if (u < g.ramp_in_s) e = smooth(u / g.ramp_in_s);
    else if (u < g.ramp_in_s + this.gHold) e = 1;
    else if (u < g.ramp_in_s + this.gHold + g.ramp_out_s) e = 1 - smooth((u - g.ramp_in_s - this.gHold) / g.ramp_out_s);
    else { e = 0; this.nextGust(Math.max(0.5, rnd(g.every_s[0], g.every_s[1]) - (g.ramp_in_s + this.gHold + g.ramp_out_s))); }
    this.gnorm = e;
    this.gust = 1 + (g.speed_mult - 1) * e;
  }

  update(dt: number, scrollX: number) {
    this.t += dt;
    this.envelope();
    const W = this.scene.scale.width;
    const g = this.wind.gust;
    // --- haze
    for (const h of this.haze) {
      const L = h.spec;
      h.off += L.wind_speed_px_s * this.gust * dt;
      const tp = scrollX * L.parallax_x - h.off;
      const sx = L.gust_tile_scale_x ? L.gust_tile_scale_x.base + (L.gust_tile_scale_x.gust - L.gust_tile_scale_x.base) * this.gnorm : 1;
      const tw = 1024 * sx;
      const start = -(((tp % 1024) + 1024) % 1024) * sx;
      const br = L.alpha_breathe;
      const a = Math.min(1, L.peak_alpha * (1 - br.amount / 2 + (br.amount / 2) * Math.sin((2 * Math.PI * this.t) / br.period_s + h.phase)) * (1 + (g.alpha_mult - 1) * this.gnorm));
      h.imgs.forEach((im, k) => {
        const x = start + k * tw;
        im.setVisible(x < W).setPosition(Math.round(x), 0).setScale(sx, 1).setAlpha(a);
      });
    }
    // --- streaks
    const st = this.wind.streaks;
    st.classes.forEach((c: any, ci: number) => {
      this.streakNext[ci] -= dt;
      if (this.streakNext[ci] <= 0) {
        const ev = this.gnorm > 0.4 ? c.gust_spawn_every_s : c.spawn_every_s;
        this.streakNext[ci] = rnd(ev[0], ev[1]);
        const s = this.streaks.find((q) => !q.alive);
        if (s) {
          s.alive = true; s.cls = c; s.age = 0; s.rate = rnd(c.rate[0], c.rate[1]); s.speed = rnd(c.speed_px_s[0], c.speed_px_s[1]);
          s.y = Math.round(rnd(c.y_range[0], c.y_range[1]));
          s.px = rnd(-500, W - 300) + scrollX * c.parallax;
          const sheet = Math.floor(Math.random() * this.streakSheets);
          s.s.setTexture(`streak${sheet}`, 0).setVisible(true).setFlipY(Math.random() < 0.5).setScrollFactor(c.parallax, 0)
            .setDepth(FX_DEPTH[`streaks:${c.name}`]);
        }
      }
    });
    for (const s of this.streaks) {
      if (!s.alive) continue;
      s.age += dt;
      s.px += s.speed * this.gust * dt;
      const f = Math.floor(s.age * st.fps * s.rate);
      if (f > st.frames - 1) { s.alive = false; s.s.setVisible(false); continue; }
      s.s.setFrame(f).setPosition(Math.round(s.px), s.y).setAlpha(Math.min(1, s.cls.alpha * (1 + (this.gust - 1) * 0.3)));
    }
    // --- bags
    const bs = this.bagsSpec;
    for (const c of bs.classes) {
      if (c.name === 'front' && !this.frontEnabled) continue;
      this.bagNext[c.name] -= dt;
      if (this.bagNext[c.name] > 0) continue;
      this.bagNext[c.name] = rnd(c.spawn_every_s[0], c.spawn_every_s[1]);
      if (this.bags.filter((b) => b.cls === c).length >= c.max_alive) continue;
      const ids = c.tier === 'XL' && this.lite ? [0] : this.bagIds;
      const id = ids[Math.floor(Math.random() * ids.length)];
      const cell = this.bagsMeta[String(id)].tiers[c.tier].cell;
      const s = this.scene.add.sprite(0, 0, `bag${id}_${c.tier}`, 0).setScale(2).setScrollFactor(c.parallax, 0)
        .setDepth(FX_DEPTH[`bags:${c.name}`]).setFlipX(Math.random() < 0.5).setAlpha(c.alpha)
        .setTint(Phaser.Display.Color.GetColor(c.tint_rgb[0], c.tint_rgb[1], c.tint_rgb[2]));
      this.bags.push({ s, cls: c, px: scrollX * c.parallax - cell[0], y0: rnd(c.y_range[0], c.y_range[1]), amp: rnd(c.bob_amp_px[0], c.bob_amp_px[1]),
        per: rnd(c.bob_period_s[0], c.bob_period_s[1]), ph: Math.random() * 6.28, drift: rnd(c.drift_y_px_s[0], c.drift_y_px_s[1]),
        rate: rnd(c.anim_rate[0], c.anim_rate[1]), fr: Math.floor(Math.random() * 144), t: 0, speed: rnd(c.speed_px_s[0], c.speed_px_s[1]), cellW: cell[0] });
    }
    for (let i = this.bags.length - 1; i >= 0; i--) {
      const b = this.bags[i], c = b.cls;
      b.t += dt;
      b.px += b.speed * this.gust * dt;
      b.fr += dt * bs.anim.fps * b.rate * (0.8 + 0.2 * this.gust);
      const y = b.y0 + b.amp * Math.sin((2 * Math.PI * b.t) / b.per + b.ph) + b.drift * b.t - (this.gust - 1) * c.gust_lift_px;
      const sxScreen = b.px - scrollX * c.parallax;
      if (sxScreen > W + b.cellW * 2 || (c.name === 'front' && !this.frontEnabled)) { b.s.destroy(); this.bags.splice(i, 1); continue; }
      b.s.setFrame(Math.floor(b.fr) % 144).setPosition(Math.round(b.px), Math.round(y));
    }
  }

  /** debug / tests: spawn the rare front bag now */
  forceFront() { this.bagNext.front = 0; }
  stats() { return { gust: +this.gust.toFixed(2), streaks: this.streaks.filter((s) => s.alive).length, bags: this.bags.map((b) => b.cls.name) }; }
}
