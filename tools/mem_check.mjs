// GPU texture memory (sum of every Phaser texture source w*h*4) at points in the STREET level. usage: node tools/mem_check.mjs [full|lite]
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:5199/';
const lite = process.argv[2] === 'lite';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const sleep = (ms) => p.waitForTimeout(ms);
const mem = () => p.evaluate(() => {
  const out = {}; let tot = 0;
  for (const [k, t] of Object.entries(__gg.mock.game.textures.list)) { let m = 0; for (const s of t.source) m += s.width * s.height * 4; if (k.startsWith('__')) continue; out[k] = +(m / 1e6).toFixed(1); tot += m; }
  return { total_mb: +(tot / 1e6).toFixed(1), by: Object.fromEntries(Object.entries(out).filter(([, v]) => v >= 1)) };
});
const D = () => p.evaluate(() => (window.__gg && __gg.mock && __gg.mock.scene.isActive() ? __gg.mock.dbg() : null));
const tap = async (k, hold = 60) => { await p.keyboard.down(k); await sleep(hold); await p.keyboard.up(k); };
await p.goto(BASE + (lite ? '?lite=1' : '')); await sleep(6500);
await tap('ArrowDown', 120); await sleep(400); await tap('ArrowDown', 120); await sleep(700); await tap('Enter', 120);
for (let i = 0; i < 100 && !(await D()); i++) await sleep(200);
await sleep(4000);
console.log('street start', JSON.stringify(await mem()));
await p.evaluate(() => __gg.mock.dbgTeleport(900)); await sleep(1500);
await tap('Space'); await sleep(6000);
console.log('during tag 1', JSON.stringify(await mem()));
await sleep(14000);
console.log('after tag 1', JSON.stringify(await mem()));
await p.evaluate(() => __gg.mock.dbgTeleport(3800)); await sleep(4000);
console.log('beyond wall 2, cylo preloaded', JSON.stringify(await mem()), JSON.stringify((await D()).art));
await p.evaluate(() => __gg.mock.dbgTeleport(5950)); await p.keyboard.down('ArrowRight');
for (let i = 0; i < 50 && !(await D()).boss; i++) await sleep(200); await p.keyboard.up('ArrowRight'); await sleep(3000);
console.log('in CYLOBOT fight', JSON.stringify(await mem()));
console.log('errors', errs.join('|') || 'none', 'lite', (await D())?.lite);
await b.close();
