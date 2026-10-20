// Passability soak: avoid-only autopilot, no enemies, counts solid crashes over N seconds.
import { chromium } from 'playwright-core';
const secs = Number(process.argv[2] || 40);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
for (const seed of [3, 42]) {
  await p.goto(`http://localhost:4173/?scene=level&noenemies=1&seed=${seed}`);
  await p.waitForFunction(() => window.__gg?.level?.carPts?.length, null, { timeout: 20000 });
  await p.evaluate(() => {
    const L = __gg.level; L.invuln = 0;
    L.autopilot = (s) => {
      const ax0 = s.px + 40, ax1 = s.px + 330;
      let top = 6, bot = s.groundMin(ax0, ax1) - 4;
      for (const o of s.obstacles) { if (o.kind !== 'solid' || o.x > ax1 || o.x + o.w < ax0) continue; if (o.overhang) top = Math.max(top, o.y + o.h); else bot = Math.min(bot, o.y); }
      const target = (top + bot) / 2 - 46;
      return { ix: Math.max(-1, Math.min(1, (70 - s.sx) / 40)), iy: Math.max(-1, Math.min(1, (target - s.py) / 18)) };
    };
    __gg.minGap = 1e9;
    setInterval(() => { const s = __gg.level; for (let x = s.px; x < s.px + 640; x += 8) { let top = 0, bot = s.groundTopAt(x); for (const o of s.obstacles) { if (o.kind !== 'solid' || o.x > x || o.x + o.w < x) continue; if (o.overhang) top = Math.max(top, o.y + o.h); else bot = Math.min(bot, o.y); } __gg.minGap = Math.min(__gg.minGap, bot - top); } }, 250);
  });
  await p.waitForTimeout(secs * 1000);
  console.log('seed', seed, JSON.stringify(await p.evaluate(() => ({ hits: __gg.level.stats.hits, levels: __gg.level.levels, dist: Math.floor(__gg.level.scroll / 8), state: __gg.level.state, minGap: Math.round(__gg.minGap), fps: Math.round(__gg.game.loop.actualFps) }))));
}
await b.close();
