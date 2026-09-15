# Website engineering review

Reviewed: 2026-09-14 (America/Vancouver). Baseline: commit `9ad5766` **plus the existing uncommitted redesign**.

## Assessment

Keep the static Next.js/Cloudflare architecture and the three-collection design. The current foundation has useful error handling, keyboard controls, reduced-motion support, and substantial Instagram tests. The most valuable next work is to finish the photography content, make contact resilient, and protect the redesigned experience in CI.

This is a local source and production-export review, not an audit of the deployed domain, Cloudflare account, real devices, or live traffic. No production code was changed. Existing user changes were preserved. Source locations below refer to this working-tree baseline and may move.

## Priority list

P1 means required before calling the redesigned portfolio ready for public launch. P2 means the next improvement cycle. These are delivery priorities, not vulnerability severity ratings.

| ID | Priority | Change | Evidence classification | Effort estimate |
|---|---|---|---|---|
| R01 | P1 | Replace placeholders with an approved photographic selection | Confirmed unfinished content | Medium + owner assets |
| R02 | P1 | Deliver responsive image variants instead of one file for every use | Confirmed architecture gap; future photo bandwidth risk | Medium |
| R03 | P1 | Make contact available without JavaScript or an email application | Confirmed access/fallback gap | Small–medium |
| R04 | P1 | Preserve an inquiry when its modal is dismissed | Confirmed state-lifetime defect | Small |
| R05 | P1 | Include redesigned flows in the deployment gate | Confirmed CI omission | Small–medium |
| R06 | P1 | Make modal background isolation explicit | Confirmed missing isolation; assistive-technology impact needs manual testing | Medium |
| R07 | P2 | Defer secondary Instagram work until it is needed | Confirmed eager request; performance impact unmeasured | Medium |
| R08 | P2 | Add immediate mobile collection access and improve small text | Visual/design recommendation | Small |
| R09 | P2 | Give every collection a complete sharing preview | Confirmed generic climbing asset; editorial improvement | Small + assets |
| R10 | P2 | Remove conflicting setup guidance and document the actual release path | Confirmed documentation mismatch | Small |

Estimates describe relative scope, not promised elapsed time.

## R01 — Finish the actual portfolio content

**Evidence:** `app/page.tsx:9` separately defines three placeholder covers. `app/collections.ts:20` onward defines 15 placeholder entries. The collection pages explicitly disclose placeholders. Desktop and mobile screenshots confirm the primary experience is illustration, not Michael's photographs.

**Change required:**

- Obtain the owner's approved files and ordering. Start with the existing five-image slots per collection; do not pad the portfolio with duplicates or invented work.
- Record stable IDs, intrinsic dimensions, descriptive alt text, and an explicit cover image ID in `app/collections.ts`. Derive homepage covers from those same records. Preserve the same cover/first-photo relationship used by the route transition.
- Give cover crops an optional focal position when needed. Check faces, limbs, climbing subjects, and underwater subjects at desktop and mobile crop ratios. The viewer must show the entire photograph at its normal zoom.
- Remove placeholder notices only when the corresponding published collection actually contains approved photos. Missing assets are a recorded dependency; never disguise them with stock or generated images.
- Update gallery/motion fixtures that currently hard-code placeholder URLs and exact image counts. Keep intentional fixture counts explicit; derive production expectations from the actual collection manifest.

**Acceptance:** Every published curated image and cover is approved, resolves successfully, has correct dimensions/alt text, and retains its subject at 320/390/768/1440px. Homepage cover ID equals the intended first collection image ID. Reordering a collection cannot silently leave an unrelated homepage cover. No upload service or CMS is required.

## R02 — Separate thumbnail and viewer image delivery

**Evidence:** `next.config.mjs` uses `images.unoptimized`. `CuratedGallery.tsx:92` and `:518` use the same `image.src`; `:451` preloads neighboring instances of that same source. This is inexpensive for today's SVGs but will fetch unnecessarily large files if full-resolution photographs are simply substituted.

**Change required:**

