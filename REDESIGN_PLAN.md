# TingLingDing portfolio redesign — action plan and resume ledger

Updated: 2026-09-07. Status: P0–P6 complete; Astra review and UI/UX refinements verified. Photos and uploads remain deferred.

## Objective and agreed direction

Create a professional personal photography portfolio that also demonstrates software craftsmanship when linked from a resume. Preserve TingLingDing. Prioritize exploring selected work and inviting collaborations or casual contact, not paid bookings.

- Dark by default: neutral near-black, white and cool-grey accents, generous spacing. User explicitly rejected the brown/warm palette during preview; this correction supersedes earlier warm-colour references in historical ledger entries. Replace the blue/purple split identity. Use semantic colour tokens; a light-mode toggle is deferred.
- Three equal collections: **Underwater**, **Portraits**, **Climbing**. Preserve `/underwater/` and `/portraits/`; add `/climbing/`.
- First homepage concept: three large image panels, side by side on wide screens and stacked on mobile, followed by a short introduction and secondary recent work. This is a direction to evaluate visually, not a user-approved final composition.
- Collection galleries: larger images at varied sizes, natural aspect ratios, no visible captions by default, accessible fullscreen viewing. Retain meaningful alternative text and control labels.
- Curated image selection will come later. Use explicitly labelled local placeholder assets with varied portrait/landscape proportions; never pass stock or generated photographs off as the user's work.
- Keep Instagram recent work for the two connected accounts, subordinate to curated galleries. Climbing has no Instagram integration.
- Subtle scroll reveals and hover transitions; no scroll hijacking. Respect reduced motion and keep content readable if scripts or observers fail.
- Short biography without a headshot. Repository footer identifies Michael Ting; birthplace and other unconfirmed facts must be omitted until supplied. Safe interim copy can mention photography, diving, climbing, friends, and natural-light portraits from the conversation.
- Keep the existing contact mail-client handoff and direct-email fallback. Use “Get in touch” and collaboration language. No prices, booking system, developer credit, or technical case study.
- Uploading, storage selection, R2, admin interfaces, and publishing automation are explicitly deferred. No backend work is necessary for this redesign.

## Repository grounding

Baseline: branch `main`, HEAD `9eaeae966693795cf17b1dd82a1c5b911d7e46ef` (revalidate on resume).
Next.js static export with React, TypeScript and CSS Modules; Cloudflare Pages and an existing Instagram Worker. Current homepage is a two-way hub; collection pages render InstagramFeed as their main content. Navigation, footer, contact context and metadata contain two-collection assumptions. Existing Instagram browser tests cover carousels, embeds and transitions, not the proposed curated gallery.

Preserve unrelated untracked files observed at planning time: `tools/build-omp-portable.ps1`, `tools/install-omp-tooling.ps1`, `tools/pack-claude-profile.ps1`. Never commit, push, deploy, discard changes, expose credentials, or clean up unrelated files without authorization. A push to main deploys production; do not use it for previews.

## Execution and review orchestration

Latest user override (2026-09-07): explicitly use Astra for this independent review. `/root/astra_review`, GPT-6 Astra high, read-only origin worktree at HEAD9eaeae9 plus current redesign diff, no write ownership. This supersedes the Luna-only restriction for this review; primary integrates bounded fixes.

The primary agent owns decisions, shared contracts, integration and final verification. User explicitly requires **GPT-5.6 Luna only for all subagents**, overriding the default M3 workflow. Do not launch M3, Terra, Sol, or other models as subagents. Use `gpt-5.6-luna`, high reasoning for implementation and independent review, medium for bounded inventory, and xhigh only for a difficult cross-component regression. Use a fresh context or a bounded history fork when setting model/reasoning overrides. Do not request Fast mode. If Luna is unavailable, record the blocker rather than substituting a model.

At most three Luna agents alongside the primary. Parallelize independent read-only tasks freely. For writing tasks, prepare isolated worktrees with an explicit approved baseline and non-overlapping path ownership; do not assume uncommitted work transfers automatically. If isolation cannot be set up without unauthorized operations, serialize writers. Only the primary updates this ledger and integrates results. Shared styles, types, package manifests and lockfiles have one owner at a time. Workers stop and report when they need changes outside their boundary. No worker may spawn other agents.

