// ~90 s capture of the whole street level: wall tag -> drone bump -> CYLOBOT enters (no scene switch) -> fight w/ spray stun -> win banner.
// usage: node tools/street_full_capture.mjs  -> /tmp/street_cap/*.webm  (teleports are used to skip empty walking)
import { chromium } from 'playwright-core';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:5199/', OUT = '/tmp/street_cap';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text() + ' ' + (m.location()?.url || '')); });
const sleep = (ms) => p.waitForTimeout(ms);
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const D = () => p.evaluate(() => (window.__gg && __gg.mock && __gg.mock.scene.isActive() ? __gg.mock.dbg() : null));
const tap = async (k, hold = 60) => { await p.keyboard.down(k); await sleep(hold); await p.keyboard.up(k); };
async function until(f, ms = 20000, step = 100) { const t = Date.now(); while (Date.now() - t < ms) { const d = await D(); if (d && f(d)) return d; await sleep(step); } log('TIMEOUT', f.toString()); return D(); }
const tp = (x) => p.evaluate((x) => __gg.mock.dbgTeleport(x), x);
await p.goto(BASE); await sleep(6500);
await tap('ArrowDown', 120); await sleep(400); await tap('ArrowDown', 120); await sleep(700); await tap('Enter', 120);
await until((d) => d.mode, 20000); await sleep(1200); log('street');
await p.keyboard.down('ArrowRight'); await until((d) => d.x >= 900, 30000, 40); await p.keyboard.up('ArrowRight'); await sleep(300);
await tap('Space'); await until((d) => d.mode === 'seq', 5000); log('tag');
await until((d) => d.walls[0].done && d.mode === 'relaxed', 25000); await sleep(500); log('tag done');
await tp(2300); await sleep(300);
await p.keyboard.down('ArrowRight'); await until((d) => d.drones.length > 0, 8000); await sleep(1500); await p.evaluate(() => __gg.mock.dbgSwoop());
await until((d) => d.fight.bumps > 0, 15000, 50); await p.keyboard.up('ArrowRight'); log('bump', JSON.stringify((await D()).fight.hp));
await sleep(1500);
await tp(5100); await sleep(500);
await p.keyboard.down('ArrowRight'); const d0 = await until((d) => d.boss, 30000); await p.keyboard.up('ArrowRight'); log('boss', JSON.stringify(d0.art));
await until((d) => d.fight.phase === 'fight', 15000); log('fight');
const t0 = Date.now(); let sprayed = 0, n = 0, helped = false;
while (Date.now() - t0 < 50000) {
  const d = await D(); if (!d || d.fight.result) break;
  const dx = d.fight.cX - d.x; n++;
  if (!helped && Date.now() - t0 > 30000) { helped = true; log('NOTE: nudged CYLOBOT hp to 15 so the capture ends'); await p.evaluate(() => __gg.mock.dbgHp('cylo', 15)); }
  if (dx > 260) await p.keyboard.down('ArrowRight'); else await p.keyboard.up('ArrowRight');
  if (sprayed < 2 && Date.now() - t0 > 2500 * (sprayed + 1) && dx < 540 && dx > 160 && d.fight.cans === undefined) { sprayed++; await tap('Space', 40); await sleep(1800); continue; }
  if (dx < 270) { const r = Math.random(); if (r < 0.15) { await p.keyboard.down('KeyC'); await sleep(350); await p.keyboard.up('KeyC'); } else await tap(r < 0.6 ? 'KeyJ' : 'KeyK', 40); }
  await sleep(110);
}
await p.keyboard.up('ArrowRight');
const dd = await until((d) => d.fight.over, 15000); log('end', JSON.stringify(dd.fight)); await sleep(4000);
log('errors', errs.join(' | ') || 'none');
await ctx.close(); await b.close(); log(fs.readdirSync(OUT).join(','));
