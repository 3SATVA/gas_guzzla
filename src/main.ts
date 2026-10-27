import Phaser from 'phaser';
import { BootScene } from './scenes/Boot';
import { PreloadScene } from './scenes/Preload';
import { SelectScene } from './scenes/Select';
import { LevelScene } from './scenes/Level';
import { HudScene } from './scenes/Hud';
import { ShopScene } from './scenes/Shop';
import { MenuScene } from './scenes/Menu';
import { FightScene } from './scenes/Fight';
import { MockLevelScene } from './scenes/MockLevel';

export const H = 720;
/** Canvas height is always 720 (= 360 gameplay rows at 2x). The width follows the screen's aspect ratio
 *  (1280..1680, even), so phones and wide desktops are filled edge to edge instead of letterboxed. */
let minW = 0;
export function targetW() {
  const a = window.innerWidth / Math.max(1, window.innerHeight);
  return Math.max(1280, minW, Math.min(1680, Math.round((H * a) / 4) * 4));
}
/** A scene can ask for a wider canvas (the body shop needs room for the native-size car AND the driver side by side).
 *  The canvas is then shown with the same CSS fit as always (letterboxed top/bottom on narrower screens). */
export function setMinWidth(w: number) { minW = Math.ceil(w / 4) * 4; fit(); }

const W0 = targetW();
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W0,
  height: H,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  render: { pixelArt: true, roundPixels: true, antialias: false, powerPreference: 'high-performance' },
  scale: { mode: Phaser.Scale.NONE, width: W0, height: H },
  input: { activePointers: 3 },
  fps: { target: 60 },
  scene: [BootScene, PreloadScene, MenuScene, SelectScene, LevelScene, HudScene, ShopScene, FightScene, MockLevelScene],
});

/** Fill the viewport: the canvas keeps its 2x pixel grid internally and is shown with nearest-neighbour CSS
 *  scaling (integer when the window allows it, otherwise the largest fit). */
function fit() {
  const c = game.canvas;
  if (!c) return;
  const w = targetW();
  if (game.scale.width !== w) game.scale.resize(w, H);
  const k = Math.min(window.innerWidth / w, window.innerHeight / H);
  const s = k >= 1 && k - Math.floor(k) < 0.02 ? Math.floor(k) : k;
  c.style.width = `${Math.round(w * s)}px`;
  c.style.height = `${Math.round(H * s)}px`;
  game.scale.refresh();
  const rot = document.getElementById('rotate');
  if (rot) rot.style.display = window.innerHeight > window.innerWidth * 1.05 && 'ontouchstart' in window ? 'flex' : 'none';
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 250));
game.events.once(Phaser.Core.Events.READY, fit);
setTimeout(fit, 0);

/** Full screen: first tap on a touch device, F key or the corner button on desktop. */
export function toggleFullscreen(force?: boolean) {
  const d = document as any, el = document.documentElement as any;
  const on = !!(d.fullscreenElement || d.webkitFullscreenElement);
  if (force === true && on) return;
  try {
    if (!on) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
      (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {});
    } else if (force !== true) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
  } catch { /* not allowed here */ }
}
window.addEventListener('pointerdown', () => { if ('ontouchstart' in window) toggleFullscreen(true); }, { once: true });
window.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFullscreen(); });
document.addEventListener('fullscreenchange', () => setTimeout(fit, 100));

(window as any).__gg = { game };
(window as any).__ggFS = () => toggleFullscreen();
(window as any).__ggMinW = setMinWidth;
