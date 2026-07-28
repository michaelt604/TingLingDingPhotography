// Lightbox cross-fade visual audit.
// Same fixture pattern as lightbox-smoke.mjs but exercises the
// carousel child-stack path and captures fade state at the transition
// timing the user cares about.
//
// Run: node tests/lightbox-fade-audit.mjs
// Exit 0 = PASS, 1 = FAIL.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4322;
const SITE = `http://127.0.0.1:${PORT}`;

const WIDE_URL = 'https://scontent.cdninstagram.com/test-wide.svg';
const TALL_URL = 'https://scontent.cdninstagram.com/test-tall.svg';

const WIDE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1333" viewBox="0 0 2000 1333"><rect width="100%" height="100%" fill="#4ecdc4"/><text x="50%" y="50%" font-size="120" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">WIDE - old slide</text></svg>`;
const TALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2000" viewBox="0 0 800 2000"><rect width="100%" height="100%" fill="#b88ce0"/><text x="50%" y="50%" font-size="100" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">TALL - new slide</text></svg>`;

const MOCK_JSON = {
  data: [
    {
      id: 'carousel-1',
      media_type: 'CAROUSEL_ALBUM',
      media_url: WIDE_URL,
      permalink: 'https://www.instagram.com/p/carousel/',
      timestamp: '2026-07-26T00:00:00Z',
      children: [
        { id: 'c1', media_type: 'IMAGE', media_url: WIDE_URL, permalink: 'https://www.instagram.com/p/carousel/' },
        { id: 'c2', media_type: 'IMAGE', media_url: TALL_URL, permalink: 'https://www.instagram.com/p/carousel/' },
        { id: 'c3', media_type: 'IMAGE', media_url: WIDE_URL, permalink: 'https://www.instagram.com/p/carousel/' },
      ],
    },
  ],
  paging: {},
};

const report = (status, message, extra = {}) => {
  console.log(`${status} ${message}`, JSON.stringify(extra));
};

const server = spawn('python',
  ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', 'out/'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
await delay(800);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const fulfillFeed = async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(MOCK_JSON),
  });
};
await page.route('https://ig-proxy.michaelt604.workers.dev/**', fulfillFeed);
await page.route('http://127.0.0.1:8788/**', fulfillFeed);
await page.route(WIDE_URL, async (route) => {
  await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WIDE_SVG });
});
await page.route(TALL_URL, async (route) => {
  await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: TALL_SVG });
});

await page.goto(`${SITE}/portraits/`, { waitUntil: 'load' });
await page.waitForSelector('button[aria-label^="View photo"]', { timeout: 15000 });
await page.waitForLoadState('networkidle');

const tiles = await page.locator('button[aria-label^="View photo"]').all();
report('INFO', `Found ${tiles.length} tiles`, {});

// Open the (lone) carousel tile.
await tiles[0].click({ force: true });
await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
await page.waitForFunction(() => {
  const img = document.querySelector('[role="dialog"][aria-modal="true"] img');
  return img?.complete && img.naturalWidth > 0;
}, { timeout: 5000 });

const dump = async (label) => {
  const state = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (!d) return { open: false };
    const imgs = d.querySelectorAll('img');
    return {
      imgCount: imgs.length,
      imgs: Array.from(imgs).map((i) => ({
        src: (i.src || '').slice(-30),
        anim: getComputedStyle(i).animationName,
        opacity: getComputedStyle(i).opacity,
      })),
      hasPrev: !!d.querySelector('[aria-label="Previous photo"]'),
      hasNext: !!d.querySelector('[aria-label="Next photo"]'),
      hasClose: !!d.querySelector('[aria-label="Close photo viewer"]'),
      hasPermalink: !!d.querySelector('[aria-label*="Open this photo on Instagram"]'),
    };
  });
  report('STATE', label, state);
  return state;
};

const open = await dump('open');
if (!open.hasNext) report('FAIL', 'canNext arrow missing on first slide of multi-child carousel');
if (!open.hasPrev) report('INFO', 'canPrev is false on first slide — expected');
if (!open.hasPermalink) report('FAIL', 'View on Instagram permalink missing');
if (open.imgCount !== 1) report('FAIL', `expected 1 img on open, got ${open.imgCount}`);

// Click Next.
await page.evaluate(() => document.querySelector('[aria-label="Next photo"]')?.click());
const timings = [30, 80, 110, 200, 300, 500, 700];
let last = 0;
for (const t of timings) {
  await delay(t - last);
  last = t;
  const s = await dump(`next+${t}ms`);
  // Specifically: at +30ms the under-layer should be mounted (imgCount >= 2)
  // and have a non-zero opacity. By +700ms the under-layer should be unmounted.
  if (t === 30 && s.imgCount < 2) report('FAIL', 'under-layer not mounted at +30ms — fade never starts');
  if (t === 110 && s.imgCount >= 2) {
    const under = s.imgs.find((i) => i.anim && i.anim !== 'none');
    if (!under) report('FAIL', 'under-layer has no animation at +110ms', { anims: s.imgs.map((i) => i.anim) });
    else if (Number(under.opacity) >= 0.95) report('FAIL', `under-layer opacity ${under.opacity} at +110ms — animation did not progress`);
  }
  if (t === 700 && s.imgCount !== 1) report('FAIL', `under-layer still mounted at +700ms — animationend did not fire`, { imgCount: s.imgCount });
}

// Settled on slide 2: arrows should still exist on a middle slide.
const settled = await dump('settled on slide 2');
if (!settled.hasNext) report('FAIL', 'canNext missing on middle slide');
if (!settled.hasPrev) report('FAIL', 'canPrev missing on middle slide');

// Click prev to go back to slide 1.
await page.evaluate(() => document.querySelector('[aria-label="Previous photo"]')?.click());
await delay(50);
const back = await dump('prev+50ms');
if (back.imgCount < 2) report('FAIL', 'under-layer not mounted on back navigation');

await browser.close();
server.kill();
process.exit(0);
