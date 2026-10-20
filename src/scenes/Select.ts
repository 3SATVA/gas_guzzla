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

  constructor() { super('Select'); }

  create() {
    const m = this.cache.json.get('manifest');
    const sel = m.select_screen;
    const L = sel.layout;
    this.index = this.registry.get('driver') === 'seek' ? 1 : 0; this.swiping = false; this.shaking = false; this.leaving = false;
    this.cameras.main.setZoom(1).setScroll(0, 0).setBackgroundColor('#000');
    this.cameras.main.fadeIn(250, 0, 0, 0);

    this.add.image(0, 0, 'sel_bg').setOrigin(0);

    // ---- Fade group: car body -> rear engine -> front gear (all bounce sheets share one canvas), Fade idle, name
    const fg = L.fade_group;
    const fade = this.add.container(0, 0);
    const [cx, cy] = fg.car_frame_pos;
    for (const k of ['sel_car_body', 'sel_car_engine', 'sel_car_gear']) {
      fade.add(this.add.sprite(cx, cy, k, 0).setOrigin(0).play(k));
    }
    fade.add(this.add.sprite(fg.fade_frame_pos[0], fg.fade_frame_pos[1], 'sel_fade_idle', 0).setOrigin(0).play('sel_fade_idle'));
    fade.add(this.add.image(fg.name_pos[0], fg.name_pos[1], 'sel_name_fade').setOrigin(0));

    // ---- Seek group: her Trans Am (body -> blue anti-grav engine -> hooks bounce sheets), Seek idle, name
    const sg = L.seek_group;
    const seek = this.add.container(L.carousel.offscreen_right_x, 0);
    for (const k of ['sel_seek_car_body', 'sel_seek_car_engine', 'sel_seek_car_gear']) {
      seek.add(this.add.sprite(sg.car_frame_pos[0], sg.car_frame_pos[1], k, 0).setOrigin(0).play(k));
    }
    seek.add(this.add.sprite(sg.seek_frame_pos[0], sg.seek_frame_pos[1], 'sel_seek_idle', 0).setOrigin(0).play('sel_seek_idle'));
    seek.add(this.add.image(sg.name_pos[0], sg.name_pos[1], 'sel_name_seek').setOrigin(0));
    this.groups = [fade, seek];
    if (this.index === 1) { fade.x = -L.carousel.offscreen_right_x; seek.x = 0; }

    // ---- UI: drawn last, never moves
    this.add.image(L.ui.logo_pos[0], L.ui.logo_pos[1], 'sel_logo').setOrigin(0);
    this.add.image(L.ui.select_your_driver_pos[0], L.ui.select_your_driver_pos[1], 'sel_title').setOrigin(0);
    this.hint = this.add.text(18, 692, '', {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#f2c27a', stroke: '#000', strokeThickness: 4,
    }).setOrigin(0, 0.5);
    this.add.text(18, 202, '\u25C0  \u25B6  CHOOSE', { fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: '#d9d2c4', stroke: '#000', strokeThickness: 4 }).setOrigin(0, 0);
    this.updateHint();

    // ---- input
    const kb = this.input.keyboard!;
    kb.on('keydown-LEFT', () => this.swipe(-1));
    kb.on('keydown-A', () => this.swipe(-1));
    kb.on('keydown-RIGHT', () => this.swipe(1));
    kb.on('keydown-D', () => this.swipe(1));
    kb.on('keydown-ENTER', () => this.choose());
    kb.on('keydown-SPACE', () => this.choose());

    let downX = 0, downT = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { downX = p.x; downT = p.time; });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const dx = p.x - downX;
      if (Math.abs(dx) > 60 && p.time - downT < 600) { this.swipe(dx < 0 ? 1 : -1); return; }
      // tap: edges swipe, middle chooses
      if (p.x < 120) this.swipe(-1);
      else if (p.x > 1160) this.swipe(1);
      else this.choose();
    });
    (window as any).__gg.select = this;
  }

  private updateHint() {
    this.hint.setText(this.index === 0 ? 'ENTER / TAP  -  DRIVE AS FADE' : 'ENTER / TAP  -  DRIVE AS SEEK');
  }

  swipe(dir: number) {
    if (this.swiping || this.leaving) return;
    const next = this.index + dir;
    if (next < 0 || next >= this.groups.length) return;
    const car = this.cache.json.get('manifest').select_screen.carousel;
    const cur = this.groups[this.index];
    const nxt = this.groups[next];
    const W = car.offscreen_right_x; // 1280
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
    this.registry.set('driver', this.index === 0 ? 'fade' : 'seek');
    this.leaving = true;
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Level'));
  }
}
