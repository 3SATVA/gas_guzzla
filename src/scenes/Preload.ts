import Phaser from 'phaser';
import { SECTIONS } from '../game/damage';

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

    // --- player car (side view)
    const pc = m.player_car_fade;
    for (const sec of SECTIONS) for (let l = 0; l <= 3; l++) this.load.image(`car_${sec}_${l}`, A + pc.files.sections[sec][String(l)]);
    this.load.image('car_rear_engine', A + pc.files.rear_engine);
    this.load.image('car_front_gear', A + pc.files.front_gear);
    this.load.image('car_composite', A + pc.files.composite);
    this.load.spritesheet('car_flame', A + pc.flame.file, { frameWidth: pc.flame.frame_size[0], frameHeight: pc.flame.frame_size[1] });

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
    this.load.spritesheet('sel_seek_car', S + 'grid/seek_car_placeholder_sheet_grid.png', grid);
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
    seq('car_flame', m.player_car_fade.flame.frames, m.player_car_fade.flame.frame_ms);
    seq('drone_fly', 4, m.enemies.drone.fly.frame_ms);
    seq('drone_break', 6, m.enemies.drone.break.frame_ms, 0);
    seq('hover_white_break', 6, m.enemies.hover_white.break.frame_ms, 0);
    seq('hover_black_break', 6, m.enemies.hover_black.break.frame_ms, 0);
    seq('fx_explosion', 10, m.fx.explosion.frame_ms, 0);
    seq('fx_spark', 8, m.fx.impact_spark_shards.frame_ms, 0);
    const sel = m.select_screen;
    seq('sel_fade_idle', 6, sel.fade_group.fade_idle.frame_ms);
    seq('sel_seek_idle_locked', 6, sel.seek_group.seek_idle.frame_ms);
    for (const k of ['sel_car_body', 'sel_car_engine', 'sel_car_gear', 'sel_seek_car']) seq(k, 20, sel.fade_group.car_bounce.frame_ms);

    const q = new URLSearchParams(location.search);
    const start = q.get('scene');
    if (start === 'level') this.scene.start('Level');
    else this.scene.start('Select');
  }
}
