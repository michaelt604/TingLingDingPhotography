// Lightbox viewport-constraint smoke test.
// - Mocks the IG proxy JSON with controlled fixture URLs (must be https
//   on cdninstagram.com to pass normalizeInstagramPosts).
// - Intercepts the fixture URLs and responds with SVG bitmaps of known
//   dimensions so the lightbox has a deterministic aspect ratio to fit.
// - Drives Playwright at 1440x900 (desktop) and 375x812 (mobile).
// - Asserts the rendered <img> stays inside the viewport, the wrap's
//   bounds match the image's bounds, backdrop click closes, ArrowRight
//   advances the carousel, Escape closes.
//
// Run: node tests/lightbox-smoke.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';

const PORT = 4321;
const SITE = `http://127.0.0.1:${PORT}`;

const WIDE_URL = 'https://scontent.cdninstagram.com/test-wide.svg';   // 2000x1333 (3:2)
const TALL_URL = 'https://scontent.cdninstagram.com/test-tall.svg';   // 800x2000 (2:5)

const WIDE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1333" viewBox="0 0 2000 1333"><rect width="100%" height="100%" fill="#4ecdc4"/><text x="50%" y="50%" font-size="120" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">3:2 landscape 2000x1333</text></svg>`;
const TALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="2000" viewBox="0 0 800 2000"><rect width="100%" height="100%" fill="#b88ce0"/><text x="50%" y="50%" font-size="100" fill="white" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">2:5 portrait 800x2000</text></svg>`;

const MOCK_JSON = {
  data: [
    {
      id: 'wide-1',
      media_type: 'IMAGE',
      media_url: WIDE_URL,
      permalink: 'https://www.instagram.com/p/wide/',
      timestamp: '2026-07-26T00:00:00Z',
    },
    {
      id: 'tall-1',
      media_type: 'CAROUSEL_ALBUM',
      media_url: WIDE_URL,
      permalink: 'https://www.instagram.com/p/tall/',
      timestamp: '2026-07-26T00:00:00Z',
      children: [
        { id: 'tall-c1', media_type: 'IMAGE', media_url: TALL_URL, permalink: 'https://www.instagram.com/p/tall/' },
        { id: 'tall-c2', media_type: 'IMAGE', media_url: WIDE_URL, permalink: 'https://www.instagram.com/p/tall/' },
        { id: 'tall-c3', media_type: 'IMAGE', media_url: TALL_URL, permalink: 'https://www.instagram.com/p/tall/' },
      ],
    },
  ],
  paging: {},
};

