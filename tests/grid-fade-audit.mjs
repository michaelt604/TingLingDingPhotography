// Grid carousel crossfade audit. Run after `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 4323;
const site = `http://127.0.0.1:${port}`;
const urls = [
  'https://scontent.cdninstagram.com/fade-one.svg',
  'https://scontent.cdninstagram.com/fade-two.svg',
  'https://scontent.cdninstagram.com/fade-three.svg',
];
const colors = ['#e34b4b', '#4b74e3', '#54b66d'];
const mock = {
  data: [{
    id: 'fade-carousel',
    media_type: 'CAROUSEL_ALBUM',
    media_url: urls[0],
    permalink: 'https://www.instagram.com/p/fade/',
    timestamp: '2026-07-28T00:00:00Z',
    children: urls.map((media_url, index) => ({
      id: `fade-${index}`,
      media_type: 'IMAGE',
      media_url,
      permalink: 'https://www.instagram.com/p/fade/',
    })),
  }],
  paging: {},
};

const server = spawn(
  'python',
  ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', 'out/'],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
await delay(800);

const browser = await chromium.launch();

async function openFixture(reducedMotion = 'no-preference', imageDelays = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion,
  });
  const page = await context.newPage();
  const fulfillFeed = (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(mock),
    });
  await page.route('https://ig-proxy.michaelt604.workers.dev/**', fulfillFeed);
  await page.route('http://127.0.0.1:8788/**', fulfillFeed);
  for (const [index, url] of urls.entries()) {
    await page.route(url, async (route) => {
      if (imageDelays[index]) await delay(imageDelays[index]);
      await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><rect width="900" height="900" fill="${colors[index]}"/></svg>`,
      });
    });
  }
  await page.goto(`${site}/portraits/`, { waitUntil: 'networkidle' });
  await page.locator('button[aria-label^="View photo"]').waitFor();
  return { context, page };
}

try {
  const { context, page } = await openFixture();
  const next = page.locator('button[aria-label^="Next photo ("]');
  await next.click();
  const outgoing = page.locator('img[class*="tileOutgoing"]');
  await outgoing.waitFor();
  await page.waitForFunction(() => {
    const old = document.querySelector('img[class*="tileOutgoing"]');
    return old && getComputedStyle(old).animationName !== 'none';
  });

  const firstSwap = await page.evaluate(() => {
    const trigger = document.querySelector('button[aria-label^="View photo"]');
    const tile = trigger?.closest('div');
    const live = trigger?.querySelector('img');
    const old = tile?.querySelector('img[class*="tileOutgoing"]');
    const nextButton = tile?.querySelector('button[aria-label^="Next photo ("]');
    if (!(tile && live && old && nextButton)) return null;

    const oldStyle = getComputedStyle(old);
    const oldPointerEvents = old.style.pointerEvents;
    old.style.pointerEvents = 'auto';
    const tileRect = tile.getBoundingClientRect();
    const paintedAtCenter = document.elementFromPoint(
      tileRect.left + tileRect.width / 2,
      tileRect.top + tileRect.height / 2,
    );
    const nextRect = nextButton.getBoundingClientRect();
    const paintedAtControl = document.elementFromPoint(
      nextRect.left + nextRect.width / 2,
      nextRect.top + nextRect.height / 2,
    );
    old.style.pointerEvents = oldPointerEvents;

    return {
      liveSrc: live.src,
      outgoingSrc: old.src,
      animationName: oldStyle.animationName,
      outgoingZ: Number(oldStyle.zIndex),
      liveZ: Number(getComputedStyle(trigger).zIndex),
      controlZ: Number(getComputedStyle(nextButton).zIndex),
      outgoingPaintedAboveLive: paintedAtCenter === old,
      controlPaintedAboveOutgoing: paintedAtControl === nextButton || nextButton.contains(paintedAtControl),
    };
  });

  assert(firstSwap, 'carousel layers were not found');
  assert.match(firstSwap.liveSrc, /fade-two\.svg$/);
  assert.match(firstSwap.outgoingSrc, /fade-one\.svg$/);
  assert.notEqual(firstSwap.animationName, 'none');
  assert(firstSwap.outgoingZ > firstSwap.liveZ, 'outgoing image must paint above the live image');
  assert(firstSwap.controlZ > firstSwap.outgoingZ, 'controls must paint above the outgoing image');
  assert(firstSwap.outgoingPaintedAboveLive, 'outgoing image is not actually painted above the live image');
  assert(firstSwap.controlPaintedAboveOutgoing, 'carousel control is not painted above the outgoing image');

  // A second normal click during the active fade must advance and restart it.
  const firstAnimation = await outgoing.evaluate((old) => {
    old.dataset.fadeAuditNode = 'first';
    const animation = old.getAnimations()[0];
    return animation ? { currentTime: Number(animation.currentTime), playState: animation.playState } : null;
  });
  assert(firstAnimation, 'first fade animation was not active before rapid navigation');
  assert.equal(firstAnimation.playState, 'running');
  assert(firstAnimation.currentTime < 280, 'first transition had already completed before rapid navigation');
  await next.click();
  await assert.doesNotReject(() => page.waitForFunction(() => {
    const live = document.querySelector('button[aria-label^="View photo"] img');
    const old = document.querySelector('img[class*="tileOutgoing"]');
    const animation = old?.getAnimations()[0];
    return live?.src.endsWith('fade-three.svg')
      && old?.src.endsWith('fade-two.svg')
      && !old.dataset.fadeAuditNode
      && animation?.playState === 'running'
      && Number(animation.currentTime) < 120;
  }));
  await outgoing.waitFor({ state: 'detached', timeout: 1000 });

  await page.locator('button[aria-label^="Previous photo ("]').click();
  await outgoing.waitFor();
  await assert.doesNotReject(() => page.waitForFunction(() => {
    const old = document.querySelector('img[class*="tileOutgoing"]');
    return old?.src.endsWith('fade-three.svg');
  }));
  await context.close();

  // A slow incoming image must keep the previous frame fully visible
  // instead of fading to the tile background.
  const slow = await openFixture('no-preference', { 1: 700 });
  await slow.page.locator('button[aria-label^="Next photo ("]').click();
  const slowOutgoing = slow.page.locator('img[class*="tileOutgoing"]');
  await slowOutgoing.waitFor();
  await slow.page.waitForTimeout(300);
  const slowState = await slow.page.evaluate(() => {
    const live = document.querySelector('button[aria-label^="View photo"] img');
    const old = document.querySelector('img[class*="tileOutgoing"]');
    return {
      liveComplete: live?.complete,
      liveNaturalWidth: live?.naturalWidth,
      outgoingAnimation: old ? getComputedStyle(old).animationName : null,
      outgoingOpacity: old ? getComputedStyle(old).opacity : null,
    };
  });
  assert.equal(slowState.liveComplete, false);
  assert.equal(slowState.liveNaturalWidth, 0);
  assert.equal(slowState.outgoingAnimation, 'none');
  assert.equal(slowState.outgoingOpacity, '1');
  await slowOutgoing.waitFor({ state: 'detached', timeout: 2000 });
  await slow.context.close();

  // If navigation advances again while an image is still pending, the
  // previous request's late load must not start the current fade.
  const pending = await openFixture('no-preference', { 1: 350, 2: 800 });
  await pending.page.locator('button[aria-label^="Next photo ("]').click();
  const pendingOutgoing = pending.page.locator('img[class*="tileOutgoing"]');
  await pendingOutgoing.waitFor();
  await pending.page.locator('button[aria-label^="Next photo ("]').click();
  await pending.page.waitForTimeout(450);
  const pendingState = await pending.page.evaluate(() => {
    const live = document.querySelector('button[aria-label^="View photo"] img');
    const old = document.querySelector('img[class*="tileOutgoing"]');
    return {
      liveSrc: live?.src,
      liveComplete: live?.complete,
      outgoingSrc: old?.src,
      outgoingAnimation: old ? getComputedStyle(old).animationName : null,
      outgoingOpacity: old ? getComputedStyle(old).opacity : null,
    };
  });
  assert.match(pendingState.liveSrc, /fade-three\.svg$/);
  assert.equal(pendingState.liveComplete, false);
  assert.match(pendingState.outgoingSrc, /fade-one\.svg$/);
  assert.equal(pendingState.outgoingAnimation, 'none');
  assert.equal(pendingState.outgoingOpacity, '1');
  await pendingOutgoing.waitFor({ state: 'detached', timeout: 2000 });
  await pending.context.close();

  const reduced = await openFixture('reduce');
  const reducedStart = await reduced.page.evaluate(() => performance.now());
  await reduced.page.locator('button[aria-label^="Next photo ("]').click();
  await reduced.page.waitForFunction(() => {
    const live = document.querySelector('button[aria-label^="View photo"] img');
    return live?.src.endsWith('fade-two.svg')
      && live.complete
      && !document.querySelector('img[class*="tileOutgoing"]');
  });
  const reducedElapsed = await reduced.page.evaluate((start) => performance.now() - start, reducedStart);
  assert(reducedElapsed >= 120, `reduced-motion dissolve was not visibly timed: ${reducedElapsed}ms`);
  assert(reducedElapsed < 500, `reduced-motion dissolve took ${reducedElapsed}ms`);
  await reduced.context.close();
  console.log('GRID FADE AUDIT PASSED');
} finally {
  await browser.close();
  server.kill();
}
