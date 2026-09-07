// Deterministic curated-gallery browser coverage for the static export.
// Run after `npm run build` with: node tests/curated-gallery-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4326;
const SITE = `http://127.0.0.1:${PORT}`;
const SITE_ORIGIN = new URL(SITE).origin;
const PROXY_HOST = 'ig-proxy.michaelt604.workers.dev';
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
    try {
      if ((await fetch(SITE)).ok) return;
    } catch {
      // The server is still starting.
    }
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
    assert.equal(await button.getAttribute('aria-label'), `Open photograph ${index + 1} of 5`);
  }
  assert.equal(await page.locator(`a[href="/${route.id}/"][aria-current="page"]`).count(), 1, `${route.id} is active in navigation`);
  assert.ok(await page.locator('button[aria-label="Open contact form"], button').filter({ hasText: 'Get in touch' }).count(), `${route.id} has contact`);
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
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Open photograph 1 of 5');
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

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const touchPage = await touchContext.newPage();
  await installNetworkPolicy(touchPage, 'empty');
  await touchPage.goto(`${SITE}/climbing/`, { waitUntil: 'networkidle' });
  await touchPage.getByRole('button', { name: 'Open photograph 1 of 5', exact: true }).tap();
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
  await touchContext.close();
  console.log('PASS real touch swipes, direction threshold and bounds');

  for (const routeId of ['underwater', 'portraits']) {
    for (const mode of ['empty', 'failure']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const requests = await installNetworkPolicy(page, mode);
      await page.goto(`${SITE}/${routeId}/`, { waitUntil: 'networkidle' });
      await waitForGallery(page);
      assert.equal(await page.locator('#recent-work').count(), 1, `${routeId} keeps the Recent work anchor on ${mode}`);
      assert.ok(await page.getByRole('heading', { name: 'Recent work', exact: true }).count(), `${routeId} keeps the Recent work heading on ${mode}`);
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
  await failedImagePage.getByRole('button', { name: 'Open photograph 1 of 5', exact: true }).click();
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
