"use client";

import Image from "next/image";
import {
	type MouseEvent,
	type PointerEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import styles from "./InstagramFeed.module.css";
import {
	type IGPost,
	mergeInstagramPosts,
	normalizeInstagramPosts,
} from "./instagramData";
import { getInstagramEmbedUrl } from "./instagramEmbed";
import { getInstagramFeedDisplayState } from "./instagramFeedState";
import { buildOptimizedImageUrl } from "./instagramImageUrl";
import { fetchWithTimeout } from "./instagramFetch";
import { lockBodyScroll } from "./bodyScrollLock";

interface Props {
	/** IG handle without the @ */
	handle: string;
	/** Profile URL on instagram.com */
	profileUrl: string;
	/**
	 * Which side this is — used to route the proxy fetch.
	 * Set automatically by the page; the Worker uses it to pick the
	 * matching IG account.
	 */
	side: "underwater" | "portraits";
}

/**
 * Shape of a single child inside a CAROUSEL_ALBUM post. The Worker
 * inlines these on the parent post when it has the access token to
 * fetch them; the field is absent when the request failed or the
 * post is IMAGE / VIDEO.
 *
 * `instagramData.ts` does not model this field, so we declare the
 * shape here and cast at the boundary.
 */
interface IGCrossPostChild {
	id: string;
	media_type: "IMAGE" | "VIDEO";
	media_url: string;
	permalink?: string;
	thumbnail_url?: string;
}

type FeedPost = IGPost & { children?: IGCrossPostChild[] };

interface FeedResponse {
	data?: unknown;
	paging?: unknown;
}

function getPagingNext(response: unknown): unknown {
	if (!response || typeof response !== "object" || !("paging" in response))
		return null;
	const paging = response.paging;
	if (!paging || typeof paging !== "object" || !("next" in paging)) return null;
	return paging.next;
}

/**
 * `paging.next` is opaque from the client's point of view — the Worker
 * may send a short token, a full Instagram URL, or nothing at all.
 *
 * We accept either shape at the client boundary. A short opaque token
 * is forwarded to the Worker as-is. A full URL (e.g. from a stale cached
 * response whose shape predates the new proxy) is parsed and its `after`
 * query parameter is extracted, which is the only piece our proxy uses
 * for the next-page request. Anything unparseable yields `null` so we
 * don't fire a request that would 400.
 */
function normalizeCursor(next: unknown): string | null {
	if (typeof next !== "string" || !next) return null;
	// Looks like a full URL (http(s)://…) — parse it and pull `after`.
	if (/^https?:\/\//i.test(next)) {
		try {
			const params = new URL(next).searchParams;
			const after = params.get("after");
			return after && after.length > 0 ? after : null;
		} catch {
			return null;
		}
	}
	return next;
}
/**
 * InstagramFeed
 * Renders the IG feed section for a side page.
 *
 * Instagram's official APIs in 2026 are limited:
 *   - Basic Display API: shut down March 2025. Do not use.
 *   - Graph API: works only for Business/Creator accounts. CORS-blocked
 *     from a static client → we proxy through a Cloudflare Worker.
 *   - oEmbed: only for individual hardcoded posts. Not a real feed.
 *
 * This component calls our own Cloudflare Worker (CORS-safe, holds
 * the access token server-side, edge-cached) to get the real feed.
 * See workers/ig-proxy/ + README "Instagram feed via Cloudflare Worker".
 */
export function InstagramFeed({ handle, profileUrl, side }: Props) {
	const proxyUrl = process.env.NEXT_PUBLIC_IG_PROXY_URL;
	const [posts, setPosts] = useState<FeedPost[]>([]);
	const [error, setError] = useState<string | null>(null);
	// Opaque cursor for the next page. `null` while loading or when
	// the Worker signals there is no further page (`paging.next` is
	// absent or empty). We treat an absent cursor as the end of the
	// feed so we can render the disabled / "all loaded" state.
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
	// Tracks whether we've completed the first fetch for this side. The
	// placeholders above should keep showing until this flips to true so
	// a slow first fetch doesn't briefly flash real posts onto the page.
	const [hasInitialLoaded, setHasInitialLoaded] = useState(false);
	// Monotonic token bumped on every feed-lifecycle boundary (unmount,
	// or `proxyUrl` / `side` change). `fetchNextPage` captures the
	// current value at start and re-checks it before each state mutation;
	// a mismatch means the lifecycle ended and any in-flight response is
	// stale, so the setter is skipped. This is the only safe way to
	// guard an `await fetch(...)` chain against the component unmounting
	// (or `side` switching) mid-request — without it, React would log a
	// "setState on unmounted" warning and we'd briefly leak the late
	// page into the wrong lifecycle's grid.
	const lifecycleTokenRef = useRef(0);

	// Initial-fetch entry point. Re-used by the mount/`side`/`proxyUrl`
	// effect AND by the initial-load Retry button so both paths funnel
	// through the same lifecycle guards: bumping the token invalidates
	// any in-flight response, resetting the state prevents a previous
	// failure from leaking into the new attempt, and the `cancelled`
	// closure short-circuits setters if the effect cleanup runs while
	// the request is still pending.
	const runInitialFetch = useCallback(() => {
		if (!proxyUrl) return;
		const token = ++lifecycleTokenRef.current;
		let cancelled = false;
		setError(null);
		setPosts([]);
		setNextCursor(null);
		setLoadMoreError(null);
		setIsLoadingMore(false);
		setHasInitialLoaded(false);
		const url = `${proxyUrl.replace(/\/$/, "")}/${side}`;
		fetchWithTimeout(url)
			.then((r) => {
				if (!r.ok) throw new Error(`Proxy ${r.status}`);
				return r.json() as Promise<FeedResponse>;
			})
			.then((data: FeedResponse) => {
				if (cancelled || lifecycleTokenRef.current !== token) return;
				const validPosts = normalizeInstagramPosts(data) as FeedPost[];
				const initialCursor = normalizeCursor(getPagingNext(data));
				setPosts(mergeInstagramPosts([], validPosts));
				setNextCursor(initialCursor);
				if (validPosts.length === 0 && initialCursor === null) {
					setError("No valid posts were returned.");
				}
			})
			.catch((e) => {
				if (!cancelled && lifecycleTokenRef.current === token)
					setError(e instanceof Error ? e.message : String(e));
			})
			.finally(() => {
				if (!cancelled && lifecycleTokenRef.current === token)
					setHasInitialLoaded(true);
		});
		return () => {
			cancelled = true;
			lifecycleTokenRef.current += 1;
		};
	}, [proxyUrl, side]);

	useEffect(() => {
		return runInitialFetch();
	}, [runInitialFetch]);

	// Initial-load Retry. User-driven only — re-runs the same lifecycle
	// path (token bump + state reset + fetch) so a failed initial
	// request can be retried without touching the side/proxyUrl state.
	const handleInitialRetry = useCallback(() => {
		runInitialFetch();
	}, [runInitialFetch]);

	// Build the proxy URL for the next page. `nextCursor` is the opaque
	// value we stored from the previous response — we never re-parse it
	// here. URL/URLSearchParams handles encoding for us, so a cursor with
	// `&`, `=`, `+`, or `#` won't break the request.
	const buildNextPageUrl = useCallback(
		(cursor: string): string | null => {
			if (!proxyUrl) return null;
			const base = `${proxyUrl.replace(/\/$/, "")}/${side}`;
			const url = new URL(base);
			url.searchParams.set("cursor", cursor);
			return url.toString();
		},
		[proxyUrl, side],
	);

	// Sentinel-driven pagination. The intersection observer watches the
	// ref'd sentinel <div>; when it nears the viewport (generous
	// rootMargin so pages start loading before the user reaches the
	// bottom) we kick off the next fetch — but only if we have a cursor,
	// aren't already loading, and aren't in an error state (the user must
	// press Retry to recover from an error, otherwise we'd hot-loop).
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	// Mirror the error into a ref so the observer-effect closure can read
	// the latest value without forcing the effect to re-bind (which would
	// disconnect + reconnect the IntersectionObserver on every error flip).
	const loadMoreErrorRef = useRef<string | null>(null);

	// The "load more" core. Re-used by the observer and the explicit
	// Retry button so both code paths funnel through one set of guards:
	// - no proxy configured        → bail
	// - another request in flight  → bail (concurrency)
	// - error state still set      → bail (observer path only — Retry
	//                                 passes the explicit `force` flag so
	//                                 it can clear the error and retry).
	// - lifecycle ended (unmount or `proxyUrl`/`side` change since the
	//   request started) → bail before any setter runs so the response
	//   can't leak posts / cursor / error / loading into the new
	//   lifecycle.
	// On success we replace `nextCursor` with the new opaque value,
	// normalized so a stale cached full-URL `paging.next` still works.
	const fetchNextPage = useCallback(
		async (force: boolean = false) => {
			if (!proxyUrl) return;
			if (isLoadingMore) return;
			if (!force && loadMoreErrorRef.current) return;
			if (nextCursor === null) return;
			const nextPageUrl = buildNextPageUrl(nextCursor);
			if (!nextPageUrl) return;
			// Snapshot the current lifecycle token so we can detect that the
			// unmount / proxyUrl / side change happened while we were awaiting.
			// Reading the ref here (not in a state) means we always see the
			// latest value without re-creating this callback.
			const token = lifecycleTokenRef.current;
			if (force) {
				loadMoreErrorRef.current = null;
				setLoadMoreError(null);
			}
			setIsLoadingMore(true);
			try {
				const response = await fetchWithTimeout(nextPageUrl);
				// Bail before reading the body if the lifecycle ended while the
				// network round-trip was in flight.
				if (lifecycleTokenRef.current !== token) return;
				if (!response.ok) throw new Error(`Proxy ${response.status}`);
				const data = (await response.json()) as FeedResponse;
				// Re-check after the second await — a proxy/flip while parsing
				// would otherwise leak posts into the next lifecycle.
				if (lifecycleTokenRef.current !== token) return;
				const incoming = normalizeInstagramPosts(data) as FeedPost[];
				setPosts((existing) => mergeInstagramPosts(existing, incoming));
				setNextCursor(normalizeCursor(getPagingNext(data)));
			} catch (e) {
				// Skip error reporting for a stale lifecycle — surfacing it would
				// show a phantom error message in the new (or unmounted) feed.
				if (lifecycleTokenRef.current !== token) return;
				const message = e instanceof Error ? e.message : String(e);
				setLoadMoreError(message || String(e));
			} finally {
				// Only the lifecycle that started this request is allowed to
				// clear its own loading flag. A late `finally` after unmount /
				// lifecycle flip must be a no-op, otherwise we'd clobber the
				// new lifecycle's loading state (or warn about an unmounted
				// component).
				if (lifecycleTokenRef.current === token) setIsLoadingMore(false);
			}
		},
		[proxyUrl, buildNextPageUrl, nextCursor, isLoadingMore],
	);

	// Observer is (re)attached whenever the sentinel mounts or the
	// pagination state changes. Cleanup disconnects before reattach, so
	// we don't accumulate listeners or double-fire during fast scrolls.
	useEffect(() => {
		const node = sentinelRef.current;
		if (!node) return;
		// Pause auto-loading while a previous attempt failed — the user
		// must press Retry to recover, otherwise the observer would fire
		// again immediately and we'd hot-loop.
		if (loadMoreErrorRef.current) return;
		if (nextCursor === null) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					fetchNextPage(false);
				}
			},
			// Generous rootMargin so the next page is already in flight by
			// the time the sentinel enters the viewport — no visible pause.
			{ rootMargin: "600px 0px 600px 0px" },
		);
		observer.observe(node);
		return () => {
			observer.disconnect();
		};
	}, [fetchNextPage, nextCursor]);
	// Keep the ref synced with the latest error so the observer can read
	// it without triggering a rebind on every error flip.
	useEffect(() => {
		loadMoreErrorRef.current = loadMoreError;
	}, [loadMoreError]);
	// Explicit retry — clears the error and fires one immediate fetch.
	// The observer stays paused for this tick; the cleanup above will
	// reattach it once `loadMoreError` flips to null on the next render.
	const handleRetry = useCallback(() => {
		if (isLoadingMore) return;
		fetchNextPage(true);
	}, [fetchNextPage, isLoadingMore]);

	const { showRealPosts, showPlaceholder, showPagination } =
		getInstagramFeedDisplayState({
			hasProxy: Boolean(proxyUrl),
			postCount: posts.length,
			nextCursor,
			hasInitialLoaded,
		});

	// Show the placeholder when we know there's nothing to render — i.e.
	// either the first fetch has completed and returned nothing, or the
	// proxy URL isn't configured at all. While the very first fetch is
	// still in flight we render neither, so we don't flash the
	// placeholder just before the grid pops in.
	return (
		<section
			className={styles.feed}
			id="instagram"
			aria-label={`Latest posts from @${handle}`}
		>
			<div className="container">
				<FeedHeader handle={handle} profileUrl={profileUrl} side={side} />

				{showRealPosts ? (
					<>
						<link
							rel="preconnect"
							href="https://www.instagram.com/"
							crossOrigin="anonymous"
						/>
						<div className={styles.grid}>
							{posts.map((post, index) => (
								<PostTile
									key={post.id}
									post={post}
									handle={handle}
									proxyUrl={proxyUrl}
									priority={index === 0}
								/>
							))}
						</div>
						{/*
              Pagination row. The sentinel <div> is what the
              IntersectionObserver watches — placing it inside the grid
              footer keeps the observer attached while the grid is on
              screen and detached when the user navigates away. We
              render exactly one of {loading, end, error+retry}.
             */}
						<div className={styles.sentinelRow}>
							<div
								ref={sentinelRef}
								className={styles.sentinel}
								aria-hidden="true"
							/>
							{loadMoreError ? (
								<div className={styles.retryBlock}>
									<p className={styles.retryError} role="alert">
										Couldn&apos;t load more posts. {loadMoreError}
									</p>
									<button
										type="button"
										className={styles.retryButton}
										onClick={handleRetry}
										disabled={isLoadingMore}
										aria-busy={isLoadingMore}
									>
										{isLoadingMore ? "Retrying…" : "Retry"}
									</button>
								</div>
							) : nextCursor === null ? (
								<p className={styles.statusEnd} role="status">
									You&apos;ve reached the end.
								</p>
							) : (
								<p
									className={styles.statusLoading}
									role="status"
									aria-live="polite"
								>
									{isLoadingMore ? "Loading more posts…" : "Scroll for more"}
								</p>
							)}
						</div>
					</>
				) : !hasInitialLoaded && proxyUrl ? (
					<div className={styles.initialLoading} role="status" aria-live="polite">
						<span className={styles.loadingDot} aria-hidden="true" />
						Loading the latest work…
					</div>
				) : showPlaceholder ? (
					<div className={styles.placeholder} role="status">
						<p className={styles.placeholderTitle}>
							Instagram photos are unavailable right now.
						</p>
						<p className={styles.placeholderNote}>
							Visit @{handle} on Instagram to see the latest work.
							{process.env.NODE_ENV !== "production" && error
								? ` (${error})`
								: ""}
						</p>
						<a
							href={profileUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="btn btn--primary"
						>
							View Instagram profile
						</a>
						{proxyUrl && error ? (
							<div className={styles.retryBlock}>
								<button
									type="button"
									className={styles.retryButton}
									onClick={handleInitialRetry}
								>
									Retry
								</button>
							</div>
						) : null}
					</div>
				) : null}
				{!showRealPosts && showPagination ? (
					<div className={styles.sentinelRow}>
						<div
							ref={sentinelRef}
							className={styles.sentinel}
							aria-hidden="true"
						/>
						{loadMoreError ? (
							<div className={styles.retryBlock}>
								<p className={styles.retryError} role="alert">
									Couldn&apos;t load more posts. {loadMoreError}
								</p>
								<button
									type="button"
									className={styles.retryButton}
									onClick={handleRetry}
									disabled={isLoadingMore}
									aria-busy={isLoadingMore}
								>
									{isLoadingMore ? "Retrying…" : "Retry"}
								</button>
							</div>
						) : (
							<p
								className={styles.statusLoading}
								role="status"
								aria-live="polite"
							>
								{isLoadingMore
									? "Loading more posts…"
									: "Scroll for more"}
							</p>
						)}
					</div>
				) : null}
			</div>
		</section>
	);
}

