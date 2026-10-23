import Phaser from 'phaser';
import { SECTIONS, DRIVERS, carPrefix } from '../game/damage';
import { liteMode } from '../game/lite';

export class PreloadScene extends Phaser.Scene {
  constructor() { super('Preload'); }

  preload() {
    const m = this.cache.json.get('manifest');
    const A = 'assets/';
    const bar = this.add.rectangle(340, 360, 0, 12, 0xd8742a).setOrigin(0, 0.5);
    this.add.rectangle(340, 360, 600, 12).setOrigin(0, 0.5).setStrokeStyle(2, 0x56260e);
    this.add.text(640, 330, 'LOADING', { fontFamily: 'monospace', fontSize: '20px', color: '#d8742a' }).setOrigin(0.5);
    this.load.on('progress', (p: number) => (bar.width = 600 * p));

    // --- parallax
    const bgKeys = ['bg_a', 'bg_b', 'bg_c', 'bg_d'];
    m.parallax.layers.forEach((l: any, i: number) => this.load.image(bgKeys[i], A + l.file));

    // --- collision layer
    const pieces = m.collision_layer.pieces;
    const thin = this.cache.json.get('p2').thin ?? {};
    for (const name of Object.keys(pieces)) {
      const p = pieces[name];
      // phase 4: solid pieces are drawn/collide as their thick CORE; the thin bits (antennas, poles, pipes, cables)
      // are separate breakable pieces '<name>_thin_<i>' that snap off without hurting the car
      this.load.image(name, A + (thin[name]?.core ?? p.file));
      (thin[name]?.thin ?? []).forEach((t: any, i: number) => this.load.image(`${name}_thin_${i}`, A + t.file));
      if (p.break) {
        this.load.spritesheet(name + '_break', A + p.break.file, { frameWidth: p.break.frame_size[0], frameHeight: p.break.frame_size[1] });
      }
    }
    const bs = m.collision_layer.black_shards;
    this.load.spritesheet('black_shards', A + bs.file, { frameWidth: bs.cell_size[0], frameHeight: bs.cell_size[1] });

    // --- player cars (side view, 128x72 = exact 10:1 box of the approved full-res side masters): keys 'sm_<driver>_*'
    const p2 = this.cache.json.get('p2');
    for (const d of DRIVERS) {
      const P = carPrefix(d), F = A + `car_${d}_small/`;
      for (const sec of SECTIONS) for (let l = 0; l <= 3; l++) this.load.image(`${P}_${sec}_${l}`, F + (l === 0 ? `body_sections/${sec}_0.png` : `damage/${sec}_${l}.png`));
      this.load.image(`${P}_rear_engine`, F + 'rear_engine.png');
      this.load.image(`${P}_front_gear`, F + 'front_gear.png');
      this.load.image(`${P}_composite`, F + 'composite.png');
      const g = p2[d].glow;
      this.load.spritesheet(`${P}_flame`, A + g.file, { frameWidth: g.frame_size[0], frameHeight: g.frame_size[1] });
      const df = p2[d].driver_frame ?? [14, 16];
      this.load.spritesheet(`${P}_driver`, F + 'driver_sheet.png', { frameWidth: df[0], frameHeight: df[1] });
    }
    // phase 4: gas barrels (generated art) + HUD damage icon (64x36 = exact 20:1 box of the side masters)
    this.load.spritesheet('barrel', A + 'barrel_sheet.png', { frameWidth: p2.barrel.frame[0], frameHeight: p2.barrel.frame[1] });
    for (const d of DRIVERS) {
      for (const sec of SECTIONS) for (let l = 0; l <= 3; l++) this.load.image(`hud_${d}_${sec}_${l}`, A + `hud_${d}/${sec}_${l}.png`);
      for (const q of ['rear_engine', 'front_gear']) this.load.image(`hud_${d}_${q}`, A + `hud_${d}/${q}.png`);
    }
    this.load.spritesheet('scrap', A + 'scrap_sheet.png', { frameWidth: p2.scrap.frame[0], frameHeight: p2.scrap.frame[1] });
    // distant towers (note 14 previews) and the graffiti near wall (note 2), generated art
    this.load.spritesheet('p3_towers', A + 'p3/towers_sheet.png', { frameWidth: p2.towers.frame[0], frameHeight: p2.towers.frame[1] });
    this.load.image('p3_near_wall', A + p2.near_wall.file);
    // phase 2 enemies: dark security drones, graffiti gang drones, smaller Tesla traffic
    const EN = A + 'enemies/';
    for (const k of ['drone_security', 'drone_gang']) {
      const fh = k === 'drone_gang' ? 26 : 21;
      this.load.spritesheet(k + '_fly', EN + k + '_fly_sheet.png', { frameWidth: 95, frameHeight: fh });
      this.load.image(k + '_smashed', EN + k + '_smashed.png');
      this.load.spritesheet(k + '_break', EN + k + '_break_sheet.png', { frameWidth: 139, frameHeight: fh + 44 });
    }
    // Tesla traffic: tiny versions (clearly smaller than the player's car), sizes from phase2.json
    for (const t of Object.values(p2.traffic) as any[]) {
      const k = t.key;
      this.load.image(k, EN + k + '.png');
      this.load.image(k + '_smashed', EN + k + '_smashed.png');
      this.load.spritesheet(k + '_break', EN + k + '_break_sheet.png', { frameWidth: t.break[0], frameHeight: t.break[1] });
    }

    // --- enemies
    const e = m.enemies;
    this.load.spritesheet('drone_fly', A + e.drone.fly.file, { frameWidth: e.drone.fly.frame_size[0], frameHeight: e.drone.fly.frame_size[1] });
    this.load.image('drone_smashed', A + e.drone.smashed.file);
    this.load.spritesheet('drone_break', A + e.drone.break.file, { frameWidth: e.drone.break.frame_size[0], frameHeight: e.drone.break.frame_size[1] });
    for (const k of ['hover_white', 'hover_black']) {
      this.load.image(k, A + e[k].idle.file);
      this.load.image(k + '_smashed', A + e[k].smashed.file);
      this.load.spritesheet(k + '_break', A + e[k].break.file, { frameWidth: e[k].break.frame_size[0], frameHeight: e[k].break.frame_size[1] });
    }

    // --- fx
    const fx = m.fx;
    this.load.spritesheet('fx_explosion', A + fx.explosion.file, { frameWidth: 96, frameHeight: 96 });
    this.load.spritesheet('fx_spark', A + fx.impact_spark_shards.file, { frameWidth: 56, frameHeight: 56 });
    this.load.spritesheet('fx_debris', A + fx.debris.file, { frameWidth: 12, frameHeight: 12 });

    // --- select screen (1280x720 native)
    const S = A + 'select/';
    this.load.image('sel_bg', A + m.select_screen.background.file);
    this.load.image('sel_logo', S + 'logo_gas_guzzla_x2.png');
    this.load.image('sel_title', S + 'select_your_driver.png');
    this.load.image('sel_name_fade', S + 'name_fade.png');
    this.load.image('sel_name_seek', S + 'name_seek.png');
    this.load.image('sel_padlock', S + 'padlock_x4.png');
    this.load.image('sel_locked', S + 'locked_text.png');
    this.load.image('sel_seek_label', S + 'seek_car_placeholder_label.png');
    // approved v2 front-facing select idles (60 frames each). The 4k x 3k grids are split into an even-frame sheet (a)
    // and an odd-frame sheet (b), 30 frames each (6x5, < 2k x 3.1k). Phones load only (a) and play it at half rate.
    const lite = liteMode(this.game);
    this.registry.set('lite', lite);
    for (const c of ['fade', 'seek']) {
      const fw = c === 'fade' ? [306, 621] : [283, 613];
      for (const h of lite ? ['a'] : ['a', 'b']) {
        this.load.spritesheet(`sel2_${c}_${h}`, S + `v2/${c}_select_idle_${h}.png`, { frameWidth: fw[0], frameHeight: fw[1], endFrame: 29 });
      }
    }
    this.load.json('sel2', S + 'v2/select_v2.json');
    // side-by-side select: both cars as exact 1/2 background composites (tools/build_select_bg_cars.py), 20 frames, 5x4 grids
    this.load.spritesheet('selc_fade', S + 'v2/fade_car_half_sheet.png', { frameWidth: 567, frameHeight: 217, endFrame: 19 });
    this.load.spritesheet('selc_seek', S + 'v2/seek_car_half_sheet.png', { frameWidth: 603, frameHeight: 262, endFrame: 19 });
    this.load.image('sel_logo1', S + 'logo_gas_guzzla.png');
    this.load.image('sel_spot', S + 'spotlight.png');
  }

