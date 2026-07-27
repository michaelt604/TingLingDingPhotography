'use client';

import { useCallback, useEffect, useState } from 'react';
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
  paging?: { next?: string };
}

function readPagingNext(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  if (!('paging' in payload)) return null;
  const paging = (payload as Record<string, unknown>).paging;
  if (!paging || typeof paging !== 'object') return null;
  const next = (paging as Record<string, unknown>).next;
  return typeof next === 'string' && next.length > 0 ? next : null;
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

  useEffect(() => {
    if (!proxyUrl) return; // No proxy URL configured — show placeholder
    let cancelled = false;
    setError(null);
    setPosts([]);
    setNextCursor(null);
    setLoadMoreError(null);
    setHasInitialLoaded(false);
    const url = `${proxyUrl.replace(/\/$/, '')}/${side}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Proxy ${r.status}`);
        return r.json() as Promise<FeedResponse>;
      })
      .then((data: FeedResponse) => {
        if (cancelled) return;
        const validPosts = normalizeInstagramPosts(data) as FeedPost[];
        setPosts(validPosts);
        setNextCursor(readPagingNext(data));
        if (validPosts.length === 0) setError('No valid posts were returned.');
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setHasInitialLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [proxyUrl, side]);

  // Manual "Load more" — appends deduplicated posts fetched with the
  // current cursor. The Worker returns `paging.next` either as a new
  // cursor (more pages remain) or absent (end of feed).
  const handleLoadMore = useCallback(async () => {
    if (!proxyUrl || isLoadingMore || nextCursor === null) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    const url =
      `${proxyUrl.replace(/\/$/, '')}/${side}` +
      `?cursor=${encodeURIComponent(nextCursor)}`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Proxy ${response.status}`);
      const data = (await response.json()) as FeedResponse;
      const incoming = normalizeInstagramPosts(data) as FeedPost[];
      setPosts((existing) => {
        const seen = new Set(existing.map((post) => post.id));
        const additions = incoming.filter((post) => !seen.has(post.id));
        return existing.concat(additions);
      });
      setNextCursor(readPagingNext(data));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadMoreError(message || String(e));
    } finally {
      setIsLoadingMore(false);
    }
  }, [proxyUrl, side, nextCursor, isLoadingMore]);

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
            <div className={styles.loadMoreRow}>
              {loadMoreError ? (
                <p className={styles.loadMoreError} role="alert">
                  Couldn't load more posts. {loadMoreError}
                </p>
              ) : null}
              {nextCursor !== null ? (
                <button
                  type="button"
                  className={styles.loadMore}
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  aria-busy={isLoadingMore}
                >
                  {isLoadingMore ? 'Loading…' : 'Load more'}
                </button>
              ) : (
                <p className={styles.loadMoreEnd} role="status">
                  You&apos;ve reached the end.
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