// Deterministic curated-gallery browser coverage for the static export.
// Run after `npm run build` with: node tests/curated-gallery-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4326;
const SITE = `http://127.0.0.1:${PORT}`;
const SITE_ORIGIN = new URL(SITE).origin;
const PROXY_HOST = 'ig-proxy.michaelt604.workers.dev';
const PROXY_URL = `https://${PROXY_HOST}`;
// Mirror the deploy.yml production-URL gate: fail fast when the built export
// does not point at the public proxy (never read .env.local here). The URL
// is embedded in the JS chunks, so scan those (skipping source maps).
function assertPublicProxyBuild() {
  const chunks = readdirSync('out/_next/static/chunks', { recursive: true }).filter((file) => String(file).endsWith('.js'));
  assert.ok(chunks.length > 0, 'test-build contains JS chunks to validate');
  const sources = chunks.map((file) => readFileSync(`out/_next/static/chunks/${file}`, 'utf8')).join('\n');
  assert.ok(!sources.includes('http://127.0.0.1'), 'test-build does not pin a localhost proxy override');
  assert.ok(sources.includes(PROXY_URL), 'test-build resolves the public Instagram proxy URL');
}
const ROUTES = [
  { id: 'underwater', title: 'Underwater', mode: 'empty' },
  { id: 'portraits', title: 'Portraits', mode: 'failure' },
  { id: 'climbing', title: 'Climbing', mode: 'none' },
];

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

async function installNetworkPolicy(page, mode) {
  const requests = { proxy: [], instagram: [], external: [] };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === SITE_ORIGIN) {
      await route.continue();
      return;
    }
    if (url.hostname === PROXY_HOST) {
      requests.proxy.push(request.url());
      if (mode === 'failure') {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture failure' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: [], paging: {} }) });
      }
      return;
    }
    requests.external.push(request.url());
    if (/instagram|ig-proxy|embed/i.test(request.url())) requests.instagram.push(request.url());
    // Keep the test hermetic: no real account, image, or embed request can escape.
    await route.abort();
  });
  return requests;
}

async function waitForGallery(page) {
  const gallery = page.locator('[data-curated-gallery]');
  await gallery.waitFor();
  const images = gallery.locator('img');
  for (const image of await images.all()) await image.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-curated-gallery] img')].every((img) => img.complete && img.naturalWidth > 0));
  return gallery;
}

