// Phase 4 headless check. usage: node tools/p4_check.mjs <fade|seek> [outDir] [width] [height] [mode=all|shop]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const drv = process.argv[2] || 'seek';
const out = process.argv[3] || '/workspace/gasguzla/cars/seek/review/phase4';
const vw = Number(process.argv[4] || 1280), vh = Number(process.argv[5] || 720);
const mode = process.argv[6] || 'all';
const tag = `${drv}_${vw}x${vh}`;
const base = 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
p.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) { errors.push(m.text()); console.log('[console]', m.text()); } });
p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) { errors.push(r.url()); console.log('[http]', r.status(), r.url()); } });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `${out}/${tag}_${n}.png` }); console.log('saved', `${tag}_${n}`); };
const E = (fn, a) => p.evaluate(fn, a);
const pilot = `(s) => { const ax0 = s.px + 40, ax1 = s.px + 260; let top = -560, bot = s.groundMin(ax0, ax1) - 4;
  for (const o of s.obstacles) { if (o.kind !== 'solid' || o.x > ax1 || o.x + o.w < ax0) continue; if (o.y < top + 40) top = Math.max(top, o.y); else bot = Math.min(bot, o.y); }
  const t = window.__gg.targetY ?? ((top + bot) / 2 - 36); return { ix: window.__gg.ix ?? 0, iy: Math.max(-1, Math.min(1, (t - s.py) / 18)) }; }`;
await p.goto(base + '?seed=41');
await p.waitForFunction(() => window.__gg?.select, null, { timeout: 30000 });
await wait(800);
if (drv === 'seek') { await p.keyboard.press('ArrowRight'); await wait(800); }
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.__gg?.level?.scene?.isActive(), null, { timeout: 15000 });
const W0 = await E(() => __gg.game.scale.width);
await E((src) => { const L = __gg.level; L.invuln = 99; L.autopilot = eval(src); L.speed = 150; __gg.ix = 1; }, pilot);

// ---------------------------------------------------------------- body shop: no bars, car shrunk, driver native
await E(() => { const L = __gg.level; L.setDamage([2, 3, 3]); L.scrap = 260; L.openShop(); });
await p.waitForFunction(() => window.__gg?.shop?.scene?.isActive(), null, { timeout: 20000 }); await wait(1200);
for (const v of ['front34', 'rear34']) {
  if (v === 'rear34') { await p.keyboard.press('v'); await wait(600); }
  const lay = await E(() => { const S = __gg.shop; const c = S.carLayer; const bb = S.view === 'front34' ? S.bbF : S.bbR; const db = __gg.game.cache.json.get('p2').shop[S.driver].driver_bbox;
    const cv = __gg.game.canvas.getBoundingClientRect();
    return { view: S.view, W: __gg.game.scale.width, carLeft: c.x + bb[0], carRight: c.x + bb[2], carBottom: c.y + bb[3], drvLeft: S.drv.x + db[0], drvRight: S.drv.x + db[2], drvScale: S.drv.scaleX, css: [Math.round(cv.width), Math.round(cv.height)], win: [innerWidth, innerHeight] }; });
  console.log('shop', JSON.stringify(lay));
  if (lay.W !== W0) errors.push(`shop widened the canvas ${W0} -> ${lay.W}`);
  if (lay.carLeft < 0 || lay.drvRight > lay.W || lay.drvLeft - lay.carRight < 40) errors.push('shop layout ' + JSON.stringify(lay));
  if (lay.drvScale !== 1) errors.push('driver resampled');
  await shot(`shop_${v}_wrecked`);
}
await p.keyboard.press('r'); await wait(500); await shot('shop_rear34_repaired');
await p.keyboard.press('Enter'); await wait(900);
const back = await E(() => __gg.game.scale.width); if (back !== W0) errors.push('canvas changed after shop');
if (mode === 'shop') { console.log('ERRORS', errors.length ? errors : 'none'); await b.close(); process.exit(errors.length ? 1 : 0); }

// ---------------------------------------------------------------- HUD + barrels
await E(() => { const L = __gg.level; L.setDamage([1, 1, 0]); __gg.targetY = -60; }); await wait(2500);
await E(() => { const L = __gg.level; L.addBarrel(L.px + 240, L.py + 36, 30, 'mid'); L.gas = 52; }); await wait(250); await shot('hud_and_barrel_ahead');
const g0 = await E(() => __gg.level.gas); await wait(1800);
const g1 = await E(() => ({ gas: __gg.level.gas, n: __gg.level.stats.barrels }));
console.log('barrel', g0.toFixed(1), '->', g1.gas.toFixed(1), 'taken', g1.n); if (!(g1.gas > g0 + 20)) errors.push('barrel did not refill');
// HUD close-up
await shot('hud_after_barrel');
const bz = await E(() => { const z = {}; for (const b of __gg.level.barrels) z[b.zone] = (z[b.zone] || 0) + 1; return z; }); console.log('barrel zones so far', JSON.stringify(bz));
// ---------------------------------------------------------------- thin obstacles snap with NO damage
await E(() => { const L = __gg.level; L.drones.forEach(d => d.spr.destroy()); L.drones = []; L.nextDrone = 999; L.invuln = 0; L.setDamage([0, 0, 0]); __gg.targetY = -40; __gg.ix = 0; L.speed = 110;
  const x = L.px + 230, y = L.py;
  // a sagging wire, a hanging cable and a roof antenna right in the car's path
  L.addThinProc(x, y + 30, 70, 12, 'wire', (q) => { for (let i = 0; i < 70; i++) { const u = i / 69; q.fillRect(i, Math.round(36 * u * (1 - u)), 1, 1); } });
  L.addThinProc(x + 60, y + 4, 3, 40, 'cable', (q) => { q.fillRect(1, 0, 1, 38); q.fillRect(0, 38, 3, 2); });
  L.addThinProc(x + 110, y + 10, 8, 50, 'antenna', (q) => { q.fillRect(3, 0, 2, 50); q.fillRect(0, 4, 8, 1); q.fillRect(1, 9, 6, 1); });
  L.stats.snapped = 0; });
