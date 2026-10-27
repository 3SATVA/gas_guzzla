// Scripted playthrough of the STREET mock level (menu -> walk -> tags -> cams -> drones -> CYLOBOT fight).
// Records playwright video to /tmp/mock_cap/*.webm and saves key screenshots to shots/mock_*.png.
// usage: node tools/mock_check.mjs   (dev server on $BASE, default http://localhost:5199/)
import { chromium } from 'playwright-core';
import fs from 'fs';
const BASE = process.env.BASE || 'http://localhost:5199/';
const OUT = process.env.OUT || '/tmp/mock_cap';
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
const shot = (n) => p.screenshot({ path: `shots/mock_${n}.png` });
async function until(f, ms = 20000, step = 100) {
  const t = Date.now();
  while (Date.now() - t < ms) { const d = await D(); if (d && f(d)) return d; await sleep(step); }
  log('TIMEOUT', f.toString(), JSON.stringify(await D())); return D();
}
async function walkTo(x) {
  await p.keyboard.down('ArrowRight');
  await until((d) => d.x >= x, 30000, 40);
  await p.keyboard.up('ArrowRight');
}
const tap = async (k, hold = 60) => { await p.keyboard.down(k); await sleep(hold); await p.keyboard.up(k); };

// ---- menu -> STREET
await p.goto(BASE);
await sleep(6500);
await shot('01_menu');
await tap('ArrowDown', 120); await sleep(400); await tap('ArrowDown', 120); await sleep(700);
await shot('02_menu_street');
await tap('Enter', 120);
await until((d) => d && d.mode, 15000);
log('in street'); await sleep(2500);

// ---- walk to wall 1, tag it
await walkTo(950); await sleep(500); log('at wall 1');
await tap('Space'); log('SPRAY wall 1');
await until((d) => d.seq.length > 0 && d.seq[0] === 'turn_to_wall', 4000, 30).catch(() => 0);
await sleep(2300); await shot('03_tag_in_progress');
await until((d) => d.walls[0].done && d.mode === 'relaxed', 15000);
await sleep(400); await shot('04_tag_done'); log('tag 1 done', JSON.stringify((await D()).cans));

// ---- security camera 1
await walkTo(1690); await sleep(500);
log('target', (await D()).target);
await tap('Space'); log('SPRAY cam 1');
await until((d) => d.seq.some((s) => s.startsWith('cam_spray')), 4000, 30);
await until((d) => d.seq.includes('cam_spray_hold'), 4000, 30); await sleep(900); await shot('05_cam_spray');
await until((d) => d.cams[0].state !== 'scan' && d.mode === 'relaxed', 15000);
await sleep(600); await shot('06_cam_painted'); log('cam 1 done', JSON.stringify((await D()).cans));

// ---- drone wave A (2 drones): spray one, kick the other
await walkTo(2420); await sleep(300);
await until((d) => d.drones.length >= 1, 8000);
await sleep(1800); await shot('07_drones_arrive');
// kick/punch one drone out of the sky first (PUNCH plays kick_b)
for (let i = 0; i < 12; i++) {
  const d = await D();
  if (d.stats.dronesCrashed >= 1) break;
  await tap(i % 2 ? 'KeyK' : 'KeyJ', 80); await sleep(700);
  if (i === 1) await shot('07b_kick_drone');
}
await sleep(500); await shot('11_drone_crash'); log('melee', JSON.stringify((await D()).stats), JSON.stringify((await D()).drones));
await until((d) => d.mode === 'guard' || d.mode === 'relaxed', 6000);
await tap('Space'); log('SPRAY drones (forward)');
await until((d) => d.seq.includes('fwd_spray_hold'), 4000, 30); await sleep(700); await shot('08_drone_spray');
await until((d) => d.stats.dronesPainted >= 1 || d.mode === 'relaxed', 8000);
await sleep(1500); await shot('09_drone_confused'); log('drone painted', JSON.stringify((await D()).stats));
await until((d) => d.mode === 'relaxed', 8000);
await sleep(2500);

// ---- wall 2 + cam 2
await walkTo(2950); await sleep(500);
await until((d) => d.mode === 'guard' || d.mode === 'relaxed', 8000);
await sleep(1200);
await tap('Space'); log('SPRAY wall 2');
await until((d) => d.walls[1].done && d.mode === 'relaxed', 20000);
await sleep(500); await shot('12_tag2_done'); log('tag 2 done', JSON.stringify((await D()).cans));
await walkTo(3490); await sleep(400);
await tap('Space'); log('SPRAY cam 2');
await until((d) => d.cams[1].state !== 'scan' && d.mode === 'relaxed', 15000); await sleep(300);

