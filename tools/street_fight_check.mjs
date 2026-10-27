// In-street CYLOBOT fight + drone bumps + lazy art. usage: node tools/street_fight_check.mjs [drone|boss|lose|win] [full|lite]
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:5199/';
const which = process.argv[2] || 'boss', lite = process.argv[3] === 'lite';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text() + ' ' + (m.location()?.url||'')); });
const sleep = (ms) => p.waitForTimeout(ms);
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(1).padStart(6), ...a);
const D = () => p.evaluate(() => (window.__gg && __gg.mock && __gg.mock.scene.isActive() ? __gg.mock.dbg() : null));
const tap = async (k, hold = 60) => { await p.keyboard.down(k); await sleep(hold); await p.keyboard.up(k); };
async function until(f, ms = 20000, step = 100) { const t = Date.now(); while (Date.now() - t < ms) { const d = await D(); if (d && f(d)) return d; await sleep(step); } log('TIMEOUT', f.toString()); return D(); }
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
await p.goto(BASE + (lite ? '?lite=1' : '')); await sleep(6500);
await tap('ArrowDown', 120); await sleep(400); await tap('ArrowDown', 120); await sleep(700); await tap('Enter', 120);
let d = await until((d) => d.mode, 20000); await sleep(1500); d = await D();
log('street', JSON.stringify(d.art), 'hp', d.fight.hp);
ok(!(await p.evaluate(() => __gg.mock.game.textures.exists('ft_cylo'))), 'ft_cylo not loaded at street start');
const tp = (x) => p.evaluate((x) => __gg.mock.dbgTeleport(x), x);
if (which === 'drone') {
  await tp(2300); await sleep(500);
  await p.keyboard.down('ArrowRight'); await until((d) => d.drones.length > 0, 8000); await p.keyboard.up('ArrowRight');
  await sleep(300); await p.evaluate(() => __gg.mock.dbgSwoop());
  d = await until((d) => d.fight.bumps > 0, 12000, 50);
  log('bump', JSON.stringify(d.fight), d.fstate, d.fmove);
  ok(d.fight.bumps >= 1 && d.fight.hp < 100, 'drone bump damaged Seek');
  ok(d.fstate === 'hit' || d.fight.iframes > 0, 'flinch / iframes');
  const h1 = d.fight.hp; await sleep(500); d = await D(); ok(d.fight.bumps === 1 || d.fight.hp === h1 || d.fight.iframes <= 0, 'iframes prevent double hit');
  await sleep(6000); d = await D(); log('after', JSON.stringify(d.fight), d.mode);
}
if (which === 'boss' || which === 'win' || which === 'lose') {
  await tp(3800); await sleep(500);
  d = await until((d) => d.art.cylo === 'ready', 30000, 200); log('cylo ready?', JSON.stringify(d.art));
  ok(d.art.cylo === 'ready', 'ft_cylo streamed in the background');
  await tp(5950); await sleep(300);
  await p.keyboard.down('ArrowRight');
  d = await until((d) => d.boss, 10000); await p.keyboard.up('ArrowRight');
  log('boss start', d.mode, JSON.stringify(d.fight));
  ok(d.boss && !(await p.evaluate(() => __gg.scene?.keys?.Fight?.sys?.isActive?.() ?? false)), 'boss started with no scene switch');
  d = await until((d) => d.fight.phase === 'fight', 15000); log('fight', JSON.stringify(d.fight));
  ok(d.fight.cBar > 0, 'CYLOBOT bar visible');
  if (which === 'lose') await p.evaluate(() => __gg.mock.dbgHp('seek', 20));
  if (which === 'win') await p.evaluate(() => __gg.mock.dbgHp('cylo', 12));
  // simple bot: close in, kick, spray now and then
  const t0 = Date.now(); let sprayed = false;
  while (Date.now() - t0 < 60000) {
    d = await D(); if (!d || d.fight.result) break;
    const dx = d.fight.cX - d.x;
    if (which === 'lose') { await sleep(300); continue; }
    if (dx > 230) await p.keyboard.down('ArrowRight'); else await p.keyboard.up('ArrowRight');
    if (!sprayed && dx < 520 && dx > 150) { sprayed = true; await tap('Space', 40); await sleep(1800); continue; }
    if (dx < 250) { await tap(Math.random() < 0.5 ? 'KeyJ' : 'KeyK', 40); }
    await sleep(120);
  }
  await p.keyboard.up('ArrowRight');
  d = await until((d) => d.fight.over, 15000); log('end', JSON.stringify(d.fight));
  log('stats', JSON.stringify({ sprays: d.fight.sprays, hits: d.fight.hits, stuns: d.fight.stuns, splats: d.fight.splats }));
  ok(!!d.fight.result, 'single KO result: ' + d.fight.result);
  await p.screenshot({ path: `shots/street_fight_${which}.png` });
  if (d.fight.result === 'lose') {
    await tap('KeyR', 80); await sleep(800); d = await D();
    log('retry', JSON.stringify(d.fight)); ok(d.fight.result === null && d.fight.hp === 100 && d.fight.cHp === 100 && d.mode !== 'x', 'retry restarts the fight in place');
  }
}
log('errors', errs.join(' | ') || 'none');
await b.close();