async function assertGallery(page, route, width) {
  const gallery = await waitForGallery(page);
  assert.equal(await page.getByRole('heading', { name: route.title, exact: true, level: 1 }).count(), 1, `${route.title} page heading exists`);
  assert.equal(await page.locator('h1').count(), 1, 'Collection has one page-level heading');
  assert.equal(await gallery.locator('img').count(), 5, `${route.id} has five curated photographs`);
  assert.ok(await gallery.locator('img').evaluateAll((images) => images.every((img) => Boolean(img.alt.trim()))), 'Every photograph has alternative text');
  const images = await gallery.locator('img').evaluateAll((elements) => elements.map((img) => ({
    src: img.currentSrc || img.src,
    width: img.naturalWidth,
    height: img.naturalHeight,
    renderedWidth: img.getBoundingClientRect().width,
    renderedHeight: img.getBoundingClientRect().height,
  })));
  assert.ok(images.every(({ width, height }) => width > 0 && height > 0), `${route.id} has intrinsic dimensions`);
  assert.ok(images.some(({ width, height }) => width < height), `${route.id} includes a portrait image`);
  assert.ok(images.some(({ width, height }) => width > height), `${route.id} includes a landscape image`);
  assert.ok(images.some(({ width, height }) => width === height), `${route.id} includes a square image`);
  for (const image of images) {
    assert.ok(Math.abs(image.width / image.height - image.renderedWidth / image.renderedHeight) < 0.02, `${route.id} preserves image ratio`);
    assert.equal(new URL(image.src, SITE).origin, SITE_ORIGIN, `${route.id} uses local image assets`);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route.id} has no overflow at ${width}px`);
  assert.equal(await gallery.locator('button').count(), 5, `${route.id} has five photograph triggers`);
  for (const [index, button] of (await gallery.locator('button').all()).entries()) {
    const label = await button.getAttribute('aria-label');
    assert.ok(label?.startsWith(`Open photograph ${index + 1} of 5`), `Photograph trigger ${index + 1} keeps N-of-5 ordering (got: ${label})`);
  }
  assert.equal(await page.locator(`a[href="/${route.id}/"][aria-current="page"]`).count(), 1, `${route.id} is active in navigation`);
  assert.ok(await page.locator('button[aria-label="Open contact form"], button').filter({ hasText: 'Get in touch' }).count(), `${route.id} has contact`);
  if (width === 1440) {
    const grid = await gallery.boundingBox();
    const first = await gallery.locator('figure').nth(0).boundingBox();
    const second = await gallery.locator('figure').nth(1).boundingBox();
    if (route.id === 'underwater') assert.ok(first.width >= grid.width - 1 && first.width > first.height, 'Underwater opens with full-width landscape');
    if (route.id === 'portraits') assert.ok(first.width < grid.width * 0.7 && Math.abs(first.x + first.width / 2 - grid.x - grid.width / 2) < 2, 'Portrait opener is centered');
    if (route.id === 'climbing') assert.ok(second.y > first.y + 30 && first.width > second.width, 'Climbing has offset asymmetric opening');
  }
  const jump = page.getByRole('link', { name: 'Latest on Instagram' });
  if (route.id === 'climbing') assert.equal(await jump.count(), 0);
  else {
    await jump.click();
    const header = await page.locator('#recent-work h2').boundingBox();
    const nav = await page.locator('body > header, header').first().boundingBox();
    assert.ok(header && nav && header.y >= nav.y + nav.height, 'Recent work heading clears sticky navigation');
    await page.evaluate(() => scrollTo(0, 0));
  }
  const more = page.getByRole('navigation', { name: 'More photography' });
  assert.deepEqual(await more.locator('a').evaluateAll(links => links.map(link => new URL(link.href).pathname)), ['portraits', 'underwater', 'climbing'].filter(id => id !== route.id).map(id => `/${id}/`));
  return gallery;
}

async function assertViewer(page, gallery, route, width) {
  const trigger = gallery.locator('button').first();
  await trigger.focus();
  await trigger.click();
  const viewer = page.locator('[data-curated-viewer][role="dialog"]');
  await viewer.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close photograph viewer');
  assert.equal(await viewer.getAttribute('aria-label'), `${route.title} photograph viewer`);
  for (const name of ['Close photograph viewer', 'Previous photograph', 'Next photograph']) {
    assert.equal(await viewer.getByRole('button', { name, exact: true }).count(), 1, `${name} control exists`);
  }
  assert.ok(await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const html = getComputedStyle(document.documentElement);
    return body.overflow === 'hidden' || body.position === 'fixed' || html.overflow === 'hidden';
  }), 'Viewer locks background scroll');
  const image = viewer.locator('img').first();
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-curated-viewer] img');
    return Boolean(image?.complete && image.naturalWidth > 0);
  });
  const box = await image.boundingBox();
  assert.ok(box, `Viewer image renders at ${width}px`);
  const viewport = page.viewportSize();
  assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `Viewer image fits at ${width}px`);

  if (width === 390) {
    assert.ok(box.width >= 350, 'Mobile fullscreen photograph uses available width');
    await page.screenshot({ path: `preview/redesign/viewer-${route.id}-${width}.png` });
  }

  const zoomIn = viewer.getByRole('button', { name: 'Zoom in', exact: true });
  await zoomIn.click();
  await viewer.getByRole('button', { name: 'Reset zoom', exact: true }).waitFor();
  if (width === 1440) {
    const beforePan = await image.getAttribute('style');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    assert.notEqual(await image.getAttribute('style'), beforePan, 'Mouse drag pans zoomed image');
  }
  await viewer.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  await zoomIn.waitFor();
  if (width === 1440) {
    await image.dblclick();
    await viewer.getByRole('button', { name: 'Reset zoom', exact: true }).click();
  }

  if (width === 1440) {
    const before = await image.getAttribute('src');
    await page.keyboard.press('+');
    await viewer.getByRole('button', { name: 'Reset zoom', exact: true }).waitFor();
    const panBefore = await image.getAttribute('style');
    await page.keyboard.press('ArrowDown');
    assert.equal(await image.getAttribute('src'), before, 'Keyboard pans without switching a zoomed photo');
    await page.waitForFunction((previous) => document.querySelector('[data-curated-viewer] img').getAttribute('style') !== previous, panBefore);
    await page.keyboard.press('0');
    await viewer.getByRole('button', { name: 'Zoom in', exact: true }).waitFor();
  }
  const firstSrc = await image.getAttribute('src');
  const focusables = viewer.locator('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])');
  const count = await focusables.count();
  await focusables.first().focus();
  for (let index = 0; index <= count; index += 1) {
    await page.keyboard.press('Tab');
    assert.ok(await viewer.evaluate((element) => element.contains(document.activeElement)), 'Tab stays inside the viewer');
  }
  for (let index = 0; index <= count; index += 1) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(await viewer.evaluate((element) => element.contains(document.activeElement)), 'Reverse Tab stays inside viewer');
  }
  await page.keyboard.press('ArrowLeft');
  assert.equal(await image.getAttribute('src'), firstSrc, 'Previous at first photograph stays bounded');

  await viewer.getByRole('button', { name: 'Next photograph', exact: true }).click();
  await page.waitForFunction((previous) => document.querySelector('[data-curated-viewer] img')?.getAttribute('src') !== previous, firstSrc);
  const nextSrc = await image.getAttribute('src');
  assert.notEqual(nextSrc, firstSrc, 'Next photograph advances');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((previous) => document.querySelector('[data-curated-viewer] img')?.getAttribute('src') === previous, firstSrc);
  for (let index = 1; index < 5; index++) {
    const before = await image.getAttribute('src');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((previous) => document.querySelector('[data-curated-viewer] img')?.getAttribute('src') !== previous, before);
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-curated-viewer] img');
      return img?.complete && img.naturalWidth > 0;
    });
    const currentBox = await image.boundingBox();
    assert.ok(currentBox && currentBox.x >= 0 && currentBox.y >= 0 && currentBox.x + currentBox.width <= viewport.width + 1 && currentBox.y + currentBox.height <= viewport.height + 1, 'Every viewer format fits');
    for (const control of await viewer.getByRole('button').all()) {
      const bounds = await control.boundingBox();
      assert.ok(bounds && bounds.width >= 44 && bounds.height >= 44 && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1, 'Viewer controls fit and remain touch sized');
    }
  }
  const lastSrc = await image.getAttribute('src');
  await viewer.getByRole('button', { name: 'Next photograph', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await image.getAttribute('src'), lastSrc, 'Next at last photograph stays bounded');
  await page.keyboard.press('Tab');
  assert.ok(await viewer.evaluate((element) => element.contains(document.activeElement)), 'Boundary navigation retains focus containment');
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'detached' });
  await trigger.click();
  await viewer.waitFor();
  await page.mouse.click(2, 2);
  await viewer.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Open photograph 1 of 5'));
  assert.ok(await trigger.evaluate((element) => document.activeElement === element), 'Viewer restores trigger focus');

  await trigger.click();
  await page.locator('[data-curated-viewer][role="dialog"]').waitFor();
  await page.getByRole('button', { name: 'Close photograph viewer', exact: true }).click();
  await viewer.waitFor({ state: 'detached' });
}

async function assertContact(page, route) {
  const trigger = page.locator('button[aria-label="Open contact form"], button').filter({ hasText: 'Get in touch' }).first();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.ok(await dialog.locator('a[href^="mailto:"]').count(), `${route.id} contact has a mailto handoff`);
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth), 'Contact dialog has no horizontal overflow');
  const email = await dialog.locator('a[href^="mailto:"]').first().boundingBox();
  assert.ok(email && email.x >= 0 && email.x + email.width <= page.viewportSize().width, 'Direct email stays inside viewport');
  if (route.id === 'climbing') {
    assert.equal(await page.locator('a[href*="instagram.com"]').count(), 0, 'Climbing contact stays generic');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
}

try {
  await waitForServer();
  await mkdir('preview/redesign', { recursive: true });
  browser = await chromium.launch();

  for (const route of ROUTES) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const requests = await installNetworkPolicy(page, route.mode);
      await page.goto(`${SITE}/${route.id}/`, { waitUntil: 'networkidle' });
      assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'Reduced-motion preference is active');
      const gallery = await assertGallery(page, route, width);
      await assertViewer(page, gallery, route, width);
      await assertContact(page, route);
      assert.deepEqual(errors, [], `${route.id} has no page errors at ${width}px`);
      if (route.id === 'climbing') {
        assert.deepEqual(requests.instagram, [], 'Climbing makes no Instagram image or embed requests');
        assert.deepEqual(requests.proxy, [], 'Climbing makes no Instagram proxy requests');
      }
      await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
      await page.screenshot({ path: `preview/redesign/collection-${route.id}-${width}.png`, fullPage: true });
      await context.close();
      console.log(`PASS ${route.id} gallery, viewer and contact at ${width}px`);
    }

    for (const width of [320, 768]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await installNetworkPolicy(page, route.mode);
      await page.goto(`${SITE}/${route.id}/`, { waitUntil: 'networkidle' });
      await waitForGallery(page);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route.id} gallery has no overflow at ${width}px`);
      for (const collection of ROUTES) {
        const link = page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: collection.title, exact: true });
        assert.ok(await link.isVisible(), 'All collection links visible');
        const box = await link.boundingBox();
        assert.ok(box && box.height >= 44 && box.width >= 44, 'Navigation touch targets');
      }
      await assertContact(page, route);
      assert.deepEqual(errors, [], 'No narrow/tablet page errors');
      await context.close();
    }
  }

  for (const mode of ['native', 'reduced', 'unsupported']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    await page.addInitScript((mode) => {
      window.__transitionReady = false;
      window.__transitionCalls = 0;
      const native = document.startViewTransition?.bind(document);
      if (mode === 'unsupported') Object.defineProperty(document, 'startViewTransition', { value: undefined });
      else if (native) document.startViewTransition = (update) => {
        window.__transitionCalls++;
        const result = native(update);
        result.ready.then(() => { window.__transitionReady = true; }).catch(() => {});
        return result;
      };
    }, mode);
    await installNetworkPolicy(page, 'none');
    await page.goto(`${SITE}/climbing/`, { waitUntil: 'networkidle' });
    const trigger = page.getByRole('button', { name: /^Open photograph 1 of 5/ });
    await trigger.click();
    const viewer = page.locator('[data-curated-viewer]');
    await viewer.waitFor();
    if (mode === 'native') {
      await page.waitForFunction(() => window.__transitionReady);
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-photo-transition'));
      await viewer.getByRole('button', { name: 'Enter fullscreen', exact: true }).click();
      await page.waitForFunction(() => document.fullscreenElement?.hasAttribute('data-curated-viewer'));
      await viewer.getByRole('button', { name: 'Exit fullscreen', exact: true }).waitFor();
      await page.screenshot({ path: 'preview/redesign/native-fullscreen.png' });
    } else assert.equal(await page.evaluate(() => window.__transitionCalls), 0, 'Motion fallback bypasses transition API');
    await viewer.getByRole('button', { name: 'Close photograph viewer', exact: true }).click();
    await viewer.waitFor({ state: 'detached' });
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Open photograph 1 of 5'));
    if (mode === 'native') {
      // Fullscreen close is instant; a pointer close morphs back into the tile; Escape stays instant.
      await trigger.click();
      await viewer.waitFor();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-photo-transition'));
      const beforeClose = await page.evaluate(() => window.__transitionCalls);
      await viewer.getByRole('button', { name: 'Close photograph viewer', exact: true }).click();
      await viewer.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.__transitionCalls), beforeClose + 1, 'Pointer close morphs back to the tile');
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-photo-transition'));
      await trigger.click();
      await viewer.waitFor();
      await page.waitForFunction(() => !document.documentElement.hasAttribute('data-photo-transition'));
      const beforeEscape = await page.evaluate(() => window.__transitionCalls);
      await page.keyboard.press('Escape');
      await viewer.waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => window.__transitionCalls), beforeEscape, 'Escape closes without animation');
    }
    await context.close();
  }
  console.log('PASS native shared-image transition, fullscreen lifecycle, reduced-motion and unsupported fallback');

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const touchPage = await touchContext.newPage();
  await touchPage.addInitScript(() => {
    window.__preloads = [];
    const NativeImage = window.Image;
    window.Image = class extends NativeImage {
      set src(value) { window.__preloads.push(value); super.src = value; }
      get src() { return super.src; }
    };
  });
  await installNetworkPolicy(touchPage, 'empty');
  await touchPage.goto(`${SITE}/climbing/`, { waitUntil: 'networkidle' });
  await touchPage.getByRole('button', { name: /^Open photograph 1 of 5/ }).tap();
  const touchImage = touchPage.locator('[data-curated-viewer] img');
  await touchImage.waitFor();
  const cdp = await touchContext.newCDPSession(touchPage);
  async function swipe(dx, dy) {
    const box = await touchImage.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 5, y: y + dy * step / 5 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const original = await touchImage.getAttribute('src');
  {
    const box = await touchImage.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 40, y }] });
    const wrap = touchPage.locator('[data-curated-viewer] [data-photo-zoom]');
    assert.equal(await wrap.getAttribute('data-swiping'), '', 'Photo tracks the finger during a swipe');
    assert.match(await wrap.evaluate((el) => el.style.transform), /translate3d\(-40px/, 'Swipe offset follows the finger 1:1');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    assert.equal(await wrap.evaluate((el) => el.style.transform), '', 'Cancelled swipe snaps back');
  }
  await swipe(100, 0);
  assert.equal(await touchImage.getAttribute('src'), original, 'Swipe stays bounded at first image');
  await swipe(-12, 0);
  assert.equal(await touchImage.getAttribute('src'), original, 'Small gesture does not navigate');
  await swipe(0, -100);
  assert.equal(await touchImage.getAttribute('src'), original, 'Vertical gesture does not navigate');
  await swipe(-110, 0);
  await touchPage.waitForFunction((src) => document.querySelector('[data-curated-viewer] img').getAttribute('src') !== src, original);
  await swipe(110, 0);
  await touchPage.waitForFunction((src) => document.querySelector('[data-curated-viewer] img').getAttribute('src') === src, original);
  const canvas = touchPage.locator('[data-photo-zoom]');
  await touchImage.tap();
  await touchImage.tap();
  await touchPage.waitForFunction(() => Number(document.querySelector('[data-photo-zoom]').dataset.photoZoom) > 1);
  await touchImage.tap();
  await touchImage.tap();
  await touchPage.waitForFunction(() => Number(document.querySelector('[data-photo-zoom]').dataset.photoZoom) === 1);
  await touchPage.getByRole('button', { name: 'Zoom in', exact: true }).tap();
  const transformBefore = await touchImage.getAttribute('style');
  await swipe(60, 15);
  assert.equal(await touchImage.getAttribute('src'), original, 'Pan while zoomed never navigates');
  assert.notEqual(await touchImage.getAttribute('style'), transformBefore, 'Zoomed image can pan');
  await touchPage.getByRole('button', { name: 'Reset zoom', exact: true }).tap();
  const zoomBounds = await canvas.boundingBox();
  const cx = zoomBounds.x + zoomBounds.width / 2;
  const cy = zoomBounds.y + zoomBounds.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 35, y: cy, id: 1 }, { x: cx + 35, y: cy, id: 2 }] });
  for (let step = 1; step <= 5; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 35 - step * 9, y: cy, id: 1 }, { x: cx + 35 + step * 9, y: cy, id: 2 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchPage.waitForFunction(() => Number(document.querySelector('[data-photo-zoom]').dataset.photoZoom) > 1);
  assert.ok(Number(await canvas.getAttribute('data-photo-zoom')) <= 3, 'Pinch zoom stays bounded');
  await touchPage.getByRole('button', { name: 'Next photograph', exact: true }).tap();
  await touchPage.waitForFunction(() => Number(document.querySelector('[data-photo-zoom]').dataset.photoZoom) === 1);
  assert.ok((await touchPage.evaluate(() => window.__preloads)).some(src => src.includes('climbing-square.svg')), 'Viewer preloads adjacent image');
  await touchContext.close();
  console.log('PASS real touch swipes, direction threshold and bounds');

  assertPublicProxyBuild();
  for (const routeId of ['underwater', 'portraits']) {
    for (const mode of ['empty', 'failure']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const requests = await installNetworkPolicy(page, mode);
      // Feed is deferred: enter via the #recent-work fragment so the gate arms
      // immediately, then scroll the sentinel into view before expecting traffic.
      await page.goto(`${SITE}/${routeId}/#recent-work`, { waitUntil: 'networkidle' });
      await waitForGallery(page);
      assert.equal(await page.locator('#recent-work').count(), 1, `${routeId} keeps the Recent work anchor on ${mode}`);
      assert.ok(await page.getByRole('heading', { name: 'Recent work', exact: true }).count(), `${routeId} keeps the Recent work heading on ${mode}`);
      // Feed is deferred: scroll the section into view so the gate sentinel
      // (600px rootMargin) arms the fetch before expecting proxy traffic.
      await page.locator('#recent-work').scrollIntoViewIfNeeded();
      for (let poll = 0; poll < 100 && requests.proxy.length === 0; poll += 1) await delay(100);
      await assertContact(page, { id: routeId });
      assert.ok(requests.proxy.length > 0, `${routeId} uses the mocked production proxy on ${mode}`);
      assert.ok(await page.getByText('Instagram photos are unavailable right now.', { exact: true }).isVisible(), 'Feed unavailable message visible');
      assert.ok(await page.getByRole('link', { name: 'View Instagram profile', exact: true }).isVisible(), 'Profile fallback visible');
      assert.equal(await page.locator('button[aria-label^="View photo"]').count(), 0, 'No failed feed tiles');
      if (mode === 'failure') assert.ok(await page.getByRole('button', { name: 'Retry', exact: true }).isVisible(), 'Retry available after failure');
      await context.close();
    }
  }

  const failedImageContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const failedImagePage = await failedImageContext.newPage();
  await installNetworkPolicy(failedImagePage, 'none');
  await failedImagePage.route('**/placeholders/climbing.svg', (route) => route.abort());
  await failedImagePage.goto(`${SITE}/climbing/`, { waitUntil: 'networkidle' });
  await failedImagePage.getByRole('button', { name: /^Open photograph 1 of 5/ }).click();
  const failedViewer = failedImagePage.locator('[data-curated-viewer]');
  await failedViewer.getByText('Image unavailable', { exact: true }).waitFor();
  await failedViewer.getByRole('button', { name: 'Next photograph', exact: true }).click();
  await failedImagePage.waitForFunction(() => {
    const img = document.querySelector('[data-curated-viewer] img');
    return img?.complete && img.naturalWidth > 0;
  });
  assert.equal(await failedViewer.getByText('Image unavailable', { exact: true }).count(), 0, 'Viewer recovers when navigating past a failed image');
  assert.ok(await failedViewer.getByRole('button').first().evaluate((element) => getComputedStyle(element).transitionDuration.split(',').every((duration) => Number.parseFloat(duration) < 0.01)), 'Reduced motion disables viewer transitions');
  await failedImagePage.keyboard.press('Escape');
  await failedViewer.waitFor({ state: 'detached' });
  await failedImageContext.close();
  console.log('PASS failed image recovery and reduced motion');

  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(`${SITE}/climbing/`);
  const noScriptGallery = noScriptPage.locator('[data-curated-gallery]');
  assert.ok(await noScriptGallery.isVisible(), 'Curated gallery is visible without JavaScript');
  assert.equal(await noScriptGallery.locator('img').count(), 5, 'All curated images remain available without JavaScript');
  await noScript.close();
  console.log('PASS curated gallery remains visible without JavaScript');
  const metadataContext = await browser.newContext();
  const metadataPage = await metadataContext.newPage();
  await installNetworkPolicy(metadataPage, 'empty');
  const paths = ['/', '/underwater/', '/portraits/', '/climbing/'];
  for (const path of paths) {
    await metadataPage.goto(`${SITE}${path}`);
    assert.equal(await metadataPage.locator('link[rel="canonical"]').getAttribute('href'), `https://tinglingdingphotography.com${path}`);
    assert.ok((await metadataPage.title()).includes('TingLingDing'));
    assert.ok(await metadataPage.locator('meta[name="description"]').getAttribute('content'));
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const value = await metadataPage.locator(selector).first().getAttribute('content');
      assert.match(value, /^https:\/\/tinglingdingphotography\.com\/og-[a-z-]+\.png$/);
    }
    if (path !== '/') assert.equal(await metadataPage.locator('h1').count(), 1);
  }
  const sitemap = readFileSync('out/sitemap.xml', 'utf8');
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]).sort(), paths.map((path) => `https://tinglingdingphotography.com${path}`).sort());
  await metadataContext.close();
  console.log('PASS built route metadata and sitemap');
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