interface PostTileProps {
	post: FeedPost;
	handle: string;
	/** ig-proxy origin used to build resized /img URLs; undefined disables resizing. */
	proxyUrl: string | undefined;
	/** True only for the first visible tile (the likely LCP image). */
	priority?: boolean;
}

/**
 * Requested widths for the ig-proxy /img route. The tile grid shows each
 * image at ~30vw, so 800px covers 2x on most screens; the lightbox is
 * near full-viewport, so it asks for a larger frame.
 */
const TILE_IMAGE_WIDTH = 800;
const LIGHTBOX_IMAGE_WIDTH = 1600;

/**
 * Renders a single IG post. For CAROUSEL_ALBUM posts with inlined
 * children we render a local carousel with prev/next buttons. IMAGE /
 * VIDEO posts — and CAROUSEL_ALBUM posts without children — fall back
 * to the parent's media_url (and thumbnail for VIDEO).
 *
 * The image is a real <button> (TileImageButton) that opens the
 * lightbox viewer. Carousel arrows are siblings of the image button,
 * sitting above it in z-order so a tap on a chevron does not also
 * open the viewer. The Instagram permalink lives ONLY inside the
 */
function PostTile({ post, handle, proxyUrl, priority = false }: PostTileProps) {
	const isCarousel = post.media_type === "CAROUSEL_ALBUM";
	const children =
		isCarousel && Array.isArray(post.children) ? post.children : null;
	const slides = children && children.length > 0 ? children : null;
	const embedUrl =
		isCarousel && slides === null ? getInstagramEmbedUrl(post.permalink) : null;
	const label = post.caption
		? post.caption.replace(/\s+/g, " ").trim().slice(0, 100)
		: `Instagram post by @${handle}`;
	// Shorter, visible-on-hover caption. Only render when the post has
	// a real caption — the fallback `label` is built for the aria-label
	// and would read weirdly as a hover overlay.
	const caption = post.caption
		? post.caption.replace(/\s+/g, " ").trim().slice(0, 80)
		: null;
	const fallbackSrc =
		post.media_type === "VIDEO" && post.thumbnail_url
			? post.thumbnail_url
			: post.media_url;
	const [slideIndex, setSlideIndex] = useState(0);
	const totalSlides = slides?.length ?? 0;
	const safeIndex =
		totalSlides === 0 ? 0 : Math.min(slideIndex, totalSlides - 1);
	const slideSrcAt = useCallback(
		(index: number) => {
			const child = slides?.[index];
			return child === undefined
				? fallbackSrc
				: child.media_type === "VIDEO" && child.thumbnail_url
					? child.thumbnail_url
					: child.media_url;
		},
		[fallbackSrc, slides],
	);
	// Resize through the ig-proxy /img route when available. If the
	// proxy URL is missing or the source is not an Instagram CDN asset,
	// buildOptimizedImageUrl returns the raw URL unchanged.
	const optimizeSrc = useCallback(
		(raw: string, width: number) =>
			buildOptimizedImageUrl(raw, width, proxyUrl),
		[proxyUrl],
	);
	// Once any image in the tile fails to load through the proxy, fall
	// back to the raw Instagram CDN URLs for the whole tile so the feed
	// keeps working when the resize route is down.
	const [imageProxyFailed, setImageProxyFailed] = useState(false);
	const displaySrcAt = useCallback(
		(index: number, width: number) =>
			imageProxyFailed ? slideSrcAt(index) : optimizeSrc(slideSrcAt(index), width),
		[imageProxyFailed, optimizeSrc, slideSrcAt],
	);
	const currentSrc = displaySrcAt(safeIndex, TILE_IMAGE_WIDTH);
	const [transition, setTransition] = useState<{
		src: string;
		targetSrc: string;
		sequence: number;
		fading: boolean;
		direction: -1 | 1;
	} | null>(null);
	const beginTransition = useCallback(
		(targetIndex: number, direction: -1 | 1) => {
			setTransition((active) => ({
				// Before the pending image loads, preserve the frame that is
				// actually still visible. Once a fade is running, currentSrc is
				// loaded and is safe to become the next outgoing frame.
				src: active && !active.fading ? active.src : currentSrc,
				targetSrc: displaySrcAt(targetIndex, TILE_IMAGE_WIDTH),
				sequence: (active?.sequence ?? 0) + 1,
				fading: false,
				direction,
			}));
		},
		[currentSrc, displaySrcAt],
	);
	const goPrev = useCallback(() => {
		if (safeIndex <= 0) return;
		const nextIndex = safeIndex - 1;
		beginTransition(nextIndex, -1);
		setSlideIndex(nextIndex);
	}, [beginTransition, safeIndex]);
	const goNext = useCallback(() => {
		if (safeIndex >= totalSlides - 1) return;
		const nextIndex = safeIndex + 1;
		beginTransition(nextIndex, 1);
		setSlideIndex(nextIndex);
	}, [beginTransition, safeIndex, totalSlides]);
	const handleLiveImageLoad = useCallback((loadedSrc: string) => {
		setTransition((active) =>
			active?.targetSrc === loadedSrc ? { ...active, fading: true } : active,
		);
	}, []);
	const handleOutgoingFadeEnd = useCallback(() => {
		setTransition(null);
	}, []);
	const [lightboxOpen, setLightboxOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const swipeStart = useRef<{ x: number; y: number } | null>(null);
	const suppressClick = useRef(false);
	const handlePointerDown = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			swipeStart.current = { x: event.clientX, y: event.clientY };
			suppressClick.current = false;
		},
		[],
	);
	const handlePointerUp = useCallback(
		(event: React.PointerEvent<HTMLButtonElement>) => {
			const start = swipeStart.current;
			swipeStart.current = null;
			if (!start || !slides || slides.length < 2) return;
			const dx = event.clientX - start.x;
			const dy = event.clientY - start.y;
			if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
			suppressClick.current = true;
			if (dx < 0) goNext();
			else goPrev();
		},
		[goNext, goPrev, slides],
	);
	const openLightbox = useCallback(() => {
		if (suppressClick.current) {
			suppressClick.current = false;
			return;
		}
		setTransition(null);
		setLightboxOpen(true);
	}, []);
	const closeLightbox = useCallback(() => {
		setLightboxOpen(false);
		const trigger = triggerRef.current;
		if (trigger) requestAnimationFrame(() => trigger.focus());
	}, []);
	const canPrev = slides !== null && slides.length > 1 && safeIndex > 0;
	const canNext =
		slides !== null && slides.length > 1 && safeIndex < totalSlides - 1;
	return (
		<div className={styles.tile}>
			<TileImageButton
				src={currentSrc}
				label={label}
				onOpen={openLightbox}
				onImageLoad={handleLiveImageLoad}
				onImageError={() => setImageProxyFailed(true)}
				transitionDirection={transition?.fading ? transition.direction : null}
				triggerRef={triggerRef}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUp}
				priority={priority}
			/>
			{transition ? (
				// The outgoing image must paint above the live image button for
				// the fade to be visible. Controls render later at the same
				// stacking level, so they remain on top and interactive.
				// biome-ignore lint/performance/noImgElement: a transient copy of the already-loaded carousel image
				<img
					key={transition.sequence}
					src={transition.src}
					alt=""
					decoding="async"
					aria-hidden="true"
					className={`${styles.tileOutgoing}${transition.fading ? ` ${transition.direction === 1 ? styles.tileOutgoingNext : styles.tileOutgoingPrev}` : ""}`}
					onAnimationEnd={handleOutgoingFadeEnd}
				/>
			) : null}
			{caption ? (
				<p className={styles.tileCaption} aria-hidden="true">
					{caption}
				</p>
			) : null}
			{canPrev || canNext ? (
				<CarouselControls
					canPrev={canPrev}
					canNext={canNext}
					safeIndex={safeIndex}
					totalSlides={totalSlides}
					onPrev={goPrev}
					onNext={goNext}
				/>
			) : null}
			{lightboxOpen ? (
				<Lightbox
					src={displaySrcAt(safeIndex, LIGHTBOX_IMAGE_WIDTH)}
					fallbackSrc={slideSrcAt(safeIndex)}
					alt={label}
					permalink={post.permalink}
					embedUrl={embedUrl}
					onClose={closeLightbox}
					canPrev={canPrev}
					canNext={canNext}
					onPrev={goPrev}
					onNext={goNext}
					onSwipePrev={goPrev}
					onSwipeNext={goNext}
				/>
			) : null}
		</div>
	);
}