Every assignment must state task ID, model/reasoning, baseline, worktree, owned paths, dependencies, acceptance criteria and checks. Return changed files, checks with outcomes, findings, remaining risks and next action. Independent reviewers do not edit. Resolve evidence-backed findings, rerun affected checks, then request fresh review of the accumulated diff.

## Milestones and gates

| ID | Action / owner | Dependency | Done when | Status |
|---|---|---|---|---|
| P0 | Primary saves brief and ledger; Luna audits repository boundaries | None | Requirements, checks and resume procedure recorded | Done |
| P1 | Primary establishes baseline checks; Luna develops homepage and shared visual foundation | P0 | Responsive local concept, labelled placeholders, three panels, intro, contact entry, screenshots at desktop/mobile | Done |
| P2 | Primary evaluates concept with user and records requested revisions; Luna refines it | P1 | Visual direction has concrete feedback recorded; no implication that placeholders prove final photography quality | Done: user Continue |
| P3 | Primary fixes collection data/component contracts; Luna builds curated gallery and viewer | P2 | All three collections work with mixed aspect ratios and accessible fullscreen controls | Done |
| P4 | Luna integrates secondary Instagram, shared navigation/footer/contact styling, and discovery metadata | P3 | Feed behavior preserved, climbing independent, three collections discoverable, contact truthful | Done |
| P5 | Independent reviews and primary verification | P4 | Required checks pass, visual and keyboard flows inspected, actionable findings resolved | Done: Luna and Astra reviews resolved |
| P6 | Primary delivers preview and final checkpoint | P5 | Changed files, screenshots, checks, limitations and next photo-selection step documented | Done |

P1 implementation ownership: homepage, global tokens, root typography and shared shell styling in one serialized task. Keep existing DM Serif Display and Outfit as the first typography treatment; reduce decorative monospace use. Use an ordinary CSS grid for three panels, not an autoplay slideshow. Capture 1440px desktop and 390px mobile views for review.

P3 contract: a small typed local collection manifest with stable image IDs, source, width, height and alt text; array order is display order. Collection identity supports underwater, portraits and climbing, while Instagram account identity remains limited to underwater and portraits. Do not expand Worker endpoints or feed validators to include climbing. Build a curated gallery independent of Instagram normalization. Inspect current viewer before deciding whether a small presentational extraction is safe; default to leaving its feed/carousel implementation intact and reuse existing scroll-lock utilities where appropriate. Avoid a speculative universal media system.

P4 defaults: render recent Instagram work below the curated gallery on each connected collection page. Homepage recent-work section provides links to those two sections, avoiding duplicate live feed mounts. Climbing receives a generic footer/contact without an invented Instagram handle. Update navigation to expose all collections and the active page, including mobile. Keep contact mailto behavior, and update site description, route metadata, sitemap, and affected social preview assets/copy to remove “two worlds” and “Underwater & Nature” branding. Retain stable existing URLs.

After contracts are settled, independent tests or metadata work may run beside a gallery implementation only when file ownership and artifacts do not overlap. Do not force concurrency into shared shell work.

## Verification and acceptance

- Before edits, run `npm run check` and `npm run build`; record baseline failures separately from regressions. Do not fix unrelated failures silently.
- Before completion, run `npm run check`, `npm run build`, `npm run test:lightbox-smoke`, `npm run test:embed-smoke`, `npm run test:lightbox-fade`, and `npm run test:grid-fade-audit`. Inspect scripts' build, Python/browser and port requirements first. Serialize builds and browser checks unless isolation is verified. Update brittle selectors only to preserve the behavior they tested, not to hide failures.
- Add focused curated-gallery browser coverage: all three routes and homepage links; wide/tall images retain proportions; viewer open/close, arrows, Escape, focus containment/restoration and background scroll lock; contact interaction; mobile navigation; reduced motion; content visible without reveal enhancement. Use deterministic local fixtures, not live Instagram reliability.
- Test existing recent-feed success, empty and failure states and collaborator embed behavior. A failed feed must not prevent curated browsing or contact. Confirm `/climbing/` makes no Instagram account request.
- Inspect desktop 1440px, tablet 768px and mobile 390px layouts, plus narrow 320px overflow. Verify focus indicators, readable contrast, touch targets, no clipped modal controls, and no photograph distortion. Review the actual rendered screenshots, not only DOM assertions.
- Reserve image dimensions, lazy-load below-fold images and avoid lazy-loading the opening visual. Confirm no new console errors and no unnecessary feed duplication. Do not claim final image performance until real photographs replace placeholders.
- Verify static export includes climbing, canonical URLs/sitemap are consistent, and direct route loads work. No backend, uploads, paid features or public release is part of the completion gate.

