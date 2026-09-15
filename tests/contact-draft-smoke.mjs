// Focused contact-draft browser smoke test for the static export.
// - Serves `out/` over a local static server (run after `npm run build`).
// - Opens the contact dialog, fills ALL SIX draft fields, then verifies the
//   full draft survives (a) Escape, (b) X close button, (c) backdrop click,
//   and (d) internal SPA navigation to another collection and back
//   (provider-owned, never cleared; reload-starts-empty is guaranteed by the
//   in-memory provider, not covered here).
// - Asserts the dialog is portaled into #dialog-host.
// - Mocks navigator.clipboard (copy capture): never touches the real clipboard.
// - Never sends mail: submit is verified via the status message plus the
//   real buildContactMailto formatter (location.assign is LegacyUnforgeable
//   in Chromium and cannot be stubbed, so the final one-line handoff is
//   covered by unit test + code inspection, not interception).
// - Asserts the shared Footer mailto fallback is visible everywhere.
//
// Run: node tests/contact-draft-smoke.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { chromium } from 'playwright';
import { buildContactMailto } from '../app/components/contactMailto.ts';

const PORT = 4331;
const SITE = `http://127.0.0.1:${PORT}`;

// Single source of truth stays in app/components/contactMailto.ts;
// the test extracts it instead of duplicating the literal.
const mailtoSource = await readFile('app/components/contactMailto.ts', 'utf8');
const CONTACT_EMAIL = mailtoSource.match(/CONTACT_EMAIL\s*=\s*'([^']+)'/)?.[1];
assert.ok(CONTACT_EMAIL, 'CONTACT_EMAIL found in contactMailto.ts');

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Install mailto + clipboard mocks before any page script runs: never sends
  // mail, never touches the real clipboard. Each stub records whether it
  // installed so the test fails fast instead of exercising the real APIs.
  await context.addInitScript(() => {
    window.__copied = null;
    window.__stubs = { clipboard: false };
    try {
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.__copied = String(text);
          },
        },
      });
      window.__stubs.clipboard = typeof window.navigator.clipboard?.writeText === 'function';
    } catch {
      window.__stubs.clipboard = false;
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(SITE, { waitUntil: 'networkidle' });
  assert.deepEqual(
    await page.evaluate(() => window.__stubs),
    { clipboard: true },
    'clipboard stub installed before page scripts ran',
  );
  // Shared Footer fallback: visible address + working mailto, no literal dup.
  const footerMailto = page.locator(`footer a[href="mailto:${CONTACT_EMAIL}"]`);
  assert.ok(await footerMailto.count(), 'Footer mailto fallback exists');
  assert.equal((await footerMailto.first().textContent())?.trim(), CONTACT_EMAIL);
  assert.ok(await footerMailto.first().isVisible(), 'Footer address is visible');

  const trigger = page.locator('button[aria-label="Open contact form"], button').filter({ hasText: 'Get in touch' }).first();
  assert.ok(await trigger.count(), 'Get in touch trigger exists');
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.ok(
    await page.evaluate(() => document.querySelector('#dialog-host [role="dialog"]') !== null),
    'Contact dialog is portaled into #dialog-host',
  );

  // Full six-field draft: every field must survive each close path below.
  const DRAFT = {
    name: 'Smoke Tester',
    email: 'smoke@example.com',
    timeframe: 'October 2026',
    location: 'Oslo',
    topic: 'A project collaboration',
    message: 'Hello from the draft smoke test.',
  };

  async function fillDraft() {
    for (const [field, value] of Object.entries(DRAFT)) {
      await dialog.locator(`#modal-contact-${field}`).fill(value);
    }
  }

  async function expectDraft(label) {
    for (const [field, value] of Object.entries(DRAFT)) {
      assert.equal(await dialog.locator(`#modal-contact-${field}`).inputValue(), value, `Draft ${field} survives ${label}`);
    }
  }

  async function reopen() {
    await trigger.click();
    await dialog.waitFor();
  }

  // (a) Escape close/reopen: the full draft must survive.
  await fillDraft();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await reopen();
  await expectDraft('Escape close/reopen');

  // (b) X close-button close/reopen: the full draft must survive.
  await dialog.getByRole('button', { name: 'Close contact form', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await reopen();
  await expectDraft('X close/reopen');

  // (c) Backdrop-click close/reopen: the full draft must survive. The dialog
  // sits above the full-overlay backdrop button, so click a gutter point
  // beside the dialog (a real user-style backdrop click).
  const backdropPoint = await page.evaluate(() => {
    const rect = document.querySelector('#dialog-host [role="dialog"]').getBoundingClientRect();
    return { x: Math.max(rect.left / 2, 4), y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(backdropPoint.x, backdropPoint.y);
  await dialog.waitFor({ state: 'detached' });
  await reopen();
  await expectDraft('backdrop close/reopen');

  // (d) Internal SPA navigation to another collection and back (client-side:
  // no reload, so the in-memory provider draft must be retained).
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.locator('a[href="/portraits/"]').first().click();
  await page.waitForURL('**/portraits/**');
  const collectionFooterMailto = page.locator(`footer a[href="mailto:${CONTACT_EMAIL}"]`);
  assert.ok(await collectionFooterMailto.count(), 'Footer mailto fallback exists on collection page');
  assert.ok(await collectionFooterMailto.first().isVisible(), 'Footer address is visible on collection page');
  await page.locator('header a[href="/"]').first().click();
  await page.waitForURL(`${SITE}/`);
  await reopen();
  await expectDraft('SPA navigation to a collection and back');

  // Copy-email uses the mocked clipboard, never the real one.
  await dialog.getByRole('button', { name: 'Copy email', exact: true }).click();
  await page.waitForFunction((email) => window.__copied === email, CONTACT_EMAIL);
  assert.ok(await dialog.getByText('Email address copied.').count(), 'Copy-email status is accurate');

  // Submit opens a mailto draft and keeps the draft. The handler run is
  // proven by the status message; the exact href is proven by feeding the
  // live field values through the real formatter (same code the handler
  // calls). location.assign itself is unforgeable and un-stubbable.
  // Message already holds the surviving draft value; submit flows it through.
  await dialog.getByRole('button', { name: /open email draft/i }).click();
  await dialog.getByText(/Your email app should open/).waitFor();
  const liveDraft = await dialog.evaluate((d) => Object.fromEntries(
    ['name', 'email', 'timeframe', 'location', 'topic', 'message'].map((field) => [
      field,
      d.querySelector(`#modal-contact-${field}`).value,
    ]),
  ));
  const href = buildContactMailto(liveDraft);
  const url = new URL(href);
  assert.equal(url.protocol, 'mailto:', 'formatter produces a mailto URL');
  assert.equal(url.pathname, CONTACT_EMAIL, 'mailto targets CONTACT_EMAIL');
  assert.match(url.searchParams.get('body') ?? '', /Smoke Tester/, 'mailto body carries the draft');
  assert.match(url.searchParams.get('body') ?? '', /Hello from the draft smoke test\./, 'mailto body carries the message');
  assert.equal(await dialog.locator('#modal-contact-name').inputValue(), 'Smoke Tester', 'Draft is never cleared on mailto open');

  assert.deepEqual(errors, [], 'No page errors');
  await context.close();
  console.log('PASS contact draft (all six fields) survives Escape/X/backdrop/SPA navigation, portal + footer fallback hold');
} finally {
  await browser?.close();
  server.kill();
}
if (serverError) throw serverError;
