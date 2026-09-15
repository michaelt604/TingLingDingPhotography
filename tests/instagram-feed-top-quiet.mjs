// Feed quiet-at-top browser check: while a visitor remains at the top of a
// collection page with the feed outside the prefetch margin, no feed/proxy
// request may fire. Hermetic by construction: it asserts ZERO matching
// requests, so no fixture or interception is needed. Run after `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4332;
const SITE = `http://127.0.0.1:${PORT}`;

const server = spawn('python', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', 'out'], { stdio: 'ignore' });
let serverError;
server.once('error', (error) => { serverError = error; });
let browser;

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverError) throw serverError;
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
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const feedRequests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('ig-proxy') || url.includes('/api/feed') || url.includes('/api/posts')) feedRequests.push(url);
  });
  await page.goto(`${SITE}/underwater/`, { waitUntil: 'networkidle' });
  // Remain at the top with the feed below the prefetch margin.
  await delay(3000);
  assert.deepEqual(feedRequests, [], 'no feed/proxy request while visitor remains at top');
  // Stable anchor + profile link render before loading (R07).
  assert.ok(await page.locator('#instagram, #recent-work').count(), 'feed section anchor renders pre-load');
  console.log('PASS feed stays quiet at top, anchor present pre-load');
} finally {
  await browser?.close();
  server.kill();
}
if (serverError) throw serverError;
