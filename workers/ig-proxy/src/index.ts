/**
 * Cloudflare Worker — Instagram feed proxy
 *
 * Holds a long-lived Instagram Graph API access token server-side and
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
 * Caches successful feed responses at the Cloudflare edge for 1 hour
 * so we don't hit the Graph API on every page load. Cache keys include
 * the cursor so paginated responses are cached independently.
 *
 * ──────────────────────────────────────────────────────────────────
 *  DEPLOY
 * ──────────────────────────────────────────────────────────────────
 *  1. Install wrangler:  npm install -g wrangler
 *  2. Login:            wrangler login
 *  3. cd workers/ig-proxy
 *  4. Set secrets:      wrangler secret put IG_ACCESS_TOKEN_UNDERWATER
 *                       wrangler secret put IG_USER_ID_UNDERWATER
 *                       wrangler secret put IG_ACCESS_TOKEN_PORTRAITS
 *                       wrangler secret put IG_USER_ID_PORTRAITS
 *                       wrangler secret put IG_COLLAB_ACCESS_TOKEN_UNDERWATER
 *                       wrangler secret put IG_COLLAB_USER_ID_UNDERWATER
 *                       wrangler secret put IG_COLLAB_ACCESS_TOKEN_PORTRAITS
 *                       wrangler secret put IG_COLLAB_USER_ID_PORTRAITS
 *                       wrangler secret put IG_COLLAB_CHILD_ACCESS_TOKEN_UNDERWATER
 *                       wrangler secret put IG_COLLAB_CHILD_ACCESS_TOKEN_PORTRAITS
 *                       wrangler secret put IG_INSTAGRAM_APP_SECRET
 *  5. Deploy:           wrangler deploy
 *  6. Set NEXT_PUBLIC_IG_PROXY_URL in your Next.js env to the
 *     deployed worker URL (e.g. https://ig-proxy.<you>.workers.dev)
 * ──────────────────────────────────────────────────────────────────
 *
 * Token refresh: long-lived tokens last 60 days. Set a calendar
 * reminder; when one expires, /me?fields=id will return an error and
 * the feed will fall back to placeholder. Refresh by re-running the
 * short-lived → long-lived exchange in Graph API Explorer.
 *
 * Security notes:
 *   - Access token is sent to Graph API via Authorization: Bearer
 *     header (NOT a query param), so it never appears in URLs, cache
 *     keys, or access logs.
 *   - The cache key is a stable internal URL
 *     (`https://ig-cache/${version}/${userId}/${side}/${cursor}`) —
 *     it never contains the token. The cursor is included only when
 *     the caller passed one, so paginated responses are cached
 *     independently while the token stays out of every key.
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
 *   - `caches.default` is zone-wide; cached bodies are shared across
 *     origins. We re-apply CORS in jsonResponse() so the cached
 *     response is still origin-aware.
 */

export interface Env {
  IG_USER_ID_UNDERWATER: string;
  IG_ACCESS_TOKEN_UNDERWATER: string;
  IG_USER_ID_PORTRAITS: string;
  IG_ACCESS_TOKEN_PORTRAITS: string;
  IG_COLLAB_USER_ID_UNDERWATER?: string;
  IG_COLLAB_ACCESS_TOKEN_UNDERWATER?: string;
  IG_COLLAB_CHILD_ACCESS_TOKEN_UNDERWATER?: string;
  IG_COLLAB_USER_ID_PORTRAITS?: string;
  IG_COLLAB_ACCESS_TOKEN_PORTRAITS?: string;
  IG_COLLAB_CHILD_ACCESS_TOKEN_PORTRAITS?: string;
  /** Instagram Business Login application id (non-secret). */
  IG_INSTAGRAM_APP_ID?: string;
  /** Instagram Business Login application secret. Keep this Worker-only. */
  IG_INSTAGRAM_APP_SECRET?: string;
  /** Exact redirect URI registered in the Instagram app. */
  IG_INSTAGRAM_REDIRECT_URI?: string;
  /** Private KV store for OAuth state and exchanged collaborator tokens. */
  IG_TOKEN_STORE?: KVNamespace;
  /**
   * Comma-separated HTTPS allowlist. Each entry must be an HTTPS URL
   * with no credentials, no path beyond "/", no query, and no fragment.
   * Whitespace is trimmed and exact-match duplicates are removed.
   * Set in wrangler.toml [vars]. Fails closed when missing or invalid.
   */
  ALLOWED_ORIGIN?: string;
  GRAPH_API_VERSION?: string;
}

