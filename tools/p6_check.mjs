// Phase 6 headless check: hunnids = dirty wrinkled $100 bills (pickups in the level, HUD icon, shop icon).
// usage: node tools/p6_check.mjs <fade|seek> [outDir] [width] [height]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const drv = process.argv[2] || 'seek';
const out = process.argv[3] || '/workspace/gasguzla/cars/seek/review/phase6';
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
const shot = async (n, clip) => { await p.screenshot({ path: `${out}/${tag}_${n}.png`, clip }); console.log('saved', `${tag}_${n}`); };
const E = (fn, a) => p.evaluate(fn, a);
await p.goto((process.env.BASE || 'http://localhost:4173/') + '?seed=61&nospawn=1');
await p.waitForFunction(() => window.__gg?.select, null, { timeout: 30000 });
await wait(800);
if (drv === 'seek') { await p.keyboard.press('ArrowRight'); await wait(800); }
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.__gg?.level?.scene?.isActive(), null, { timeout: 15000 });
await wait(8000); // let the intro text fade
// hover in the open, lay a row of all 4 bill variants in front of the car
const info = await E(() => { const L = __gg.level; L.invuln = 1e9; L.speed = 0; L.hoverLock = 99; L.autopilot = () => ({ ix: 0, iy: 0 }); L.py = 40; L.vy = 0;
  L.obstacles.forEach(o => o.img?.setVisible(false)); L.obstacles = [];
  for (let i = 0; i < 8; i++) { L.addScrap(L.px + 190 + i * 34, L.py + 30 + (i % 2) * 18, 10); const s = L.scraps[L.scraps.length - 1]; s.spr.play({ key: `scrap_${i % 4}`, startFrame: i < 4 ? 0 : 1 }); }
  L.scrap = 340; L.hud.setScrap(340); L.gas = 70; L.setDamage([1, 1, 0]);
  const fr = __gg.game.textures.get('scrap').get(0); return { frame: [fr.width, fr.height], css: __gg.game.canvas.getBoundingClientRect().height / 720, sx: L.px - L.scroll, py: L.py, camY: L.camY }; });
console.log('pickups', JSON.stringify(info));
if (info.frame[0] !== 20 || info.frame[1] !== 15) errors.push('bill frame ' + info.frame);
await wait(1500);
// bob check
const y0 = await E(() => __gg.level.scraps.map(s => s.spr.y)); await wait(400); const y1 = await E(() => __gg.level.scraps.map(s => s.spr.y));
if (!y0.some((y, i) => y !== y1[i])) errors.push('no hover bob');
await shot('level_pickups');
const cs = info.css, cam = await E(() => __gg.level.camY);
const cx = (info.sx + 170) * 2 * cs, cy = (info.py + 10 - cam) * 2 * cs;
await shot('level_pickups_closeup', { x: Math.max(0, cx), y: Math.max(0, cy), width: Math.min(vw - cx, 300 * 2 * cs), height: 90 * 2 * cs });
await shot('hud_closeup', { x: 0, y: 0, width: Math.min(vw, 760 * cs), height: 90 * cs });
await shot('hud');
// grab one: arm reach + floating text
await E(() => { const L = __gg.level; const s = L.scraps[0]; s.wx = L.px + L.cp.gear_bbox[2] + 6; s.y = L.py + L.cp.gear_bbox[3] - 2; s.spr.x = s.wx; }); await wait(700);
const got = await E(() => __gg.level.stats.grabbed); if (!got) errors.push('grab failed');
// shop icon
await E(() => { const L = __gg.level; L.openShop(); });
await p.waitForFunction(() => window.__gg?.shop?.scene?.isActive(), null, { timeout: 20000 }); await wait(1200);
await shot('shop_hunnids', { x: 0, y: 0, width: Math.min(vw, 700 * cs), height: 130 * cs });
console.log('ERRORS', errors.length ? errors : 'none');
await b.close(); process.exit(errors.length ? 1 : 0);
