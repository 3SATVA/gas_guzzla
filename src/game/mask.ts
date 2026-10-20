import Phaser from 'phaser';

/** Hard-alpha collision mask read straight from the approved PNG (alpha >= 128 = solid). */
export interface Mask { w: number; h: number; a: Uint8Array; top: Int16Array; }

const cache = new Map<string, Mask>();

export function maskOf(scene: Phaser.Scene, key: string): Mask {
  const hit = cache.get(key);
  if (hit) return hit;
  const img = scene.textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const w = img.width, h = img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img as CanvasImageSource, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  const a = new Uint8Array(w * h);
  const top = new Int16Array(w).fill(-1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] >= 128) { a[y * w + x] = 1; if (top[x] < 0) top[x] = y; }
  }
  const m = { w, h, a, top };
  cache.set(key, m);
  return m;
}

export function solidAt(m: Mask, x: number, y: number): boolean {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return false;
  return m.a[y * m.w + x] === 1;
}
