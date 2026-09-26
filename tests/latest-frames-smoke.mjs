// Homepage "Latest frames" strip against a mocked Instagram proxy.
// Run after `npm run build` with: node tests/latest-frames-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4333;
const SITE = `http://127.0.0.1:${PORT}`;
const PROXY = 'https://ig-proxy.michaelt604.workers.dev';

const post = (id, day, extra = {}) => ({
  id,
  media_type: 'IMAGE',
  media_url: `https://scontent.cdninstagram.com/${id}.jpg`,
  permalink: `https://www.instagram.com/p/${id}/`,
  caption: `Frame ${id}\n#tag`,
  timestamp: `2026-09-${String(day).padStart(2, '0')}T12:00:00+0000`,
  ...extra,
});
const feeds = {
  portraits: [post('p1', 20), post('p2', 18), post('broken', 17)],
  underwater: [post('u1', 19), post('v1', 16, { media_type: 'VIDEO', media_url: 'https://video.fbcdn.net/v1.mp4' })],
};

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', 'out'], { stdio: 'ignore' });
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Static preview server exited: ${server.exitCode}`);
    const ready = await new Promise((resolve) => {
      const socket = net.connect(PORT, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error(`Static preview server did not become ready at ${SITE}`);
}

try {
  await waitForServer();
  browser = await chromium.launch();

  const context = await browser.newContext({ viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const feedRequests = [];
  await page.route(`${PROXY}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/img') {
      if (url.searchParams.get('u')?.includes('broken')) return route.abort();
      return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800"><rect width="640" height="800" fill="#345"/></svg>' });
    }
    feedRequests.push(url.pathname);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: feeds[url.pathname.slice(1)] ?? [] }) });
  });

  await page.goto(SITE, { waitUntil: 'networkidle' });
  assert.deepEqual(feedRequests, [], 'Feed stays quiet at the top of the homepage');
  await page.locator('#recent').scrollIntoViewIfNeeded();
  const strip = page.locator('[data-latest-frames="ready"]');
  await strip.waitFor();
  assert.deepEqual([...feedRequests].sort(), ['/portraits', '/underwater'], 'Both feeds load once');

  const links = strip.locator('li a');
  // Lazy images load as the track scrolls; the failing one must be reached to be dropped.
  await strip.locator('ul').evaluate((track) => { track.scrollLeft = track.scrollWidth; });
  await page.waitForFunction(() => document.querySelectorAll('[data-latest-frames] li').length === 3);
  assert.deepEqual(
    await links.evaluateAll((items) => items.map((item) => new URL(item.href).pathname)),
    ['/p/p1/', '/p/u1/', '/p/p2/'],
    'Newest stills first; videos without thumbnails and failed images are dropped',
  );
  assert.ok((await strip.locator('img').first().getAttribute('src')).startsWith(`${PROXY}/img?u=`), 'Images use the resizing proxy');
  assert.equal(await strip.locator('img').first().getAttribute('alt'), 'Instagram post, Sep 2026, Frame p1');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page overflow at 320px');
  await context.close();
  console.log('PASS latest frames: deferred load, ordering, fallbacks and proxy images');

  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(SITE);
  assert.equal(await noScriptPage.locator('[data-latest-frames] li').count(), 0, 'No stuck skeleton without JavaScript');
  assert.ok(await noScriptPage.locator('a[href="/portraits/#recent-work"]').isVisible(), 'Feed links remain without JavaScript');
  await noScript.close();
  console.log('PASS latest frames without JavaScript');
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