const server = spawn('python',
  ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', 'out/'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

await delay(800);

const browser = await chromium.launch();
const results = [];
let failed = false;

async function runViewport(label, vw, vh) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const page = await ctx.newPage();

  await page.route('https://ig-proxy.michaelt604.workers.dev/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify(MOCK_JSON),
    });
  });
  await page.route(WIDE_URL, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: WIDE_SVG });
  });
  await page.route(TALL_URL, async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: TALL_SVG });
  });

  await page.goto(`${SITE}/portraits/`, { waitUntil: 'load' });
  await page.waitForSelector('button[aria-label^="View photo"]', { timeout: 15000 });
  await page.waitForLoadState('networkidle');

  const tileCount = await page.evaluate(() => document.querySelectorAll('button[aria-label^="View photo"]').length);
  console.log(`[${label}] viewport ${vw}x${vh} — tiles: ${tileCount}`);
  assert.equal(tileCount, 2, `expected 2 tiles (1 IMAGE + 1 CAROUSEL), got ${tileCount}`);

  for (const [tileIdx, label2] of [[0, 'wide'], [1, 'tall']]) {
    const tiles = await page.$$('button[aria-label^="View photo"]');
    await tiles[tileIdx].click({ force: true });
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { timeout: 5000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('[role="dialog"][aria-modal="true"] img');
      return img?.complete && img.naturalWidth > 0;
    }, { timeout: 5000 });

    const box = await page.evaluate(() => {
      const img = document.querySelector('[role="dialog"][aria-modal="true"] img');
      const wrap = img?.parentElement;
      const v = { w: window.innerWidth, h: window.innerHeight };
      const r = img.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      return {
        viewport: v,
        imgBox: { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom },
        wrapBox: { x: wr.x, y: wr.y, w: wr.width, h: wr.height, right: wr.right, bottom: wr.bottom },
        imgNatural: { w: img.naturalWidth, h: img.naturalHeight },
      };
    });
    const { viewport, imgBox, wrapBox, imgNatural } = box;

    const insideViewport =
      imgBox.x >= 0 &&
      imgBox.y >= 0 &&
      imgBox.right <= viewport.w &&
      imgBox.bottom <= viewport.h;

    const wrapMatchesImage =
      Math.abs(wrapBox.x - imgBox.x) < 1 &&
      Math.abs(wrapBox.y - imgBox.y) < 1 &&
      Math.abs(wrapBox.w - imgBox.w) < 1 &&
      Math.abs(wrapBox.h - imgBox.h) < 1;

    const record = {
      label, tile: label2,
      viewport, imgBox, wrapBox, imgNatural,
      insideViewport, wrapMatchesImage,
    };
    results.push(record);
    console.log(`[${label} / ${label2}] img=${imgBox.w.toFixed(0)}x${imgBox.h.toFixed(0)} wrap=${wrapBox.w.toFixed(0)}x${wrapBox.h.toFixed(0)} natural=${imgNatural.w}x${imgNatural.h} insideViewport=${insideViewport} wrapMatches=${wrapMatchesImage}`);

    if (!insideViewport) {
      console.error(`FAIL: image overflows viewport at ${label} / ${label2}`);
      failed = true;
    }
    if (!wrapMatchesImage) {
      console.error(`FAIL: wrap does not match image bounds at ${label} / ${label2}`);
      failed = true;
    }

    // Backdrop close: click in the very top-left corner where only the
    // .lightbox root sits (no children reach there).
    await page.mouse.click(5, 5);
    await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached', timeout: 3000 })
      .then(() => console.log(`[${label} / ${label2}] backdrop close OK`))
      .catch(() => { console.error(`FAIL: backdrop did not close at ${label} / ${label2}`); failed = true; });
  }

  // Keyboard nav: open the tall carousel, ArrowRight should swap images.
  const tiles = await page.$$('button[aria-label^="View photo"]');
  await tiles[1].click({ force: true });
  await page.waitForSelector('[role="dialog"][aria-modal="true"]');
  await page.waitForFunction(() => {
    const img = document.querySelector('[role="dialog"][aria-modal="true"] img');
    return img?.complete && img.naturalWidth > 0;
  });
  const firstSrc = await page.evaluate(() => document.querySelector('[role="dialog"][aria-modal="true"] img')?.src);
  await page.keyboard.press('ArrowRight');
  await delay(400);
  const secondSrc = await page.evaluate(() => document.querySelector('[role="dialog"][aria-modal="true"] img')?.src);
  if (firstSrc === secondSrc) {
    console.error(`FAIL: ArrowRight did not advance the carousel at ${label}`);
    failed = true;
  } else {
    console.log(`[${label}] ArrowRight nav OK`);
  }
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"][aria-modal="true"]', { state: 'detached', timeout: 3000 })
    .then(() => console.log(`[${label}] Escape close OK`))
    .catch(() => { console.error(`FAIL: Escape did not close at ${label}`); failed = true; });

  await ctx.close();
}

try {
  await runViewport('desktop', 1440, 900);
  await runViewport('mobile', 375, 812);
} finally {
  await browser.close();
  server.kill();
}

console.log('\n=== RESULTS ===');
for (const r of results) {
  const ok = r.insideViewport && r.wrapMatchesImage ? 'PASS' : 'FAIL';
  console.log(`${ok} ${r.label.padEnd(8)} ${r.tile.padEnd(6)} img=${r.imgBox.w.toFixed(0)}x${r.imgBox.h.toFixed(0)} (vp ${r.viewport.w}x${r.viewport.h})`);
}

if (failed) {
  console.error('\nSMOKE TEST FAILED');
  process.exit(1);
}
console.log('\nSMOKE TEST PASSED');