- Retain static export. Generate checked, versioned image derivatives during asset preparation/build; do not enable the default runtime image optimizer in a static deployment.
- Use a concrete manifest contract: intrinsic `width`/`height`, fallback `src`, responsive grid candidates, separate viewer candidates, and optional cover focal position. Produce widths near 480/960/1600/2400px, skipping upscaling. Prefer WebP plus a broadly supported fallback; verify photographic quality before choosing compression.
- Use `picture`/`srcset`/`sizes` or a verified static-compatible loader so the browser selects an appropriate image. Keep dimensions in markup. Only request viewer-sized variants on opening the viewer; neighbor warming must respect data-saving preferences and use the intended viewer variant.
- Use content-versioned filenames for long-lived caching. Add matching photo cache rules to `public/_headers` only after filenames are versioned.
- Preserve the cover-to-gallery view transition by stable photo identity rather than requiring identical derivative URLs.

**Acceptance:** At 390px/DPR 1 the grid does not request a 2400px original. Opening a viewer requests an appropriately larger derivative. Grid loading does not pull every viewer asset. No new `/_next/image` requests, image layout jumps, or build-time upscaling. Record actual transferred bytes before/after on approved photographs; do not claim a speedup from SVG measurements. Proposed initial budgets: cover <=250KB, grid derivative <=200KB, viewer derivative <=800KB, with documented quality exceptions.