let snapShot = false;
for (let i = 0; i < 40; i++) { await wait(60); const n = await E(() => __gg.level.stats.snapped); if (n >= 1 && !snapShot) { await wait(90); await shot('thin_snap_wire'); snapShot = true; } if (n >= 3) { await wait(120); await shot('thin_snap_antenna'); break; } }
const th = await E(() => ({ snapped: __gg.level.stats.snapped, levels: __gg.level.levels, hits: __gg.level.stats.hits }));
console.log('thin', JSON.stringify(th)); if (th.snapped < 3 || th.levels.some(l => l)) errors.push('thin obstacles ' + JSON.stringify(th));
// real level thin bits (building antennas / pipes) count
const tags = await E(() => { const z = {}; for (const o of __gg.level.obstacles) { const k = o.kind + (o.thin ? ':' + o.thin : ''); z[k] = (z[k] || 0) + 1; } return z; }); console.log('obstacle tags', JSON.stringify(tags));
// ---------------------------------------------------------------- traffic ceiling
await E(() => { const L = __gg.level; L.invuln = 99; L.speed = 140; __gg.ix = 1; __gg.targetY = -300; }); await wait(2600); await shot('traffic_lower_band_passable');
await E(() => { __gg.targetY = -470; }); await wait(2200); await shot('traffic_ceiling_wall');
const tc = await E(() => { const L = __gg.level; const by = {}; for (const t of L.traffic) by[t.lane] = (by[t.lane] || 0) + 1; return { n: L.traffic.length, by, camY: L.camY, py: L.py }; });
console.log('ceiling traffic', JSON.stringify(tc));
// how long can you survive in the ceiling? (real damage, fresh car)
const surv = await E(async () => { const L = __gg.level; L.setDamage([0, 0, 0]); L.invuln = 0; L.gas = 100; __gg.targetY = -520; const t0 = performance.now();
  while (L.state === 'play' && performance.now() - t0 < 30000) { L.gas = 100; await new Promise(r => setTimeout(r, 100)); }
  return { state: L.state, secs: ((performance.now() - t0) / 1000).toFixed(1), hits: L.stats.hits, py: Math.round(L.py) }; });
console.log('ceiling survival', JSON.stringify(surv)); if (surv.state !== 'totaled') errors.push('survived the ceiling');
await wait(1500); await shot('traffic_ceiling_totalled');
// ---------------------------------------------------------------- gas: low, empty -> sink -> crash
await p.keyboard.press('r'); await p.waitForFunction(() => window.__gg?.level?.state === 'play', null, { timeout: 15000 }); await wait(800);
await E((src) => { const L = __gg.level; L.invuln = 99; L.autopilot = eval(src); L.speed = 120; __gg.ix = 0; __gg.targetY = -100; L.nextDrone = 999; L.gas = 14; }, pilot);
await wait(1500); await shot('gas_low_warning');
await E(() => { __gg.level.gas = 0.2; }); await wait(1400); await shot('gas_empty_sinking');
const dry = await E(async () => { const L = __gg.level; const t0 = performance.now(); while (L.state === 'play' && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 100)); return { state: L.state, dead: L.dead, secs: ((performance.now() - t0) / 1000).toFixed(1) }; });
console.log('out of gas', JSON.stringify(dry)); if (dry.dead !== 'gas') errors.push('no out-of-gas crash');
await wait(1800); await shot('gas_out_crash_game_over');
// ---------------------------------------------------------------- drones: rate + cap over 60 s of normal flying
await p.keyboard.press('r'); await p.waitForFunction(() => window.__gg?.level?.state === 'play', null, { timeout: 15000 }); await wait(500);
const dr = await E(async (src) => { const L = __gg.level; L.invuln = 1e9; L.autopilot = eval(src); __gg.ix = 1; delete __gg.targetY; let max = 0, spawned = 0; const seen = new Set();
  const t0 = performance.now(); while (performance.now() - t0 < 60000) { L.gas = 100; const alive = L.drones.filter(d => !d.dead); max = Math.max(max, alive.length); for (const d of L.drones) seen.add(d); await new Promise(r => setTimeout(r, 100)); }
  return { max, spawned: seen.size, gameSecs: L.elapsed.toFixed(0) }; }, pilot);
console.log('drones/60s', JSON.stringify(dr)); if (dr.max > 2) errors.push('drone cap');
await shot('gameplay_after_60s');
console.log('ERRORS', errors.length ? errors : 'none');
await b.close(); process.exit(errors.length ? 1 : 0);
