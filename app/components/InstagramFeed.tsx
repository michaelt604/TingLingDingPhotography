'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { normalizeInstagramPosts, type IGPost } from './instagramData';
import styles from './InstagramFeed.module.css';

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
  side: 'underwater' | 'portraits';
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
  media_type: 'IMAGE' | 'VIDEO';
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
  if (!response || typeof response !== 'object' || !('paging' in response)) return null;
  const paging = response.paging;
  if (!paging || typeof paging !== 'object' || !('next' in paging)) return null;
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
  if (typeof next !== 'string' || !next) return null;
  // Looks like a full URL (http(s)://…) — parse it and pull `after`.
  if (/^https?:\/\//i.test(next)) {
    try {
      const params = new URL(next).searchParams;
      const after = params.get('after');
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
export function InstagramFeed({
  handle,
  profileUrl,
  side,
}: Props) {
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


  useEffect(() => {
    if (!proxyUrl) return; // No proxy URL configured — show placeholder
    // Bump the lifecycle token on entry; any in-flight `fetchNextPage`
    // from the previous lifecycle now sees a stale token and bails
    // before it can call a setter. Cleared `isLoadingMore` /
    // `loadMoreError` here too so a late pagination response can't
    // strand the new lifecycle in a stale loading-or-error state
    // (the pagination guards short-circuit on `isLoadingMore`).
    const token = ++lifecycleTokenRef.current;
    let cancelled = false;
    setError(null);
    setPosts([]);
    setNextCursor(null);
    setLoadMoreError(null);
    setIsLoadingMore(false);
    setHasInitialLoaded(false);
    const url = `${proxyUrl.replace(/\/$/, '')}/${side}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Proxy ${r.status}`);
        return r.json() as Promise<FeedResponse>;
      })
      .then((data: FeedResponse) => {
        if (cancelled || lifecycleTokenRef.current !== token) return;
        const validPosts = normalizeInstagramPosts(data) as FeedPost[];
        setPosts(validPosts);
        setNextCursor(normalizeCursor(getPagingNext(data)));
        if (validPosts.length === 0) setError('No valid posts were returned.');
      })
      .catch((e) => {
        if (!cancelled && lifecycleTokenRef.current === token) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled && lifecycleTokenRef.current === token) setHasInitialLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [proxyUrl, side]);

  // Build the proxy URL for the next page. `nextCursor` is the opaque
  // value we stored from the previous response — we never re-parse it
  // here. URL/URLSearchParams handles encoding for us, so a cursor with
  // `&`, `=`, `+`, or `#` won't break the request.
  const buildNextPageUrl = useCallback((cursor: string): string | null => {
    if (!proxyUrl) return null;
    const base = `${proxyUrl.replace(/\/$/, '')}/${side}`;
    const url = new URL(base);
    url.searchParams.set('cursor', cursor);
    return url.toString();
  }, [proxyUrl, side]);

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
  const fetchNextPage = useCallback(async (force: boolean = false) => {
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
    setIsLoadingMore(true);
    try {
      const response = await fetch(nextPageUrl);
      // Bail before reading the body if the lifecycle ended while the
      // network round-trip was in flight.
      if (lifecycleTokenRef.current !== token) return;
      if (!response.ok) throw new Error(`Proxy ${response.status}`);
      const data = (await response.json()) as FeedResponse;
      // Re-check after the second await — a proxy/flip while parsing
      // would otherwise leak posts into the next lifecycle.
      if (lifecycleTokenRef.current !== token) return;
      const incoming = normalizeInstagramPosts(data) as FeedPost[];
      setPosts((existing) => {
        const seen = new Set(existing.map((post) => post.id));
        const additions = incoming.filter((post) => !seen.has(post.id));
        return existing.concat(additions);
      });
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
  }, [proxyUrl, buildNextPageUrl, nextCursor, isLoadingMore]);

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
      { rootMargin: '600px 0px 600px 0px' },
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

  const showRealPosts = Boolean(proxyUrl) && posts.length > 0;
  // Show the placeholder when we know there's nothing to render — i.e.
  // either the first fetch has completed and returned nothing, or the
  // proxy URL isn't configured at all. While the very first fetch is
  // still in flight we render neither, so we don't flash the
  // placeholder just before the grid pops in.
  const showPlaceholder = !showRealPosts && (!proxyUrl || hasInitialLoaded);
  return (
    <section className={styles.feed} id="instagram" aria-label={`Latest posts from @${handle}`}>
      <div className="container">
        <FeedHeader handle={handle} profileUrl={profileUrl} />

        {showRealPosts ? (
          <>
            <div className={styles.grid}>
              {posts.map((post) => (
                <PostTile
                  key={post.id}
                  post={post}
                  handle={handle}
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
              <div ref={sentinelRef} className={styles.sentinel} aria-hidden="true" />
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
                    {isLoadingMore ? 'Retrying…' : 'Retry'}
                  </button>
                </div>
              ) : nextCursor === null ? (
                <p className={styles.statusEnd} role="status">
                  You&apos;ve reached the end.
                </p>
              ) : (
                <p className={styles.statusLoading} role="status" aria-live="polite">
                  {isLoadingMore ? 'Loading more posts…' : 'Scroll for more'}
                </p>
              )}
            </div>
          </>
        ) : showPlaceholder ? (
          <div className={styles.placeholder} role="status">
            <p className={styles.placeholderTitle}>Instagram photos are unavailable right now.</p>
            <p className={styles.placeholderNote}>
              Visit @{handle} on Instagram to see the latest work.
              {process.env.NODE_ENV !== 'production' && error ? ` (${error})` : ''}
            </p>
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--primary"
            >
              View Instagram profile
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}

interface PostTileProps {
  post: FeedPost;
  handle: string;
}

/**
 * Renders a single IG post. For CAROUSEL_ALBUM posts with inlined
 * children we render a local carousel with prev/next buttons. IMAGE /
 * VIDEO posts — and CAROUSEL_ALBUM posts without children — fall back
 * to the parent's media_url (and thumbnail for VIDEO).
 *
 * The tile is a <div> wrapper. The link to Instagram is an absolutely
 * positioned <a> filling the wrapper; carousel buttons are siblings of
 * the link (also absolutely positioned) so the DOM stays valid (no
 * <button> inside <a>) and clicks on the buttons do not propagate to
 * the link.
 */
function PostTile({ post, handle }: PostTileProps) {
  const isCarousel = post.media_type === 'CAROUSEL_ALBUM';
  const children = isCarousel && Array.isArray(post.children) ? post.children : null;
  // A carousel needs at least one navigable child item to show its
  // controls. With zero children we fall back to the parent's own
  // media_url — IG sets that to the first child's media_url for
  // CAROUSEL_ALBUM posts, so the visual result is the same.
  const slides = children && children.length > 0 ? children : null;

  const label = post.caption
    ? post.caption.replace(/\s+/g, ' ').trim().slice(0, 100)
    : `Instagram post by @${handle}`;

  const fallbackSrc =
    post.media_type === 'VIDEO' && post.thumbnail_url
      ? post.thumbnail_url
      : post.media_url;

  // Local carousel index lives in PostTile so we render a single
  // <Image> per tile. The buttons live in <CarouselControls> and
  // mutate the index via callbacks; when the index changes we swap
  // the <Image> src in place — no remount, no double-load.
  const [slideIndex, setSlideIndex] = useState(0);
  const totalSlides = slides?.length ?? 0;
  const safeIndex = totalSlides === 0 ? 0 : Math.min(slideIndex, totalSlides - 1);
  const currentChild = slides ? slides[safeIndex] : undefined;
  const currentSrc =
    currentChild === undefined
      ? fallbackSrc
      : currentChild.media_type === 'VIDEO' && currentChild.thumbnail_url
        ? currentChild.thumbnail_url
        : currentChild.media_url;
  const goPrev = useCallback(() => {
    if (totalSlides <= 1) return;
    setSlideIndex((current) => (current <= 0 ? totalSlides - 1 : current - 1));
  }, [totalSlides]);
  const goNext = useCallback(() => {
    if (totalSlides <= 1) return;
    setSlideIndex((current) => (current >= totalSlides - 1 ? 0 : current + 1));
  }, [totalSlides]);

  return (
    <div className={styles.tile}>
      <TileImage src={currentSrc} />
      <a
        className={styles.tileLink}
        href={post.permalink}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
      >
        <span className={styles.srOnly}>{label}</span>
      </a>
      {slides && slides.length > 1 ? (
        <CarouselControls
          safeIndex={safeIndex}
          totalSlides={totalSlides}
          onPrev={goPrev}
          onNext={goNext}
        />
      ) : null}
    </div>
  );
}

interface CarouselControlsProps {
  safeIndex: number;
  totalSlides: number;
  onPrev: () => void;
  onNext: () => void;
}

function CarouselControls({ safeIndex, totalSlides, onPrev, onNext }: CarouselControlsProps) {
  // Buttons are absolutely positioned over the image inside the tile.
  // They sit ABOVE the link overlay in z-order, so clicks land on the
  // buttons instead of navigating to Instagram.
  return (
    <>
      <button
        type="button"
        className={`${styles.carouselButton} ${styles.carouselButtonPrev}`}
        onClick={onPrev}
        aria-label={`Previous photo (${safeIndex + 1} of ${totalSlides})`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        className={`${styles.carouselButton} ${styles.carouselButtonNext}`}
        onClick={onNext}
        aria-label={`Next photo (${safeIndex + 1} of ${totalSlides})`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <span className={styles.carouselIndicator} aria-live="polite">
        {safeIndex + 1}/{totalSlides}
      </span>
    </>
  );
}

interface TileImageProps {
  src: string;
}

function TileImage({ src }: TileImageProps) {
  return (
    <Image
      src={src}
      alt=""
      fill
      sizes="(min-width: 1024px) 30vw, (min-width: 540px) 33vw, 50vw"
      unoptimized
      className={styles.tileImage}
    />
  );
}

interface FeedHeaderProps {
  handle: string;
  profileUrl: string;
}

function FeedHeader({ handle, profileUrl }: FeedHeaderProps) {
  return (
    <header className={styles.head}>
      <a
        className={styles.follow}
        href={profileUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Follow @${handle} on Instagram`}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="18" cy="6" r="1.2" fill="currentColor" />
        </svg>
        <span>Follow @{handle}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={styles.followArrow}>
          <path d="M7 17 17 7" />
          <path d="M7 7h10v10" />
        </svg>
      </a>
    </header>
  );
}