## Resume protocol and evidence ledger

This file is the durable source of truth. Update it before/after each agent launch, integration, milestone, user decision and quota interruption. Write compact evidence, not transcripts. A file in the working tree survives a session interruption but is not a remote backup; no commit/push is authorized by this plan.

For every active task append: ID, status (`pending/running/review/blocked/done`), Luna model/reasoning, agent ID, exact worktree and baseline, owned paths, output location, checks/results, unresolved findings and next action. Mark “done” only with inspected evidence.

On resume:
1. Read this plan, repository instructions and `git status`; compare current HEAD and diffs with recorded baseline. Preserve new user changes.
2. Inspect saved worktrees and tool/agent handles. Verify a job is live before waiting or relaunching; quota exhaustion or an observation timeout alone does not prove it stopped. Never assume old agents are still available.
3. Inspect existing outputs and check evidence; continue from the earliest incomplete dependency. Reassign stopped unfinished tasks to Luna only, with a focused brief and current baseline.
4. Record failures honestly. Do not restart completed milestones or repeat unchanged tests without a new reason.
5. After a major milestone, provide a short handoff and recommend a fresh task pointing to this file if context is large. Do not create scheduled wakeups or promise automatic resumption after quota resets.

### Planning checkpoint (superseded by execution ledger below)

- Requested deliverable for this turn: an action plan and persistent tracking, not implementation.
- Completed: conversation requirements consolidated; repository instructions, current HEAD/status, route/shell types and test scripts inspected.
- Completed: Luna read-only planning audit (`/root/plan_audit`, requested `gpt-5.6-luna`, high reasoning; shared repository, no source ownership). Audit confirmed binary navigation assumptions and the coupled Instagram viewer; these are reflected in P3/P4. No independent lightbox extraction is required.
- Audit-reported checks: `npm test` passed (73 tests), `npm run typecheck` passed, `npm run lint` passed (42 files). These are agent-reported baseline evidence; production build and browser checks have not been run in this planning turn. Revalidate at P1 if state changes.
- No website files changed. Only this action-plan document was added by the primary. Existing untracked scripts remain untouched.
- Next action: future implementation begins at P1. Primary owns orchestration, Luna-only task assignments and ledger updates. No implementation agents are running.
- Deferred user inputs: curated photographs and optional birthplace/background details. Neither blocks placeholder design; never invent them.

### Execution ledger — 2026-09-06

