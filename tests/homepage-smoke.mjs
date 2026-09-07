// Responsive homepage smoke test for the static export.
// Run after `npm run build` with: node tests/homepage-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4326;
const SITE = `http://127.0.0.1:${PORT}`;

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

async function assertContact(page, width) {
  const trigger = page.locator('button[aria-label="Open contact form"], button').filter({ hasText: 'Get in touch' }).first();
  assert.ok(await trigger.count(), `Get in touch exists at ${width}px`);
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.waitForFunction(() => document.activeElement?.matches('input, textarea, select'));
  assert.equal(await dialog.getAttribute('aria-modal'), 'true');
  assert.ok(await dialog.getAttribute('aria-labelledby'));
  assert.ok(await dialog.locator('a[href^="mailto:"]').count(), 'Contact has a mailto handoff');
  assert.ok(await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const html = getComputedStyle(document.documentElement);
    return body.overflow === 'hidden' || body.position === 'fixed' || html.overflow === 'hidden';
  }), 'Contact locks background scroll');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.ok(await trigger.evaluate((element) => document.activeElement === element), 'Contact restores focus');
}

try {
  await waitForServer();
  await mkdir('preview/redesign', { recursive: true });
  browser = await chromium.launch();

  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(SITE, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);

    assert.ok(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'Reduced-motion media preference is active');
    for (const name of ['Underwater', 'Portraits', 'Climbing']) {
      const heading = page.getByRole('heading', { name, exact: true });
      assert.ok(await heading.isVisible(), `${name} visible at ${width}px`);
      assert.ok(await heading.evaluate((element) => {
        const text = document.createRange();
        text.selectNodeContents(element);
        return text.getBoundingClientRect().right <= element.getBoundingClientRect().right + 1;
      }), `${name} text fits at ${width}px`);
    }
    assert.ok(await page.locator('a[href="/underwater/"]').count(), 'Underwater route link exists');
    assert.ok(await page.locator('a[href="/portraits/"]').count(), 'Portraits route link exists');
    assert.ok(await page.locator('a[href="/climbing/"]').count(), 'Climbing route link exists');
    assert.equal(await page.locator('a[href="#climbing-preview"]').count(), 0, 'Climbing uses its route');
    assert.equal(await page.locator('#climbing-preview').count(), 0, 'Old climbing preview anchor is gone');
    assert.ok(await page.getByText('Michael Ting', { exact: false }).count(), 'Footer identifies Michael Ting');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow at ${width}px`);

    for (const button of await page.getByRole('button').all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 44, `Button has a touch target at ${width}px`);
    }
    await assertContact(page, width);
    await page.screenshot({ path: `preview/redesign/home-${width}.png`, fullPage: true });
    assert.deepEqual(errors, [], `No homepage errors at ${width}px`);
    await context.close();
    console.log(`PASS homepage layout, links, contact and assets at ${width}px`);
  }

  const motionContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const motionPage = await motionContext.newPage();
  await motionPage.goto(SITE, { waitUntil: 'networkidle' });
  const panel = motionPage.locator('[data-photo-panel]').first();
  const bounds = await panel.boundingBox();
  await motionPage.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.7);
  assert.notEqual(await panel.evaluate((el) => el.style.getPropertyValue('--panel-x')), '', 'Pointer adds photo depth');
  await motionPage.mouse.move(0, 0);
  assert.equal(await panel.evaluate((el) => el.style.getPropertyValue('--panel-x')), '', 'Pointer departure resets depth');
  await motionPage.emulateMedia({ reducedMotion: 'reduce' });
  await motionPage.mouse.move(bounds.x + bounds.width * 0.8, bounds.y + bounds.height * 0.7);
  assert.equal(await panel.locator('img').evaluate((el) => getComputedStyle(el).transform), 'none', 'Reduced motion disables pointer depth');
  assert.equal(await motionPage.getByText(/^(01|02|03)$/).count(), 0, 'No decorative collection numbers');
  await motionContext.close();
  console.log('PASS pointer depth and reduced-motion fallback');

  const recentLinks = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const recentPage = await recentLinks.newPage();
  await recentPage.goto(SITE, { waitUntil: 'networkidle' });
  for (const collection of ['underwater', 'portraits']) {
    assert.ok(await recentPage.locator(`a[href="/${collection}/#recent-work"]`).count(), `${collection} recent work link exists`);
  }
  await recentLinks.close();

  const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(SITE);
  for (const name of ['Underwater', 'Portraits', 'Climbing']) {
    assert.ok(await noScriptPage.getByRole('heading', { name, exact: true }).isVisible(), `${name} remains visible without JavaScript`);
  }
  await noScript.close();
  console.log('PASS homepage content remains visible without JavaScript');
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
