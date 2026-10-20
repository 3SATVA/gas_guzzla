// Phase 3 (review fixes) headless check. usage: node tools/p3_check.mjs <fade|seek> [outDir] [width] [height]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const drv = process.argv[2] || 'seek';
const out = process.argv[3] || '/workspace/gasguzla/cars/seek/review/phase3';
const vw = Number(process.argv[4] || 1280), vh = Number(process.argv[5] || 720);
const base = 'http://localhost:4173/';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
p.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) { errors.push(m.text()); console.log('[console]', m.text()); } });
p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) { errors.push(r.url()); console.log('[http]', r.status(), r.url()); } });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `${out}/${drv}_${n}.png` }); console.log('saved', `${drv}_${n}`); };
const E = (fn, a) => p.evaluate(fn, a);
const pilot = `(s) => { const ax0 = s.px + 40, ax1 = s.px + 260; let top = -340, bot = s.groundMin(ax0, ax1) - 4;
  for (const o of s.obstacles) { if (o.kind !== 'solid' || o.x > ax1 || o.x + o.w < ax0) continue; if (o.y < top + 40) top = Math.max(top, o.y); else bot = Math.min(bot, o.y); }
  const t = window.__gg.targetY ?? ((top + bot) / 2 - 36); return { ix: window.__gg.ix ?? 0, iy: Math.max(-1, Math.min(1, (t - s.py) / 18)) }; }`;
await p.goto(base + '?seed=33');
await p.waitForFunction(() => window.__gg?.select, null, { timeout: 30000 });
await wait(800);
if (drv === 'seek') { await p.keyboard.press('ArrowRight'); await wait(800); }
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.__gg?.level?.scene?.isActive(), null, { timeout: 15000 });
const d = await E(() => __gg.level.driver); if (d !== drv) { errors.push('driver ' + d); }
await E((src) => { const L = __gg.level; L.invuln = 99; L.autopilot = eval(src); L.speed = 150; __gg.ix = 1; }, pilot);
await E(() => { __gg.targetY = -40; }); await wait(3500); await shot('01_near_wall_wind_full_speed');
// traffic band: tiny Teslas vs the player car
await E(() => { __gg.targetY = -290; }); await wait(2600); await shot('02_traffic_band_flythrough');
await E(() => { const L = __gg.level; __gg.targetY = -150; L.nextDrone = 99; L.drones.forEach(d => d.spr.destroy()); L.drones = []; }); await wait(1800); await shot('02b_traffic_size_vs_player');
const tr = await E(() => { const L = __gg.level; return { n: L.traffic.length, lanes: [...new Set(L.traffic.map(t => t.lane))].sort(), dirs: [...new Set(L.traffic.map(t => Math.sign(t.v)))], w: L.traffic[0]?.w, h: L.traffic[0]?.h, carBox: L.carBox }; });
console.log('traffic', JSON.stringify(tr));
if (!(tr.w < (tr.carBox.x1 - tr.carBox.x0) * 0.6)) errors.push('traffic not smaller');
// hover stop: wind settles
await E(() => { const L = __gg.level; __gg.targetY = -60; __gg.ix = 0; L.speed = 0; L.hoverLock = 99; }); await wait(2600);
const w0 = await E(() => { const L = __gg.level; return { windV: L.windV, a: L.wind[0].img.alpha, x: L.wind.map(w => w.x) }; });
await wait(500); const w1 = await E(() => __gg.level.wind.map(w => w.x));
console.log('hover wind dx/0.5s', (w1[0] - w0.x[0]).toFixed(2), 'windV', w0.windV.toFixed(2), 'alpha', w0.a.toFixed(3));
await shot('03_hover_stop_wind_settled');
// reverse: haze drifts back
await E(() => { const L = __gg.level; L.hoverLock = 0; __gg.ix = -1; }); await wait(2500);
const r0 = await E(() => __gg.level.wind.map(w => w.x)); await wait(400); const r1 = await E(() => __gg.level.wind.map(w => w.x));
const rv = await E(() => __gg.level.speed); console.log('reverse speed', rv, 'wind dx/0.4s', (r1[1] - r0[1]).toFixed(2));
if (!(r1[1] - r0[1] > 0 || r1[2] - r0[2] > 0)) errors.push('wind not drifting back on reverse');
await shot('04_reversing_wind_back');
// open seat driver + scrap pickups
await E(() => { const L = __gg.level; __gg.ix = 0; L.speed = 0; L.hoverLock = 99; L.setDamage([1, 2, 1]); L.seatFace = 0; L.seatT = 0; __gg.targetY = 110;
  L.noSpawn = true; for (let i = 0; i < 4; i++) L.addScrap(L.px + 170 + i * 26, 150, 10); });
await wait(1500); await shot('05_open_seat_driver_and_scrap');
await E(() => { const L = __gg.level; L.setDamage([2, 3, 1]); L.seatFace = 2; L.seatT = 9; }); await wait(400); await shot('06_wreck_driver_arm_up');
// body shop
await E(() => { const L = __gg.level; L.nextDrone = 2; L.setDamage([2, 3, 3]); L.scrap = 260; L.openShop(); });
await p.waitForFunction(() => window.__gg?.shop?.scene?.isActive(), null, { timeout: 20000 }); await wait(1200);
const lay = await E(() => { const S = __gg.shop; const c = S.carLayer; const bb = S.view === 'front34' ? S.bbF : S.bbR; return { W: __gg.game.scale.width, carRight: c.x + bb[2], drvLeft: S.drv.x + __gg.game.cache.json.get('p2').shop[S.driver].driver_bbox[0], carLeft: c.x + bb[0] }; });
console.log('shop layout', JSON.stringify(lay)); if (lay.drvLeft - lay.carRight < 40 || lay.carLeft < 0) errors.push('shop overlap');
await shot('07_body_shop_front34_wrecked');
await p.keyboard.press('v'); await wait(600); await shot('08_body_shop_back34_wrecked');
const lay2 = await E(() => { const S = __gg.shop; const c = S.carLayer; const bb = S.bbR; return { carRight: c.x + bb[2], carLeft: c.x + bb[0] }; });
console.log('shop layout back', JSON.stringify(lay2)); if (lay.drvLeft - lay2.carRight < 40 || lay2.carLeft < 0) errors.push('shop overlap back');
await p.keyboard.press('r'); await wait(500); await shot('09_body_shop_repaired');
await p.keyboard.press('Enter'); await wait(1000);
const st = await E(() => ({ state: __gg.level.state, levels: __gg.level.levels, scrap: __gg.level.scrap, w: __gg.game.scale.width }));
console.log('after shop', JSON.stringify(st));
await shot('10_back_in_level');
console.log(errors.length ? 'P3 CHECK ERRORS ' + errors.length + ' ' + errors.join(' | ') : `P3 CHECK PASS ${drv}`);
await b.close();
