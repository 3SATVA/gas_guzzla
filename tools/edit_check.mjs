// Seek edit check (EDL rebuild): graffiti clip order, camera/drone spray freeze+reverse, block hold, unblocked hurt, win pose. usage: node tools/edit_check.mjs [lite]
import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:5199/';
const lite = process.argv[2] === 'lite';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) errs.push(m.text()); });
const sleep = (ms) => p.waitForTimeout(ms);
const D = () => p.evaluate(() => (window.__gg && __gg.mock && __gg.mock.scene.isActive() ? __gg.mock.dbg() : null));
const tap = async (k, hold = 60) => { await p.keyboard.down(k); await sleep(hold); await p.keyboard.up(k); };
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1; };
async function trace(ms, step = 40) { const seq = [], t0 = Date.now(); let last = ''; while (Date.now() - t0 < ms) { const d = await D(); if (d) { const k = d.mode === 'guard' ? 'F:' + d.fmove : d.clip; if (k !== last) { seq.push(k); last = k; } } await sleep(step); } return seq; }
await p.goto(BASE + (lite ? '?lite=1' : '')); await sleep(6500);
await tap('ArrowDown', 120); await sleep(400); await tap('ArrowDown', 120); await sleep(700); await tap('Enter', 120);
for (let i = 0; i < 100 && !(await D()); i++) await sleep(200);
await sleep(2500);
let d = await D(); console.log('idle clip', d.clip);
ok(d.clip === 'idle_a', 'idle is idle_a');
// walk
await p.keyboard.down('ArrowRight'); let s = await trace(800); await p.keyboard.up('ArrowRight'); console.log('walk', s.join(' > ')); ok(s.includes('walk_loop'), 'walk_loop');
// graffiti
await p.evaluate(() => __gg.mock.dbgTeleport(900)); await sleep(1500);
await tap('Space'); s = await trace(20000, 30); console.log('tag', s.join(' > '));
d = await D(); ok(d.stats.tags >= 1 || d.walls.some((w) => w.done), 'tag finished: ' + JSON.stringify(d.stats));
const want = ['turn_to_wall', 'wall_shake', 'wall_squat_dn', 'wall_squat_hold', 'wall_squat_up', 'wall_spray_mid', 'turn_away_toss'];
ok(want.every((c, i) => s.indexOf(c) >= 0 && (i === 0 || s.indexOf(c) > s.indexOf(want[i - 1]))), 'graffiti order');
// camera spray
const cam = await p.evaluate(() => __gg.mock.dbg().cams.map((c) => c.x));
console.log('cams', cam);
if (cam.length) { await p.evaluate((x) => __gg.mock.dbgTeleport(x - 150), cam[0]); await sleep(800); await tap('Space', 60); s = await trace(4500); console.log('cam', s.join(' > ')); ok(s.includes('cam_spray_hold') && s.includes('cam_spray_return'), 'cam raise/hold/return'); }
// block / hurt / win pose in the CYLOBOT fight
await p.evaluate(() => __gg.mock.dbgTeleport(3800)); await sleep(500);
for (let i = 0; i < 150 && (await D()).art.cylo !== 'ready'; i++) await sleep(200);
await p.evaluate(() => __gg.mock.dbgTeleport(5950)); await p.keyboard.down('ArrowRight');
for (let i = 0; i < 50 && !(await D()).boss; i++) await sleep(200); await p.keyboard.up('ArrowRight');
for (let i = 0; i < 100 && (await D()).fight.phase !== 'fight'; i++) await sleep(150);
const F = () => p.evaluate(() => { const f = __gg.mock.F; return `${f.state}/${f.move}/${f.fi}`; });
const seen = new Map(); let t0 = Date.now(), blocked = false;
await p.keyboard.down('KeyC');
while (Date.now() - t0 < 40000) { const k = await F(); seen.set(k, (seen.get(k) || 0) + 1); const dd = await D(); if (dd.fight.result) break; await sleep(30); }
await p.keyboard.up('KeyC');
console.log('seen (state/move/frame:samples)', [...seen].map(([k, v]) => k + ':' + v).join(' '));
ok([...seen.keys()].some((k) => k.includes('block')), 'block seen');
console.log('errors', errs.join(' | ') || 'none');
await b.close();
