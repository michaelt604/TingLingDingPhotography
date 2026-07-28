// Grid-tile cross-fade visual audit.
// Sibling to tests/lightbox-fade-audit.mjs. Same fixture pattern but
// drives the TILE carousel arrows (not the lightbox arrows). Asserts:
//   - The first paint of a carousel tile has NO .tileUnder under-layer.
//   - Clicking the tile's Next arrow mounts the under-layer within ~30ms
//     with the prior src, fading via the tileUnderFade keyframes.
//   - The under-layer unmounts within ~700ms via animationend.
//   - The live <Image> on the tile carries the new src throughout.
//   - Back navigation re-mounts the under-layer (the fade must round-trip).
//
// Run: node tests/grid-fade-audit.mjs
// Exit 0 = PASS, 1 = FAIL.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4323;
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

let failed = false;
const fail = (msg, extra) => { failed = true; report('FAIL', msg, extra); };

const server = spawn('python',
  ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', 'out/'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
await delay(800);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

await page.route('https://ig-proxy.michaelt604.workers.dev/**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
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

// Grid tile under-layer inspection. The tile is the .tile ancestor of
// the trigger button. Inside .tile we look for any img (live next/image
// or the under-layer <img>) and any .tileUnder specifically.
const dumpTile = async (label) => {
  const state = await page.evaluate(() => {
    const trigger = document.querySelector('button[aria-label^="View photo"]');
    if (!trigger) return { found: false };
    const tile = trigger.closest('div');
    const liveImg = tile.querySelector('button > img, button picture img');
    const under = tile.querySelector('img.tileUnder, img[class*="tileUnder"]');
    return {
      found: true,
      hasLiveImg: !!liveImg,
      liveSrc: liveImg ? (liveImg.src || '').slice(-40) : null,
      underPresent: !!under,
      underSrc: under ? (under.src || '').slice(-40) : null,
      underAnim: under ? getComputedStyle(under).animationName : null,
      underOpacity: under ? Number(getComputedStyle(under).opacity) : null,
    };
  });
  report('STATE', label, state);
  return state;
};

const open = await dumpTile('first paint');
if (!open.found) fail('no tile button found');
if (!open.hasLiveImg) fail('live tile image missing');
if (open.liveSrc && !open.liveSrc.includes('test-wide.svg')) fail(`live image should be slide 1 (WIDE), got ${open.liveSrc}`);
if (open.underPresent) fail('under-layer should NOT be present on first paint');

// Click the TILE carousel Next arrow. Note: the tile arrow's aria-label
// is "Next photo (N of M)" — different from the lightbox's bare "Next photo".
await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label^="Next photo ("]');
  btn?.click();
});

const timings = [30, 80, 110, 200, 300, 500, 700];
let last = 0;
for (const t of timings) {
  await delay(t - last);
  last = t;
  const s = await dumpTile(`next+${t}ms`);
  if (t === 30 && !s.underPresent) fail(`under-layer not mounted at +${t}ms — fade never starts`);
  if (t === 110 && s.underPresent) {
    if (!s.underAnim || !s.underAnim.includes('tileUnderFade')) {
      fail(`under-layer has wrong animation at +110ms: ${s.underAnim}`);
    }
    if (s.underOpacity >= 0.95) fail(`under-layer opacity ${s.underOpacity} at +110ms — animation did not progress`);
    if (!s.underSrc || !s.underSrc.includes('test-wide.svg')) {
      fail(`under-layer should carry prior (WIDE) src, got ${s.underSrc}`);
    }
  }
  if (t === 700 && s.underPresent) fail(`under-layer still mounted at +700ms — animationend did not fire`);
  if (s.hasLiveImg && s.liveSrc && !s.liveSrc.includes('test-tall.svg')) {
    fail(`live image should be slide 2 (TALL) after Next, got ${s.liveSrc}`);
  }
}

// Round-trip: click Prev on the tile, expect under-layer to mount again.
await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label^="Previous photo ("]');
  btn?.click();
});
await delay(50);
const back = await dumpTile('prev+50ms');
if (!back.underPresent) fail('under-layer not mounted on back navigation');
if (back.underSrc && !back.underSrc.includes('test-tall.svg')) {
  fail(`under-layer on back nav should carry prior (TALL) src, got ${back.underSrc}`);
}

await browser.close();
server.kill();

if (failed) {
  console.log('\nGRID FADE AUDIT FAILED');
  process.exit(1);
}
console.log('\nGRID FADE AUDIT PASSED');
process.exit(0);
