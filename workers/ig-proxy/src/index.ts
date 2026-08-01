/**
 * Cloudflare Worker — Instagram feed proxy
 *
 * Holds one Facebook Graph Page/System User access token per account server-side and
 * exposes a CORS-safe JSON endpoint the static site can call.
 *
 * Routes:
 *   GET /underwater           → first page of @tinglingdingphotography's media
 *   GET /portraits            → first page of @tinglingdingportraits's media
 *   GET /underwater?cursor=X  → next page of @tinglingdingphotography's media
 *   GET /portraits?cursor=X   → next page of @tinglingdingportraits's media
 *
 * Pagination:
 *   The upstream Graph API returns a `paging.next` URL that contains
 *   the access token in the query string. We never forward that URL
 *   to clients — we strip it and only surface the opaque cursor
 *   (`paging.cursors.after`) under a `paging.next` field in our
 *   response. Clients send it back as the `cursor` query param.
 *
 *   The cursor is validated as a short opaque token (standard/base64url
 *   alphabet, length-bounded) so it cannot be abused to inject a new URL
 *   or leak the upstream access token.
 *
 * Caches successful feed responses for 1 hour in a globally shared
 * Workers KV namespace, with the Cache API retained as an optional
 * per-colo L1. Cache keys include the cursor so paginated responses
 * are cached independently.
 *
 * ──────────────────────────────────────────────────────────────────
 *  DEPLOY
 * ──────────────────────────────────────────────────────────────────
 *  1. Install wrangler:  npm install -g wrangler
 *  2. Login:            wrangler login
 *  3. cd workers/ig-proxy
 *  4. Set secrets:      wrangler secret put IG_ACCESS_TOKEN_UNDERWATER
 *                       wrangler secret put IG_COLLAB_USER_ID_UNDERWATER
 *                       wrangler secret put IG_ACCESS_TOKEN_PORTRAITS
 *                       wrangler secret put IG_COLLAB_USER_ID_PORTRAITS
 *  5. Deploy:           wrangler deploy
 *  6. Set NEXT_PUBLIC_IG_PROXY_URL in your Next.js env to the
 *     deployed worker URL (e.g. https://ig-proxy.<you>.workers.dev)
 * ──────────────────────────────────────────────────────────────────
 *
 * Token lifecycle: both access tokens are Facebook-host Page/System User
 * credentials with the Page/Instagram assets and permissions required for
 * both /media and /collaborative_media. They are never sent to Instagram's
 * incompatible ig_refresh_token endpoint.
 *
 * Security notes:
 *   - Feed access tokens are sent via Authorization: Bearer and never enter
 *     feed URLs, cache keys, responses, or logs.
 *   - The cache key is a stable internal URL
 *     (`https://ig-cache/${version}/${userId}/${side}/${cursor}`) —
 *     it never contains the token. Cache API L1 uses that URL directly;
 *     Workers KV uses a fixed-length SHA-256 digest of it so maximum-size
 *     pagination cursors remain below KV's key limit. The cursor is
 *     included only when the caller passed one, so paginated responses
 *     are cached independently while the token stays out of every key.
 *   - The `paging.next` field in our response is the upstream
 *     `paging.cursors.after` value — never the upstream URL, which
 *     would embed the access token. Incoming `cursor` query params
 *     are length-bounded and restricted to a safe character set so a
 *     malicious caller cannot inject a token or a different URL.
 *   - ALLOWED_ORIGIN is a comma-separated HTTPS allowlist. Both the
 *     apex and www production origins are listed there. Each entry is
 *     validated as an HTTPS URL with no credentials, no path beyond
 *     "/", no query, and no fragment. Whitespace is trimmed and
 *     duplicates are removed. The whole configuration fails closed
 *     (503) if the binding is missing, blank, contains an empty
 *     comma-delimited entry, or any entry is invalid.
 *   - For browser requests the request's `Origin` header is compared
 *     exactly against the normalized allowlist. Allowed requests get
 *     `Access-Control-Allow-Origin` set to that exact origin; the
 *     header is never a comma-separated value. Rejected requests,
 *     including lookalikes and www/apex variants not listed, get a
 *     generic 403 with the existing error body and `Cache-Control:
 *     no-store`. Non-browser requests (no Origin header) continue
 *     working and use a deterministic single configured origin for
 *     any CORS response header.
 *   - `IG_FEED_CACHE` is a globally shared, eventually consistent KV
 *     namespace. `caches.default` is only an optional local L1 and may
 *     be ineffective on a workers.dev deployment. We re-apply CORS in
 *     jsonResponse() so every cached response remains origin-aware.
 */

