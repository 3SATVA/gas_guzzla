// Short capture of the STREET graffiti: TWO tags (walls at spots 1000 and 3000), each with the full 10 s squat spray, centred on the wall.
// usage: node tools/mock_tags_check.mjs    -> /tmp/mock_tags_cap/*.webm + shots/tags_*.png
import { chromium } from 'playwright-core';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:5199/';
const OUT = process.env.OUT || '/tmp/mock_tags_cap';
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('pageerror ' + e.message));
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const D = () => p.evaluate(() => (window.__gg && __gg.mock && __gg.mock.scene.isActive() ? __gg.mock.dbg() : null));
const sleep = (ms) => p.waitForTimeout(ms);
const shot = (n) => p.screenshot({ path: `shots/tags_${n}.png` });
async function until(f, ms = 20000, step = 100) {
  const t = Date.now();
  while (Date.now() - t < ms) { const d = await D(); if (d && f(d)) return d; await sleep(step); }
  log('TIMEOUT', f.toString(), JSON.stringify(await D())); return D();
}
const tap = async (k, hold = 60) => { await p.keyboard.down(k); await sleep(hold); await p.keyboard.up(k); };
async function walkTo(x) { await p.keyboard.down('ArrowRight'); await until((d) => d.x >= x, 30000, 40); await p.keyboard.up('ArrowRight'); }

await p.goto(BASE); await sleep(6500);
await tap('ArrowDown', 120); await sleep(400); await tap('ArrowDown', 120); await sleep(700);
await tap('Enter', 120);
await until((d) => d && d.mode, 15000); log('in street'); await sleep(1500);
const shotsAt = [0.1, 0.3, 0.5, 0.62, 0.75, 0.9];
for (const [wi, startX] of [[0, 900], [1, 3000]]) {
  if (wi === 1) { await p.evaluate((x) => __gg.mock.dbgTeleport(x), startX); await sleep(1500); }
  else await walkTo(startX);
  await sleep(500);
  await tap('Space'); log(`SPRAY wall ${wi + 1}`, JSON.stringify(await D()).slice(0, 120));
  await until((d) => d.seq[0] === 'wall_spray_long', 15000, 40); log('long spray started, hero x', (await D()).x, 'wall cx', (await D()).walls[wi].cx);
  let n = 0;
  while (n < shotsAt.length) {
    const d = await D();
    if (!d || d.mode !== 'seq') break;
    if (d.seq[0] === 'wall_spray_long' && d.cf / 240 >= shotsAt[n]) { await shot(`w${wi + 1}_${String(Math.round(shotsAt[n] * 100)).padStart(3, '0')}`); n++; }
    await sleep(60);
  }
  await until((d) => d.walls[wi].done && d.mode === 'relaxed', 20000);
  await sleep(500); await shot(`w${wi + 1}_done`); log(`tag ${wi + 1} done`, JSON.stringify((await D()).cans));
  await sleep(800);
}
log('errors', errs.join(' | ') || 'none');
await ctx.close(); await b.close();
log('video in', OUT, fs.readdirSync(OUT).join(','));
