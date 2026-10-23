import Phaser from 'phaser';

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Character select, authored natively at 1280x720 (camera zoom 1). */
export class SelectScene extends Phaser.Scene {
  private groups: Phaser.GameObjects.Container[] = [];
  private index = 0;
  private swiping = false;
  private shaking = false;
  private leaving = false;
  private hint!: Phaser.GameObjects.Text;
  /** 'drive' = pick a driver for the car game, 'fight' = pick a fighter for the 1v1 (same screen, fighters in front of their cars) */
  private mode: 'drive' | 'fight' = 'drive';

  constructor() { super('Select'); }

  init(data: any) { this.mode = data?.mode === 'fight' ? 'fight' : 'drive'; }

  create() {
    const s2 = this.cache.json.get('sel2');
    const m = this.cache.json.get('manifest');
    const sel = m.select_screen;
    const L = sel.layout;
    this.index = this.registry.get(this.mode === 'fight' ? 'fighter' : 'driver') === 'seek' ? 1 : 0; this.swiping = false; this.shaking = false; this.leaving = false;
    const off = Math.round((this.scale.width - 1280) / 2);
    this.cameras.main.setZoom(1).setScroll(-off, 0).setBackgroundColor('#000');
    this.cameras.main.fadeIn(250, 0, 0, 0);

    this.add.image(0, 0, 'sel_bg').setOrigin(0);
    // wide screens: mirrored copies of the approved backdrop fill the extra width (no resampling)
    this.add.image(-1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.add.image(1280, 0, 'sel_bg').setOrigin(0).setFlipX(true);
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off('resize', this.onResize, this));

    // ---- Fade group: car body -> rear engine -> front gear (all bounce sheets share one canvas), Fade idle, name
    const fg = L.fade_group;
    const fade = this.add.container(0, 0);
    const [cx, cy] = fg.car_frame_pos;
    for (const k of ['sel_car_body', 'sel_car_engine', 'sel_car_gear']) {
      fade.add(this.add.sprite(cx, cy, k, 0).setOrigin(0).play(k));
    }
    // approved v2 front-facing idle at its authored screen position (1:1, never resampled)
    fade.add(this.add.sprite(s2.fade.screen_pos[0], s2.fade.screen_pos[1], 'sel2_fade_a', 0).setOrigin(0).play('sel2_fade'));
    fade.add(this.add.image(fg.name_pos[0], fg.name_pos[1], 'sel_name_fade').setOrigin(0));

    // ---- Seek group: her Trans Am (body -> blue anti-grav engine -> hooks bounce sheets), Seek idle, name
    const sg = L.seek_group;
    const seek = this.add.container(Math.max(L.carousel.offscreen_right_x, this.scale.width), 0);
    for (const k of ['sel_seek_car_body', 'sel_seek_car_engine', 'sel_seek_car_gear']) {
      seek.add(this.add.sprite(sg.car_frame_pos[0], sg.car_frame_pos[1], k, 0).setOrigin(0).play(k));
    }
    seek.add(this.add.sprite(s2.seek.screen_pos[0], s2.seek.screen_pos[1], 'sel2_seek_a', 0).setOrigin(0).play('sel2_seek'));
    seek.add(this.add.image(sg.name_pos[0], sg.name_pos[1], 'sel_name_seek').setOrigin(0));
    this.groups = [fade, seek];
    if (this.index === 1) { fade.x = -Math.max(L.carousel.offscreen_right_x, this.scale.width); seek.x = 0; }

    // ---- UI: drawn last, never moves
    this.add.image(L.ui.logo_pos[0], L.ui.logo_pos[1], 'sel_logo').setOrigin(0);
    if (this.mode === 'drive') this.add.image(L.ui.select_your_driver_pos[0], L.ui.select_your_driver_pos[1], 'sel_title').setOrigin(0);
    else this.add.text(L.ui.select_your_driver_pos[0], L.ui.select_your_driver_pos[1] + 4, 'CHOOSE YOUR FIGHTER', {
      fontFamily: 'monospace', fontSize: '30px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 6,
    }).setOrigin(0);
    this.hint = this.add.text(18, 692, '', {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0, 0.5);
    this.add.text(18, 202, '\u25C0  \u25B6  CHOOSE', { fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(0, 0);
    this.add.text(1262, 24, 'MENU \u21A9', { fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(1, 0.5);
    this.updateHint();

    // ---- input
    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.swipe(-1));
    kb.on('keydown-A', () => this.swipe(-1));
    kb.on('keydown-RIGHT', () => this.swipe(1));
    kb.on('keydown-D', () => this.swipe(1));
    kb.on('keydown-ENTER', () => this.choose());
    kb.on('keydown-SPACE', () => this.choose());
    kb.on('keydown-ESC', () => this.back());

    let downX = 0, downT = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { downX = p.worldX; downT = p.time; });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const dx = p.worldX - downX;
      if (Math.abs(dx) > 60 && p.time - downT < 600) { this.swipe(dx < 0 ? 1 : -1); return; }
      if (p.worldY < 64 && p.worldX > 1110) { this.back(); return; }
      // tap: edges swipe, middle chooses
      if (p.worldX < 120) this.swipe(-1);
      else if (p.worldX > 1160) this.swipe(1);
      else this.choose();
    });
    (window as any).__gg.select = this;
  }

  private onResize() { this.cameras.main.setScroll(-Math.round((this.scale.width - 1280) / 2), 0); }

  private updateHint() {
    const verb = this.mode === 'fight' ? 'FIGHT' : 'DRIVE';
    this.hint.setText(`ENTER / TAP  -  ${verb} AS ${this.index === 0 ? 'FADE' : 'SEEK'}     ESC - MENU`);
  }

  swipe(dir: number) {
    if (this.swiping || this.leaving) return;
    const next = this.index + dir;
    if (next < 0 || next >= this.groups.length) return;
    const car = this.cache.json.get('manifest').select_screen.carousel;
    const cur = this.groups[this.index];
    const nxt = this.groups[next];
    const W = Math.max(car.offscreen_right_x, this.scale.width); // off-screen even on wide canvases
    nxt.x = dir > 0 ? W : -W;
    this.swiping = true;
    this.tweens.addCounter({
      from: 0, to: 1, duration: car.duration_ms, ease: (t: number) => t,
      onUpdate: (tw) => {
        const e = easeOutCubic(tw.getValue() ?? 0);
        cur.x = Math.round(-dir * W * e);
        nxt.x = Math.round(dir * W * (1 - e));
      },
      onComplete: () => { cur.x = -dir * W; nxt.x = 0; this.index = next; this.swiping = false; this.updateHint(); },
    });
  }

  choose() {
    if (this.swiping || this.leaving) return;
    const who = this.index === 0 ? 'fade' : 'seek';
    this.registry.set(this.mode === 'fight' ? 'fighter' : 'driver', who);
    this.leaving = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () =>
      this.mode === 'fight' ? this.scene.start('Fight', { fighter: who }) : this.scene.start('Level'));
  }

  back() {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(200, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Menu'));
  }
}
