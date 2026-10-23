import { chromium } from 'playwright-core';
const BASE = process.env.BASE || 'http://localhost:4174/';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errs = [];
async function page(q, w = 1280) {
  const p = await b.newPage({ viewport: { width: w, height: 720 } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${q}] ${m.type()} ${m.text()}`); });
  p.on('pageerror', (e) => errs.push(`[${q}] pageerror ${e.message}`));
  await p.goto(BASE + q);
  return p;
}
const shot = (p, n) => p.screenshot({ path: `shots/${n}.png` });
const ev = (p, f) => p.evaluate(f);

let p = await page('');
await p.waitForTimeout(5000);
console.log('menu scenes', await ev(p, () => __gg.game.scene.getScenes(true).map((s) => s.scene.key)));
await shot(p, 'fight_01_menu');
await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
await p.waitForTimeout(2500);
console.log('menu->', await ev(p, () => [__gg.game.scene.getScenes(true).map((s) => s.scene.key), __gg.select?.mode]));
await p.close();

p = await page('?fight=1');
await p.waitForTimeout(5000);
await shot(p, 'fight_02_pick_fade');
await p.keyboard.press('ArrowRight'); await p.waitForTimeout(1500);
await shot(p, 'fight_03_pick_seek');
await p.keyboard.press('Enter'); await p.waitForTimeout(9000);
console.log('pick->', await ev(p, () => [__gg.game.scene.getScenes(true).map((s) => s.scene.key), __gg.fight?.dbg()]));
await shot(p, 'fight_04_seek_from_pick');
await p.close();

for (const f of ['fade', 'seek']) {
  p = await page(`?scene=fight&fighter=${f}&bag=front`);
  await p.waitForTimeout(8000);
  await shot(p, `fight_05_${f}_intro`);
  await p.waitForTimeout(2500);
  // walk in and attack
  await p.keyboard.down('ArrowRight'); await p.waitForTimeout(900); await p.keyboard.up('ArrowRight');
  for (let i = 0; i < 4; i++) { await p.keyboard.press('j'); await p.waitForTimeout(160); }
  await shot(p, `fight_06_${f}_jab`);
  await p.keyboard.press('k'); await p.waitForTimeout(250);
  await shot(p, `fight_07_${f}_kick`);
  await p.keyboard.down('ArrowDown'); await p.waitForTimeout(700); await shot(p, `fight_08_${f}_crouch`); await p.keyboard.up('ArrowDown');
  await p.keyboard.down('l'); await p.waitForTimeout(700); await shot(p, `fight_09_${f}_block`); await p.keyboard.up('l');
  await p.waitForTimeout(4000);
  console.log(f, 'mid', JSON.stringify(await ev(p, () => __gg.fight.dbg())));
  await shot(p, `fight_10_${f}_cpu`);
  await ev(p, () => __gg.fight.dbgHit('c', 200));
  await p.waitForTimeout(700); await shot(p, `fight_11_${f}_ko_hit`);
  await p.waitForTimeout(1800); await shot(p, `fight_12_${f}_ko`);
  await p.waitForTimeout(3500);
  console.log(f, 'r2', JSON.stringify(await ev(p, () => __gg.fight.dbg())));
  await p.waitForTimeout(2500);
  await ev(p, () => __gg.fight.dbgHit('c', 200));
  await p.waitForTimeout(6000);
  console.log(f, 'over', JSON.stringify(await ev(p, () => __gg.fight.dbg())));
  await shot(p, `fight_13_${f}_win`);
  await p.keyboard.press('r'); await p.waitForTimeout(1500);
  console.log(f, 'rematch', JSON.stringify(await ev(p, () => __gg.fight.dbg().round)));
  await p.keyboard.press('Escape'); await p.waitForTimeout(2500);
  console.log(f, 'esc->', await ev(p, () => [__gg.game.scene.getScenes(true).map((s) => s.scene.key), __gg.select?.mode]));
  await p.close();
}

// cpu wins + touch/lite on a phone-ish wide viewport
p = await page('?scene=fight&fighter=fade&touch=1&lite=1', 1560);
await p.waitForTimeout(9000);
await shot(p, 'fight_14_touch_lite');
for (let i = 0; i < 2; i++) { await ev(p, () => __gg.fight.dbgHit('p', 200)); await p.waitForTimeout(8000); }
console.log('lite', JSON.stringify(await ev(p, () => __gg.fight.dbg())));
await shot(p, 'fight_15_cpu_wins');
await p.close();

p = await page('?scene=select');
await p.waitForTimeout(5000); await shot(p, 'fight_16_drive_select');
await p.keyboard.press('Enter'); await p.waitForTimeout(6000);
console.log('drive->', await ev(p, () => __gg.game.scene.getScenes(true).map((s) => s.scene.key)));
await p.keyboard.down('ArrowRight'); await p.waitForTimeout(2500); await p.keyboard.up('ArrowRight');
await shot(p, 'fight_17_drive_level');
await p.close();

console.log('ERRORS', errs.length); for (const e of errs.slice(0, 30)) console.log(e);
await b.close();