interface CarouselControlsProps {
	canPrev: boolean;
	canNext: boolean;
	safeIndex: number;
	totalSlides: number;
	onPrev: () => void;
	onNext: () => void;
}

function CarouselControls({
	canPrev,
	canNext,
	safeIndex,
	totalSlides,
	onPrev,
	onNext,
}: CarouselControlsProps) {
	// Buttons are absolutely positioned over the image inside the tile.
	// They sit above the image-trigger button in z-order, so a tap lands
	// on the carousel control instead of opening the lightbox. We render
	// only the arrows that can actually move — first slide shows Next
	// only, last slide shows Prev only, middle shows both. No wrapping.
	return (
		<>
			{canPrev ? (
				<button
					type="button"
					className={`${styles.carouselButton} ${styles.carouselButtonPrev}`}
					onClick={onPrev}
					aria-label={`Previous photo (${safeIndex + 1} of ${totalSlides})`}
				>
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.4"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M15 18l-6-6 6-6" />
					</svg>
				</button>
			) : null}
			{canNext ? (
				<button
					type="button"
					className={`${styles.carouselButton} ${styles.carouselButtonNext}`}
					onClick={onNext}
					aria-label={`Next photo (${safeIndex + 1} of ${totalSlides})`}
				>
					<svg
						viewBox="0 0 24 24"
						width="18"
						height="18"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.4"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M9 6l6 6-6 6" />
					</svg>
				</button>
			) : null}
			<span className={styles.carouselIndicator} aria-live="polite">
				{safeIndex + 1}/{totalSlides}
			</span>
		</>
	);
}