const CACHE_TTL_SECONDS = 3600;
export const DEFAULT_GRAPH_API_VERSION = 'v23.0';
const INSTAGRAM_AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_CODE_EXCHANGE_URL = 'https://api.instagram.com/oauth/access_token';
const INSTAGRAM_LONG_LIVED_EXCHANGE_URL = 'https://graph.instagram.com/access_token';
const OAUTH_STATE_TTL_SECONDS = 600;
const OAUTH_STATE_PREFIX = 'ig-oauth-state:';
const COLLAB_TOKEN_PREFIX = 'ig-collab-child-token:';

const CORS = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  // Vary on Origin so caches don't serve one origin's response to another
  // when we lock down ALLOWED_ORIGIN.
  'Vary': 'Origin',
});

const JSON_HEADERS = (origin: string, cacheControl: string) => ({
  ...CORS(origin),
  'Content-Type': 'application/json',
  'Cache-Control': cacheControl,
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

export function errorResponse(message: string, origin: string, status = 500): Response {
  return jsonResponse({ error: message }, origin, status, 'no-store');
}

interface ApiCredentials {
  userId: string;
  accessToken: string;
}

interface FeedRoute {
  owned: ApiCredentials;
  collaborative: ApiCredentials;
  collaborativeChildAccessToken?: string;
}

function routeFor(path: string, env: Env): FeedRoute | null {
  if (path === 'underwater') {
    return {
      owned: { userId: env.IG_USER_ID_UNDERWATER, accessToken: env.IG_ACCESS_TOKEN_UNDERWATER },
      collaborative: {
        userId: env.IG_COLLAB_USER_ID_UNDERWATER ?? '',
        accessToken: env.IG_COLLAB_ACCESS_TOKEN_UNDERWATER ?? '',
      },
      collaborativeChildAccessToken: env.IG_COLLAB_CHILD_ACCESS_TOKEN_UNDERWATER,
    };
  }
  if (path === 'portraits') {
    return {
      owned: { userId: env.IG_USER_ID_PORTRAITS, accessToken: env.IG_ACCESS_TOKEN_PORTRAITS },
      collaborative: {
        userId: env.IG_COLLAB_USER_ID_PORTRAITS ?? '',
        accessToken: env.IG_COLLAB_ACCESS_TOKEN_PORTRAITS ?? '',
      },
      collaborativeChildAccessToken: env.IG_COLLAB_CHILD_ACCESS_TOKEN_PORTRAITS,
    };
  }
  return null;
}

type FeedSide = 'underwater' | 'portraits';

function isFeedSide(value: string | null): value is FeedSide {
  return value === 'underwater' || value === 'portraits';
}

function collaboratorUserIdFor(side: FeedSide, env: Env): string {
  return side === 'underwater'
    ? env.IG_COLLAB_USER_ID_UNDERWATER ?? ''
    : env.IG_COLLAB_USER_ID_PORTRAITS ?? '';
}

function collaboratorTokenKey(side: FeedSide): string {
  return `${COLLAB_TOKEN_PREFIX}${side}`;
}

function oauthStateKey(state: string): string {
  return `${OAUTH_STATE_PREFIX}${state}`;
}

interface InstagramTokenExchange {
  accessToken: string;
  userId: string;
  expiresIn?: number;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function parseUpstreamJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return parseJsonObject(await response.json());
  } catch {
    return null;
  }
}

function validTokenExchangePayload(
  payload: Record<string, unknown> | null,
  fallbackUserId?: string,
): InstagramTokenExchange | null {
  if (!payload) return null;
  const accessToken = payload.access_token;
  const rawUserId = payload.user_id;
  const userId =
    typeof rawUserId === 'string'
      ? rawUserId
      : typeof rawUserId === 'number' && Number.isFinite(rawUserId) && Number.isInteger(rawUserId)
        ? String(rawUserId)
        : null;
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
  const resolvedUserId = userId ?? fallbackUserId;
  if (!resolvedUserId) return null;
  const expiresIn = payload.expires_in;
  return {
    accessToken,
    userId: resolvedUserId,
    ...(typeof expiresIn === 'number' && Number.isFinite(expiresIn) && expiresIn > 0
      ? { expiresIn }
      : {}),
  };
}

function safeUpstreamError(payload: Record<string, unknown> | null): Record<string, unknown> {
  if (!payload) return {};
  const nested = parseJsonObject(payload.error);
  const source = nested ?? payload;
  const result: Record<string, unknown> = {};
  for (const key of ['type', 'code', 'error_subcode']) {
    const value = source[key];
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      result[key] = value;
    }
  }
  const message = source.message ?? source.error_message ?? payload.error_description;
  if (typeof message === 'string' && message.length > 0) {
    result.message = message.slice(0, 240);
  }
  return result;
}