export interface Env {
	IG_ACCESS_TOKEN_UNDERWATER: string;
	IG_ACCESS_TOKEN_PORTRAITS: string;
	/** Facebook-host Instagram ID; legacy binding name retained in Cloudflare. */
	IG_COLLAB_USER_ID_UNDERWATER: string;
	/** Facebook-host Instagram ID; legacy binding name retained in Cloudflare. */
	IG_COLLAB_USER_ID_PORTRAITS: string;
	/**
	 * Comma-separated HTTPS allowlist. Each entry must be an HTTPS URL
	 * with no credentials, no path beyond "/", no query, and no fragment.
	 * Whitespace is trimmed and exact-match duplicates are removed.
	 * Set in wrangler.toml [vars]. Fails closed when missing or invalid.
	 */
	ALLOWED_ORIGIN?: string;
	GRAPH_API_VERSION?: string;
	/**
	 * Globally shared cache for complete feed pages. Optional so a missing
	 * binding or local test configuration bypasses KV instead of taking the
	 * feed offline.
	 */
	IG_FEED_CACHE?: KVNamespace;
}

const CACHE_TTL_SECONDS = 3600;
const KV_READ_CACHE_TTL_SECONDS = 60;
const CACHE_ENVELOPE_VERSION = 1;
const GRAPH_API_HOST = "graph.facebook.com";
export const DEFAULT_GRAPH_API_VERSION = "v25.0";

const CORS = (origin: string) => ({
	"Access-Control-Allow-Origin": origin,
	"Access-Control-Allow-Methods": "GET, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
	"Access-Control-Max-Age": "86400",
	// Vary on Origin so caches don't serve one origin's response to another
	// when we lock down ALLOWED_ORIGIN.
	Vary: "Origin",
});

const JSON_HEADERS = (origin: string, cacheControl: string) => ({
	...CORS(origin),
	"Content-Type": "application/json",
	"Cache-Control": cacheControl,
});

function jsonResponse(
	body: unknown,
	origin: string,
	status = 200,
	cacheControl = `public, max-age=${CACHE_TTL_SECONDS}`,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: JSON_HEADERS(origin, cacheControl),
	});
}

export function errorResponse(
	message: string,
	origin: string,
	status = 500,
): Response {
	return jsonResponse({ error: message }, origin, status, "no-store");
}

interface ApiCredentials {
	userId: string;
	accessToken: string;
}

interface FeedRoute {
	credentials: ApiCredentials;
}

type FeedSide = "underwater" | "portraits";

function isFeedSide(value: string): value is FeedSide {
	return value === "underwater" || value === "portraits";
}

function routeFor(path: FeedSide, env: Env): FeedRoute {
	if (path === "underwater") {
		return {
			credentials: {
				userId: env.IG_COLLAB_USER_ID_UNDERWATER,
				accessToken: env.IG_ACCESS_TOKEN_UNDERWATER,
			},
		};
	}
	return {
		credentials: {
			userId: env.IG_COLLAB_USER_ID_PORTRAITS,
			accessToken: env.IG_ACCESS_TOKEN_PORTRAITS,
		},
	};
}

const MEDIA_FIELDS =
	"id,media_type,media_url,permalink,thumbnail_url,caption,timestamp";

// Fields we ask for when listing the children of a CAROUSEL_ALBUM post.
// Children don't have a `caption` or `timestamp` — those live on the
// parent — and their `permalink` is optional (IG omits it on some
// children), so we don't require it.
const CHILDREN_FIELDS = "id,media_type,media_url,permalink,thumbnail_url";

// ──────────────────────────────────────────────────────────────────
// Carousel child normalization
// ──────────────────────────────────────────────────────────────────
//
// IG returns CAROUSEL_ALBUM posts with only the first child's media in
// the parent's `media_url`. To render real per-image navigation we
// also fetch each carousel's children and inline them in the response
// as `post.children`. Failures to fetch a carousel's children are
// silent — the post is returned without `children` and the client
// falls back to the parent's `media_url`.

const CHILD_MEDIA_TYPES = new Set(["IMAGE", "VIDEO"]);

/**
 * Returns true when the URL is an HTTPS URL on Instagram's CDN or
 * fbcdn. Mirrors the host check used by the feed normalizer so a
 * child can't smuggle in a non-IG asset.
 */
function isInstagramMediaHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return false;
		const host = url.hostname;
		return (
			host === "cdninstagram.com" ||
			host.endsWith(".cdninstagram.com") ||
			host === "fbcdn.net" ||
			host.endsWith(".fbcdn.net")
		);
	} catch {
		return false;
	}
}

/**
 * Returns true when the URL is an HTTPS URL on instagram.com or a
 * subdomain. Used to validate the optional `permalink` on carousel
 * children.
 */
function isInstagramHttpsUrl(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") return false;
		const host = url.hostname;
		return host === "instagram.com" || host.endsWith(".instagram.com");
	} catch {
		return false;
	}
}