interface TileImageButtonProps {
	src: string;
	label: string;
	onOpen: () => void;
	onImageLoad: (loadedSrc: string) => void;
	/** Fired on the first load failure so the parent can fall back to raw CDN URLs. */
	onImageError: () => void;
	transitionDirection: -1 | 1 | null;
	triggerRef: RefObject<HTMLButtonElement | null>;
	onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
	onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
	/** next/image priority; true only for the first tile of the initial grid. */
	priority?: boolean;
}
function TileImageButton({
	src,
	label,
	onOpen,
	onImageLoad,
	onImageError,
	transitionDirection,
	triggerRef,
	onPointerDown,
	onPointerUp,
	priority = false,
}: TileImageButtonProps) {
	const [imageErrorSrc, setImageErrorSrc] = useState<string | null>(null);
	const imageError = imageErrorSrc === src;
	return (
		<button
			ref={triggerRef}
			type="button"
			className={styles.tileImageButton}
			onClick={onOpen}
			onPointerDown={onPointerDown}
			onPointerUp={onPointerUp}
			aria-label={`View photo: ${label}`}
		>
			<Image
				src={src}
				alt=""
				fill
				sizes="(min-width: 1024px) 30vw, (min-width: 540px) 33vw, 50vw"
				priority={priority}
				unoptimized
				className={`${styles.tileImage}${transitionDirection ? ` ${transitionDirection === 1 ? styles.tileImageEnterNext : styles.tileImageEnterPrev}` : ""}`}
				onLoad={() => {
					setImageErrorSrc(null);
					onImageLoad(src);
				}}
				onError={() => {
					// First failure notifies the parent (it swaps to raw CDN
					// URLs for the tile); a failure of the fallback URL shows
					// the "Image unavailable" state instead of looping.
					if (!imageError) {
						setImageErrorSrc(src);
						onImageError();
					}
				}}
			/>
			{imageError ? (
				<span className={styles.tileImageError} role="status">
					Image unavailable
				</span>
			) : null}
		</button>
	);
}
interface LightboxProps {
	src: string;
	/** Raw (unoptimized) URL for the same slide, shown if the resized src fails to load. */
	fallbackSrc: string;
	alt: string;
	permalink: string;
	embedUrl: string | null;
	onClose: () => void;
	canPrev: boolean;
	canNext: boolean;
	onPrev: () => void;
	onNext: () => void;
	onSwipePrev: () => void;
	onSwipeNext: () => void;
}

