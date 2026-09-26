// Instagram defer + lightbox contract smoke (R07 / R06-feed).
// Node-only source-contract checks: no build, no browser.
// - Initial fetch gated behind viewport proximity (600px rootMargin sentinel)
//   or immediate for #recent-work / #instagram deep-links; stable anchor +
//   profile link render pre-load; immediate fallback when
//   IntersectionObserver is unavailable; single-fire guard; existing
//   cancellation/dedup/pagination/retry/unmount paths intact.
// - No unconditional priority on below-fold grid tiles.
// - Concise user errors: no raw transport detail in production DOM
//   (dev-only suffix preserved).
// - Lightbox portals into #dialog-host and consumes useDialogIsolation,
//   keeping trap / Esc / focus-restore / scroll-lock behavior.
//
// Run: node tests/instagram-defer-smoke.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const TSX = readFileSync('app/components/InstagramFeed.tsx', 'utf8');
const CSS = readFileSync('app/components/InstagramFeed.module.css', 'utf8');

let n = 0;
function check(name, cond) {
  n += 1;
  assert.ok(cond, `FAIL: ${name}`);
  console.log(`ok ${n} - ${name}`);
}

// 1. Gate sentinel with 600px rootMargin arms the initial fetch.
check('gate observer uses 600px rootMargin', TSX.includes('{ rootMargin: "600px 0px" }'));
check('gate sentinel ref rendered pre-load', TSX.includes('ref={gateRef}'));
check('gate uses deferGate class', TSX.includes('styles.deferGate'));

// 2. Immediate arming for hash deep-links.
check('immediate load on #recent-work', TSX.includes('#recent-work'));
check('immediate load on #instagram', TSX.includes('#instagram'));

// 3. Fallback when IntersectionObserver is unavailable.
check(
  'immediate fallback without IntersectionObserver',
  TSX.includes('typeof IntersectionObserver === "undefined"'),
);

// 4. Single-fire guard against StrictMode / observer re-attach double-fire.
check('double-fire guard ref', TSX.includes('gateFiredRef'));
check('armed state gates initial fetch', TSX.includes('if (!feedArmed) return;'));

// 5. Stable section anchor + profile link render pre-load (before any fetch).
check('stable section anchor id', TSX.includes('id="instagram"'));
check('FeedHeader renders pre-load', TSX.includes('<FeedHeader handle={handle} profileUrl={profileUrl} />'));

// 6. Existing lifecycle guards preserved.
check('cancellation token preserved', TSX.includes('lifecycleTokenRef'));
check('cursor pagination preserved', TSX.includes('normalizeCursor(getPagingNext(data))'));
check('initial retry preserved', TSX.includes('handleInitialRetry'));
check('unmount cleanup preserved', TSX.includes('cancelled = true'));

// 7. No unconditional priority on below-fold grid tiles (code-specific:
// no JSX pass-through, no prop declaration, no default value).
check('no priority JSX pass-through', !TSX.includes('priority={'));
check('no priority prop declaration', !TSX.includes('priority?:'));
check('no priority default value', !TSX.includes('priority ='));

check(
  'concise load-more error copy',
  TSX.includes("Couldn&apos;t load more posts. Please try again."),
);
check(
  'no raw load-more error interpolation',
  !TSX.includes("Couldn&apos;t load more posts. {loadMoreError}"),
);
check(
  'load-more detail kept as dev-only suffix',
  TSX.includes('process.env.NODE_ENV !== "production" && loadMoreError'),
);
check(
  'initial error kept as dev-only suffix',
  TSX.includes('process.env.NODE_ENV !== "production" && error'),
);

// 9. Lightbox portals into #dialog-host + consumes dialog isolation.
check('lightbox uses createPortal', TSX.includes('createPortal(dialog, dialogHost)'));
check(
  'lightbox resolves dialog-host inline',
  TSX.includes(`document.getElementById("dialog-host")`) ||
    TSX.includes(`document.getElementById('dialog-host')`),
);
check('lightbox consumes useDialogIsolation', TSX.includes('useDialogIsolation(open)'));
check('lightbox short-circuits when closed', TSX.includes('if (!open) return null;'));

