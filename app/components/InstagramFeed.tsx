'use client';

import { useEffect, useState } from 'react';
import styles from './InstagramFeed.module.css';

interface Props {
  /** IG handle without the @ */
  handle: string;
  /** Profile URL on instagram.com */
  profileUrl: string;
  /** When the widget is not active, render this many placeholder tiles */
  placeholderCount?: number;
  /**
   * Which side this is — used to route the proxy fetch.
   * Set automatically by the page; the Worker uses it to pick the
   * matching IG account.
   */
  side: 'underwater' | 'portraits';
}

interface IGPost {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url: string;
  permalink: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp: string;
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
  placeholderCount = 9,
  side,
}: Props) {
  const proxyUrl = process.env.NEXT_PUBLIC_IG_PROXY_URL;
  const [posts, setPosts] = useState<IGPost[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!proxyUrl) return; // No proxy URL configured — show placeholder
    let cancelled = false;
    setError(null);
    const url = `${proxyUrl.replace(/\/$/, '')}/${side}`;
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Proxy ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (Array.isArray(data.data)) {
          setPosts(data.data);
        } else if (data.error) {
          setError(String(data.error));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });
    return () => {
      cancelled = true;
    };
  }, [proxyUrl, side]);

  const showRealPosts = Boolean(proxyUrl) && posts.length > 0;
  const tiles = Array.from({ length: placeholderCount }, (_, i) => i + 1);

  return (
    <section className={styles.feed} id="instagram" aria-label={`Latest posts from @${handle}`}>
      <div className="container">
        <FeedHeader handle={handle} profileUrl={profileUrl} />

        {showRealPosts ? (
          <div className={styles.grid}>
            {posts.map((post) => {
              const src = post.media_type === 'VIDEO' && post.thumbnail_url
                ? post.thumbnail_url
                : post.media_url;
              const label = post.caption
                ? post.caption.replace(/\s+/g, ' ').trim().slice(0, 100)
                : `Instagram post by @${handle}`;
              return (
                <a
                  key={post.id}
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.tile}
                  aria-label={label}
                >
                  <img src={src} alt="" loading="lazy" className={styles.tileImage} />
                </a>
              );
            })}
          </div>
        ) : (
          <div className={styles.placeholder}>
            {process.env.NODE_ENV !== 'production' && error && (
              <p className={styles.placeholderNote}>
                Instagram feed unavailable: {error}
              </p>
            )}
            <div className={styles.grid}>
              {tiles.map((n) => (
                <a
                  key={n}
                  href={profileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.tile}
                  data-tile={n}
                  aria-label={`View @${handle} on Instagram`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
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