async function exchangeInstagramAuthorizationCode(
  code: string,
  env: Env,
): Promise<InstagramTokenExchange | null> {
  if (!env.IG_INSTAGRAM_APP_ID || !env.IG_INSTAGRAM_APP_SECRET || !env.IG_INSTAGRAM_REDIRECT_URI) {
    return null;
  }

  const form = new FormData();
  form.set('client_id', env.IG_INSTAGRAM_APP_ID);
  form.set('client_secret', env.IG_INSTAGRAM_APP_SECRET);
  form.set('grant_type', 'authorization_code');
  form.set('redirect_uri', env.IG_INSTAGRAM_REDIRECT_URI);
  form.set('code', code);

  try {
    const shortLivedResponse = await fetch(INSTAGRAM_CODE_EXCHANGE_URL, {
      method: 'POST',
      body: form,
    });
    const shortLivedPayload = await parseUpstreamJson(shortLivedResponse);
    if (!shortLivedResponse.ok) {
      console.error(
        'Instagram short-lived token exchange rejected',
        shortLivedResponse.status,
        safeUpstreamError(shortLivedPayload),
      );
      return null;
    }
    const shortLived = validTokenExchangePayload(shortLivedPayload);
    if (!shortLived) {
      console.error(
        'Instagram short-lived token exchange payload invalid',
        safeUpstreamError(shortLivedPayload),
      );
      return null;
    }

    const longLivedUrl = new URL(INSTAGRAM_LONG_LIVED_EXCHANGE_URL);
    longLivedUrl.search = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: env.IG_INSTAGRAM_APP_SECRET,
      access_token: shortLived.accessToken,
    }).toString();
    const longLivedResponse = await fetch(longLivedUrl, { method: 'GET' });
    const longLivedPayload = await parseUpstreamJson(longLivedResponse);
    if (!longLivedResponse.ok) {
      console.error(
        'Instagram long-lived token exchange rejected',
        longLivedResponse.status,
        safeUpstreamError(longLivedPayload),
      );
      return null;
    }
    const longLived = validTokenExchangePayload(longLivedPayload, shortLived.userId);
    if (!longLived) {
      console.error(
        'Instagram long-lived token exchange payload invalid',
        safeUpstreamError(longLivedPayload),
      );
      return null;
    }
    if (longLived.userId !== shortLived.userId) {
      console.error('Instagram token exchange returned mismatched account ids');
      return null;
    }
    return longLived;
  } catch (error) {
    console.error(
      'Instagram token exchange request failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return null;
  }
}

function oauthConfigReady(env: Env): boolean {
  return Boolean(
    env.IG_TOKEN_STORE &&
      env.IG_INSTAGRAM_APP_ID &&
      env.IG_INSTAGRAM_APP_SECRET &&
      env.IG_INSTAGRAM_REDIRECT_URI,
  );
}

