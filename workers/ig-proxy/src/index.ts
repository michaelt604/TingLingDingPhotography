/**
 * Cloudflare Worker — Instagram feed proxy
 *
 * Holds a long-lived Instagram Graph API access token server-side and
 * exposes a CORS-safe JSON endpoint the static site can call.
 *
 * Routes:
 *   GET /underwater  → @tinglingdingphotography's media
 *   GET /portraits   → @tinglingdingportraits's media
 *
 * Caches successful feed responses at the Cloudflare edge for 1 hour so we don't
 * hit the Graph API on every page load.
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
 *   - The cache key is a stable internal URL (`https://ig-cache/${side}`)
 *     — it never contains the token.
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

function routeFor(path: string, env: Env): { userId: string; accessToken: string } | null {
  if (path === 'underwater') {
    return { userId: env.IG_USER_ID_UNDERWATER, accessToken: env.IG_ACCESS_TOKEN_UNDERWATER };
  }
  if (path === 'portraits') {
    return { userId: env.IG_USER_ID_PORTRAITS, accessToken: env.IG_ACCESS_TOKEN_PORTRAITS };
  }
  return null;
}

const MEDIA_FIELDS = 'id,media_type,media_url,permalink,thumbnail_url,caption,timestamp';

// Validates a single comma-delimited allowlist entry and returns the
// normalized URL.origin, or null when the entry is empty, malformed, or
// violates the strict HTTPS-origin policy.
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

export function buildCacheKey(
  side: string,
  userId: string,
  graphApiVersion: string,
): Request {
  const path = [graphApiVersion, userId, side].map(encodeURIComponent).join('/');
  return new Request(`https://ig-cache.local/${path}`, { method: 'GET' });
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
    if (url.pathname === '/' || url.pathname === '/health') {
      const ready = Boolean(
        env.IG_USER_ID_UNDERWATER &&
        env.IG_ACCESS_TOKEN_UNDERWATER &&
        env.IG_USER_ID_PORTRAITS &&
        env.IG_ACCESS_TOKEN_PORTRAITS,
      );
      return jsonResponse(
        { ok: ready, version: graphApiVersion },
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

    if (!route.userId || !route.accessToken) {
      return errorResponse('Service configuration is incomplete.', effectiveOrigin, 503);
    }

    // Cache key: stable, internal, NEVER includes the token.
    // Using the upstream URL as a cache key would put the token into
    // the key (since we used to send it as a query param). Now the
    // token goes in the Authorization header instead, so we can use
    // a clean internal key.
    const cacheKey = buildCacheKey(side, route.userId, graphApiVersion);

    // Build the upstream request WITH the token in a Bearer header.
    const igUrl =
      `https://graph.instagram.com/${graphApiVersion}/${route.userId}/media` +
      `?fields=${MEDIA_FIELDS}` +
      `&limit=9`;

    try {
      const cache = caches.default;
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.json();
        return jsonResponse(body, effectiveOrigin);
      }

      const upstream = await fetch(igUrl, {
        headers: {
          'Authorization': `Bearer ${route.accessToken}`,
        },
      });
      if (!upstream.ok) {
        console.error('Instagram API request failed', {
          side,
          status: upstream.status,
        });
        return errorResponse('Instagram feed is temporarily unavailable.', effectiveOrigin, 502);
      }

      const data = await upstream.json();
      // Cache the successful response under the clean key.
      const cacheable = new Response(JSON.stringify(data), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
      });
      await cache.put(cacheKey, cacheable.clone());
      return jsonResponse(data, effectiveOrigin);
    } catch (error) {
      console.error(
        'Instagram proxy request failed',
        error instanceof Error ? error.name : 'UnknownError',
      );
      return errorResponse('Instagram feed is temporarily unavailable.', effectiveOrigin, 502);
    }
  },
} satisfies ExportedHandler<Env>;
