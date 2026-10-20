// Phase 5 headless check: big crisp HUD (phone + desktop) and Teslas on straight AI rails.
// usage: node tools/p5_check.mjs <fade|seek> [outDir] [width] [height]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const drv = process.argv[2] || 'seek';
const out = process.argv[3] || '/workspace/gasguzla/cars/seek/review/phase5';
const vw = Number(process.argv[4] || 1280), vh = Number(process.argv[5] || 720);
const tag = `${drv}_${vw}x${vh}`;
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
await p.goto('http://localhost:4173/?seed=57');
await p.waitForFunction(() => window.__gg?.select, null, { timeout: 30000 });
await wait(800);
if (drv === 'seek') { await p.keyboard.press('ArrowRight'); await wait(800); }
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.__gg?.level?.scene?.isActive(), null, { timeout: 15000 });
await E((src) => { const L = __gg.level; L.invuln = 1e9; L.autopilot = eval(src); L.speed = 150; __gg.ix = 1; L.nextDrone = 999; }, pilot);
// ---- HUD
await E(() => { const L = __gg.level; L.setDamage([1, 2, 1]); L.gas = 64; L.scrap = 340; L.hud.setScrap(340); __gg.targetY = -60; }); await wait(8200);
const hud = await E(() => { const H = __gg.game.scene.getScene('Hud'); const cs = H.L.cssScale; const t = (o) => ({ css: +(parseFloat(o.style.fontSize) * cs).toFixed(1), x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.width) });
  return { W: __gg.game.scale.width, cs: +cs.toFixed(3), phone: H.L.phone, short: H.L.shortScrap, scrap: t(H.scrapT), gas: t(H.gasT), dmg: t(H.dmgT), spd: t(H.spd), dist: t(H.dist), stripH: H.dbg.y - 16,
    scales: { scrap: H.scrapIcon.scaleX, barrel: H.gasIcon.scaleX, car: H.icon.scaleX } }; });
console.log('hud', JSON.stringify(hud));
for (const k of ['scrap', 'gas', 'dmg', 'spd', 'dist']) if (hud[k].css < (vh <= 400 ? 16 : 20)) errors.push(`hud ${k} text ${hud[k].css}css px`);
for (const v of Object.values(hud.scales)) if (!Number.isInteger(v)) errors.push('non-integer icon scale');
if (hud.stripH / 720 > 0.24) errors.push('HUD strip too tall ' + hud.stripH);
await shot('hud');
// ---- Tesla rails
const rails = async () => E(() => { const L = __gg.level; const LN = L.constructor.LANES_DBG; const by = {};
  for (const t of L.traffic) { if (t.dead) continue; (by[t.lane] = by[t.lane] || []).push(t); }
  const res = {}; let bad = [];
  for (const [i, cs] of Object.entries(by)) {
    const ys = new Set(cs.map(c => c.y)), sy = new Set(cs.map(c => Math.round(c.spr.y))), vs = new Set(cs.map(c => c.v));
    const xs = cs.map(c => c.wx).sort((a, b) => a - b); const d = []; for (let k = 1; k < xs.length; k++) d.push(Math.round(xs[k] - xs[k - 1]));
    res[i] = { n: cs.length, y: [...ys], v: [...vs], gaps: [...new Set(d)].sort((a, b) => a - b) };
    if (ys.size > 1 || sy.size > 1 || vs.size > 1) bad.push(i);
  }
  return { res, bad }; });
await E(() => { __gg.targetY = -230; }); await wait(3500); await shot('traffic_lower_lanes');
let r = await rails(); console.log('lower rails', JSON.stringify(r.res)); if (r.bad.length) errors.push('lanes not on rails ' + r.bad);
await E(() => { __gg.targetY = -470; }); await wait(2500); await shot('traffic_top_wall');
r = await rails(); console.log('top rails', JSON.stringify(r.res)); if (r.bad.length) errors.push('lanes not on rails ' + r.bad);
// still impassable at the very top
const surv = await E(async () => { const L = __gg.level; L.setDamage([0, 0, 0]); L.invuln = 0; __gg.targetY = -520; const t0 = performance.now();
  while (L.state === 'play' && performance.now() - t0 < 30000) { L.gas = 100; await new Promise(r => setTimeout(r, 100)); }
  return { state: L.state, secs: ((performance.now() - t0) / 1000).toFixed(1), hits: L.stats.hits }; });
console.log('ceiling survival', JSON.stringify(surv)); if (surv.state !== 'totaled') errors.push('survived the ceiling');
console.log('ERRORS', errors.length ? errors : 'none');
await b.close(); process.exit(errors.length ? 1 : 0);