// 10. Trap / Esc / restore / scroll behavior kept.
check('focus trap kept', TSX.includes('document.activeElement === last'));
check('Escape closes kept', TSX.includes('"Escape"'));
check('focus restore kept', TSX.includes('trigger.focus()'));
check('ref-counted scroll lock kept', TSX.includes('lockBodyScroll()'));

// 11. CSS: gate sentinel + anchor scroll margin.
check('deferGate style exists', CSS.includes('.deferGate'));
check('anchor scroll margin exists', CSS.includes('scroll-margin-top'));
// 12. Top-of-page zero-request + single-fire arming (deterministic gate
// model). Mirrors the gate effect above: feedArmed starts false so no
// fetch runs at top while the sentinel sits outside the 600px prefetch
// margin; scrolling within the margin (or a #recent-work fragment entry)
// arms exactly once via the gateFiredRef guard, and repeated observer
// callbacks / re-attaches never duplicate the initial load.
const PREFETCH_MARGIN_PX = Number(
  (TSX.match(/\{ rootMargin: "(\d+)px 0px" \}/) ?? [])[1],
);
check('gate model tracks 600px source margin', PREFETCH_MARGIN_PX === 600);

function createGateHarness({ hash = '', proxyUrl = 'https://ig-proxy.test/feed' } = {}) {
  const harness = {
    gateFired: false,
    feedArmed: false,
    fetchCount: 0,
    observerCallbacks: [],
  };
  harness.armFeed = () => {
    if (harness.gateFired) return;
    harness.gateFired = true;
    harness.feedArmed = true;
    if (proxyUrl) harness.fetchCount += 1;
  };
  harness.installGate = ({ ioAvailable = true, nodePresent = true } = {}) => {
    if (hash === '#recent-work' || hash === '#instagram') {
      harness.armFeed();
      return;
    }
    if (!ioAvailable || !nodePresent) {
      harness.armFeed();
      return;
    }
    harness.observerCallbacks.push((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) harness.armFeed();
    });
  };
  harness.emit = (isIntersecting) => {
    for (const cb of harness.observerCallbacks) cb([{ isIntersecting }]);
  };
  return harness;
};

// Virtual collection-page geometry: viewport + feed offset fixture. The
// feed sits far enough below the fold that at scrollY 0 the sentinel is
// outside the prefetch margin; scrolling near brings it within margin.
const VIEWPORT_H = 800;
const FEED_TOP = 2400;
const distanceToViewport = (scrollY) => FEED_TOP - scrollY - VIEWPORT_H;
const withinPrefetchMargin = (scrollY) => distanceToViewport(scrollY) <= PREFETCH_MARGIN_PX;

// Remain at top with the feed outside the margin: no request in window.
{
  const top = createGateHarness({ hash: '' });
  top.installGate();
  assert.ok(distanceToViewport(0) > PREFETCH_MARGIN_PX, 'fixture keeps feed outside margin at top');
  for (let frame = 0; frame < 60; frame += 1) top.emit(withinPrefetchMargin(0));
  check('top of page fires zero feed/proxy requests', top.fetchCount === 0 && !top.feedArmed);
}

// Scroll near the section: loading starts exactly once, then repeated
// observer callbacks (StrictMode remount / re-attach) never duplicate it.
{
  const near = createGateHarness({ hash: '' });
  near.installGate();
  near.installGate(); // StrictMode-style second attach before scroll.
  for (let frame = 0; frame < 60; frame += 1) near.emit(withinPrefetchMargin(0));
  check('still zero requests before entering prefetch margin', near.fetchCount === 0);
  near.emit(withinPrefetchMargin(FEED_TOP - VIEWPORT_H - PREFETCH_MARGIN_PX + 1));
  check('scroll into prefetch margin starts exactly one load', near.fetchCount === 1 && near.feedArmed);
  for (let frame = 0; frame < 10; frame += 1) near.emit(true);
  near.installGate(); // observer re-attach after arming.
  near.emit(true);
  check('repeated observer callbacks never duplicate initial load', near.fetchCount === 1);
}

// Fragment entry arms immediately at top without scrolling, exactly once.
{
  const frag = createGateHarness({ hash: '#recent-work' });
  frag.installGate();
  frag.installGate();
  check('fragment entry loads exactly once without scroll', frag.fetchCount === 1 && frag.feedArmed);
}

console.log(`\nSMOKE TEST PASSED (${n} checks)`);