// ---- drone wave B (3 drones)
await walkTo(4320); await sleep(300);
await until((d) => d.drones.filter((x) => x.state === 'hover').length >= 2, 8000);
await sleep(900); await shot('13_wave_b');
for (let i = 0; i < 12; i++) {   // punch/kick the first drone down, then spray the rest
  const d = await D();
  if (d.stats.dronesCrashed >= 2) break;
  await tap(i % 2 ? 'KeyK' : 'KeyJ', 80); await sleep(700);
}
await sleep(400); await until((d) => d.mode === 'guard' || d.mode === 'relaxed', 6000);
await tap('Space'); log('SPRAY wave B');
await until((d) => d.stats.dronesPainted >= 3 || (d.mode === 'relaxed' && d.seq.length === 0), 8000);
await sleep(1800); await shot('13b_wave_b_painted'); log('wave B', JSON.stringify((await D()).stats));

// ---- cam 3, then on to the CYLOBOT
await walkTo(4890); await sleep(400);
await until((d) => d.mode === 'relaxed' || d.mode === 'guard', 8000); await sleep(1500);
await tap('Space'); log('SPRAY cam 3');
await until((d) => d.cams[2].state !== 'scan' && d.mode === 'relaxed', 15000); await sleep(300);
await p.evaluate(() => __gg.mock.dbgRefill());   // test helper: the street run spends almost every can; refill so the fight has some to spray
await p.keyboard.down('ArrowRight');
await until((d) => d.boss, 40000, 60);
await p.keyboard.up('ArrowRight'); log('boss triggered');
await sleep(3000); await shot('14_cylobot_warning');
await sleep(2500); await shot('15_cylobot_banner');
await sleep(4500);
const scenes = await p.evaluate(() => __gg.game.scene.getScenes(true).map((s) => s.scene.key));
log('scenes', scenes);

// ---- in the CYLOBOT fight: the cans from the street are in the HUD; SPRAY (SPACE) freezes him ~1 s on his current frame, leaves paint splats
const FD = () => p.evaluate(() => __gg.fight?.dbg?.() ?? null);
const t0 = Date.now(); let fd = null;
while (Date.now() - t0 < 30000) { fd = await FD(); if (fd && fd.phase === 'fight') break; await sleep(200); }
await p.evaluate(() => __gg.fight.dbgCpu(false));   // test helper: CYLOBOT stands still so the scripted sprays aren't interrupted by his punches
log('fight phase', fd?.phase, 'cans carried over from the street:', JSON.stringify(fd?.spray?.cans));
await shot('16_fight_cans_carried');
async function sprayOnce(tag) {
  await p.keyboard.down('Space'); await sleep(80); await p.keyboard.up('Space');
  const t = Date.now(); let seenStun = false, f1 = null;
  while (Date.now() - t < 9000) {
    const d = await FD();
    if (d && d.spray.stunT > 20 && !seenStun) { seenStun = true; f1 = d.C.fi; await sleep(350); const d2 = await FD(); log(tag, 'STUN: CYLOBOT frame', f1, '->', d2?.C?.fi, '(frozen)', 'stunT', d2?.spray.stunT, 'splats', d2?.spray.splats); await shot(tag); }
    if (d && !d.spray.active && (Date.now() - t) > 700) break;
    await sleep(60);
  }
  return FD();
}
let n = 0;
while (n < 3) {
  n++;
  await p.evaluate(() => __gg.fight.dbgPlace(430, 760));
  const d = await sprayOnce(n === 1 ? '17_cylobot_stunned' : n === 3 ? '18_cylobot_stunned_more_splats' : '17b_stun_' + n);
  log('spray', n, JSON.stringify(d?.spray));
  await sleep(n === 1 ? 2200 : 400);
  if (n === 2) { await shot('17c_splats_accumulate'); }
}
// spend the rest (test helper empties the stock instead of waiting out 7 more sprays), then SPACE again: OUT OF CANS
await p.evaluate(() => { const f = __gg.fight; f.cans.cans.fill(0); });
await p.evaluate(() => __gg.fight.dbgCpu(true)); await sleep(1200);
await sleep(300); await p.keyboard.down('Space'); await sleep(80); await p.keyboard.up('Space'); await sleep(500);
await shot('19_out_of_cans'); log('after out', JSON.stringify((await FD())?.spray));
// back to the street: the remaining cans carry back
await p.evaluate(() => __gg.fight.backToPick()); await sleep(2500);
log('back in street, cans', JSON.stringify((await D())?.cans));
log('errors', errs.join(' | ') || 'none');
await ctx.close(); await b.close();
log('video in', OUT, fs.readdirSync(OUT).join(','));
