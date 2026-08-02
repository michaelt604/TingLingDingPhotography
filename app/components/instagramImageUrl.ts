import { isInstagramMediaUrl } from "./instagramData.ts";

const IMAGE_MIN_WIDTH = 100;
const IMAGE_MAX_WIDTH = 1600;
const IMAGE_DEFAULT_WIDTH = 800;

/**
 * Clamps a requested image width to the range the ig-proxy /img route
 * accepts. Non-finite or non-positive inputs fall back to the default.
 */
export function clampImageWidth(width: number): number {
	if (!Number.isFinite(width) || width <= 0) return IMAGE_DEFAULT_WIDTH;
	return Math.min(
		IMAGE_MAX_WIDTH,
		Math.max(IMAGE_MIN_WIDTH, Math.round(width)),
	);
}

/**
 * Rewrites an Instagram CDN media URL to the ig-proxy /img resizing route.
 * Returns the source unchanged when there is no proxy URL, the source is
 * not an Instagram media URL, or the proxy URL cannot be parsed — so a
 * misconfiguration can never break the feed, it just disables resizing.
 */
export function buildOptimizedImageUrl(
	src: string,
	width: number,
	proxyUrl: string | undefined,
): string {
	if (!proxyUrl || !isInstagramMediaUrl(src)) return src;
	try {
		const url = new URL("/img", proxyUrl);
		url.searchParams.set("u", src);
		url.searchParams.set("w", String(clampImageWidth(width)));
		return url.toString();
	} catch {
		return src;
	}
}
