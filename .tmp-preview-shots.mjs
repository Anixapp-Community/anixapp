import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

mkdirSync('.tmp-previews', { recursive: true });
const hub = JSON.parse(readFileSync('.tmp-previews/hub.json', 'utf8'));

async function shot({ url, out, width, height, scroll = 0, theme = '', interact }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1.5,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  });
  const page = await context.newPage();
  if (theme) {
    await page.addInitScript((t) => {
      try { localStorage.setItem('anixapp.activeTheme', t); } catch { /* ignore */ }
    }, theme);
  }
  await page.route('**/__anix/invoke', async (route) => {
    let body = {};
    try { body = JSON.parse(route.request().postData() ?? '{}'); } catch { /* ignore */ }
    if (body?.channel === 'anix:collectionHub') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: hub }) });
      return;
    }
    await route.continue();
  });
  // Для превью тянем картинки напрямую (dev-прокси на десятках обложек подвисает)
  await page.route(/\/__cdn\/\?u=/, async (route) => {
    try {
      const target = new URL(route.request().url()).searchParams.get('u');
      if (!target) return route.continue();
      const res = await fetch(target);
      const buf = Buffer.from(await res.arrayBuffer());
      await route.fulfill({
        status: res.status,
        headers: { 'content-type': res.headers.get('content-type') ?? 'image/jpeg' },
        body: buf,
      });
    } catch {
      await route.continue();
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.support-promo')?.remove());
  if (scroll) {
    await page.evaluate((y) => { const el = document.querySelector('.page__scroll'); if (el) el.scrollTop = y; }, scroll);
    await page.waitForTimeout(3500);
  }
  await page.evaluate(() => document.querySelector('.support-promo')?.remove());
  await page.waitForTimeout(300);
  if (interact) await interact(page);
  await page.screenshot({ path: out });
  await browser.close();
  console.log('saved', out);
}

await shot({ url: 'http://127.0.0.1:5192/collections', out: '.tmp-previews/mobile-hub.png', width: 393, height: 852 });
await shot({ url: 'http://127.0.0.1:5192/collections', out: '.tmp-previews/mobile-grid.png', width: 393, height: 852, scroll: 830 });
await shot({ url: 'http://127.0.0.1:5191/collections', out: '.tmp-previews/desktop-hub.png', width: 1440, height: 900 });
await shot({ url: 'http://127.0.0.1:5191/collections', out: '.tmp-previews/desktop-grid.png', width: 1440, height: 900, scroll: 700 });
await shot({
  url: 'http://127.0.0.1:5192/collections',
  out: '.tmp-previews/mobile-sort-sheet.png',
  width: 393,
  height: 852,
  scroll: 120,
  interact: async (page) => {
    await page.locator('.collections-hub__sort').click();
    await page.waitForTimeout(600);
  },
});