- Resume: HEAD and unrelated untracked files match planning baseline. Primary independently ran `npm run check` (73 tests, lint and both typechecks passed) and `npm run build` (passed static export).
- P1 running: `/root/homepage_p1`, `gpt-5.6-luna`, high reasoning, isolated detached worktree `C:/Users/Micha/.codex/worktrees/tinglingding-redesign-p1`, baseline `9eaeae966693795cf17b1dd82a1c5b911d7e46ef`. Ownership: homepage TSX/CSS, global CSS, root typography only, new local placeholder assets and optional ScrollReveal component. No commits, pushes or deployments.
- Next: inspect Luna output, integrate owned files after checking origin unchanged, run checks/build, capture and inspect desktop/mobile concept. P2 asks for visual feedback before gallery implementation; the full redesign remains incomplete until P3–P6.
- P1 source review: initial Luna draft required correction before integration: photo panels must lead rather than follow an oversized introduction; remove unconfirmed Vancouver location and remaining “& nature” label; reduce decorative monospace. Same Luna agent assigned a correction, same worktree/ownership.
- Primary added `tests/homepage-smoke.mjs` (syntax checked) for 1440/768/390/320 widths, local assets, anchors, contact focus/scroll lock/Escape and no-JavaScript visibility. Screenshots will be saved under ignored `preview/redesign/`. Test execution pending integrated build.
- Read-only test audit completed by `/root/homepage_test_design` (Luna medium): existing fade/embed scripts share port 4322 and must be serialized; new homepage check uses 4324.
- P1 integrated: homepage TSX/CSS, global CSS, three SVG placeholders. Browser screenshots inspected; mobile title collision found visually and corrected by Luna, then strengthened in smoke test. Primary replaced equivalent named grid areas with explicit row/column placement to satisfy repository Biome lint. Origin CSS now includes this small integration correction beyond the isolated worktree; do not overwrite it from the worker copy.
- Initial homepage smoke passed all four widths and no-JavaScript check before tighter title-fit assertion. Initial Instagram lightbox smoke failed to get mocked photos; its mock covers only the production public proxy, while other scripts also cover local proxy. Final build explicitly uses tracked public production URL for deterministic checks; no env files changed. First browser attempt before build completion used stale export and was discarded.
- P1 independent review running: `/root/p1_review`, Luna high, read-only origin worktree, homepage/assets/new test and global CSS ownership review. Final verification logs saved in ignored `preview/redesign/`.
- Final deterministic checks: `npm run check` passed with 73 tests and no lint warnings; production-configured `npm run build` passed. All five browser scripts passed: homepage-smoke, lightbox-smoke, instagram-embed-smoke, lightbox-fade-audit, grid-fade-audit. Each script's output is in `preview/redesign/<script>.log`; build/check logs alongside. `git diff --check` passed.
- Primary visually inspected final `preview/redesign/home-1440.png` and `home-390.png`; title collision is resolved. Other captures: `home-768.png`, `home-320.png`. Artwork is explicitly placeholder content, not final photography. The existing collection pages/contact retain some older styling until P4.
- Local static preview started at `http://127.0.0.1:4325/`, exec session `94197`, serving `out/`. Verify process on resume before assuming live. Browser panel open queued successfully. Recreate with `python -m http.server 4325 --bind 127.0.0.1 --directory out` only if stopped.
- P2 feedback requested through async question: keep direction, simplify text/spacing, or change direction. Await actual user feedback before P3; no automatic interpretation of elapsed time as agreement. Full goal remains active/incomplete.
- Independent review findings addressed by primary: contact header/footer targets now at least 44px (browser assertion added), root viewport themeColor matches charcoal, opening heading reduced to a compact desktop line with panels higher in viewport. A compact title before panels is intentional; personal introduction remains below. Fresh Luna re-review requested; final screenshots/build being refreshed. Root `app/layout.tsx` themeColor is the only added implementation path beyond original P1 ownership.
- Second review corrections: remove embedded SVG text labels (keep single HTML placeholder label and accessible alt text), restore top/bottom and horizontal safe-area padding for viewport-fit cover. Final source diverges from retained worker worktree by these primary integration fixes. Fresh independent confirmation requested.
- P1 final gate COMPLETE: fresh Luna source/screenshot review returned zero actionable findings; primary inspected final desktop, mobile, tablet and narrow-phone captures. Final lint/build/homepage smoke passed after last CSS/assets corrections. Existing four Instagram suites passed after global colour changes; subsequent corrections only affect homepage CSS/assets and viewport theme colour, so those suites were not unnecessarily repeated.
- Final changed implementation files: `app/page.tsx`, `app/page.module.css`, `app/globals.css`, `app/layout.tsx`, three `public/placeholders/*.svg`, `tests/homepage-smoke.mjs`. This ledger is also updated. Unrelated tooling scripts untouched; no commit/push/deployment. Agent work is finished; local preview server is the only expected running process.
- Resume at P2: collect/review the user's visual feedback for the local concept, record it, then continue P3–P6 with Luna-only delegation. Do not mark the overall goal complete: curated galleries, climbing route and P4 integration are not implemented yet. Uploading and final photographs remain deferred.

### P3/P4 execution wave

