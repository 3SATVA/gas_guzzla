import Phaser from 'phaser';
import { BootScene } from './scenes/Boot';
import { PreloadScene } from './scenes/Preload';
import { SelectScene } from './scenes/Select';
import { LevelScene } from './scenes/Level';
import { HudScene } from './scenes/Hud';

export const W = 1280;
export const H = 720;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  render: { pixelArt: true, roundPixels: true, antialias: false, powerPreference: 'high-performance' },
  scale: { mode: Phaser.Scale.NONE, width: W, height: H },
  input: { activePointers: 3 },
  fps: { target: 60 },
  scene: [BootScene, PreloadScene, SelectScene, LevelScene, HudScene],
});

/** Integer scaling: 1x, 2x, 3x ... of the 1280x720 canvas. Smaller windows fall back to 0.5x
 *  (gameplay is authored at 640x360, so 0.5x is still pixel-exact there), then free fit. */
function fit() {
  const c = game.canvas;
  if (!c) return;
  const k = Math.min(window.innerWidth / W, window.innerHeight / H);
  let s = k >= 1 ? Math.floor(k) : k >= 0.5 ? 0.5 : k;
  c.style.width = `${W * s}px`;
  c.style.height = `${H * s}px`;
  game.scale.refresh();
}
window.addEventListener('resize', fit);
game.events.once(Phaser.Core.Events.READY, fit);
setTimeout(fit, 0);

(window as any).__gg = { game };