/**
 * Normalizes the `data` array of a `/media/{id}/children` response.
 * Each entry is whitelisted to known fields and validated as a real
 * Instagram media URL. Returns an empty array when the payload is
 * malformed — callers treat that as "no children, fall back to the
 * parent's `media_url`".
 */
function normalizeCarouselChildren(payload: unknown): unknown[] {
	if (!payload || typeof payload !== "object") return [];
	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data)) return [];
	return data.filter((candidate): candidate is Record<string, unknown> => {
		if (!candidate || typeof candidate !== "object") return false;
		const post = candidate as Record<string, unknown>;
		const id = post.id;
		const mediaUrl = post.media_url;
		const mediaType = post.media_type;
		if (typeof id !== "string" || !id) return false;
		if (typeof mediaUrl !== "string" || !isInstagramMediaHttpsUrl(mediaUrl))
			return false;
		if (typeof mediaType !== "string" || !CHILD_MEDIA_TYPES.has(mediaType))
			return false;
		const thumbnail = post.thumbnail_url;
		if (
			thumbnail !== undefined &&
			(typeof thumbnail !== "string" || !isInstagramMediaHttpsUrl(thumbnail))
		) {
			return false;
		}
		const permalink = post.permalink;
		if (
			permalink !== undefined &&
			(typeof permalink !== "string" || !isInstagramHttpsUrl(permalink))
		) {
			return false;
		}
		return true;
	});
}

/**
 * Fetches the children of a single CAROUSEL_ALBUM post. Returns the
 * normalized array, or an empty array on any failure (which the caller
 * treats as "fall back to the parent's media_url").
 */
async function fetchCarouselChildren(
	graphApiVersion: string,
	parentId: string,
	accessToken: string,
): Promise<unknown[]> {
	const url =
		`https://${GRAPH_API_HOST}/${graphApiVersion}/${encodeURIComponent(parentId)}/children` +
		`?fields=${CHILDREN_FIELDS}&limit=10`;
	try {
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!response.ok) return [];
		const payload = await response.json();
		return normalizeCarouselChildren(payload);
	} catch (error) {
		console.error(
			"Instagram carousel children request failed",
			parentId,
			error instanceof Error ? error.name : "UnknownError",
		);
		return [];
	}
}

/**
 * Augments a list of posts with inline `children` arrays for every
 * CAROUSEL_ALBUM entry. Posts of other media types are returned
 * unchanged. Failures to fetch a carousel's children are silent and
 * leave that post without `children` — the client falls back to the
 * parent's `media_url`.
 */
async function inlineCarouselChildren(
	graphApiVersion: string,
	accessToken: string,
	posts: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
	return Promise.all(
		posts.map(async (post) => {
			if (post.media_type !== "CAROUSEL_ALBUM") return post;
			const id = post.id;
			if (typeof id !== "string") return post;
			const children = await fetchCarouselChildren(
				graphApiVersion,
				id,
				accessToken,
			);
			return children.length > 0 ? { ...post, children } : post;
		}),
	);
}

function validateOriginEntry(entry: string): string | null {
	const trimmed = entry.trim();
	if (!trimmed) return null;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;
	if (url.username !== "" || url.password !== "") return null;
	if (url.pathname !== "/") return null;
	if (url.search !== "") return null;
	if (url.hash !== "") return null;
	return url.origin;
}

// Parses ALLOWED_ORIGIN as a comma-separated allowlist, validates every
// entry, normalizes each valid URL to its .origin, and deduplicates
// exact normalized origins. Returns the sorted, deduped list of
// normalized origins, or null when the configuration is absent, blank,
// contains an empty comma-delimited entry, or has any invalid entry.
export function resolveAllowlist(env: Env): readonly string[] | null {
	const raw = env.ALLOWED_ORIGIN;
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== "string") return null;
	const trimmedRaw = raw.trim();
	if (!trimmedRaw) return null;
	const entries = raw.split(",");
	const origins = new Set<string>();
	for (const entry of entries) {
		const origin = validateOriginEntry(entry);
		if (origin === null) return null;
		origins.add(origin);
	}
	if (origins.size === 0) return null;
	return Array.from(origins).sort();
}

// Resolves a deterministic single origin for non-browser CORS responses.
// Returns the lexicographically smallest normalized origin from the
// allowlist, or null when the configuration is missing/invalid.
export function resolveOrigin(env: Env): string | null {
	const allowlist = resolveAllowlist(env);
	if (!allowlist) return null;
	return allowlist[0];
}

export function resolveGraphApiVersion(env: Env): string | null {
	const version = env.GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
	return /^v\d+\.\d+$/.test(version) ? version : null;
}

// IG's `paging.cursors.after` tokens are short opaque strings using the
// standard or URL-safe base64 alphabet. Accept both forms so URLSearchParams-
// decoded `+`, `/`, and `=` characters round-trip unchanged, while rejecting
// URL-shaped values, controls, and every character outside those alphabets.
// Returns null when the value is empty, too long, or malformed.
const MAX_CURSOR_LENGTH = 256;
const MAX_CLIENT_CURSOR_LENGTH = 1024;
const CACHE_SCHEMA_VERSION = "facebook-two-token-v1";

