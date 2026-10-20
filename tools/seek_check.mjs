// Headless check: select Seek -> gameplay with her side-view car; saves screenshots to argv[3]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/workspace/gasguzla/cars/seek/review';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errors = [];
p.on('response', (r) => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) { errors.push(m.text()); console.log('[console]', m.text()); } });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `${out}/${n}.png` }); console.log('saved', n); };
await p.goto(base + '?seed=11');
await p.waitForFunction(() => window.__gg?.select, null, { timeout: 30000 });
await wait(1200); await shot('select_fade');
await p.keyboard.press('ArrowRight'); await wait(900); await shot('select_seek');
await p.keyboard.press('Enter');
await p.waitForFunction(() => window.__gg?.level?.scene?.isActive(), null, { timeout: 15000 });
const info = await p.evaluate(() => { const L = __gg.level; return { driver: L.driver, tex: L.secImgs.map(i => i.texture.key), engine: L.engine.texture.key, gear: L.gear.texture.key, flame: L.flame.texture.key }; });
console.log('level', JSON.stringify(info));
await p.evaluate(() => { const L = __gg.level; L.invuln = 4; L.autopilot = (s) => { const ax0 = s.px + 60, ax1 = s.px + 320; let top = 6, bot = s.groundMin(ax0, ax1) - 4;
  for (const o of s.obstacles) { if (o.kind !== 'solid' || o.x > ax1 || o.x + o.w < ax0) continue; if (o.overhang) top = Math.max(top, o.y + o.h); else bot = Math.min(bot, o.y); }
  return { ix: Math.max(-1, Math.min(1, (70 - s.sx) / 40)), iy: Math.max(-1, Math.min(1, ((top + bot) / 2 - 46 - s.py) / 18)) }; }; });
await wait(3000); await shot('gameplay_seek_clean');
await p.evaluate(() => { __gg.level.setDamage([1, 2, 3]); __gg.level.invuln = 99; }); await wait(600); await shot('gameplay_seek_damage_b1_m2_f3');
const ok = info.driver === 'seek' && info.tex.every(k => k.startsWith('sm_seek_')) && info.engine === 'sm_seek_rear_engine';
console.log(ok && !errors.length ? 'SEEK CHECK PASS' : 'SEEK CHECK FAIL', errors.length, 'errors');
await b.close();
