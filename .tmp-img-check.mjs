import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const hub = JSON.parse(readFileSync('.tmp-previews/hub.json', 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'ru-RU' });
const page = await context.newPage();
await page.route('**/__anix/invoke', async (route) => {
  let body = {};
  try { body = JSON.parse(route.request().postData() ?? '{}'); } catch { /* ignore */ }
  if (body?.channel === 'anix:collectionHub') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: hub }) });
    return;
  }
  await route.continue();
});
await page.goto('http://127.0.0.1:5192/collections', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.evaluate(() => document.querySelector('.support-promo')?.remove());
await page.evaluate(() => { const el = document.querySelector('.page__scroll'); if (el) el.scrollTop = 830; });
await page.waitForTimeout(8000);
const stats = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('.collections-hub__grid img')];
  return {
    count: imgs.length,
    loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
    failed: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    srcs: imgs.slice(0, 3).map((i) => i.getAttribute('src')),
  };
});
console.log(JSON.stringify(stats, null, 2));
await page.screenshot({ path: '.tmp-previews/mobile-grid.png' });
await browser.close();