interface SourceCursorState {
	after: string | null;
	exhausted: boolean;
	failures: 0 | 1;
}

interface CompositeCursor {
	version: 3;
	media: SourceCursorState;
	collaborativeMedia: SourceCursorState;
}

export function validateCursor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (value.length === 0 || value.length > MAX_CURSOR_LENGTH) return null;
	if (value.startsWith("//") || !/^[A-Za-z0-9_+/=-]+$/.test(value)) return null;
	return value;
}

function hasExactKeys(
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function parseSourceCursorState(value: unknown): SourceCursorState | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	if (!hasExactKeys(candidate, ["after", "exhausted", "failures"])) return null;
	if (typeof candidate.exhausted !== "boolean") return null;
	if (candidate.failures !== 0 && candidate.failures !== 1) return null;
	const after =
		candidate.after === null ? null : validateCursor(candidate.after);
	if (candidate.after !== null && after === null) return null;
	if (candidate.exhausted && after !== null) return null;
	if (!candidate.exhausted && after === null && candidate.failures !== 1)
		return null;
	return {
		after,
		exhausted: candidate.exhausted,
		failures: candidate.failures,
	};
}

function encodeCompositeCursor(cursor: CompositeCursor): string {
	const bytes = new TextEncoder().encode(JSON.stringify(cursor));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

export function decodeCompositeCursor(value: unknown): CompositeCursor | null {
	if (typeof value !== "string") return null;
	if (
		value.length === 0 ||
		value.length > MAX_CLIENT_CURSOR_LENGTH ||
		value.length % 4 === 1 ||
		!/^[A-Za-z0-9_-]+$/.test(value)
	) {
		return null;
	}

	try {
		const padded = value
			.replace(/-/g, "+")
			.replace(/_/g, "/")
			.padEnd(Math.ceil(value.length / 4) * 4, "=");
		const binary = atob(padded);
		const bytes = Uint8Array.from(binary, (character) =>
			character.charCodeAt(0),
		);
		const parsed = JSON.parse(
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
		) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return null;
		const candidate = parsed as Record<string, unknown>;
		if (
			!hasExactKeys(candidate, ["version", "media", "collaborativeMedia"])
		)
			return null;
		if (candidate.version !== 3) return null;
		const media = parseSourceCursorState(candidate.media);
		const collaborativeMedia = parseSourceCursorState(
			candidate.collaborativeMedia,
		);
		if (!media || !collaborativeMedia) return null;
		const cursor: CompositeCursor = {
			version: 3,
			media,
			collaborativeMedia,
		};
		return encodeCompositeCursor(cursor) === value ? cursor : null;
	} catch {
		return null;
	}
}

export function buildCacheKey(
	side: string,
	userId: string,
	graphApiVersion: string,
	cursor?: string | null,
): Request {
	// Use a fixed marker when no cursor is provided so the first-page cache
	// key is stable regardless of how the URL was constructed. Encode every
	// segment because valid opaque cursors may contain reserved URL characters.
	const cursorSegment = cursor ?? "_";
	const path = [
		CACHE_SCHEMA_VERSION,
		graphApiVersion,
		userId,
		side,
		cursorSegment,
	]
		.map(encodeURIComponent)
		.join("/");
	return new Request(`https://ig-cache.local/${path}`, { method: "GET" });
}

export async function buildKvCacheKey(cacheKey: Request): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(cacheKey.url),
	);
	const hex = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `ig-feed:v${CACHE_ENVELOPE_VERSION}:${hex}`;
}

interface CacheEnvelope {
	version: typeof CACHE_ENVELOPE_VERSION;
	expiresAt: number;
	body: Record<string, unknown>;
}

interface CacheHit {
	envelope: CacheEnvelope;
	remainingTtl: number;
}

const CACHE_POST_KEYS = new Set([
	"id",
	"media_type",
	"media_url",
	"permalink",
	"thumbnail_url",
	"caption",
	"timestamp",
	"children",
]);
const CACHE_CHILD_KEYS = new Set([
	"id",
	"media_type",
	"media_url",
	"permalink",
	"thumbnail_url",
]);
const CACHE_MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]);

