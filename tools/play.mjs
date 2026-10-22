// Headless play-through: drives the real build with keyboard + test hooks and saves screenshots.
// usage: node tools/play.mjs [baseUrl] [--video]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (process.env.BASE || 'http://localhost:4173/');
const video = process.argv.includes('--video');
fs.mkdirSync('shots', { recursive: true });
const b = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) console.log('[console]', m.text()); });
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => { await p.screenshot({ path: `shots/${n}.png` }); console.log('saved', n); };
const until = async (fn, arg, ms = 8000) => { await p.waitForFunction(fn, arg, { timeout: ms, polling: 16 }); };

await p.goto(base + '?seed=11');
await until(() => window.__gg?.select, null, 20000);
if (video) {
  // record the game canvas itself (lossless-ish VP9) instead of a screen grab
  await p.evaluate(() => {
    const c = __gg.game.canvas;
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 16_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(500);
    __gg.rec = rec; __gg.chunks = chunks;
  });
}
await wait(1500);
if (!video) await shot('01_select_fade');
await p.keyboard.press('ArrowRight');
await wait(70);
if (!video) await shot('02b_select_swipe_mid');
await wait(800);
if (!video) await shot('02_select_seek');
await p.keyboard.press('Enter'); // locked -> shake
await wait(80);
if (!video) await shot('02c_select_seek_locked_shake');
await wait(500);
await p.keyboard.press('ArrowLeft');
await wait(700);
await p.keyboard.press('Enter');
await until(() => window.__gg?.level?.scene?.isActive(), null, 10000);

// autopilot: steer toward the middle of the open corridor ~120-260 px ahead, keep left third
await p.evaluate(() => {
  const L = window.__gg.level;
  window.__gg.mode = 'avoid';
  L.autopilot = (s) => {
    const ax0 = s.px + 60, ax1 = s.px + 320;
    let top = 6, bot = s.groundMin(ax0, ax1) - 4;
    for (const o of s.obstacles) {
      if (o.kind !== 'solid' || o.x > ax1 || o.x + o.w < ax0) continue;
      if (o.overhang) top = Math.max(top, o.y + o.h); else bot = Math.min(bot, o.y);
    }
    let target = (top + bot) / 2 - 46;
    if (window.__gg.mode === 'hunt') {
      const e = s.enemies.find((e) => !e.dead && e.rx > s.sx + 40);
      if (e) target = Math.min(Math.max(e.y + e.h / 2 - 48, top - 20), bot - 70);
    }
    const iy = Math.max(-1, Math.min(1, (target - s.py) / 18));
    const ix = Math.max(-1, Math.min(1, ((window.__gg.mode === 'hunt' ? 150 : 70) - s.sx) / 40));
    return { ix, iy };
  };
});
await wait(3500);
if (!video) await shot('03_gameplay_flying');