function Lightbox({
	src,
	fallbackSrc,
	alt,
	permalink,
	embedUrl,
	onClose,
	canPrev,
	canNext,
	onPrev,
	onNext,
	onSwipePrev,
	onSwipeNext,
}: LightboxProps) {
	const [embedLoaded, setEmbedLoaded] = useState(false);
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	// The resized /img src can fail even when the tile version loaded (a
	// different width is a different upstream request). Swap to the raw
	// CDN URL rather than leaving a broken image. `failedSrc` records
	// which URL actually failed: a slide change (new src) retries the
	// optimized URL, while a failed raw fallback stays on screen instead
	// of flip-flopping between the two.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const displaySrc =
		failedSrc === src || failedSrc === fallbackSrc ? fallbackSrc : src;
	const [transition, setTransition] = useState<{
		src: string;
		alt: string;
		sequence: number;
		fading: boolean;
		direction: -1 | 1;
	} | null>(null);
	const beginTransition = useCallback(
		(direction: -1 | 1) => {
			setTransition((active) => ({
				// Preserve the frame that is still visible if the previous
				// destination is pending; otherwise the loaded live frame can
				// become the next outgoing layer.
				src: active && !active.fading ? active.src : displaySrc,
				alt: active && !active.fading ? active.alt : alt,
				sequence: (active?.sequence ?? 0) + 1,
				fading: false,
				direction,
			}));
		},
		[alt, displaySrc],
	);
	const handlePrev = useCallback(() => {
		beginTransition(-1);
		onPrev();
	}, [beginTransition, onPrev]);
	const handleNext = useCallback(() => {
		beginTransition(1);
		onNext();
	}, [beginTransition, onNext]);
	const handleSwipePrev = useCallback(() => {
		beginTransition(-1);
		onSwipePrev();
	}, [beginTransition, onSwipePrev]);
	const handleSwipeNext = useCallback(() => {
		beginTransition(1);
		onSwipeNext();
	}, [beginTransition, onSwipeNext]);
	// Body-overflow lock while the lightbox is open (prevents the
	// underlying feed from scrolling under the modal).
	useEffect(() => {
		// Body-scroll lock while the lightbox is open (prevents the
		// underlying feed from scrolling under the modal).
		return lockBodyScroll();
	}, []);
	// Keyboard nav: ArrowLeft / ArrowRight drive the same wrapped
	// handlers so swipes and key presses share the snapshot path.
	useEffect(() => {
		const handleKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.stopPropagation();
				onClose();
				return;
			}
		};
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [onClose]);
	const handleBackdropClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (event.target === event.currentTarget) onClose();
		},
		[onClose],
	);
	const handleBackdropKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (event.key === "ArrowLeft" && canPrev) {
				event.preventDefault();
				handlePrev();
				return;
			}
			if (event.key === "ArrowRight" && canNext) {
				event.preventDefault();
				handleNext();
				return;
			}
			if (event.key === "Tab") {
				const focusable = Array.from(
					event.currentTarget.querySelectorAll<HTMLElement>(
						'button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
					),
				);
				if (focusable.length === 0) {
					event.preventDefault();
					closeButtonRef.current?.focus();
					return;
				}
				const first = focusable[0];
				const last = focusable.at(-1);
				if (!first || !last) return;
				// If focus has escaped the lightbox (e.g. the browser moved it
				// outside), pull it back instead of wrapping blindly.
				const escaped = !event.currentTarget.contains(document.activeElement);
				if (event.shiftKey && (document.activeElement === first || escaped)) {
					event.preventDefault();
					last.focus();
				} else if (
					!event.shiftKey &&
					(document.activeElement === last || escaped)
				) {
					event.preventDefault();
					first.focus();
				}
				return;
			}
			if (
				event.target === event.currentTarget &&
				(event.key === "Enter" || event.key === " ")
			) {
				event.preventDefault();
				onClose();
			}
		},
		[canNext, canPrev, handleNext, handlePrev, onClose],
	);
	const swipeStart = useRef<{ x: number; y: number } | null>(null);
	const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
		swipeStart.current = { x: event.clientX, y: event.clientY };
	};
	const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
		const start = swipeStart.current;
		swipeStart.current = null;
		if (!start) return;
		const dx = event.clientX - start.x;
		const dy = event.clientY - start.y;
		if (Math.abs(dx) < 48 || Math.abs(dy) > Math.abs(dx)) return;
		if (dx < 0) handleSwipeNext();
		else handleSwipePrev();
	};
	const handleLiveImageLoad = useCallback(
		(loadedSrc: string) => {
			if (loadedSrc !== displaySrc) return;
			setTransition((active) =>
				active ? { ...active, fading: true } : active,
			);
		},
		[displaySrc],
	);
	const onOutgoingAnimationEnd = useCallback(() => {
		setTransition(null);
	}, []);
	useEffect(() => {
		closeButtonRef.current?.focus();
	}, []);
	return (
		<div
			className={`${styles.lightbox} ${styles.lightboxOpen}`}
			role="dialog"
			aria-modal="true"
			aria-label={`Photo viewer: ${alt}`}
			tabIndex={-1}
			onClick={handleBackdropClick}
			onKeyDown={handleBackdropKeyDown}
		>
			<div
				className={`${styles.lightboxContent}${embedUrl ? ` ${styles.lightboxEmbedContent}` : ""}`}
			>
				<button
					ref={closeButtonRef}
					type="button"
					className={styles.lightboxClose}
					onClick={onClose}
					aria-label="Close photo viewer"
				>
					<svg
						viewBox="0 0 24 24"
						width="22"
						height="22"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M6 6l12 12" />
						<path d="M18 6L6 18" />
					</svg>
				</button>
				{embedUrl ? (
					<div className={styles.lightboxEmbedWrap}>
						{/* Keep the already-loaded Graph cover visible while the
						 * cross-origin Instagram document starts. The iframe is
						 * mounted immediately above it and fades in only after its
						 * load event, so opening a collaborator carousel never
						 * flashes an empty white panel. */}
						{/* biome-ignore lint/performance/noImgElement: transient copy of the already-loaded Graph cover */}
						<img
							src={displaySrc}
							alt=""
							decoding="async"
							aria-hidden="true"
							className={styles.lightboxEmbedCover}
						/>
						{!embedLoaded ? (
							<p className={styles.lightboxEmbedLoading} role="status">
								Loading Instagram carousel…
							</p>
						) : null}
						<iframe
							src={embedUrl}
							title={`Instagram carousel: ${alt}`}
							className={`${styles.lightboxEmbed}${embedLoaded ? ` ${styles.lightboxEmbedLoaded}` : ""}`}
							loading="eager"
							referrerPolicy="strict-origin-when-cross-origin"
							allow="encrypted-media; picture-in-picture; web-share"
							allowFullScreen
							onLoad={() => setEmbedLoaded(true)}
						/>
					</div>
				) : (
					<div
						className={styles.lightboxImageWrap}
						onPointerDown={handlePointerDown}
						onPointerUp={handlePointerUp}
					>
						{canPrev ? (
							<button
								type="button"
								className={`${styles.lightboxArrow} ${styles.lightboxArrowPrev}`}
								onClick={handlePrev}
								aria-label="Previous photo"
							>
								<span aria-hidden="true">‹</span>
							</button>
						) : null}
						{/* The prior full-screen image stays above the live image
						 * until the destination has loaded, then both layers run
						 * the direction-aware transition together. */}
						{transition ? (
							// biome-ignore lint/performance/noImgElement: transient copy of the already-loaded lightbox image
							<img
								key={transition.sequence}
								src={transition.src}
								alt={transition.alt}
								decoding="async"
								aria-hidden="true"
								className={`${styles.lightboxImage} ${styles.lightboxUnder}${transition.fading ? ` ${transition.direction === 1 ? styles.lightboxOutgoingNext : styles.lightboxOutgoingPrev}` : ""}`}
								onAnimationEnd={onOutgoingAnimationEnd}
							/>
						) : null}
						{/* biome-ignore lint/performance/noImgElement: see above */}
						<img
							src={displaySrc}
							alt={alt}
							decoding="async"
							className={`${styles.lightboxImage}${transition?.fading ? ` ${transition.direction === 1 ? styles.lightboxImageEnterNext : styles.lightboxImageEnterPrev}` : ""}`}
							onLoad={() => handleLiveImageLoad(displaySrc)}
							onError={() => setFailedSrc(displaySrc)}
						/>
						{canNext ? (
							<button
								type="button"
								className={`${styles.lightboxArrow} ${styles.lightboxArrowNext}`}
								onClick={handleNext}
								aria-label="Next photo"
							>
								<span aria-hidden="true">›</span>
							</button>
						) : null}
					</div>
				)}
				<a
					href={permalink}
					target="_blank"
					rel="noopener noreferrer"
					className={styles.lightboxInstagram}
					aria-label={`Open this photo on Instagram in a new tab: ${alt}`}
				>
					<span>View on Instagram</span>
				</a>
			</div>
		</div>
	);
}

interface FeedHeaderProps {
	handle: string;
	profileUrl: string;
	side: "underwater" | "portraits";
}

function FeedHeader({ handle, profileUrl, side }: FeedHeaderProps) {
	const title = side === "underwater" ? "Underwater & Nature" : "Portraits";
	return (
		<header className={styles.head}>
			<div className={styles.titleCopy}>
				<span className={styles.kicker}>TingLingDing Photography</span>
				<h1 className={`display ${styles.title}`}>{title}</h1>
			</div>
			<a
				className={styles.follow}
				href={profileUrl}
				target="_blank"
				rel="noopener noreferrer"
				aria-label={`Follow @${handle} on Instagram`}
			>
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					aria-hidden="true"
				>
					<rect x="2" y="2" width="20" height="20" rx="5" />
					<circle cx="12" cy="12" r="4" />
					<circle cx="18" cy="6" r="1.2" fill="currentColor" />
				</svg>
				<span>Follow @{handle}</span>
				<svg
					viewBox="0 0 24 24"
					width="14"
					height="14"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
					className={styles.followArrow}
				>
					<path d="M7 17 17 7" />
					<path d="M7 7h10v10" />
				</svg>
			</a>
		</header>
	);
}