function sanitizeCachedChild(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const child = value as Record<string, unknown>;
	if (Object.keys(child).some((key) => !CACHE_CHILD_KEYS.has(key))) return null;
	if (typeof child.id !== "string" || child.id.length === 0) return null;
	if (
		child.media_type !== undefined &&
		(typeof child.media_type !== "string" ||
			!CHILD_MEDIA_TYPES.has(child.media_type))
	) {
		return null;
	}
	if (
		child.media_url !== undefined &&
		(typeof child.media_url !== "string" ||
			!isInstagramMediaHttpsUrl(child.media_url))
	) {
		return null;
	}
	if (
		child.thumbnail_url !== undefined &&
		(typeof child.thumbnail_url !== "string" ||
			!isInstagramMediaHttpsUrl(child.thumbnail_url))
	) {
		return null;
	}
	if (
		child.permalink !== undefined &&
		(typeof child.permalink !== "string" ||
			!isInstagramHttpsUrl(child.permalink))
	) {
		return null;
	}
	return { ...child };
}

function sanitizeCachedPost(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const post = value as Record<string, unknown>;
	if (Object.keys(post).some((key) => !CACHE_POST_KEYS.has(key))) return null;
	if (typeof post.id !== "string" || post.id.length === 0) return null;
	if (
		post.media_type !== undefined &&
		(typeof post.media_type !== "string" ||
			!CACHE_MEDIA_TYPES.has(post.media_type))
	) {
		return null;
	}
	if (
		post.media_url !== undefined &&
		(typeof post.media_url !== "string" ||
			!isInstagramMediaHttpsUrl(post.media_url))
	) {
		return null;
	}
	if (
		post.permalink !== undefined &&
		(typeof post.permalink !== "string" || !isInstagramHttpsUrl(post.permalink))
	) {
		return null;
	}
	if (
		post.thumbnail_url !== undefined &&
		(typeof post.thumbnail_url !== "string" ||
			!isInstagramMediaHttpsUrl(post.thumbnail_url))
	) {
		return null;
	}
	if (post.caption !== undefined && typeof post.caption !== "string")
		return null;
	if (post.timestamp !== undefined && typeof post.timestamp !== "string")
		return null;

	let children: Record<string, unknown>[] | undefined;
	if (post.children !== undefined) {
		if (!Array.isArray(post.children)) return null;
		children = [];
		for (const child of post.children) {
			const sanitized = sanitizeCachedChild(child);
			if (!sanitized) return null;
			children.push(sanitized);
		}
	}
	return children ? { ...post, children } : { ...post };
}

function sanitizeCacheBody(payload: unknown): Record<string, unknown> | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return null;
	const candidate = payload as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.some((key) => key !== "data" && key !== "paging") ||
		!Array.isArray(candidate.data)
	) {
		return null;
	}

	const data: Record<string, unknown>[] = [];
	for (const post of candidate.data) {
		const sanitized = sanitizeCachedPost(post);
		if (!sanitized) return null;
		data.push(sanitized);
	}

	if (candidate.paging === undefined) return { data };
	if (
		!candidate.paging ||
		typeof candidate.paging !== "object" ||
		Array.isArray(candidate.paging)
	) {
		return null;
	}
	const paging = candidate.paging as Record<string, unknown>;
	if (
		Object.keys(paging).length !== 1 ||
		!("next" in paging) ||
		!decodeCompositeCursor(paging.next)
	) {
		return null;
	}
	return { data, paging: { next: paging.next } };
}

function createCacheEnvelope(
	responseBody: Record<string, unknown>,
): CacheEnvelope | null {
	const body = sanitizeCacheBody(responseBody);
	if (!body) return null;
	return {
		version: CACHE_ENVELOPE_VERSION,
		expiresAt: Date.now() + CACHE_TTL_SECONDS * 1000,
		body,
	};
}

function parseCacheEnvelope(payload: unknown): CacheHit | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload))
		return null;
	const candidate = payload as Record<string, unknown>;
	if (
		Object.keys(candidate).sort().join(",") !== "body,expiresAt,version" ||
		candidate.version !== CACHE_ENVELOPE_VERSION ||
		typeof candidate.expiresAt !== "number" ||
		!Number.isFinite(candidate.expiresAt)
	) {
		return null;
	}
	const body = sanitizeCacheBody(candidate.body);
	if (!body) return null;
	const remainingTtl = Math.min(
		CACHE_TTL_SECONDS,
		Math.floor((candidate.expiresAt - Date.now()) / 1000),
	);
	if (remainingTtl <= 0) return null;
	return {
		envelope: {
			version: CACHE_ENVELOPE_VERSION,
			expiresAt: candidate.expiresAt,
			body,
		},
		remainingTtl,
	};
}

function logCacheFailure(
	operation: "l1-read" | "l1-write" | "kv-read" | "kv-write",
	error: unknown,
): void {
	console.error("Instagram feed cache operation failed", {
		operation,
		error: error instanceof Error ? error.name : "UnknownError",
	});
}

async function readLocalCache(cacheKey: Request): Promise<unknown | null> {
	try {
		const cached = await caches.default.match(cacheKey);
		return cached ? await cached.json() : null;
	} catch (error) {
		logCacheFailure("l1-read", error);
		return null;
	}
}

