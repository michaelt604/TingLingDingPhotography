# Cross-fade plan: grid + lightbox

## Goal
Make carousel image swaps cross-fade on both surfaces:
- **Grid tile** (carousel tiles in the feed): currently swaps `<Image src>` instantly.
- **Lightbox**: already has an under-layer fade-out, but the new top image snaps to opacity 1 — asymmetric.

## Design

### Pattern (mirror the existing lightbox)
Two stacked `<img>`s. On swap:
1. Snapshot the live src into a ref *synchronously* before the React state flush (so it's in place when the effect would otherwise see the new src).
2. Render an **under-layer** with the prior src + a mount-driven `@keyframes` that fades opacity 1 → 0 over `220ms`.
3. The **top layer** carries the new src at opacity 1 throughout.
4. `onAnimationEnd` on the under-layer unmounts it and clears refs.

Why a content-stack and not a single `<img>` with opacity toggle: swapping `src` on one `<img>` unmounts/remounts and skips the animation. A stack of two `<img>`s over each other keeps both mounted during the transition.

### Lightbox symmetry fix
Currently the under-layer fades 1 → 0, but the top image is `opacity: 1` from frame 0 → it reads as fade-out only. Make it symmetric:
- Under-layer: 1 → 0 (existing).
- Top layer: 0 → 1 over the same 220ms, both running concurrently. Mount-driven keyframes so each fresh mount plays from frame 0.

### Reduced motion
The existing `@media (prefers-reduced-motion: reduce)` block (`app/components/InstagramFeed.module.css` line 451–460) sets `transition: none` on several selectors but does NOT touch `animation`. The under-layer keyframes still fire. Extend the block (in place, don't split) to add `animation: none` on `.tileUnder`, `.lightboxUnder`, and `.lightboxTopFade`.

## Files / changes

### `app/components/InstagramFeed.tsx` — `PostTile`
- Add `prevSrcRef = useRef<string|null>(null)`.
- Add `underSrc` state.
- Snapshot in `goPrev` / `goNext`: `prevSrcRef.current = currentSrc; setUnderSrc(currentSrc); goPrev()`.
- Add `onUnderAnimationEnd` callback that nulls `underSrc` + `prevSrcRef`.
- In JSX, render a plain `<img>` under-layer when `underSrc` is set: `position: absolute; inset: 0`, `styles.tileImage` + `styles.tileUnder`.
  - First paint: don't render an under-layer (nothing to fade from).

### `app/components/InstagramFeed.tsx` — `Lightbox`
- When `underSrc` is set, give the top `<img>` the `lightboxTopFade` class. Otherwise omit it.

### `app/components/InstagramFeed.module.css`
- `.tileUnder` — `pointer-events: none; animation: tileUnderFade 220ms ease forwards`.
- `@keyframes tileUnderFade { from { opacity: 1; } to { opacity: 0; } }`.
- `.lightboxTopFade` — `animation: lightboxTopFade 220ms ease forwards`.
- `@keyframes lightboxTopFade { from { opacity: 0; } to { opacity: 1; } }`.
- Extend the existing `prefers-reduced-motion: reduce` block (in place) to include `.tileUnder`, `.lightboxUnder`, `.lightboxTopFade` with `transition: none; animation: none;`.

### `tests/grid-fade-audit.mjs` (new)
Sibling to `tests/lightbox-fade-audit.mjs`. Same fixture pattern (mock IG proxy with two-image CAROUSEL_ALBUM SVG fixtures, serve `out/` over Python http.server on a free port). Open a carousel tile, click the **tile's** carousel Next arrow (not the lightbox arrow), assert:
- An under-layer `<img>` mounts immediately on click.
- It carries the prior src.
- It unmounts within ~300ms via `animationend`.
- The new top `<img>` carries the new src.

## Acceptance
- `npm run check` clean (lint + tests + typecheck).
- `node tests/lightbox-smoke.mjs` passes (existing viewport-constraint behavior).
- `node tests/lightbox-fade-audit.mjs` still passes.
- `node tests/grid-fade-audit.mjs` (new) passes.
- Manual: opening a carousel tile and pressing Next in the grid shows the old tile fading out as the new tile fades in; same in the lightbox; no flicker.
- Under `prefers-reduced-motion: reduce`, the swaps become instant (no animation).