The [Next.js static-export guide](https://nextjs.org/docs/app/guides/static-exports) describes static-compatible image loaders and unsupported server features. Apply that principle to the installed Next.js 15 version; do not copy unrelated latest-version APIs or upgrade the framework for this work.

## R03 — Provide resilient contact access

**Evidence:** `ContactModal.tsx:102` returns no content while closed. Homepage and `SiteNav` contact triggers are JS-only buttons. The direct email link in `Contact.tsx:173` is inside that modal, and it uses the same mailto mechanism as the form. The comment at `Contact.tsx:62` claims no-JS support that the current page composition does not provide.

**Change required:**

- Render a visible email address and working `mailto:` anchor in the homepage footer and shared collection/404 footer. Use `CONTACT_EMAIL`; do not duplicate the literal address.
- Preserve the current modal and truthful “Open email draft” wording. Add a “Copy email address” action and a “Copy inquiry” action containing the composed subject/body. Handle Clipboard API rejection with selectable text and a clear status.
- Share the subject/body formatting with `contactMailto.ts` so copied and emailed inquiries contain the same fields. Correct the misleading no-JS comment to describe the rendered fallback accurately.

**Acceptance:** With JS disabled, home and all three collections expose a selectable address and a usable email link. With no mail handler, the user can still copy their inquiry. Tests mock mailto/clipboard; they must never send mail. No false “message sent” status. A server contact backend is out of scope.

## R04 — Preserve contact drafts on accidental dismissal

**Evidence:** Form fields live in `Contact.tsx:70–75`; `ContactModal.tsx:102` unmounts the form when closed. Escape, backdrop click, and the close button therefore discard all typed fields.

**Reproduction:** Open contact, fill name and message, press Escape, reopen. The fields initialize empty.

**Change required:** Move the draft state to the existing provider, or another single owner that outlives modal visibility, and make `Contact` controlled. Retain the draft across close/reopen and internal collection navigation. Do not persist personal inquiry text to browser storage or logs. Do not clear it merely because a mailto draft was opened; delivery is unconfirmed.

**Acceptance:** All six fields survive Escape, close button, backdrop dismissal, and internal navigation. Reload starts empty. Validation still works and status messages remain accurate. Add focused browser regressions; keep focus restoration and scroll locking intact.

## R05 — Make the redesign part of release verification

**Evidence:** `.github/workflows/deploy.yml:60–65` runs four Instagram browser scripts. It omits `tests/homepage-smoke.mjs`, `tests/curated-gallery-smoke.mjs`, and the untracked `tests/motion-smoke.mjs`. `package.json` has scripts for the first two but no motion command.

**Change required:**

- Add `test:motion-smoke` and one canonical `test:browser` script that runs all seven existing browser checks sequentially after a build. Point CI and README at that command.
- Repair two observed baseline failures before enabling the gate. The local build resolves a local-host proxy override, whereas `curated-gallery-smoke.mjs:420` expects the production-host fixture. Set the public proxy URL explicitly for the test-build process and validate it before building; preserve `.env.local`. Fail early on configuration mismatch rather than reporting a gallery defect. `motion-smoke.mjs:40` compares an absolute image URL with a relative URL: normalize both against the page origin for the existing assets, then use stable photo IDs once R02 introduces distinct derivatives.
- Retain existing unit, type, security-header, production-URL, and dependency-audit gates. Install browser dependencies explicitly.
- Add a small Firefox/WebKit core-flow lane for homepage navigation, contact, and curated viewer. Feature-detect fullscreen/view-transition APIs and assert usable fallbacks; do not require unsupported animation APIs.
- Save screenshots and concise logs on failure with bounded retention. Improve server startup checks to report port conflicts/early server exit. Never silently test a stale export or another process on the same port.

**Acceptance:** A deliberate failing homepage/gallery assertion fails the verify job and prevents deploy. All named checks run against the same freshly built export. Core behavior is checked in Chromium, Firefox, and WebKit; missing local browser runtimes must be reported rather than called a pass. CI never sends mail or requires live Instagram credentials.

## R06 — Isolate dialogs and expose photograph descriptions

**Evidence:** `ContactModal.tsx:121`, `CuratedGallery.tsx:471`, and the Instagram lightbox declare modal dialogs and implement keyboard trapping. They do not explicitly make the surrounding document inert. `CuratedGallery.tsx:88` overrides the thumbnail button name with only an ordinal, omitting the image description.

**Change required:**

- Use a small shared dialog isolation mechanism with one clear owner. Either use a verified native modal dialog approach or portal dialogs outside an inert application-content wrapper. Do not set `inert` on an ancestor that contains the active dialog.
- Preserve existing focus entry, Tab/Shift+Tab wrapping, Escape, backdrop handling, fullscreen exit, focus restoration, and reference-counted scroll locking. Restore prior inert state on cleanup, including rapid close and route changes.
- Include the concise photo description and ordinal in the gallery button's accessible name; retain meaningful image alt text.

**Acceptance:** Background controls cannot be programmatically focused while the dialog is open. Keyboard and screen-reader checks stay inside the active dialog; closing restores the initiating control when it still exists. Test contact and both viewer types, rejected fullscreen requests, and reduced motion. Run a manual VoiceOver or NVDA check when available and record its environment; automated checks are not proof of full accessibility.

The [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) requires the surrounding content to be inert and focus to remain inside a modal. The existing ARIA attributes and Tab handling are useful but do not themselves provide DOM focus isolation.

## R07 — Load recent Instagram work when visitors approach it

**Evidence:** `InstagramFeed.tsx:183` starts the initial request on mount, although the feed follows the curated gallery. The first feed tile receives `priority` at `:358`. Pagination errors include internal `loadMoreError` strings at `:378` and `:452`.

**Change required:** Start feed loading when its section approaches the viewport (suggested root margin: 600px), or immediately when entering through `#recent-work`. Keep a stable section anchor and useful profile link before loading. Fall back to loading when IntersectionObserver is unavailable. Remove unconditional high priority from the below-fold feed image. Preserve lifecycle cancellation, deduplication, pagination, retries, and accessible fallback states. Show concise user-facing errors without appending internal transport details.

**Acceptance:** No feed request is made while a visitor remains at the top of a collection with the feed outside the prefetch margin. Direct fragment navigation loads it promptly. Repeated observer callbacks do not duplicate initial loads. Mock success, timeout, empty feed, partial/degraded response, failed pagination, and route changes. The curated portfolio works when the feed is blocked. Measure request timing rather than claiming unmeasured Core Web Vitals gains.

## R08 — Improve mobile access and reading hierarchy

**Evidence:** The 390px homepage is approximately 3066px tall, stacks collections in one column, and has no collection shortcuts above the first card. Homepage CSS uses 9–11px text for several navigation/brand/footer elements. The mobile about/recent sections have 130–145px margins. No horizontal-overflow defect was observed at tested widths.

**Change required:** Add compact, visible collection links below the introduction so all three destinations are reachable without scrolling through preceding cards. Retain the triptych on desktop and stacked mobile photography. Increase actionable small text to at least 12px, retaining >=44px interaction targets. Reduce mobile about/recent section gaps to a consistent 72–96px range. Keep existing biography wording and personal tone; do not invent location, availability, commercial packages, or credentials.

**Acceptance:** All collection shortcuts are available near the start of the mobile page. At 320px, 200% text zoom, and landscape phone sizes there is no clipping or horizontal scrolling; keyboard focus remains visible. Compare 390px/1440px screenshots with the baseline. Preserve reduced-motion behavior and existing hover expansion unless a measured usability issue requires changing it.

## R09 — Complete collection sharing metadata

**Evidence:** `app/climbing/page.tsx:17` uses `og-default.png` rather than a climbing-specific preview. Collection Open Graph objects omit explicit per-collection titles/descriptions. Current tests check asset presence and a URL pattern, not the complete generated social card content.

**Change required:** Add an approved climbing preview and use explicit title/description/image-alt values for each collection's Open Graph and Twitter metadata. Generate photographic previews only from approved assets; keep the existing designed fallback if assets are unavailable. Check exported HTML rather than only matching source strings. Do not fabricate schema.org business/location/review data.

**Acceptance:** Each exported route contains its own canonical URL, meaningful title/description, absolute sharing-image URL, and correct 1200x630 raster asset. Preview cropping is reviewed visually. Metadata tests fail on a missing tag or image. Preserve existing sitemap coverage; only update last-modified dates for real content changes.

## R10 — Keep operations guidance consistent with the repository

**Evidence:** README says Node 22+ while package engines require >=24. It retains widget alternatives, old setup paths, and a suggestion to move to SSR for a real form. `next.config.mjs` repeats adapter migration guidance unrelated to this static site.

**Change required:** Document Node 24, static build/preview, the canonical verification command, existing Worker/Pages deployment order, and content preparation. Remove superseded widget implementation directions and speculative adapter migration comments. Keep essential credential-binding and recovery guidance concise without exposing credentials. Explain that mailto does not confirm delivery and that photo assets remain owner-supplied.

**Acceptance:** A new agent can install, verify, build, preview, and locate the deployment workflow from one concise path. README commands match package scripts and CI. No new hosting platform, paid provider, authentication flow, or deployment is introduced by this cleanup.

## Evidence and verification

- `npm run check`: passed lint, 73 unit tests, and app/Worker type checks.
- `npm run build`: passed; all routes statically exported. Build-reported first-load JS: home 116KB, climbing 119KB, portraits/underwater 125KB. These are build estimates, not real-user performance measurements.
- `npm run test:homepage-smoke`: passed at 1440/768/390/320px, pointer/reduced-motion checks, and no-JS content visibility.
- `npm run test:gallery-smoke`: **failed** at line 420 (`underwater uses the mocked production proxy on empty`). Before failure, all three collections passed at 1440/390px; transition/fullscreen/reduced-motion/fallback and touch checks passed. Environment resolution confirmed a local-host public proxy override, while the fixture recognizes only the production host. Remaining assertions after that failure did not run.
- `node tests/motion-smoke.mjs`: **failed** at line 40. Actual was an absolute local URL to `/placeholders/portraits.svg`; expected was the equivalent relative path. This establishes a test-comparison defect, not a demonstrated visual transition failure. Later motion assertions did not run.
- Visually inspected fresh `preview/redesign/home-390.png` and `home-1440.png`.
- Local logs: `review-baseline-check.log`, `review-baseline-build.log`, `review-homepage.log`, `review-gallery.log`, `review-motion.log` (ignored by Git). Shell wrappers printed log tails and returned success; pass/fail here is taken from the actual test output, including its assertion failures.
- The graph overview was used to orient the review; direct source and freshly built output were used for the active redesign because the graph did not describe all newer components.

Not established: deployed header behavior, real image quality/performance, live Instagram reliability, screen-reader conformance, real-device gestures, production monitoring, or field Core Web Vitals. Do not treat these as passed checks or confirmed failures.