async function readGlobalCache(
	namespace: KVNamespace | undefined,
	kvCacheKey: string,
): Promise<unknown | null> {
	if (!namespace) return null;
	try {
		return await namespace.get<unknown>(kvCacheKey, {
			type: "json",
			cacheTtl: KV_READ_CACHE_TTL_SECONDS,
		});
	} catch (error) {
		logCacheFailure("kv-read", error);
		return null;
	}
}

async function writeLocalCache(
	cacheKey: Request,
	envelope: CacheEnvelope,
	ttl: number,
): Promise<void> {
	try {
		await caches.default.put(
			cacheKey,
			new Response(JSON.stringify(envelope), {
				headers: {
					"Cache-Control": `public, max-age=${ttl}`,
				},
			}),
		);
	} catch (error) {
		logCacheFailure("l1-write", error);
	}
}

async function writeGlobalCache(
	namespace: KVNamespace | undefined,
	kvCacheKey: string,
	envelope: CacheEnvelope,
): Promise<void> {
	if (!namespace) return;
	try {
		await namespace.put(kvCacheKey, JSON.stringify(envelope), {
			expirationTtl: CACHE_TTL_SECONDS,
		});
	} catch (error) {
		logCacheFailure("kv-write", error);
	}
}

async function persistCaches(
	namespace: KVNamespace | undefined,
	cacheKey: Request,
	kvCacheKey: string,
	envelope: CacheEnvelope,
): Promise<void> {
	await Promise.all([
		writeLocalCache(cacheKey, envelope, CACHE_TTL_SECONDS),
		writeGlobalCache(namespace, kvCacheKey, envelope),
	]);
}

async function scheduleCacheWork(
	ctx: ExecutionContext | undefined,
	work: Promise<void>,
): Promise<void> {
	if (ctx) {
		ctx.waitUntil(work);
		return;
	}
	await work;
}

// Strips any `paging.next` URL from an upstream Graph API payload and
// returns a sanitized object whose `paging.next` field is the opaque
// cursor token only. Returns undefined when the payload has no paging
// block or the upstream cursor fails validation.
function sanitizePaging(
	payload: unknown,
): { next?: string } | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	if (!("paging" in payload)) return undefined;
	const raw = (payload as Record<string, unknown>).paging;
	if (!raw || typeof raw !== "object") return undefined;
	if (!("cursors" in raw)) return undefined;
	const cursors = (raw as Record<string, unknown>).cursors;
	if (!cursors || typeof cursors !== "object") return undefined;
	const after = (cursors as Record<string, unknown>).after;
	const cursor = validateCursor(after);
	if (!cursor) return undefined;
	return { next: cursor };
}

type MediaPageResult =
	| { outcome: "success"; payload: Record<string, unknown> }
	| { outcome: "failure"; status?: number }
	| { outcome: "skipped" };

function buildMediaUrl(
	graphApiVersion: string,
	userId: string,
	endpoint: "media" | "collaborative_media",
	after: string | null,
): URL {
	const url = new URL(
		`https://${GRAPH_API_HOST}/${graphApiVersion}/${encodeURIComponent(userId)}/${endpoint}`,
	);
	url.search = new URLSearchParams({
		fields: MEDIA_FIELDS,
		limit: "9",
		...(after ? { after } : {}),
	}).toString();
	return url;
}

async function fetchMediaPage(
	url: URL,
	accessToken: string,
): Promise<MediaPageResult> {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
	} catch (error) {
		console.error("Instagram media request threw", {
			host: url.host,
			path: url.pathname,
			error: error instanceof Error ? error.name : "UnknownError",
		});
		return { outcome: "failure" };
	}
	if (!response.ok) {
		console.error("Instagram media request failed", {
			host: url.host,
			path: url.pathname,
			status: response.status,
			statusText: response.statusText,
		});
		return { outcome: "failure", status: response.status };
	}
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return { outcome: "failure" };
	}
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return { outcome: "failure" };
	}
	if (!Array.isArray((payload as Record<string, unknown>).data)) {
		return { outcome: "failure" };
	}
	return { outcome: "success", payload: payload as Record<string, unknown> };
}

function postsFromResult(result: MediaPageResult): Record<string, unknown>[] {
	if (result.outcome !== "success" || !Array.isArray(result.payload.data))
		return [];
	return result.payload.data.filter(
		(post): post is Record<string, unknown> =>
			Boolean(post) && typeof post === "object" && !Array.isArray(post),
	);
}

function stateFromResult(
	previous: SourceCursorState,
	result: MediaPageResult,
): SourceCursorState {
	if (result.outcome === "skipped") return previous;
	if (result.outcome === "failure") {
		if (previous.failures === 0) return { ...previous, failures: 1 };
		return { after: null, exhausted: true, failures: 1 };
	}
	const after = sanitizePaging(result.payload)?.next ?? null;
	return after
		? { after, exhausted: false, failures: 0 }
		: { after: null, exhausted: true, failures: 0 };
}