function tokenFingerprint(token: string | undefined): string {
  if (!token) return 'none';
  // This is only a cache namespace discriminator; it is intentionally not
  // reversible and never contains token material.
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${token.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

interface ResolvedCollaborativeToken {
  accessToken: string | undefined;
  graphApiHost: 'graph.facebook.com' | 'graph.instagram.com';
  fromInstagramLogin: boolean;
}

async function resolveCollaborativeToken(
  side: FeedSide,
  env: Env,
  fallback: string | undefined,
): Promise<ResolvedCollaborativeToken> {
  if (!env.IG_TOKEN_STORE) {
    return { accessToken: fallback, graphApiHost: 'graph.facebook.com', fromInstagramLogin: false };
  }
  try {
    const stored = await env.IG_TOKEN_STORE.get(collaboratorTokenKey(side));
    // Instagram Business Login tokens are valid on graph.instagram.com and
    // replace the legacy Facebook Graph token for the entire collaborator
    // request, not only for carousel children.
    if (stored) {
      return { accessToken: stored, graphApiHost: 'graph.instagram.com', fromInstagramLogin: true };
    }
    return { accessToken: fallback, graphApiHost: 'graph.facebook.com', fromInstagramLogin: false };
  } catch (error) {
    console.error(
      'Instagram collaborator token lookup failed',
      side,
      error instanceof Error ? error.name : 'UnknownError',
    );
    return { accessToken: fallback, graphApiHost: 'graph.facebook.com', fromInstagramLogin: false };
  }
}

const MEDIA_FIELDS = 'id,media_type,media_url,permalink,thumbnail_url,caption,timestamp';

// Fields we ask for when listing the children of a CAROUSEL_ALBUM post.
// Children don't have a `caption` or `timestamp` — those live on the
// parent — and their `permalink` is optional (IG omits it on some
// children), so we don't require it.
const CHILDREN_FIELDS = 'id,media_type,media_url,permalink,thumbnail_url';
const COLLABORATIVE_MEDIA_FIELDS = `${MEDIA_FIELDS},children{${CHILDREN_FIELDS}}`;

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

const CHILD_MEDIA_TYPES = new Set(['IMAGE', 'VIDEO']);

/**
 * Returns true when the URL is an HTTPS URL on Instagram's CDN or
 * fbcdn. Mirrors the host check used by the feed normalizer so a
 * child can't smuggle in a non-IG asset.
 */
function isInstagramMediaHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname;
    return (
      host === 'cdninstagram.com' ||
      host.endsWith('.cdninstagram.com') ||
      host === 'fbcdn.net' ||
      host.endsWith('.fbcdn.net')
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
    if (url.protocol !== 'https:') return false;
    const host = url.hostname;
    return host === 'instagram.com' || host.endsWith('.instagram.com');
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
export function normalizeCarouselChildren(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as { data?: unknown; children?: { data?: unknown } };
  // The media edge returns `{ data: [...] }`, while field expansion on a
  // parent returns `{ children: { data: [...] } }`. Accept both shapes so
  // collaborator media can use whichever form its Graph endpoint supports.
  const data = Array.isArray(body.data) ? body.data : body.children?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((candidate): candidate is Record<string, unknown> => {
    if (!candidate || typeof candidate !== 'object') return false;
    const post = candidate as Record<string, unknown>;
    const id = post.id;
    const mediaUrl = post.media_url;
    const mediaType = post.media_type;
    if (typeof id !== 'string' || !id) return false;
    if (typeof mediaUrl !== 'string' || !isInstagramMediaHttpsUrl(mediaUrl)) return false;
    if (typeof mediaType !== 'string' || !CHILD_MEDIA_TYPES.has(mediaType)) return false;
    const thumbnail = post.thumbnail_url;
    if (
      thumbnail !== undefined &&
      (typeof thumbnail !== 'string' || !isInstagramMediaHttpsUrl(thumbnail))
    ) {
      return false;
    }
    const permalink = post.permalink;
    if (
      permalink !== undefined &&
      (typeof permalink !== 'string' || !isInstagramHttpsUrl(permalink))
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
  graphApiHost = 'graph.instagram.com',
  fallback?:
    | { accessToken: string; graphApiHost: string }
    | Array<{ accessToken: string; graphApiHost: string }>,
): Promise<unknown[]> {
  const sources = [
    { accessToken, graphApiHost },
    ...(fallback ? (Array.isArray(fallback) ? fallback : [fallback]) : []),
  ];

  // Collaborative media may not expose the `/children` edge on the
  // Facebook Graph host, while the parent field expansion still returns the
  // complete carousel. Try that form once before the edge fallbacks.
  if (fallback) {
    const expandedUrl = new URL(
      `https://${graphApiHost}/${graphApiVersion}/${encodeURIComponent(parentId)}`,
    );
    expandedUrl.searchParams.set('fields', `children{${CHILDREN_FIELDS}}`);
    try {
      const response = await fetch(expandedUrl, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (response.ok) {
        const children = normalizeCarouselChildren(await response.json());
        if (children.length > 0) return children;
      }
    } catch (error) {
      console.error(
        'Instagram expanded carousel request failed',
        parentId,
        graphApiHost,
        error instanceof Error ? error.name : 'UnknownError',
      );
    }
  }

  const attempts = sources;

  for (const attempt of attempts) {
    const encodedId = encodeURIComponent(parentId);
    const url =
      `https://${attempt.graphApiHost}/${graphApiVersion}/${encodedId}/children` +
      `?fields=${CHILDREN_FIELDS}&limit=10`;
    try {
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${attempt.accessToken}` },
      });
      if (!response.ok) continue;
      const children = normalizeCarouselChildren(await response.json());
      if (children.length > 0) return children;
    } catch (error) {
      console.error(
        'Instagram carousel children request failed',
        parentId,
        attempt.graphApiHost,
        error instanceof Error ? error.name : 'UnknownError',
      );
    }
  }

  return [];
}

/**
 * Augments a list of posts with inline `children` arrays for every
 * CAROUSEL_ALBUM entry. Posts of other media types are returned
 * unchanged. Failures to fetch a carousel's children are silent and
 * leave that post without `children` — the client falls back to the
 * parent's `media_url`.
 */
export async function inlineCarouselChildren(
  graphApiVersion: string,
  accessToken: string,
  posts: Record<string, unknown>[],
  graphApiHost = 'graph.instagram.com',
  fallback?:
    | { accessToken: string; graphApiHost: string }
    | Array<{ accessToken: string; graphApiHost: string }>,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    posts.map(async (post) => {
      if (post.media_type !== 'CAROUSEL_ALBUM') return post;
      const id = post.id;
      if (typeof id !== 'string') return post;
      const inlineChildren = Array.isArray(post.children)
        ? normalizeCarouselChildren({ data: post.children })
        : normalizeCarouselChildren(post.children);
      if (inlineChildren.length > 0) return { ...post, children: inlineChildren };
      const children = await fetchCarouselChildren(
        graphApiVersion,
        id,
        accessToken,
        graphApiHost,
        fallback,
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
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.pathname !== '/') return null;
  if (url.search !== '') return null;
  if (url.hash !== '') return null;
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
  if (typeof raw !== 'string') return null;
  const trimmedRaw = raw.trim();
  if (!trimmedRaw) return null;
  const entries = raw.split(',');
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
const CACHE_SCHEMA_VERSION = 'collaborative-v10';

interface SourceCursorState {
  after: string | null;
  exhausted: boolean;
  failures: 0 | 1;
}

interface CompositeCursor {
  version: 1;
  media: SourceCursorState;
  collaborativeMedia: SourceCursorState;
}

export function validateCursor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH) return null;
  if (value.startsWith('//') || !/^[A-Za-z0-9_+/=-]+$/.test(value)) return null;
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseSourceCursorState(value: unknown): SourceCursorState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!hasExactKeys(candidate, ['after', 'exhausted', 'failures'])) return null;
  if (typeof candidate.exhausted !== 'boolean') return null;
  if (candidate.failures !== 0 && candidate.failures !== 1) return null;
  const after = candidate.after === null ? null : validateCursor(candidate.after);
  if (candidate.after !== null && after === null) return null;
  if (candidate.exhausted && after !== null) return null;
  if (!candidate.exhausted && after === null && candidate.failures !== 1) return null;
  return { after, exhausted: candidate.exhausted, failures: candidate.failures };
}

function encodeCompositeCursor(cursor: CompositeCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function decodeCompositeCursor(value: unknown): CompositeCursor | null {
  if (typeof value !== 'string') return null;
  if (
    value.length === 0 ||
    value.length > MAX_CLIENT_CURSOR_LENGTH ||
    value.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    return null;
  }

  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (!hasExactKeys(candidate, ['version', 'media', 'collaborativeMedia'])) return null;
    if (candidate.version !== 1) return null;
    const media = parseSourceCursorState(candidate.media);
    const collaborativeMedia = parseSourceCursorState(candidate.collaborativeMedia);
    if (!media || !collaborativeMedia) return null;
    const cursor: CompositeCursor = { version: 1, media, collaborativeMedia };
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
  childTokenFingerprint = 'none',
): Request {
  // Use a fixed marker when no cursor is provided so the first-page cache
  // key is stable regardless of how the URL was constructed. Encode every
  // segment because valid opaque cursors may contain reserved URL characters.
  const cursorSegment = cursor ?? '_';
  const path = [
    CACHE_SCHEMA_VERSION,
    graphApiVersion,
    userId,
    side,
    childTokenFingerprint,
    cursorSegment,
  ]
    .map(encodeURIComponent)
    .join('/');
  return new Request(`https://ig-cache.local/${path}`, { method: 'GET' });
}

// Strips any `paging.next` URL from an upstream Graph API payload and
// returns a sanitized object whose `paging.next` field is the opaque
// cursor token only. Returns undefined when the payload has no paging
// block or the upstream cursor fails validation.
export function sanitizePaging(payload: unknown): { next?: string } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  if (!('paging' in payload)) return undefined;
  const raw = (payload as Record<string, unknown>).paging;
  if (!raw || typeof raw !== 'object') return undefined;
  if (!('cursors' in raw)) return undefined;
  const cursors = (raw as Record<string, unknown>).cursors;
  if (!cursors || typeof cursors !== 'object') return undefined;
  const after = (cursors as Record<string, unknown>).after;
  const cursor = validateCursor(after);
  if (!cursor) return undefined;
  return { next: cursor };
}

type MediaPageResult =
  | { outcome: 'success'; payload: Record<string, unknown> }
  | { outcome: 'failure'; status?: number }
  | { outcome: 'skipped' };

function buildMediaUrl(
  graphApiVersion: string,
  userId: string,
  endpoint: 'media' | 'collaborative_media',
  after: string | null,
  graphApiHost = 'graph.instagram.com',
  fields = MEDIA_FIELDS,
): URL {
  const url = new URL(
    `https://${graphApiHost}/${graphApiVersion}/${encodeURIComponent(userId)}/${endpoint}`,
  );
  url.search = new URLSearchParams({
    fields,
    limit: '9',
    ...(after ? { after } : {}),
  }).toString();
  return url;
}

async function fetchMediaPage(url: URL, accessToken: string): Promise<MediaPageResult> {
  try {
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) return { outcome: 'failure', status: response.status };
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { outcome: 'failure' };
    }
    if (!Array.isArray((payload as Record<string, unknown>).data)) {
      return { outcome: 'failure' };
    }
    return { outcome: 'success', payload: payload as Record<string, unknown> };
  } catch {
    return { outcome: 'failure' };
  }
}

function postsFromResult(result: MediaPageResult): Record<string, unknown>[] {
  if (result.outcome !== 'success' || !Array.isArray(result.payload.data)) return [];
  return result.payload.data.filter(
    (post): post is Record<string, unknown> =>
      Boolean(post) && typeof post === 'object' && !Array.isArray(post),
  );
}

function stateFromResult(
  previous: SourceCursorState,
  result: MediaPageResult,
): SourceCursorState {
  if (result.outcome === 'skipped') return previous;
  if (result.outcome === 'failure') {
    if (previous.failures === 0) return { ...previous, failures: 1 };
    return { after: null, exhausted: true, failures: 1 };
  }
  const after = sanitizePaging(result.payload)?.next ?? null;
  return after
    ? { after, exhausted: false, failures: 0 }
    : { after: null, exhausted: true, failures: 0 };
}

async function fetchCollaborativeMediaPage(
  graphApiVersion: string,
  userId: string,
  accessToken: string,
  after: string | null,
  graphApiHost: 'graph.facebook.com' | 'graph.instagram.com' = 'graph.facebook.com',
): Promise<MediaPageResult> {
  const expanded = await fetchMediaPage(
    buildMediaUrl(
      graphApiVersion,
      userId,
      'collaborative_media',
      after,
      graphApiHost,
      COLLABORATIVE_MEDIA_FIELDS,
    ),
    accessToken,
  );
  if (expanded.outcome !== 'failure') return expanded;

  // Keep the feed available if a Graph API version rejects nested fields;
  // child expansion will still be attempted per carousel below.
  return fetchMediaPage(
    buildMediaUrl(
      graphApiVersion,
      userId,
      'collaborative_media',
      after,
      graphApiHost,
    ),
    accessToken,
  );
}

function mergeMediaPosts(
  mediaPosts: Record<string, unknown>[],
  collaborativePosts: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seenIds = new Set<string>();
  return [...mediaPosts, ...collaborativePosts]
    .filter((post) => {
      if (typeof post.id !== 'string') return true;
      if (seenIds.has(post.id)) return false;
      seenIds.add(post.id);
      return true;
    })
    .sort((left, right) => {
      const leftTimestamp = typeof left.timestamp === 'string' ? Date.parse(left.timestamp) : Number.NaN;
      const rightTimestamp = typeof right.timestamp === 'string' ? Date.parse(right.timestamp) : Number.NaN;
      const leftValue = Number.isNaN(leftTimestamp) ? Number.NEGATIVE_INFINITY : leftTimestamp;
      const rightValue = Number.isNaN(rightTimestamp) ? Number.NEGATIVE_INFINITY : rightTimestamp;
      if (rightValue !== leftValue) return rightValue - leftValue;
      const leftId = typeof left.id === 'string' ? left.id : '';
      const rightId = typeof right.id === 'string' ? right.id : '';
      return leftId.localeCompare(rightId);
    });
}

function responseBodyFromCache(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { data: [] };
  const candidate = payload as Record<string, unknown>;
  const data = Array.isArray(candidate.data) ? candidate.data : [];
  const paging = candidate.paging;
  if (!paging || typeof paging !== 'object' || Array.isArray(paging)) return { data };
  const next = (paging as Record<string, unknown>).next;
  return decodeCompositeCursor(next) ? { data, paging: { next } } : { data };
}

async function handleInstagramOAuthStart(
  env: Env,
  requestedSide: string | null,
  origin: string,
): Promise<Response> {
  if (!oauthConfigReady(env)) {
    return errorResponse('Instagram authorization is not configured.', origin, 503);
  }
  if (!isFeedSide(requestedSide) || !collaboratorUserIdFor(requestedSide, env)) {
    return errorResponse('Invalid Instagram authorization target.', origin, 400);
  }
  const side = requestedSide;

  const state = crypto.randomUUID();
  try {
    await env.IG_TOKEN_STORE!.put(oauthStateKey(state), side, {
      expirationTtl: OAUTH_STATE_TTL_SECONDS,
    });
  } catch (error) {
    console.error(
      'Instagram OAuth state storage failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return errorResponse('Instagram authorization is temporarily unavailable.', origin, 503);
  }

  const authorizeUrl = new URL(INSTAGRAM_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    force_reauth: 'true',
    client_id: env.IG_INSTAGRAM_APP_ID!,
    redirect_uri: env.IG_INSTAGRAM_REDIRECT_URI!,
    response_type: 'code',
    scope: 'instagram_business_basic',
    state,
  }).toString();
  return new Response(null, {
    status: 302,
    headers: {
      ...CORS(origin),
      Location: authorizeUrl.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

async function handleInstagramOAuthCallback(
  requestUrl: URL,
  env: Env,
  origin: string,
): Promise<Response> {
  if (!oauthConfigReady(env)) {
    return errorResponse('Instagram authorization is not configured.', origin, 503);
  }

  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  if (!code || !state || code.length > 4096 || state.length > 256) {
    return errorResponse('Instagram authorization response is incomplete.', origin, 400);
  }

  let storedSide: string | null = null;
  try {
    storedSide = await env.IG_TOKEN_STORE!.get(oauthStateKey(state));
    await env.IG_TOKEN_STORE!.delete(oauthStateKey(state));
  } catch (error) {
    console.error(
      'Instagram OAuth state lookup failed',
      error instanceof Error ? error.name : 'UnknownError',
    );
    return errorResponse('Instagram authorization is temporarily unavailable.', origin, 503);
  }
  if (!isFeedSide(storedSide)) {
    return errorResponse('Instagram authorization state is invalid or expired.', origin, 400);
  }

  const exchanged = await exchangeInstagramAuthorizationCode(code, env);
  if (!exchanged) {
    return errorResponse('Instagram authorization could not be completed.', origin, 502);
  }
  if (exchanged.userId !== collaboratorUserIdFor(storedSide, env)) {
    return errorResponse('Instagram authorization account does not match this feed.', origin, 403);
  }

  try {
    const options =
      exchanged.expiresIn && exchanged.expiresIn >= 60
        ? { expirationTtl: Math.floor(exchanged.expiresIn) }
        : undefined;
    await env.IG_TOKEN_STORE!.put(collaboratorTokenKey(storedSide), exchanged.accessToken, options);
  } catch (error) {
    console.error(
      'Instagram collaborator token storage failed',
      storedSide,
      error instanceof Error ? error.name : 'UnknownError',
    );
    return errorResponse('Instagram authorization is temporarily unavailable.', origin, 503);
  }

  return jsonResponse(
    {
      ok: true,
      side: storedSide,
      instagramUserId: exchanged.userId,
      ...(exchanged.expiresIn ? { expiresIn: exchanged.expiresIn } : {}),
    },
    origin,
    200,
    'no-store',
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowlist = resolveAllowlist(env);
    const graphApiVersion = resolveGraphApiVersion(env);
    const nonBrowserOrigin = allowlist ? allowlist[0] : null;

    if (!allowlist || !graphApiVersion || nonBrowserOrigin === null) {
      return new Response(
        JSON.stringify({ error: 'Service configuration is incomplete.' }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        },
      );
    }

    const requestOrigin = request.headers.get('Origin');
    let effectiveOrigin: string;
    if (requestOrigin) {
      if (!allowlist.includes(requestOrigin)) {
        return errorResponse('Forbidden.', nonBrowserOrigin, 403);
      }
      effectiveOrigin = requestOrigin;
    } else {
      effectiveOrigin = nonBrowserOrigin;
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS(effectiveOrigin) });
    }

    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', effectiveOrigin, 405);
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/oauth/instagram/start') {
      return handleInstagramOAuthStart(env, url.searchParams.get('side'), effectiveOrigin);
    }
    if (url.pathname === '/oauth/instagram/callback') {
      return handleInstagramOAuthCallback(url, env, effectiveOrigin);
    }
    if (url.pathname === '/' || url.pathname === '/health') {
      const ready = Boolean(
        env.IG_USER_ID_UNDERWATER &&
        env.IG_ACCESS_TOKEN_UNDERWATER &&
        env.IG_USER_ID_PORTRAITS &&
        env.IG_ACCESS_TOKEN_PORTRAITS,
      );
      const collaborativeReady = Boolean(
        env.IG_COLLAB_USER_ID_UNDERWATER &&
        env.IG_COLLAB_ACCESS_TOKEN_UNDERWATER &&
        env.IG_COLLAB_USER_ID_PORTRAITS &&
        env.IG_COLLAB_ACCESS_TOKEN_PORTRAITS,
      );
      return jsonResponse(
        { ok: ready, collaborativeReady, version: graphApiVersion },
        effectiveOrigin,
        ready ? 200 : 503,
        'no-store',
      );
    }

    const side = url.pathname.replace(/^\//, '');
    const route = routeFor(side, env);
    if (!route) {
      return errorResponse(`Unknown route: ${side}. Use /underwater or /portraits.`, effectiveOrigin, 404);
    }

    if (!route.owned.userId || !route.owned.accessToken) {
      return errorResponse('Service configuration is incomplete.', effectiveOrigin, 503);
    }

    const rawCursor = url.searchParams.get('cursor');
    let pagination: CompositeCursor = {
      version: 1,
      media: { after: null, exhausted: false, failures: 0 },
      collaborativeMedia: { after: null, exhausted: false, failures: 0 },
    };
    if (rawCursor !== null) {
      const decoded = decodeCompositeCursor(rawCursor);
      if (!decoded) {
        return errorResponse('Invalid cursor.', effectiveOrigin, 400);
      }
      pagination = decoded;
    }

    const feedSide = side as FeedSide;
    const collaborativeToken = await resolveCollaborativeToken(
      feedSide,
      env,
      route.collaborative.accessToken,
    );
    const cacheKey = buildCacheKey(
      side,
      route.owned.userId,
      graphApiVersion,
      rawCursor,
      tokenFingerprint(collaborativeToken.accessToken),
    );

    try {
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        return jsonResponse(responseBodyFromCache(await cached.json()), effectiveOrigin);
      }

      const skipped: MediaPageResult = { outcome: 'skipped' };
      const [mediaResult, collaborativeResult] = await Promise.all([
        pagination.media.exhausted
          ? Promise.resolve(skipped)
          : fetchMediaPage(
              buildMediaUrl(
                graphApiVersion,
                route.owned.userId,
                'media',
                pagination.media.after,
                'graph.instagram.com',
              ),
              route.owned.accessToken,
            ),
        pagination.collaborativeMedia.exhausted
          ? Promise.resolve(skipped)
          : !route.collaborative.userId || !collaborativeToken.accessToken
            ? Promise.resolve({ outcome: 'success', payload: { data: [] } } as MediaPageResult)
            : fetchCollaborativeMediaPage(
                graphApiVersion,
                route.collaborative.userId,
                collaborativeToken.accessToken,
                pagination.collaborativeMedia.after,
                collaborativeToken.graphApiHost,
              ),
      ]);

      if (mediaResult.outcome === 'failure') {
        console.error('Instagram API request failed', {
          side,
          source: 'media',
          status: mediaResult.status,
        });
        return errorResponse('Instagram feed is temporarily unavailable.', effectiveOrigin, 502);
      }

      if (collaborativeResult.outcome === 'failure') {
        console.error('Instagram collaborative media request failed', {
          side,
          status: collaborativeResult.status,
        });
      }

      const ownedPosts = await inlineCarouselChildren(
        graphApiVersion,
        route.owned.accessToken,
        postsFromResult(mediaResult),
        'graph.instagram.com',
      );
      const collaborativePosts = await inlineCarouselChildren(
        graphApiVersion,
        collaborativeToken.accessToken ?? '',
        postsFromResult(collaborativeResult),
        collaborativeToken.graphApiHost,
        collaborativeToken.fromInstagramLogin
          ? [
              { accessToken: route.collaborative.accessToken, graphApiHost: 'graph.facebook.com' },
              { accessToken: route.owned.accessToken, graphApiHost: 'graph.instagram.com' },
            ]
          : [
              {
                accessToken: route.collaborativeChildAccessToken ?? route.collaborative.accessToken,
                graphApiHost: 'graph.instagram.com',
              },
              { accessToken: route.owned.accessToken, graphApiHost: 'graph.instagram.com' },
            ],
      );
      const augmentedPosts = mergeMediaPosts(ownedPosts, collaborativePosts);
      const nextPagination: CompositeCursor = {
        version: 1,
        media: stateFromResult(pagination.media, mediaResult),
        collaborativeMedia: stateFromResult(
          pagination.collaborativeMedia,
          collaborativeResult,
        ),
      };
      const hasNext =
        !nextPagination.media.exhausted || !nextPagination.collaborativeMedia.exhausted;
      const responseBody: Record<string, unknown> = hasNext
        ? { data: augmentedPosts, paging: { next: encodeCompositeCursor(nextPagination) } }
        : { data: augmentedPosts };
      const cacheable = new Response(JSON.stringify(responseBody), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
      });
      await cache.put(cacheKey, cacheable.clone());
      return jsonResponse(responseBody, effectiveOrigin);
    } catch (error) {
      console.error(
        'Instagram proxy request failed',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return errorResponse('Instagram feed is temporarily unavailable.', effectiveOrigin, 502);
    }
  },
} satisfies ExportedHandler<Env>;