- User explicitly said “Continue” while viewing local concept. Proceed with current direction; no new visual revisions requested. Prior P1 evidence remains valid and worktree matches checkpoint.
- `/root/gallery_p3`: Luna high, isolated `C:/Users/Micha/.codex/worktrees/tinglingding-redesign-gallery`; baseline HEAD9eaeae9 plus explicit copy of current P1 tracked changes/placeholders. Own curated gallery/data/CSS, three collection routes, and new landscape/square placeholder SVGs. Read existing SVGs only. No shared shell writes.
- `/root/shell_p4`: Luna high, isolated `C:/Users/Micha/.codex/worktrees/tinglingding-redesign-shell`; same copied P1 baseline. Own nav/footer/contact/global CSS, root metadata/sitemap/social previews, homepage link updates only. No collection-route or gallery writes.
- Shared contracts settled before launch: SiteNav current supports underwater/portraits/climbing; curated data independent of IG identities; recent-work anchors on two existing routes; homepage links climb to real route. Curated buttons use “Open photograph N of M”, viewer named “[collection] photograph viewer”, controls “Close photograph viewer”, “Previous photograph”, “Next photograph”, data-curated-gallery and data-curated-viewer. Preserve Instagram “View photo” selectors/behavior.
- Primary owns integration and verification; no concurrent shared-worktree writers. No credentials/env-local copied. No commit/push/deploy.
- `/root/gallery_tests`: Luna high, isolated `C:/Users/Micha/.codex/worktrees/tinglingding-redesign-tests`, HEAD9eaeae9 plus copied P1 homepage test/plan. Own only new curated-gallery browser test and adapting homepage smoke to final routing. Primary added package script entries, docs/manifest descriptions and theme colours, 404 third-collection link, and metadata test coverage for climbing; these paths are excluded from workers.
- Shell worker completed and 16 owned files integrated by primary. Agent-reported changed-file Biome and diff checks passed; social previews verified1200x630. Primary integration validation waits for gallery routes/tests so all interfaces exist.
- Gallery worker completed: 8 route/data/component files plus12 new SVG variants integrated; self-review/lint/XML checks reported passed. Test worker files integrated; primary strengthened climbing no-proxy assertion. Integrated `npm run check` passed; production build running (exec63910).
- Fresh independent Luna high reviews launched read-only at origin: `/root/redesign_review` (full correctness/accessibility/scope) and `/root/coverage_review` (test/acceptance evidence). Primary owns build/browser/visual checks. All implementation agents idle; retained isolated worktrees are evidence only and must not overwrite later primary fixes.
- Quota interruption: both reviewer turns errored at the usage limit; no completed review was inferred. On resumption live usage was available; same Luna reviewers resumed. Old exec41468 was missing; saved logs proved homepage pass and gallery failure. No unfinished implementation was relaunched.
- Gallery failure exposed existing feed H1 duplicating new page H1. Primary changed feed title to Underwater (retired Nature label removed) and H3 beneath Recent work H2; test now asserts exactly one H1. Independent correctness reviewer confirmed same finding. Mobile shell retains readable brand/contact text; screenshots reset scroll/focus before capture.
- Coverage review requested visible feed failure/fallback assertions, built canonical/social/sitemap audit, reverse focus/backdrop/boundary behavior and narrow/tablet navigation checks. Primary added these to curated smoke. Fresh check/build passed after source corrections; expanded gallery browser run active (exec86629).
- Final integrated browser gate: all six scripts passed (homepage, curated-gallery, Instagram lightbox, embed, lightbox fade, grid fade). Expanded gallery suite also proves all image/viewer control bounds, reverse focus and boundaries, backdrop/Escape, failed-image recovery, actual reduced-motion style, visible unavailable/profile/retry state, no climbing proxy, no-JS visibility, built canonicals/social URLs and exact sitemap membership. Focus restoration test waits for the component's scheduled animation frame rather than checking before restoration occurs.
- Primary inspected final gallery screenshots including climbing390 and portraits1440, and previous underwater desktop/mobile. Final captures under ignored `preview/redesign/collection-<id>-<width>.png`. All command logs saved alongside. Check/build passed (73tests, lint/types/static export).
- Local preview server from earlier turn was confirmed unavailable; recreated serving current out at `http://127.0.0.1:4325/`, exec21453. Climbing preview queued in Codex browser. Revalidate handle/HTTP on next resume. Independent Luna reviewers both re-requested after fixes, awaiting clean results.
- User steering: “Get rid of that ugly brown colour asap.” Primary immediately replaced warm/brown background and gold accents with neutral near-black (#111214), white (#f2f3f4) and cool grey (#c6ccd3) across global/home/viewer/manifest/browser theme. Social preview typography regenerated with same palette. This is the accepted latest direction; do not restore warm brown/gold on resume. Placeholder artwork still represents future images, not the UI theme.
- Neutral-palette build passed. New social PNGs copied into static out after generation (source and preview match). Fresh check/homepage/gallery scripts running; full existing IG regression suites already passed before colour-only steering. README obsolete route/style references corrected per independent review.

### Astra review — 2026-09-07

- P0–P4 complete; P5 final review and P6 delivery remain. Uploads and real photo selection remain deferred. Astra reviews plan/code/screenshots while primary inspects UI.
- Prior neutral check/build/homepage/gallery passed; prior Luna findings resolved.
- Primary refinements: mobile viewer uses full width with arrows below and fixed close corner; disabled arrows retain disabled hover appearance; homepage empty gaps reduced; collection header uses neutral text branding. Verification pending.

### Final checkpoint — 2026-09-07

- Astra identified narrow contact-email overflow, undersized mobile viewer images, and legacy colourful collection branding. All resolved; fresh Astra review reports no remaining actionable findings. Homepage section gaps also tightened.
- Final pass changed Contact.module.css, CuratedGallery.module.css, SiteNav.tsx/CSS, page.module.css, curated-gallery-smoke.mjs and this plan. Unrelated tooling preserved.
- Passed: npm run check (73 tests, lint, typechecks), npm run build, gallery-smoke, homepage-smoke and git diff --check. Earlier four Instagram suites remain passing evidence; this pass does not change feed behavior. Logs: preview/redesign/{check,build,gallery,homepage}-astra.log.
- Updated desktop/mobile screenshots inspected by primary and Astra. Browser coverage includes 320px contact overflow, mobile viewer width, all viewer formats/controls, keyboard handling and no-JavaScript content.
- P5/P6 complete. Updated static preview verified HTTP200 at http://127.0.0.1:4325/climbing/. No commit, push or deployment.
- Deferred: curated real photographs and their performance assessment, uploads/storage, optional biography details. Start a fresh task referencing this checkpoint for the next major phase.

### Dynamic enhancement pass — 2026-09-07

- User requests more dynamic/technically impressive elements and removal of collection numbers. Scope: bounded pointer depth within homepage image crops, progressive gallery reveals and touch-swipe viewer navigation; preserve neutral palette and reduced-motion/no-JavaScript behavior.
- `/root/dynamic_gallery`, Luna high, isolated worktree C:/Users/Micha/.codex/worktrees/tinglingding-dynamic at HEAD9eaeae9 with current app/tests snapshot; owns only CuratedGallery.tsx/CSS. Primary owns homepage, number removal, tests, integration and verification. No uploads, commits or deployment.
- Status: implementation and checks in progress; previous P0–P6 completion applies to original redesign.
- Integrated: collection ordinal labels removed throughout; pointer depth stays within homepage image crops; CSS view-timeline gallery reveals with visible unsupported/reduced-motion fallback; touch swipe navigation and reduced-motion-aware viewer entrance. Primary removed the worker's redundant load-time stagger and its unused style index.
- Verified: npm run check (73 tests, lint, types), build, homepage-smoke and gallery-smoke passed. New browser assertions exercise pointer reset/reduced motion and actual CDP touch swipes (direction, threshold, boundaries, vertical gestures). Desktop/mobile screenshots inspected; live gallery view timeline confirmed. Logs: preview/redesign/{check,build,homepage,gallery}-dynamic.log. No dependencies or backend changes. Independent Luna review pending.
- Final independent Luna review completed with no actionable findings. Dynamic enhancement pass complete; updated local preview remains at http://127.0.0.1:4325/. No commit, push or deployment.

### Commit checkpoint — 2026-09-07

- User explicitly requested committing and building the current version. This authorizes the redesign commit; earlier no-commit instructions above are historical. Push and deployment remain outside this request.
- Commit scope: website source/assets, documentation and focused browser tests. Unrelated tools/build-omp-portable.ps1, tools/install-omp-tooling.ps1 and tools/pack-claude-profile.ps1 remain untracked. Static export stays in ignored out/.