function mergeMediaPosts(
	mediaPosts: Record<string, unknown>[],
	collaborativePosts: Record<string, unknown>[],
): Record<string, unknown>[] {
	const seenIds = new Set<string>();
	return [...mediaPosts, ...collaborativePosts]
		.filter((post) => {
			if (typeof post.id !== "string") return true;
			if (seenIds.has(post.id)) return false;
			seenIds.add(post.id);
			return true;
		})
		.sort((left, right) => {
			const leftTimestamp =
				typeof left.timestamp === "string"
					? Date.parse(left.timestamp)
					: Number.NaN;
			const rightTimestamp =
				typeof right.timestamp === "string"
					? Date.parse(right.timestamp)
					: Number.NaN;
			const leftValue = Number.isNaN(leftTimestamp)
				? Number.NEGATIVE_INFINITY
				: leftTimestamp;
			const rightValue = Number.isNaN(rightTimestamp)
				? Number.NEGATIVE_INFINITY
				: rightTimestamp;
			if (rightValue !== leftValue) return rightValue - leftValue;
			const leftId = typeof left.id === "string" ? left.id : "";
			const rightId = typeof right.id === "string" ? right.id : "";
			return leftId.localeCompare(rightId);
		});
}

interface FeedHealth {
	ok: boolean;
	collaborativeOk: boolean;
}

interface GraphHealth {
	ok: boolean;
	collaborativeReady: boolean;
	version: string;
	feeds: Record<FeedSide, FeedHealth>;
}

async function probeMedia(
	graphApiVersion: string,
	credentials: ApiCredentials,
	endpoint: "media" | "collaborative_media",
): Promise<boolean> {
	if (!credentials.userId || !credentials.accessToken) return false;
	const result = await fetchMediaPage(
		buildMediaUrl(graphApiVersion, credentials.userId, endpoint, null),
		credentials.accessToken,
	);
	return result.outcome === "success";
}

