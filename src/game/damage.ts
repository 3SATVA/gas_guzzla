/** Sectional damage for the player car. Index 0 = back, 1 = middle, 2 = front (car faces right). */
export const SECTIONS = ['back', 'middle', 'front'] as const;
export type SectionName = (typeof SECTIONS)[number];
export const MAX_LEVEL = 3;

export interface HitResult { changed: number[]; totaled: boolean; }

/**
 * Apply one hit on section `hit`.
 *  - The hit section goes up one level. If it is already at 3, the damage moves on to the next
 *    section inward (front -> middle -> back, back -> middle -> front).
 *  - Once the damaged section is at 2 or more, the hit also spills one level into the neighbour
 *    (second front hit = front 2 + middle 1).
 *  - Middle hits spill toward the less-damaged neighbour.
 *  - TOTALED only when all three are at 3.
 */
export function applyHit(levels: number[], hit: number): HitResult {
  const changed: number[] = [];
  const dirFor = (i: number): number => {
    if (i === 2) return -1;
    if (i === 0) return 1;
    return levels[0] <= levels[2] ? -1 : 1;
  };
  let dir = dirFor(hit);
  let t = hit;
  while (t >= 0 && t <= 2 && levels[t] >= MAX_LEVEL) t += dir;
  if (t < 0 || t > 2) {
    // overflowed past the end: take whatever is still intact
    t = levels.findIndex((l) => l < MAX_LEVEL);
  }
  if (t >= 0) {
    levels[t]++;
    changed.push(t);
    if (levels[t] >= 2) {
      const sd = t === 1 ? dirFor(1) : t === hit ? dir : dir;
      let j = t + sd;
      while (j >= 0 && j <= 2 && levels[j] >= MAX_LEVEL) j += sd;
      if (j >= 0 && j <= 2 && j !== t) { levels[j]++; changed.push(j); }
    }
  }
  return { changed, totaled: levels.every((l) => l >= MAX_LEVEL) };
}

/** Texture keys in draw order: least damaged first, most damaged last. */
export function sectionDrawOrder(levels: number[]): { sec: SectionName; level: number }[] {
  return [0, 1, 2]
    .map((i) => ({ sec: SECTIONS[i], level: levels[i], i }))
    .sort((a, b) => a.level - b.level || a.i - b.i)
    .map(({ sec, level }) => ({ sec, level }));
}

export type Driver = 'fade' | 'seek';
export const DRIVERS: Driver[] = ['fade', 'seek'];
/** Texture-key prefix per driver's in-game (128x72) car. */
export function carPrefix(d: Driver) { return `sm_${d}`; }
export function sectionKey(sec: SectionName, level: number, d: Driver = 'fade') { return `${carPrefix(d)}_${sec}_${level}`; }
export function currentDriver(reg: { get(k: string): any }): Driver {
  const q = new URLSearchParams(location.search).get('driver');
  const r = reg.get('driver');
  return (r === 'seek' || r === 'fade') ? r : q === 'seek' ? 'seek' : 'fade';
}
