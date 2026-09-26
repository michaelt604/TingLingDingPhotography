'use client';

import { useEffect, useRef, useState } from 'react';
import { captionLabel, type IGPost, mergeInstagramPosts, normalizeInstagramPosts, stillImageSource } from './instagramData';
import { fetchWithTimeout } from './instagramFetch';
import { buildOptimizedImageUrl } from './instagramImageUrl';
import styles from './LatestFrames.module.css';

const FEEDS = ['portraits', 'underwater'] as const;
const FRAME_COUNT = 10;
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e'];

type State = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; posts: IGPost[] };

/**
 * Recent frames from both Instagram accounts, fetched only when the strip
 * approaches the viewport. Without JavaScript or the proxy, the section
 * keeps its profile links and simply omits the strip.
 */
export function LatestFrames() {
	const proxyUrl = process.env.NEXT_PUBLIC_IG_PROXY_URL;
	const gateRef = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<State>({ status: 'idle' });
	const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());

	useEffect(() => {
		const gate = gateRef.current;
		if (!proxyUrl || !gate) return;
		let cancelled = false;
		let started = false;

		const load = () => {
			if (started) return;
			started = true;
			setState({ status: 'loading' });
			const base = proxyUrl.replace(/\/$/, '');
			Promise.allSettled(
				FEEDS.map((feed) => fetchWithTimeout(`${base}/${feed}`).then((response) => {
					if (!response.ok) throw new Error(`Feed ${feed} returned ${response.status}`);
					return response.json();
				})),
			).then((results) => {
				if (cancelled) return;
				const posts = results.reduce<IGPost[]>(
					(merged, result) => result.status === 'fulfilled'
						? mergeInstagramPosts(merged, normalizeInstagramPosts(result.value))
						: merged,
					[],
				).filter((post) => stillImageSource(post)).slice(0, FRAME_COUNT);
				setState(posts.length ? { status: 'ready', posts } : { status: 'error' });
			});
		};

		if (typeof IntersectionObserver === 'undefined') {
			load();
			return () => { cancelled = true; };
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				observer.disconnect();
				load();
			}
		}, { rootMargin: '600px 0px' });
		observer.observe(gate);
		return () => {
			cancelled = true;
			observer.disconnect();
		};
	}, [proxyUrl]);

	return (
		<div ref={gateRef} className={styles.strip} data-latest-frames={state.status}>
			{state.status === 'loading' && (
				<ul className={styles.track} aria-hidden="true">
					{SKELETON_KEYS.map((key) => <li key={key} className={`${styles.frame} ${styles.skeleton}`} />)}
				</ul>
			)}
			{state.status === 'ready' && (
				<ul className={styles.track} aria-label="Latest Instagram posts">
					{state.posts.filter((post) => !failedIds.has(post.id)).map((post) => {
						const label = captionLabel(post.caption);
						const date = new Date(post.timestamp);
						const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en', { month: 'short', year: 'numeric' });
						return (
							<li key={post.id} className={styles.frame}>
								<a href={post.permalink} target="_blank" rel="noopener noreferrer" className={styles.link}>
									<img
										src={buildOptimizedImageUrl(stillImageSource(post) ?? '', 640, proxyUrl)}
										alt={['Instagram post', when, label].filter(Boolean).join(', ')}
										loading="lazy"
										decoding="async"
										width={640}
										height={800}
										onError={() => setFailedIds((previous) => new Set(previous).add(post.id))}
										onLoad={(event) => { event.currentTarget.dataset.loaded = ''; }}
									/>
									<span className={styles.meta} aria-hidden="true">
										{label && <span className={styles.caption}>{label}</span>}
										{when && <time dateTime={post.timestamp}>{when}</time>}
									</span>
								</a>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
