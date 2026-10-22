// Phase 2 headless check. usage: node tools/p2_check.mjs [base] [outDir] [width] [height]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.argv[2] || (process.env.BASE || 'http://localhost:4173/');
const out = process.argv[3] || '/workspace/gasguzla/cars/seek/review/phase2';
const vw = Number(process.argv[4] || 1280), vh = Number(process.argv[5] || 720);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: vw, height: vh } })).newPage();
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
p.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) { errors.push(r.url()); console.log('[http]', r.status(), r.url()); } });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('saved', n); };
const E = (fn, a) => p.evaluate(fn, a);
const pilot = `(s) => { const ax0 = s.px + 40, ax1 = s.px + 260; let top = -340, bot = s.groundMin(ax0, ax1) - 4;
  for (const o of s.obstacles) { if (o.kind !== 'solid' || o.x > ax1 || o.x + o.w < ax0) continue; if (o.y < top + 40) top = Math.max(top, o.y); else bot = Math.min(bot, o.y); }
  const t = window.__gg.targetY ?? ((top + bot) / 2 - 36); return { ix: window.__gg.ix ?? 0, iy: Math.max(-1, Math.min(1, (t - s.py) / 18)) }; }`;
await p.goto(base + '?seed=21');
await p.waitForFunction(() => window.__gg?.select, null, { timeout: 30000 });
await wait(800);
await p.keyboard.press('ArrowRight'); await wait(800);
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.__gg?.level?.scene?.isActive(), null, { timeout: 15000 });
await E((src) => { const L = __gg.level; L.invuln = 2; L.autopilot = eval(src); }, pilot);
await wait(3500); await shot('p2_01_seek_street_band');
// climb into the traffic lanes
await E(() => { __gg.targetY = -300; __gg.level.invuln = 99; }); await wait(2600); await shot('p2_02_traffic_band_camera_up');
// tunnel: spawn one just ahead and fly the passage
await E(() => { const L = __gg.level; __gg.targetY = undefined; L.noSpawn = true; L.obstacles.filter(o => o.x > L.px - 40).forEach(o => o.img && o.img.destroy()); L.obstacles = L.obstacles.filter(o => o.x <= L.px - 40);
  L.scraps.forEach(s => s.spr.destroy()); L.scraps = [];
  const x = Math.round(L.px) + 220; const roof = -120; L.addSilhouette(x, roof, 420, 380 - roof, [{ y0: 40 - 50 - roof, y1: 40 + 50 - roof }]); L.addScrap(x + 120, 52, 30);
  __gg.targetY = 40 - 36; L.py = 4; });
await wait(1800); await shot('p2_03_tunnel');
// hover stop under the scrap -> arm grabs it
await E(() => { const L = __gg.level; L.speed = 0; L.hoverLock = 9; __gg.ix = 0; const s = L.scraps.find(s => !s.taken); if (s) { L.scroll = s.wx - L.sx - L.cp.gear_bbox[2] - 12; __gg.targetY = s.y - L.cp.gear_bbox[3] + 6; L.py = __gg.targetY; } });
await wait(260); await shot('p2_04_arm_reaching_scrap');
await wait(900); const g = await E(() => ({ scrap: __gg.level.scrap, grabbed: __gg.level.stats.grabbed })); console.log('grab', JSON.stringify(g));
await shot('p2_05_after_grab_hover');
// reverse
await E(() => { __gg.ix = -1; __gg.level.hoverLock = 0; }); await wait(1500);
const rv = await E(() => __gg.level.speed); console.log('reverse speed', rv);
await shot('p2_06_reversing');
// damage: middle smashed -> driver visible in the seat
await E(() => { const L = __gg.level; __gg.ix = 0; L.speed = 60; L.setDamage([1, 2, 1]); L.seatFace = 2; L.seatT = 5; __gg.targetY = 120; });
await wait(900); await shot('p2_07_open_seat_driver');
// drones chasing from behind + traffic
await E(() => { const L = __gg.level; L.noSpawn = false; L.setDamage([0, 0, 0]); for (let i = 0; i < 3; i++) L.spawnDrone(i ? 'security' : 'gang', true); __gg.targetY = undefined; });
await wait(1600); await shot('p2_08_drones_chasing');
// body shop
await E(() => __gg.level.setDamage([2, 1, 3]));
await E(() => { __gg.level.scrap = 260; __gg.level.openShop(); });
await p.waitForFunction(() => window.__gg?.shop?.scene?.isActive(), null, { timeout: 20000 }); await wait(900);
await shot('p2_09_body_shop_front34');
await p.keyboard.press('v'); await wait(500); await shot('p2_10_body_shop_back34');
await p.keyboard.press('r'); await wait(500); await shot('p2_11_body_shop_repaired');
await p.keyboard.press('Enter'); await wait(900);
const st = await E(() => ({ state: __gg.level.state, levels: __gg.level.levels, scrap: __gg.level.scrap, w: __gg.game.scale.width }));
console.log('after shop', JSON.stringify(st));
await shot('p2_12_back_in_level');
console.log(errors.length ? 'P2 CHECK ERRORS ' + errors.length : 'P2 CHECK PASS');
await b.close();
