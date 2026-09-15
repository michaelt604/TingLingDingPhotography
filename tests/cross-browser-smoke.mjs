// Small Firefox/WebKit core-flow lane for the static export.
// Run after `npm run build` with: node tests/cross-browser-smoke.mjs
// Covers homepage nav, contact open/close, and the curated viewer on each
// engine listed in SMOKE_BROWSERS (default: firefox,webkit).
// Fullscreen and view-transition paths are feature-detected: engines without
// the API exercise the fallback instead of failing.
// Missing engine runtimes are reported as BLOCKED (exit 2), never as a pass.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { firefox, webkit } from 'playwright';

const PORT = 4332;
const SITE = `http://127.0.0.1:${PORT}`;
const ENGINES = (process.env.SMOKE_BROWSERS ?? 'firefox,webkit').split(',').map((name) => name.trim()).filter(Boolean);
const LAUNCHERS = { firefox, webkit };

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

async function runEngine(name) {
  let page;
  const launcher = LAUNCHERS[name];
  if (!launcher) throw new Error(`Unknown engine in SMOKE_BROWSERS: ${name}`);
  try {
    browser = await launcher.launch();
  } catch (error) {
    if (String(error?.message).includes("Executable doesn't exist") || String(error?.message).includes('executable')) {
      console.error(`BLOCKED ${name}: browser runtime is not installed. Run: npx playwright install --with-deps ${name}`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // Homepage nav: collection links route to their pages.
    await page.goto(SITE, { waitUntil: 'networkidle' });
    for (const id of ['underwater', 'portraits', 'climbing']) {
      assert.ok(await page.locator(`a[href="/${id}/"]`).count(), `${name}: ${id} route link exists`);
    }
    await page.locator('a[href="/climbing/"]').first().click();
    await page.waitForURL('**/climbing/');

    // Contact: dialog opens with a mailto handoff, Escape closes.
    const trigger = page.locator('button[aria-label="Open contact form"], button').filter({ hasText: 'Get in touch' }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.ok(await dialog.locator('a[href^="mailto:"]').count(), `${name}: contact has a mailto handoff`);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });

    // Curated viewer: first photograph opens; transitions/fullscreen are
    // feature-detected so unsupported engines take the fallback path.
    const photo = page.getByRole('button', { name: /^Open photograph 1 of 5/ });
    await photo.click();
    const viewer = page.locator('[data-curated-viewer][role="dialog"]');
    await viewer.waitFor();
    const supportsTransition = await page.evaluate(() => typeof document.startViewTransition === 'function');
    console.log(`${name}: view-transition ${supportsTransition ? 'native' : 'fallback'}`);
    const fullscreenButton = viewer.getByRole('button', { name: 'Enter fullscreen', exact: true });
    if (await fullscreenButton.count()) {
      try {
        await fullscreenButton.click({ timeout: 5000 });
        await page.waitForFunction(() => Boolean(document.fullscreenElement), { timeout: 5000 });
        await page.keyboard.press('Escape');
      } catch {
        console.log(`${name}: fullscreen fallback (request declined or unsupported)`);
      }
      await page.waitForFunction(() => !document.fullscreenElement).catch(() => {});
    }
    await viewer.getByRole('button', { name: 'Close photograph viewer', exact: true }).click();
    await viewer.waitFor({ state: 'detached' });

    assert.deepEqual(errors, [], `${name} has no page errors`);
    await context.close();
    console.log(`PASS ${name} core flow (nav, contact, curated viewer)`);
  } catch (error) {
    await page?.screenshot?.({ path: `preview/redesign/cross-browser-${name}-failure.png` }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    browser = undefined;
  }
}

try {
  await waitForServer();
  await mkdir('preview/redesign', { recursive: true });
  for (const name of ENGINES) await runEngine(name);
  if (process.exitCode === 2) console.error('BLOCKED: one or more browser runtimes are missing (see above).');
  else console.log('CROSS-BROWSER SMOKE PASSED');
} finally {
  await browser?.close();
  if (server.exitCode === null) server.kill();
}
if (serverError) throw serverError;
