import Phaser from 'phaser';
import { SECTIONS, DRIVERS, carPrefix } from '../game/damage';

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
    for (const name of Object.keys(pieces)) {
      const p = pieces[name];
      this.load.image(name, A + p.file);
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
      this.load.spritesheet(`${P}_driver`, F + 'driver_sheet.png', { frameWidth: 14, frameHeight: 16 });
    }
    this.load.spritesheet('scrap', A + 'scrap_sheet.png', { frameWidth: 13, frameHeight: 11 });
    // phase 2 enemies: dark security drones, graffiti gang drones, smaller Tesla traffic
    const EN = A + 'enemies/';
    for (const k of ['drone_security', 'drone_gang']) {
      const fh = k === 'drone_gang' ? 26 : 21;
      this.load.spritesheet(k + '_fly', EN + k + '_fly_sheet.png', { frameWidth: 95, frameHeight: fh });
      this.load.image(k + '_smashed', EN + k + '_smashed.png');
      this.load.spritesheet(k + '_break', EN + k + '_break_sheet.png', { frameWidth: 139, frameHeight: fh + 44 });
    }
    for (const k of ['hover_white_small', 'hover_black_small']) {
      this.load.image(k, EN + k + '.png');
      this.load.image(k + '_smashed', EN + k + '_smashed.png');
      const [bw, bh] = k === 'hover_white_small' ? [139, 66] : [140, 67];
      this.load.spritesheet(k + '_break', EN + k + '_break_sheet.png', { frameWidth: bw, frameHeight: bh });
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
    this.load.spritesheet('sel_fade_idle', S + 'fade_idle_sheet.png', { frameWidth: 248, frameHeight: 619 });
    this.load.spritesheet('sel_seek_idle_locked', S + 'seek_idle_locked_sheet.png', { frameWidth: 248, frameHeight: 609 });
    // 20-frame 1133x433 strips, re-packed 1:1 into 3-column grids (tools/regrid.py) so they fit in GPU textures
    const grid = { frameWidth: 1133, frameHeight: 433, endFrame: 19 };
    this.load.spritesheet('sel_car_body', S + 'grid/car34_bounce_body_sheet_grid.png', grid);
    this.load.spritesheet('sel_car_engine', S + 'grid/car34_bounce_rear_engine_sheet_grid.png', grid);
    this.load.spritesheet('sel_car_gear', S + 'grid/car34_bounce_front_gear_sheet_grid.png', grid);
    const sb = m.select_screen.seek_group.car_bounce;
    const sgrid = { frameWidth: sb.frame_size[0], frameHeight: sb.frame_size[1], endFrame: sb.frames - 1 };
    this.load.spritesheet('sel_seek_car_body', A + sb.layers.body, sgrid);
    this.load.spritesheet('sel_seek_car_engine', A + sb.layers.rear_engine, sgrid);
    this.load.spritesheet('sel_seek_car_gear', A + sb.layers.front_gear, sgrid);
    this.load.spritesheet('sel_seek_idle', S + 'seek_idle_sheet.png', { frameWidth: 248, frameHeight: 609 });
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
    seq('scrap', 4, [700, 90, 90, 90]);
    for (const k of ['drone_security', 'drone_gang']) { seq(k + '_fly', 4, 40); seq(k + '_break', 6, 70, 0); }
    for (const k of ['hover_white_small', 'hover_black_small']) seq(k + '_break', 6, 70, 0);
    seq('drone_fly', 4, m.enemies.drone.fly.frame_ms);
    seq('drone_break', 6, m.enemies.drone.break.frame_ms, 0);
    seq('hover_white_break', 6, m.enemies.hover_white.break.frame_ms, 0);
    seq('hover_black_break', 6, m.enemies.hover_black.break.frame_ms, 0);
    seq('fx_explosion', 10, m.fx.explosion.frame_ms, 0);
    seq('fx_spark', 8, m.fx.impact_spark_shards.frame_ms, 0);
    const sel = m.select_screen;
    seq('sel_fade_idle', 6, sel.fade_group.fade_idle.frame_ms);
    seq('sel_seek_idle_locked', 6, sel.seek_group.seek_idle.frame_ms);
    seq('sel_seek_idle', 6, sel.seek_group.seek_idle.frame_ms);
    for (const k of ['sel_car_body', 'sel_car_engine', 'sel_car_gear']) seq(k, 20, sel.fade_group.car_bounce.frame_ms);
    for (const k of ['sel_seek_car_body', 'sel_seek_car_engine', 'sel_seek_car_gear']) seq(k, 20, sel.seek_group.car_bounce.frame_ms);

    const q = new URLSearchParams(location.search);
    const start = q.get('scene');
    if (q.get('scrap')) this.registry.set('scrap', Number(q.get('scrap')) || 0);
    const drv = q.get('driver');
    if (drv === 'seek' || drv === 'fade') this.registry.set('driver', drv);
    if (start === 'level' || start === 'shop') this.scene.start('Level');
    else this.scene.start('Select');
  }
}