  create() {
    const m = this.cache.json.get('manifest');
    const a = this.anims;
    const seq = (key: string, n: number, ms: number | number[], repeat = -1) => {
      const frames = a.generateFrameNumbers(key, { start: 0, end: n - 1 }).map((f, i) => ({ ...f, duration: Array.isArray(ms) ? ms[i] : 0 }));
      a.create({ key, frames, frameRate: Array.isArray(ms) ? 1000 / ms[0] : 1000 / ms, repeat });
    };
    const pieces = m.collision_layer.pieces;
    for (const name of Object.keys(pieces)) {
      const b = pieces[name].break;
      if (b) seq(name + '_break', b.frames, b.frame_ms, 0);
    }
    for (const d of DRIVERS) seq(`${carPrefix(d)}_flame`, 6, 70);
    // scrap pickups: 4 variants, each idles then glints
    for (let v = 0; v < 4; v++) a.create({ key: `barrel_${v}`, frames: [{ key: 'barrel', frame: v * 2, duration: 1100 }, { key: 'barrel', frame: v * 2 + 1, duration: 160 }], repeat: -1 });
    for (let v = 0; v < 4; v++) a.create({ key: `scrap_${v}`, frames: [{ key: 'scrap', frame: v * 2, duration: 900 }, { key: 'scrap', frame: v * 2 + 1, duration: 140 }], repeat: -1 });
    for (const k of ['drone_security', 'drone_gang']) { seq(k + '_fly', 4, 40); seq(k + '_break', 6, 70, 0); }
    for (const t of Object.values(this.cache.json.get('p2').traffic) as any[]) seq(t.key + '_break', 6, 70, 0);
    seq('drone_fly', 4, m.enemies.drone.fly.frame_ms);
    seq('drone_break', 6, m.enemies.drone.break.frame_ms, 0);
    seq('hover_white_break', 6, m.enemies.hover_white.break.frame_ms, 0);
    seq('hover_black_break', 6, m.enemies.hover_black.break.frame_ms, 0);
    seq('fx_explosion', 10, m.fx.explosion.frame_ms, 0);
    seq('fx_spark', 8, m.fx.impact_spark_shards.frame_ms, 0);
    const sel = m.select_screen;
    const s2 = this.cache.json.get('sel2');
    for (const c of ['fade', 'seek']) {
      const ms = s2[c].frame_ms;
      const frames: Phaser.Types.Animations.AnimationFrame[] = [];
      for (let i = 0; i < 30; i++) {
        frames.push({ key: `sel2_${c}_a`, frame: i, duration: this.registry.get('lite') ? ms * 2 : ms });
        if (!this.registry.get('lite')) frames.push({ key: `sel2_${c}_b`, frame: i, duration: ms });
      }
      a.create({ key: `sel2_${c}`, frames, frameRate: 1000 / ms, repeat: -1 });
    }
    seq('selc_fade', 20, sel.fade_group.car_bounce.frame_ms);
    seq('selc_seek', 20, sel.seek_group.car_bounce.frame_ms);

    const q = new URLSearchParams(location.search);
    const start = q.get('scene');
    if (q.get('scrap')) this.registry.set('scrap', Number(q.get('scrap')) || 0);
    const drv = q.get('driver');
    if (drv === 'seek' || drv === 'fade') this.registry.set('driver', drv);
    const fighter = q.get('fighter');
    if (start === 'level' || start === 'shop') this.scene.start('Level');
    else if (start === 'fight') this.scene.start('Fight', { fighter: fighter === 'seek' ? 'seek' : 'fade' });
    else if (q.get('fight') === '1') this.scene.start('Select', { mode: 'fight' });
    else if (start === 'select') this.scene.start('Select', { mode: 'drive' });
    else this.scene.start('Menu');
  }
}
