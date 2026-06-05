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
 * Caches every response at the Cloudflare edge for 1 hour so we don't
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
 */

interface Env {
  IG_USER_ID_UNDERWATER: string;
  IG_ACCESS_TOKEN_UNDERWATER: string;
  IG_USER_ID_PORTRAITS: string;
  IG_ACCESS_TOKEN_PORTRAITS: string;
  // Optional: set to "*" for any origin, or your specific domain(s).
  // Default: "*" for development convenience. Lock this down for prod.
  ALLOWED_ORIGIN?: string;
}

const CACHE_TTL_SECONDS = 3600;
const DEFAULT_ORIGIN = '*';

const CORS = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

const JSON_HEADERS = (origin: string) => ({
  ...CORS(origin),
  'Content-Type': 'application/json',
  'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
});

function jsonResponse(body: unknown, origin: string, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS(origin),
  });
}

function errorResponse(message: string, origin: string, status = 500): Response {
  return jsonResponse({ error: message }, origin, status);
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

const GRAPH_API_VERSION = 'v18.0';
const MEDIA_FIELDS = 'id,media_type,media_url,permalink,thumbnail_url,caption,timestamp';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS(origin) });
    }

    if (request.method !== 'GET') {
      return errorResponse('Method not allowed', origin, 405);
    }

    // Health check
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return jsonResponse({ ok: true, version: GRAPH_API_VERSION }, origin);
    }

    const side = url.pathname.replace(/^\//, '');
    const route = routeFor(side, env);
    if (!route) {
      return errorResponse(`Unknown route: ${side}. Use /underwater or /portraits.`, origin, 404);
    }

    if (!route.userId || !route.accessToken) {
      return errorResponse(
        `Missing secrets for ${side}. Set IG_USER_ID_${side.toUpperCase()} and IG_ACCESS_TOKEN_${side.toUpperCase()}.`,
        origin,
        500,
      );
    }

    const igUrl =
      `https://graph.instagram.com/${GRAPH_API_VERSION}/${route.userId}/media` +
      `?fields=${MEDIA_FIELDS}` +
      `&access_token=${encodeURIComponent(route.accessToken)}` +
      `&limit=9`;

    try {
      // Use the cache API so the edge serves repeat requests for CACHE_TTL.
      const cache = caches.default;
      const cacheKey = new Request(igUrl, { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.json();
        return jsonResponse(body, origin);
      }

      const upstream = await fetch(igUrl);
      if (!upstream.ok) {
        // Don't cache errors; let the user retry.
        const txt = await upstream.text();
        return errorResponse(
          `Instagram API ${upstream.status}: ${txt.slice(0, 200)}`,
          origin,
          502,
        );
      }

      const data = await upstream.json();
      // Cache a successful response
      const cacheable = new Response(JSON.stringify(data), {
        headers: { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
      });
      await cache.put(cacheKey, cacheable.clone());
      return jsonResponse(data, origin);
    } catch (e) {
      return errorResponse(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`, origin);
    }
  },
} satisfies ExportedHandler<Env>;
