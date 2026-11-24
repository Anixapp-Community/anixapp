import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const hub = JSON.parse(readFileSync('.tmp-previews/hub.json', 'utf8'));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, locale: 'ru-RU' });
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
const boxes = await page.evaluate(() => {
  const out = {};
  const tile = document.querySelector('.uiv2-collection-new');
  const card = document.querySelector('.collections-hub__rail-item--small .uiv2-collection');
  out.tile = tile ? Object.fromEntries(['width', 'height', 'top', 'bottom'].map((k) => [k, Math.round(tile.getBoundingClientRect()[k])])) : null;
  out.tileMedia = tile?.querySelector('.uiv2-collection-new__media') ? Object.fromEntries(['width', 'height', 'top', 'bottom'].map((k) => [k, Math.round(tile.querySelector('.uiv2-collection-new__media').getBoundingClientRect()[k])])) : null;
  out.card = card ? Object.fromEntries(['width', 'height', 'top', 'bottom'].map((k) => [k, Math.round(card.getBoundingClientRect()[k])])) : null;
  out.cardMedia = card?.querySelector('.uiv2-collection__media') ? Object.fromEntries(['width', 'height', 'top', 'bottom'].map((k) => [k, Math.round(card.querySelector('.uiv2-collection__media').getBoundingClientRect()[k])])) : null;
  out.cardTitle = card?.querySelector('.uiv2-collection__caption-title') ? Math.round(card.querySelector('.uiv2-collection__caption-title').getBoundingClientRect().top) : null;
  out.tileTitle = tile?.querySelector('.uiv2-collection__caption-title') ? Math.round(tile.querySelector('.uiv2-collection__caption-title').getBoundingClientRect().top) : null;
  return out;
});
console.log(JSON.stringify(boxes, null, 2));
await browser.close();
