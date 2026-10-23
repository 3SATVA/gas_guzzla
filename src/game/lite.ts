import Phaser from 'phaser';

/** Phones / small GPUs get the "lite" texture sets (about half the GPU memory):
 *  touch device, or a GPU whose max texture size is under 8192. ?lite=1 forces it, ?full=1 turns it off. */
let cached: boolean | null = null;
export function isTouch(): boolean {
  return 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
}
export function liteMode(game: Phaser.Game): boolean {
  if (cached !== null) return cached;
  const q = new URLSearchParams(location.search);
  if (q.get('full') === '1') return (cached = false);
  if (q.get('lite') === '1') return (cached = true);
  let max = 16384;
  const r: any = game.renderer;
  try { if (r?.gl) max = r.gl.getParameter(r.gl.MAX_TEXTURE_SIZE); } catch { /* ignore */ }
  return (cached = isTouch() || max < 8192);
}