async function checkGraphHealth(
	env: Env,
	graphApiVersion: string,
): Promise<GraphHealth> {
	const underwaterRoute = routeFor("underwater", env);
	const portraitsRoute = routeFor("portraits", env);
	const [underwaterOwnedOk, underwaterCollaborativeOk, portraitsOwnedOk, portraitsCollaborativeOk] =
		await Promise.all([
			probeMedia(
				graphApiVersion,
				underwaterRoute.credentials,
				"media",
			),
			probeMedia(
				graphApiVersion,
				underwaterRoute.credentials,
				"collaborative_media",
			),
			probeMedia(
				graphApiVersion,
				portraitsRoute.credentials,
				"media",
			),
			probeMedia(
				graphApiVersion,
				portraitsRoute.credentials,
				"collaborative_media",
			),
		]);
	return {
		ok: underwaterOwnedOk && portraitsOwnedOk,
		collaborativeReady:
			underwaterCollaborativeOk && portraitsCollaborativeOk,
		version: graphApiVersion,
		feeds: {
			underwater: {
				ok: underwaterOwnedOk,
				collaborativeOk: underwaterCollaborativeOk,
			},
			portraits: {
				ok: portraitsOwnedOk,
				collaborativeOk: portraitsCollaborativeOk,
			},
		},
	};
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx?: ExecutionContext,
	): Promise<Response> {
		const allowlist = resolveAllowlist(env);
		const graphApiVersion = resolveGraphApiVersion(env);
		const nonBrowserOrigin = allowlist ? allowlist[0] : null;

		if (!allowlist || !graphApiVersion || nonBrowserOrigin === null) {
			return new Response(
				JSON.stringify({ error: "Service configuration is incomplete." }),
				{
					status: 503,
					headers: {
						"Content-Type": "application/json",
						"Cache-Control": "no-store",
					},
				},
			);
		}

		const requestOrigin = request.headers.get("Origin");
		let effectiveOrigin: string;
		if (requestOrigin) {
			if (!allowlist.includes(requestOrigin)) {
				return errorResponse("Forbidden.", nonBrowserOrigin, 403);
			}
			effectiveOrigin = requestOrigin;
		} else {
			effectiveOrigin = nonBrowserOrigin;
		}

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: CORS(effectiveOrigin),
			});
		}

		if (request.method !== "GET") {
			return errorResponse("Method not allowed", effectiveOrigin, 405);
		}

		// Health check
		const url = new URL(request.url);
		if (url.pathname === "/" || url.pathname === "/health") {
			const health = await checkGraphHealth(env, graphApiVersion);
			return jsonResponse(
				health,
				effectiveOrigin,
				health.ok ? 200 : 503,
				"no-store",
			);
		}

		const side = url.pathname.replace(/^\//, "");
		if (!isFeedSide(side)) {
			return errorResponse(
				`Unknown route: ${side}. Use /underwater or /portraits.`,
				effectiveOrigin,
				404,
			);
		}
		const route = routeFor(side, env);

		if (!route.credentials.userId || !route.credentials.accessToken) {
			return errorResponse(
				"Service configuration is incomplete.",
				effectiveOrigin,
				503,
			);
		}

		const rawCursor = url.searchParams.get("cursor");
		let pagination: CompositeCursor = {
			version: 3,
			media: { after: null, exhausted: false, failures: 0 },
			collaborativeMedia: { after: null, exhausted: false, failures: 0 },
		};
		if (rawCursor !== null) {
			const decoded = decodeCompositeCursor(rawCursor);
			if (!decoded) {
				return errorResponse("Invalid cursor.", effectiveOrigin, 400);
			}
			pagination = decoded;
		}

		const cacheKey = buildCacheKey(
			side,
			route.credentials.userId,
			graphApiVersion,
			rawCursor,
		);

		try {
			const localCached = await readLocalCache(cacheKey);
			const localHit = parseCacheEnvelope(localCached);
			if (localHit) {
				return jsonResponse(
					localHit.envelope.body,
					effectiveOrigin,
					200,
					`public, max-age=${localHit.remainingTtl}`,
				);
			}

			const kvCacheKey = await buildKvCacheKey(cacheKey);
			const globalCached = await readGlobalCache(env.IG_FEED_CACHE, kvCacheKey);
			const globalHit = parseCacheEnvelope(globalCached);
			if (globalHit) {
				await scheduleCacheWork(
					ctx,
					writeLocalCache(cacheKey, globalHit.envelope, globalHit.remainingTtl),
				);
				return jsonResponse(
					globalHit.envelope.body,
					effectiveOrigin,
					200,
					`public, max-age=${globalHit.remainingTtl}`,
				);
			}

			const skipped: MediaPageResult = { outcome: "skipped" };
			const [mediaResult, collaborativeResult] = await Promise.all([
				pagination.media.exhausted
					? Promise.resolve(skipped)
					: fetchMediaPage(
							buildMediaUrl(
								graphApiVersion,
								route.credentials.userId,
								"media",
								pagination.media.after,
							),
							route.credentials.accessToken,
						),
				pagination.collaborativeMedia.exhausted
					? Promise.resolve(skipped)
					: fetchMediaPage(
							buildMediaUrl(
								graphApiVersion,
								route.credentials.userId,
								"collaborative_media",
								pagination.collaborativeMedia.after,
							),
							route.credentials.accessToken,
						),
			]);

			if (mediaResult.outcome === "failure") {
				console.error("Instagram API request failed", {
					side,
					source: "media",
					status: mediaResult.status,
				});
				return errorResponse(
					"Instagram feed is temporarily unavailable.",
					effectiveOrigin,
					502,
				);
			}

			if (collaborativeResult.outcome === "failure") {
				console.error("Instagram collaborative media request failed", {
					side,
					status: collaborativeResult.status,
				});
			}

			const ownedPosts = await inlineCarouselChildren(
				graphApiVersion,
				route.credentials.accessToken,
				postsFromResult(mediaResult),
			);
			const collaborativePosts = await inlineCarouselChildren(
				graphApiVersion,
				route.credentials.accessToken,
				postsFromResult(collaborativeResult),
			);
			const augmentedPosts = mergeMediaPosts(ownedPosts, collaborativePosts);
			const nextPagination: CompositeCursor = {
				version: 3,
				media: stateFromResult(pagination.media, mediaResult),
				collaborativeMedia: stateFromResult(
					pagination.collaborativeMedia,
					collaborativeResult,
				),
			};
			const hasNext =
				!nextPagination.media.exhausted ||
				!nextPagination.collaborativeMedia.exhausted;
			const responseBody: Record<string, unknown> = hasNext
				? {
						data: augmentedPosts,
						paging: { next: encodeCompositeCursor(nextPagination) },
					}
				: { data: augmentedPosts };
			if (collaborativeResult.outcome === "failure") {
				return jsonResponse(responseBody, effectiveOrigin, 200, "no-store");
			}
			const cacheEnvelope = createCacheEnvelope(responseBody);
			if (!cacheEnvelope) {
				return jsonResponse(responseBody, effectiveOrigin, 200, "no-store");
			}
			await scheduleCacheWork(
				ctx,
				persistCaches(env.IG_FEED_CACHE, cacheKey, kvCacheKey, cacheEnvelope),
			);
			return jsonResponse(responseBody, effectiveOrigin);
		} catch (error) {
			console.error(
				"Instagram proxy request failed",
				error instanceof Error ? error.name : "UnknownError",
			);
			return errorResponse(
				"Instagram feed is temporarily unavailable.",
				effectiveOrigin,
				502,
			);
		}
	},
} satisfies ExportedHandler<Env>;
