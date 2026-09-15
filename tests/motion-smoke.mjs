import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:4328';
const server = spawn('python', ['-m', 'http.server', '4328', '--bind', '127.0.0.1', '--directory', 'out'], { stdio: 'ignore' });
let serverError;
server.once('error', (error) => { serverError = error; });
let browser;
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (serverError) throw serverError;
    if (server.exitCode !== null) throw new Error(`Static preview server exited: ${server.exitCode}`);
    const ready = await new Promise((resolve) => {
      const socket = net.connect(4328, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error(`Static preview server did not become ready at ${origin}`);
}
try {
  await waitForServer();
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    window.__pageMotion = 'none';
    addEventListener('pagereveal', (event) => {
      if (event.viewTransition) event.viewTransition.ready.then(() => { window.__pageMotion = 'ready'; }).catch(() => { window.__pageMotion = 'skipped'; });
    });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const id of ['portraits', 'underwater', 'climbing']) {
    await page.goto(origin, { waitUntil: 'networkidle' });
    const panel = page.locator(`[data-route-image="${id}"]`);
    const frame = panel.locator('..');
    const before = await frame.boundingBox();
    await frame.hover();
    await page.waitForFunction(({id, width}) => document.querySelector(`[data-route-image="${id}"]`).parentElement.getBoundingClientRect().width > width * 1.3, {id, width: before.width});
    await delay(750);
    const after = await frame.boundingBox();
    assert.ok(Math.abs(after.height - before.height) < 1, 'Expanding panels keep a stable height');
    if (id === 'underwater') await page.screenshot({ path: 'preview/redesign/triptych-expanded.png' });
    const src = await panel.getAttribute('src');
    await panel.click();
    await page.waitForURL(`${origin}/${id}/`);
    await page.waitForFunction(() => window.__pageMotion === 'ready');
    // Same-photo continuation: compare stable photo IDs, not URL spellings —
    // the homepage cover src may be root-relative while the gallery img is absolute.
    assert.equal(new URL(await page.locator('[data-curated-gallery] img').first().getAttribute('src'), origin).href, new URL(src, origin).href, 'The same photo continues into its page');
    await page.goBack();
    await page.waitForURL(`${origin}/`);
  }
  await page.goto(`${origin}/climbing/`, { waitUntil: 'networkidle' });
  const reveal = page.locator('[data-curated-gallery] button').nth(2);
  await reveal.evaluate(el => { scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight + 120); });
  await delay(100);
  const entering = await reveal.evaluate(el => getComputedStyle(el).clipPath);
  await reveal.scrollIntoViewIfNeeded();
  await delay(100);
  const settled = await reveal.evaluate(el => getComputedStyle(el).clipPath);
  assert.notEqual(entering, settled, 'Gallery crop changes with scrolling');
  await reveal.focus();
  assert.equal(await reveal.evaluate(el => getComputedStyle(el).animationName), 'none', 'Keyboard focus fully reveals the photograph');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await reveal.evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(errors, []);
  await context.close();
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mobile = await touch.newPage();
  await mobile.goto(origin);
  assert.equal(await mobile.locator('[data-route-image]').first().evaluate(el => getComputedStyle(el).viewTransitionName), 'none', 'Touch uses ordinary navigation');
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await touch.close();
  console.log('PASS expanding panels, three native page transitions and Back, scroll crops, focus and touch/reduced-motion fallbacks');
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
if (serverError) throw serverError;
