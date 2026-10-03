// Quick screenshots: node scripts/shot.mjs <baseUrl> <outDir> /path1 /path2 ...
// Captures each path at 390px (mobile) and 1440px (desktop), full page.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [base, out, ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [label, width, height] of [['390', 390, 844], ['1440', 1440, 900]]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); } window.scrollTo(0, 0); });
    const name = (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[/?=&]/g, '_')) + `-${label}.png`;
    await page.screenshot({ path: `${out}/${name}`, fullPage: true });
    console.log('saved', `${out}/${name}`);
  }
  await ctx.close();
}
await browser.close();