const L = (fn, arg) => p.evaluate(fn, arg);
if (!video) {
  // ---- breakable smash: billboard on the deck right ahead, car pulled down to its height
  await L(() => { const s = __gg.level; s.invuln = 99; s.noSpawn = true; s.enemies.forEach(e=>{e.spr.destroy();}); s.enemies=[];
    s.obstacles.filter(o=>o.x > s.px - 50).forEach(o=>o.img.destroy()); s.obstacles = s.obstacles.filter(o=>o.x <= s.px - 50);
    __gg.mode = 'manual'; s.autopilot = () => ({ ix: 0.4, iy: 0 }); s.py = 150; s.vy = 0;
    s.addBreakableOnGround(Math.round(s.px) + 230, 'brk_billboard'); __gg.b0 = s.stats.broken; });
  await until(() => __gg.level.stats.broken > __gg.b0);
  await wait(230);
  console.log('dbg', JSON.stringify(await L(() => { const s = __gg.level; return { px: Math.round(s.px), obs: s.obstacles.map(o => [o.name, o.x, o.y, o.broken]), spr: s.children.list.filter(c => c.texture && c.type==='Image' && !String(c.texture.key).startsWith('car')).map(c => [c.texture.key, c.x, c.y, c.visible]) }; })));
  await shot('04_smash_breakable');
  await wait(900);
  // ---- drone ram
  await L(() => { const s = __gg.level; s.invuln = 0; const e = s.spawnEnemy('drone', 'weave', s.sx + 330, s.py + 30); e.baseY = s.py + 32; e.t = 0; __gg.s0 = s.stats.smashed; s.autopilot = () => ({ ix: 0.8, iy: 0 }); });
  await until(() => __gg.level.stats.smashed > __gg.s0);
  await wait(200);
  await shot('05_ram_drone');
  await wait(1200);
  // ---- hover car ram + natural damage
  await L(() => { const s = __gg.level; s.invuln = 0; s.autopilot = () => ({ ix: 0, iy: 0 }); s.spawnEnemy('hover_white', 'ram', 600, s.py + 30); __gg.s0 = s.stats.smashed; });
  await until(() => __gg.level.stats.smashed > __gg.s0, null, 10000);
  await wait(260);
  await shot('05b_ram_hover_car');
  await wait(1400);
  // ---- mixed damage (debug HUD on)
  await L(() => { const s = __gg.level; s.setDamage([1, 2, 3]); s.invuln = 0; s.py = 120; });
  await wait(400);
  await shot('06_mixed_damage');
  const cp = await L(() => ({ x: __gg.level.car.x - __gg.level.scroll, y: __gg.level.car.y }));
  await p.screenshot({ path: 'shots/06b_mixed_damage_closeup.png', clip: { x: Math.max(0, Math.round(cp.x * 2) - 40), y: Math.max(0, Math.round(cp.y * 2) - 20), width: 560, height: 300 } });
  await L(() => { const s = __gg.level; s.debug = true; s.hud.setDebug(true); });
  await wait(300);
  await shot('06c_mixed_damage_debug_hud');
  await L(() => { const s = __gg.level; s.debug = false; s.hud.setDebug(false); });
  // ---- totaled: last front hit on a nearly wrecked car
  await L(() => { const s = __gg.level; s.setDamage([3, 3, 2]); s.invuln = 0; s.spawnEnemy('hover_black', 'lane', s.sx + 260, s.py + 30); s.autopilot = () => ({ ix: 0.6, iy: 0 }); });
  await until(() => __gg.level.state === 'totaled', null, 10000);
  await wait(250);
  await shot('07a_totaled_explosion');
  await wait(2000);
  await shot('07_totaled');
  // ---- restart works
  await p.keyboard.press('r');
  await wait(1200);
  const st = await L(() => ({ state: __gg.level.state, levels: __gg.level.levels }));
  console.log('after R', JSON.stringify(st));
} else {
  // ---- clip: let it play naturally, alternate dodge / hunt modes
  for (let i = 0; i < 4; i++) {
    await L((m) => { __gg.mode = m; }, i % 2 ? 'avoid' : 'hunt');
    await wait(4000);
  }
  await L(() => { const s = __gg.level; s.setDamage([3, 3, 2]); s.invuln = 0; s.spawnEnemy('hover_black', 'lane', s.sx + 280, s.py + 30); s.autopilot = () => ({ ix: 0.6, iy: 0 }); });
  await until(() => __gg.level.state === 'totaled', null, 10000);
  await wait(3200);
  const b64 = await p.evaluate(async () => {
    await new Promise((r) => { __gg.rec.onstop = r; __gg.rec.stop(); });
    const blob = new Blob(__gg.chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  fs.writeFileSync('shots/gameplay.webm', Buffer.from(b64, 'base64'));
  console.log('webm bytes', Buffer.from(b64, 'base64').length);
}
const stats = await L(() => ({ stats: __gg.level.stats, levels: __gg.level.levels, dist: Math.floor(__gg.level.scroll / 8), fps: Math.round(__gg.game.loop.actualFps) }));
console.log('stats', JSON.stringify(stats), 'errors', errors.length);
await ctx.close();
await b.close();
