import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCacheKey,
  decodeCompositeCursor,
  DEFAULT_GRAPH_API_VERSION,
  errorResponse,
  resolveAllowlist,
  resolveGraphApiVersion,
  resolveOrigin,
  type Env,
  validateCursor,
} from '../src/index.ts';
import worker from '../src/index.ts';

const baseEnv = {} as Env;

const productionAllowlist =
  'https://tinglingdingphotography.com,https://www.tinglingdingphotography.com';

test('resolveOrigin fails closed and returns the deterministic first allowlist origin', () => {
  assert.equal(resolveOrigin(baseEnv), null);
  assert.equal(
    resolveOrigin({ ...baseEnv, ALLOWED_ORIGIN: productionAllowlist }),
    'https://tinglingdingphotography.com',
  );
  assert.equal(
    resolveOrigin({
      ...baseEnv,
      ALLOWED_ORIGIN: 'https://www.tinglingdingphotography.com,https://tinglingdingphotography.com',
    }),
    'https://tinglingdingphotography.com',
  );
  assert.equal(resolveOrigin({ ...baseEnv, ALLOWED_ORIGIN: 'not-a-url' }), null);
});

test('resolveAllowlist parses, trims, and dedupes valid entries', () => {
  assert.deepEqual(
    resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: productionAllowlist }),
    ['https://tinglingdingphotography.com', 'https://www.tinglingdingphotography.com'],
  );
  // Order does not matter — output is deterministically sorted.
  assert.deepEqual(
    resolveAllowlist({
      ...baseEnv,
      ALLOWED_ORIGIN: 'https://www.tinglingdingphotography.com,https://tinglingdingphotography.com',
    }),
    ['https://tinglingdingphotography.com', 'https://www.tinglingdingphotography.com'],
  );
  // Whitespace around entries is trimmed.
  assert.deepEqual(
    resolveAllowlist({
      ...baseEnv,
      ALLOWED_ORIGIN: '  https://a.com  ,  https://b.com  ',
    }),
    ['https://a.com', 'https://b.com'],
  );
  // Exact duplicates collapse to a single entry.
  assert.deepEqual(
    resolveAllowlist({
      ...baseEnv,
      ALLOWED_ORIGIN: 'https://a.com,https://a.com',
    }),
    ['https://a.com'],
  );
  // Mixed-case duplicates normalize via URL.origin (lowercased host).
  assert.deepEqual(
    resolveAllowlist({
      ...baseEnv,
      ALLOWED_ORIGIN: 'https://A.com,https://a.com/',
    }),
    ['https://a.com'],
  );
  // Trailing slash on a single origin normalizes to the bare origin.
  assert.deepEqual(
    resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://a.com/' }),
    ['https://a.com'],
  );
});

test('resolveAllowlist fails closed for invalid entries', () => {
  // Absent binding.
  assert.equal(resolveAllowlist(baseEnv), null);
  // Blank binding.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: '' }), null);
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: '   ' }), null);
  // Empty comma-delimited entries.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'a,,b' }), null);
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: ',https://a.com' }), null);
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://a.com,' }), null);
  // Non-https is rejected.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'http://a.com' }), null);
  // Credentials are rejected.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://user@a.com' }), null);
  assert.equal(
    resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://user:pass@a.com' }),
    null,
  );
  // Non-root path is rejected.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://a.com/path' }), null);
  // Query is rejected.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://a.com/?q=1' }), null);
  // Fragment is rejected.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://a.com/#x' }), null);
  // Malformed URL.
  assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'not-a-url' }), null);
  // Mixed valid + invalid fails the whole configuration closed.
  assert.equal(
    resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: 'https://a.com,http://b.com' }),
    null,
  );
});

test('Graph API version is configurable and validated', () => {
  assert.equal(resolveGraphApiVersion(baseEnv), DEFAULT_GRAPH_API_VERSION);
  assert.equal(resolveGraphApiVersion({ ...baseEnv, GRAPH_API_VERSION: 'v24.0' }), 'v24.0');
  assert.equal(resolveGraphApiVersion({ ...baseEnv, GRAPH_API_VERSION: 'latest' }), null);
});

test('error responses are never publicly cached', () => {
  const response = errorResponse('Unavailable.', 'https://example.com', 502);
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://example.com');
});

test('cache keys vary by account, version, and side', () => {
  const first = buildCacheKey('underwater', '123', 'v23.0').url;
  assert.notEqual(first, buildCacheKey('underwater', '456', 'v23.0').url);
  assert.notEqual(first, buildCacheKey('underwater', '123', 'v24.0').url);
  assert.notEqual(first, buildCacheKey('portraits', '123', 'v23.0').url);
});

const readyEnv: Env = {
  IG_USER_ID_UNDERWATER: '1',
  IG_ACCESS_TOKEN_UNDERWATER: 'secret-1',
  IG_USER_ID_PORTRAITS: '2',
  IG_ACCESS_TOKEN_PORTRAITS: 'secret-2',
  IG_COLLAB_USER_ID_UNDERWATER: '3',
  IG_COLLAB_ACCESS_TOKEN_UNDERWATER: 'collab-secret-1',
  IG_COLLAB_USER_ID_PORTRAITS: '4',
  IG_COLLAB_ACCESS_TOKEN_PORTRAITS: 'collab-secret-2',
  ALLOWED_ORIGIN: 'https://example.com',
  GRAPH_API_VERSION: 'v23.0',
};

const productionEnv: Env = {
  ...readyEnv,
  ALLOWED_ORIGIN: productionAllowlist,
};

function oauthTestEnv(store: MemoryKV): Env {
  return {
    ...readyEnv,
    IG_INSTAGRAM_APP_ID: 'test-app-id',
    IG_INSTAGRAM_APP_SECRET: 'test-app-secret',
    IG_INSTAGRAM_REDIRECT_URI: 'https://ig-proxy.example/oauth/instagram/callback',
    IG_TOKEN_STORE: store as unknown as KVNamespace,
  };
}

interface CacheCapture {
  matchedKeys: Request[];
  puts: Array<{ key: Request; body: string }>;
}

class MemoryKV {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

async function withWorkerMocks(
  fetchImplementation: typeof fetch,
  run: (capture: CacheCapture) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const originalCaches = Reflect.get(globalThis, 'caches');
  const capture: CacheCapture = { matchedKeys: [], puts: [] };
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    value: {
      default: {
        match: async (key: Request) => {
          capture.matchedKeys.push(key);
          return undefined;
        },
        put: async (key: Request, response: Response) => {
          capture.puts.push({ key, body: await response.text() });
        },
      },
    },
  });
  globalThis.fetch = fetchImplementation;

  try {
    await run(capture);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: originalCaches,
    });
  }
}

function upstreamPage(
  data: Record<string, unknown>[],
  after?: string,
  token = 'must-not-leak',
): Response {
  return Response.json({
    data,
    ...(after
      ? {
          paging: {
            next: `https://graph.instagram.com/next?access_token=${token}`,
            cursors: { after },
          },
        }
      : {}),
  });
}

function requestPath(input: string | URL | Request): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

test('merges owned and collaborative posts by descending timestamp, dedupes ids, and expands carousels', async () => {
  const calls: URL[] = [];
  await withWorkerMocks(
    async (input, init) => {
      const url = requestPath(input);
      calls.push(url);
      const expectedToken = url.hostname === 'graph.facebook.com' ? 'collab-secret-1' : 'secret-1';
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${expectedToken}`);
      if (url.pathname.endsWith('/media')) {
        return upstreamPage([
          {
            id: 'duplicate',
            media_type: 'IMAGE',
            timestamp: '2026-01-02T00:00:00Z',
          },
          {
            id: 'carousel',
            media_type: 'CAROUSEL_ALBUM',
            timestamp: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      if (url.pathname.endsWith('/collaborative_media')) {
        return upstreamPage([
          {
            id: 'newest',
            media_type: 'IMAGE',
            timestamp: '2026-01-03T00:00:00Z',
          },
          {
            id: 'duplicate',
            media_type: 'IMAGE',
            timestamp: '2026-01-02T00:00:00Z',
          },
        ]);
      }
      if (url.pathname.endsWith('/carousel/children')) {
        return Response.json({
          data: [
            {
              id: 'child',
              media_type: 'IMAGE',
              media_url: 'https://cdninstagram.com/child.jpg',
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };
      assert.deepEqual(body.data.map((post) => post.id), ['newest', 'duplicate', 'carousel']);
      assert.deepEqual(body.data[2].children, [
        {
          id: 'child',
          media_type: 'IMAGE',
          media_url: 'https://cdninstagram.com/child.jpg',
        },
      ]);
      const listCalls = calls.filter((url) => !url.pathname.endsWith('/children'));
      assert.deepEqual(
        listCalls.map((url) => url.pathname).sort(),
        ['/v23.0/1/media', '/v23.0/3/collaborative_media'],
      );
      for (const url of listCalls) {
        assert.equal(
          url.hostname,
          url.pathname.endsWith('/collaborative_media')
            ? 'graph.facebook.com'
            : 'graph.instagram.com',
        );
        assert.equal(url.searchParams.get('limit'), '9');
        assert.equal(
          url.searchParams.get('fields'),
          url.pathname.endsWith('/collaborative_media')
            ? 'id,media_type,media_url,permalink,thumbnail_url,caption,timestamp,children{id,media_type,media_url,permalink,thumbnail_url}'
            : 'id,media_type,media_url,permalink,thumbnail_url,caption,timestamp',
        );
      }
    },
  );
});

test('keeps tokens and upstream next URLs out of responses and cache keys', async () => {
  const requestUrls: string[] = [];
  await withWorkerMocks(
    async (input, init) => {
      const url = requestPath(input);
      requestUrls.push(url.href);
      const expectedToken = url.hostname === 'graph.facebook.com' ? 'collab-secret-1' : 'secret-1';
      assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${expectedToken}`);
      return upstreamPage([], url.pathname.endsWith('/collaborative_media') ? 'collab-after' : 'media-after');
    },
    async (capture) => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      const responseText = await response.text();
      assert.equal(response.status, 200);
      assert.equal(responseText.includes('secret-1'), false);
      assert.equal(responseText.includes('must-not-leak'), false);
      assert.equal(responseText.includes('graph.instagram.com/next'), false);
      assert.equal(requestUrls.every((url) => !url.includes('secret-1')), true);
      assert.equal(capture.matchedKeys.every((key) => !key.url.includes('secret-1')), true);
      assert.equal(capture.puts.every(({ key, body }) => !`${key.url}${body}`.includes('secret-1')), true);
      assert.equal(capture.puts.every(({ body }) => !body.includes('must-not-leak')), true);
    },
  );
});

test('composite pagination advances and exhausts each source independently', async () => {
  const calls: Array<{ source: string; after: string | null }> = [];
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      const collaborative = url.pathname.endsWith('/collaborative_media');
      const source = collaborative ? 'collaborativeMedia' : 'media';
      const after = url.searchParams.get('after');
      calls.push({ source, after });

      if (!collaborative && after === null) return upstreamPage([{ id: 'm1' }], 'media-1');
      if (!collaborative && after === 'media-1') return upstreamPage([{ id: 'm2' }]);
      if (collaborative && after === null) return upstreamPage([{ id: 'c1' }], 'collab-1');
      if (collaborative && after === 'collab-1') {
        return upstreamPage([{ id: 'c2' }], 'collab-2');
      }
      if (collaborative && after === 'collab-2') return upstreamPage([{ id: 'c3' }]);
      return new Response(null, { status: 500 });
    },
    async () => {
      const first = await worker.fetch(new Request('https://worker.test/underwater'), readyEnv);
      const firstBody = (await first.json()) as { paging: { next: string } };
      const firstCursor = decodeCompositeCursor(firstBody.paging.next);
      assert.ok(firstCursor);
      assert.deepEqual(firstCursor.media, {
        after: 'media-1',
        exhausted: false,
        failures: 0,
      });
      assert.deepEqual(firstCursor.collaborativeMedia, {
        after: 'collab-1',
        exhausted: false,
        failures: 0,
      });

      const secondUrl = new URL('https://worker.test/underwater');
      secondUrl.searchParams.set('cursor', firstBody.paging.next);
      const second = await worker.fetch(new Request(secondUrl), readyEnv);
      const secondBody = (await second.json()) as { paging: { next: string } };
      const secondCursor = decodeCompositeCursor(secondBody.paging.next);
      assert.ok(secondCursor);
      assert.deepEqual(secondCursor.media, {
        after: null,
        exhausted: true,
        failures: 0,
      });
      assert.deepEqual(secondCursor.collaborativeMedia, {
        after: 'collab-2',
        exhausted: false,
        failures: 0,
      });

      const thirdUrl = new URL('https://worker.test/underwater');
      thirdUrl.searchParams.set('cursor', secondBody.paging.next);
      const third = await worker.fetch(new Request(thirdUrl), readyEnv);
      assert.deepEqual(await third.json(), { data: [{ id: 'c3' }] });
      assert.deepEqual(calls, [
        { source: 'media', after: null },
        { source: 'collaborativeMedia', after: null },
        { source: 'media', after: 'media-1' },
        { source: 'collaborativeMedia', after: 'collab-1' },
        { source: 'collaborativeMedia', after: 'collab-2' },
      ]);
    },
  );
});

test('returns owned posts when collaborative media fails', async () => {
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      if (url.pathname.endsWith('/collaborative_media')) {
        return new Response(null, { status: 503 });
      }
      return upstreamPage([
        { id: 'owned', media_type: 'IMAGE', timestamp: '2026-01-01T00:00:00Z' },
      ]);
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
        paging: { next: string };
      };
      assert.deepEqual(body.data, [
        { id: 'owned', media_type: 'IMAGE', timestamp: '2026-01-01T00:00:00Z' },
      ]);
      assert.deepEqual(decodeCompositeCursor(body.paging.next)?.collaborativeMedia, {
        after: null,
        exhausted: false,
        failures: 1,
      });
    },
  );
});

test('preserves the 502 response when owned media fails', async () => {
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      return url.pathname.endsWith('/media')
        ? new Response(null, { status: 503 })
        : upstreamPage([{ id: 'collaborative' }]);
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), {
        error: 'Instagram feed is temporarily unavailable.',
      });
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    },
  );
});

test('preserves collaborator carousel stacks with the owned Instagram fallback', async () => {
  const calls: URL[] = [];
  await withWorkerMocks(
    async (input, init) => {
      const url = requestPath(input);
      calls.push(url);
      const token = new Headers(init?.headers).get('Authorization');
      if (url.pathname.endsWith('/media')) {
        assert.equal(token, 'Bearer secret-1');
        return upstreamPage([]);
      }
      if (url.pathname.endsWith('/collaborative_media')) {
        assert.equal(token, 'Bearer collab-secret-1');
        return upstreamPage([
          {
            id: 'collab-carousel',
            media_type: 'CAROUSEL_ALBUM',
            media_url: 'https://cdninstagram.com/collab-cover.jpg',
            permalink: 'https://www.instagram.com/p/collab-carousel/',
            timestamp: '2026-01-03T00:00:00Z',
          },
        ]);
      }
      if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/children')) {
        assert.equal(token, 'Bearer collab-secret-1');
        return Response.json({ data: [] });
      }
      if (url.hostname === 'graph.instagram.com' && url.pathname.endsWith('/children')) {
        if (token === 'Bearer collab-secret-1') return Response.json({ data: [] });
        assert.equal(token, 'Bearer secret-1');
        return Response.json({
          data: [
            {
              id: 'collab-child',
              media_type: 'IMAGE',
              media_url: 'https://cdninstagram.com/collab-child.jpg',
            },
          ],
        });
      }
      return new Response(null, { status: 404 });
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };
      assert.deepEqual(body.data[0].children, [
        {
          id: 'collab-child',
          media_type: 'IMAGE',
          media_url: 'https://cdninstagram.com/collab-child.jpg',
        },
      ]);
      assert.deepEqual(
        calls.filter((url) => url.pathname.endsWith('/children')).map((url) => url.hostname),
        ['graph.facebook.com', 'graph.instagram.com', 'graph.instagram.com'],
      );
    },
  );
});

test('keeps valid collaborator children already included in the upstream payload', async () => {
  const child = {
    id: 'inline-child',
    media_type: 'IMAGE',
    media_url: 'https://cdninstagram.com/inline-child.jpg',
  };
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      if (url.pathname.endsWith('/media')) return upstreamPage([]);
      if (url.pathname.endsWith('/collaborative_media')) {
        return upstreamPage([
          {
            id: 'inline-collab-carousel',
            media_type: 'CAROUSEL_ALBUM',
            media_url: 'https://cdninstagram.com/inline-cover.jpg',
            permalink: 'https://www.instagram.com/p/inline-collab-carousel/',
            timestamp: '2026-01-03T00:00:00Z',
            children: [child],
          },
        ]);
      }
      throw new Error('child fetch should not run when inline children are present');
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };
      assert.deepEqual(body.data[0].children, [child]);
    },
  );
});

test('expands collaborator carousel children from the parent Graph response', async () => {
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      if (url.pathname.endsWith('/media')) return upstreamPage([]);
      if (url.pathname.endsWith('/collaborative_media')) {
        return upstreamPage([
          {
            id: 'expanded-collab-carousel',
            media_type: 'CAROUSEL_ALBUM',
            media_url: 'https://cdninstagram.com/expanded-cover.jpg',
            timestamp: '2026-01-03T00:00:00Z',
          },
        ]);
      }
      if (
        url.hostname === 'graph.facebook.com' &&
        url.pathname.endsWith('/expanded-collab-carousel')
      ) {
        assert.equal(url.searchParams.get('fields'), `children{${
          'id,media_type,media_url,permalink,thumbnail_url'
        }}`);
        return Response.json({
          children: {
            data: [
              {
                id: 'expanded-collab-child',
                media_type: 'IMAGE',
                media_url: 'https://cdninstagram.com/expanded-child.jpg',
              },
            ],
          },
        });
      }
      throw new Error(`unexpected request: ${url.href}`);
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        readyEnv,
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        data: Array<Record<string, unknown>>;
      };
      assert.deepEqual(body.data[0].children, [
        {
          id: 'expanded-collab-child',
          media_type: 'IMAGE',
          media_url: 'https://cdninstagram.com/expanded-child.jpg',
        },
      ]);
    },
  );
});

test('uses a dedicated Instagram-host token for collaborator children', async () => {
  await withWorkerMocks(
    async (input, init) => {
      const url = requestPath(input);
      const token = new Headers(init?.headers).get('Authorization');
      if (url.pathname.endsWith('/media')) return upstreamPage([]);
      if (url.pathname.endsWith('/collaborative_media')) return upstreamPage([
        { id: 'tokenized-collab-carousel', media_type: 'CAROUSEL_ALBUM' },
      ]);
      if (url.hostname === 'graph.facebook.com') return Response.json({ data: [] });
      if (url.hostname === 'graph.instagram.com' && url.pathname.endsWith('/children')) {
        assert.equal(token, 'Bearer instagram-child-secret');
        return Response.json({
          data: [
            {
              id: 'tokenized-collab-child',
              media_type: 'IMAGE',
              media_url: 'https://cdninstagram.com/tokenized-child.jpg',
            },
          ],
        });
      }
      throw new Error(`unexpected request: ${url.href}`);
    },
    async () => {
      const response = await worker.fetch(new Request('https://worker.test/underwater'), {
        ...readyEnv,
        IG_COLLAB_CHILD_ACCESS_TOKEN_UNDERWATER: 'instagram-child-secret',
      });
      const body = (await response.json()) as { data: Array<Record<string, unknown>> };
      assert.deepEqual(body.data[0].children, [
        {
          id: 'tokenized-collab-child',
          media_type: 'IMAGE',
          media_url: 'https://cdninstagram.com/tokenized-child.jpg',
        },
      ]);
    },
  );
});

test('OAuth start creates state and callback exchanges/stores only safe metadata', async () => {
  const store = new MemoryKV();
  const env = oauthTestEnv(store);
  env.IG_COLLAB_USER_ID_PORTRAITS = '17841404000071984';
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      if (url.hostname === 'api.instagram.com') {
        return Response.json({ access_token: 'short-lived-token', user_id: 17841404000071984 });
      }
      if (url.hostname === 'graph.instagram.com' && url.pathname.endsWith('/access_token')) {
        assert.equal(url.searchParams.get('grant_type'), 'ig_exchange_token');
        assert.equal(url.searchParams.get('client_secret'), 'test-app-secret');
        assert.equal(url.searchParams.get('access_token'), 'short-lived-token');
        return Response.json({ access_token: 'long-lived-token', expires_in: 5000 });
      }
      throw new Error(`unexpected OAuth request: ${url.href}`);
    },
    async () => {
      const start = await worker.fetch(
        new Request('https://worker.test/oauth/instagram/start?side=portraits'),
        env,
      );
      assert.equal(start.status, 302);
      const location = start.headers.get('Location');
      assert.ok(location);
      const authorizeUrl = new URL(location);
      assert.equal(authorizeUrl.origin, 'https://www.instagram.com');
      assert.equal(authorizeUrl.pathname, '/oauth/authorize');
      assert.equal(authorizeUrl.searchParams.get('client_id'), 'test-app-id');
      assert.equal(
        authorizeUrl.searchParams.get('redirect_uri'),
        'https://ig-proxy.example/oauth/instagram/callback',
      );
      assert.equal(authorizeUrl.searchParams.get('scope'), 'instagram_business_basic');
      const state = authorizeUrl.searchParams.get('state');
      assert.ok(state);
      assert.equal(await store.get(`ig-oauth-state:${state}`), 'portraits');

      const callbackUrl = new URL('https://worker.test/oauth/instagram/callback');
      callbackUrl.searchParams.set('code', 'one-time-code');
      callbackUrl.searchParams.set('state', state);
      const callback = await worker.fetch(new Request(callbackUrl), env);
      assert.equal(callback.status, 200);
      const body = (await callback.json()) as Record<string, unknown>;
      assert.deepEqual(body, {
        ok: true,
        side: 'portraits',
        instagramUserId: '17841404000071984',
        expiresIn: 5000,
      });
      const responseText = JSON.stringify(body);
      assert.equal(responseText.includes('short-lived-token'), false);
      assert.equal(responseText.includes('long-lived-token'), false);
      assert.equal(responseText.includes('test-app-secret'), false);
      assert.equal(await store.get(`ig-oauth-state:${state}`), null);
      assert.equal(await store.get('ig-collab-child-token:portraits'), 'long-lived-token');
    },
  );
});

test('OAuth callback rejects missing state and a mismatched Instagram account', async () => {
  const store = new MemoryKV();
  const env = oauthTestEnv(store);
  let upstreamCalls = 0;
  await withWorkerMocks(
    async (input) => {
      upstreamCalls += 1;
      const url = requestPath(input);
      if (url.hostname === 'api.instagram.com') {
        return Response.json({ access_token: 'short-lived-token', user_id: 'not-portrait' });
      }
      if (url.hostname === 'graph.instagram.com') {
        return Response.json({ access_token: 'long-lived-token', user_id: 'not-portrait' });
      }
      throw new Error(`unexpected OAuth request: ${url.href}`);
    },
    async () => {
      const missingState = await worker.fetch(
        new Request('https://worker.test/oauth/instagram/callback?code=one-time-code'),
        env,
      );
      assert.equal(missingState.status, 400);
      assert.equal(upstreamCalls, 0);

      await store.put('ig-oauth-state:mismatch', 'portraits');
      const mismatch = await worker.fetch(
        new Request(
          'https://worker.test/oauth/instagram/callback?code=one-time-code&state=mismatch',
        ),
        env,
      );
      assert.equal(mismatch.status, 403);
      assert.equal(await store.get('ig-collab-child-token:portraits'), null);
      assert.equal(await store.get('ig-oauth-state:mismatch'), null);
      assert.equal(upstreamCalls, 2);
    },
  );
});

test('uses the KV collaborator token for parent media and carousel children', async () => {
  const store = new MemoryKV();
  await store.put('ig-collab-child-token:underwater', 'kv-child-secret');
  const env = {
    ...readyEnv,
    IG_COLLAB_CHILD_ACCESS_TOKEN_UNDERWATER: 'stale-static-child-secret',
    IG_TOKEN_STORE: store as unknown as KVNamespace,
  };
  await withWorkerMocks(
    async (input, init) => {
      const url = requestPath(input);
      const token = new Headers(init?.headers).get('Authorization');
      if (url.pathname.endsWith('/media')) return upstreamPage([]);
      if (url.pathname.endsWith('/collaborative_media')) {
        assert.equal(url.hostname, 'graph.instagram.com');
        assert.equal(token, 'Bearer kv-child-secret');
        return upstreamPage([
          { id: 'kv-collab-carousel', media_type: 'CAROUSEL_ALBUM' },
        ]);
      }
      if (url.hostname === 'graph.facebook.com') return Response.json({ data: [] });
      if (url.hostname === 'graph.instagram.com' && url.pathname.endsWith('/children')) {
        assert.equal(token, 'Bearer kv-child-secret');
        return Response.json({
          data: [{
            id: 'kv-collab-child',
            media_type: 'IMAGE',
            media_url: 'https://cdninstagram.com/kv-child.jpg',
          }],
        });
      }
      throw new Error(`unexpected request: ${url.href}`);
    },
    async () => {
      const response = await worker.fetch(new Request('https://worker.test/underwater'), env);
      const body = (await response.json()) as { data: Array<Record<string, unknown>> };
      assert.deepEqual(body.data[0].children, [{
        id: 'kv-collab-child',
        media_type: 'IMAGE',
        media_url: 'https://cdninstagram.com/kv-child.jpg',
      }]);
    },
  );
});

test('collaborative failures retry once, recover, and then stop after two consecutive failures', async () => {
  let collaborativeAttempts = 0;
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      if (url.pathname.endsWith('/media')) {
        return upstreamPage([{ id: 'owned' }]);
      }

      if (url.searchParams.get('fields')?.includes('children{')) {
        return new Response(null, { status: 400 });
      }

      collaborativeAttempts += 1;
      if (collaborativeAttempts === 2) {
        return upstreamPage([{ id: 'collaborative-recovered' }], 'collab-next');
      }
      return new Response(null, { status: 503 });
    },
    async () => {
      const first = await worker.fetch(new Request('https://worker.test/underwater'), readyEnv);
      const firstBody = (await first.json()) as {
        data: Array<{ id: string }>;
        paging: { next: string };
      };
      assert.deepEqual(firstBody.data, [{ id: 'owned' }]);
      assert.deepEqual(decodeCompositeCursor(firstBody.paging.next)?.collaborativeMedia, {
        after: null,
        exhausted: false,
        failures: 1,
      });

      const secondUrl = new URL('https://worker.test/underwater');
      secondUrl.searchParams.set('cursor', firstBody.paging.next);
      const second = await worker.fetch(new Request(secondUrl), readyEnv);
      const secondBody = (await second.json()) as {
        data: Array<{ id: string }>;
        paging: { next: string };
      };
      assert.deepEqual(secondBody.data, [{ id: 'collaborative-recovered' }]);
      assert.deepEqual(decodeCompositeCursor(secondBody.paging.next)?.collaborativeMedia, {
        after: 'collab-next',
        exhausted: false,
        failures: 0,
      });

      const thirdUrl = new URL('https://worker.test/underwater');
      thirdUrl.searchParams.set('cursor', secondBody.paging.next);
      const third = await worker.fetch(new Request(thirdUrl), readyEnv);
      const thirdBody = (await third.json()) as {
        data: unknown[];
        paging: { next: string };
      };
      assert.deepEqual(thirdBody.data, []);
      assert.deepEqual(decodeCompositeCursor(thirdBody.paging.next)?.collaborativeMedia, {
        after: 'collab-next',
        exhausted: false,
        failures: 1,
      });

      const fourthUrl = new URL('https://worker.test/underwater');
      fourthUrl.searchParams.set('cursor', thirdBody.paging.next);
      const fourth = await worker.fetch(new Request(fourthUrl), readyEnv);
      assert.deepEqual(await fourth.json(), { data: [] });
      assert.equal(collaborativeAttempts, 4);
    },
  );
});

test('uses the resolved Instagram-host token for collaborative_media on graph.instagram.com', async () => {
  const store = new MemoryKV();
  await store.put('ig-collab-child-token:underwater', 'kv-collab-secret');
  const env = {
    ...readyEnv,
    IG_TOKEN_STORE: store as unknown as KVNamespace,
  };
  let instagramCollaborativeCalls = 0;
  let facebookCollaborativeCalls = 0;

  await withWorkerMocks(
    async (input, init) => {
      const url = requestPath(input);
      const token = new Headers(init?.headers).get('Authorization');

      if (
        url.hostname === 'graph.instagram.com' &&
        url.pathname.endsWith('/media')
      ) {
        assert.equal(token, 'Bearer secret-1');
        return upstreamPage([
          {
            id: 'owned-post',
            media_type: 'IMAGE',
            timestamp: '2026-01-02T00:00:00Z',
          },
        ]);
      }

      // Instagram's `collaborative_media` lives on graph.instagram.com for
      // Business Login tokens; the Worker must hit that host with the
      // resolved Instagram-host token, never the Facebook Graph host.
      if (
        url.hostname === 'graph.instagram.com' &&
        url.pathname.endsWith('/collaborative_media')
      ) {
        instagramCollaborativeCalls += 1;
        assert.equal(token, 'Bearer kv-collab-secret');
        return upstreamPage([
          {
            id: 'collab-post',
            media_type: 'IMAGE',
            timestamp: '2026-01-03T00:00:00Z',
          },
          {
            id: 'owned-post',
            media_type: 'IMAGE',
            timestamp: '2026-01-02T00:00:00Z',
          },
        ]);
      }

      if (url.hostname === 'graph.facebook.com') {
        facebookCollaborativeCalls += 1;
      }

      throw new Error(`unexpected request: ${url.href}`);
    },
    async () => {
      const response = await worker.fetch(
        new Request('https://worker.test/underwater'),
        env,
      );
      const responseText = await response.text();

      assert.equal(response.status, 200);
      assert.equal(
        instagramCollaborativeCalls,
        1,
        'expected exactly one graph.instagram.com collaborative_media request',
      );
      assert.equal(
        facebookCollaborativeCalls,
        0,
        'must not call graph.facebook.com for collaborative_media',
      );

      const body = JSON.parse(responseText) as {
        data: Array<{ id: string }>;
      };
      const ids = body.data.map((post) => post.id);
      assert.ok(
        ids.includes('collab-post'),
        `expected collaborator post in merged response, got: ${JSON.stringify(ids)}`,
      );
      assert.equal(
        ids.filter((id) => id === 'owned-post').length,
        1,
        `expected the duplicate owned id to be deduped, got: ${JSON.stringify(ids)}`,
      );
      assert.deepEqual(ids, ['collab-post', 'owned-post']);

      assert.equal(
        responseText.includes('kv-collab-secret'),
        false,
        'response body must not leak the KV collaborator token',
      );
    },
  );
});

test('malformed upstream data falls back for collaborative media and fails owned media', async () => {
  await withWorkerMocks(
    async (input) => {
      const url = requestPath(input);
      return url.pathname.endsWith('/media')
        ? upstreamPage([{ id: 'owned' }])
        : Response.json({ paging: {} });
    },
    async () => {
      const response = await worker.fetch(new Request('https://worker.test/underwater'), readyEnv);
      const body = (await response.json()) as {
        data: Array<{ id: string }>;
        paging: { next: string };
      };
      assert.equal(response.status, 200);
      assert.deepEqual(body.data, [{ id: 'owned' }]);
      assert.equal(
        decodeCompositeCursor(body.paging.next)?.collaborativeMedia.failures,
        1,
      );
    },
  );

  await withWorkerMocks(
    async (input) =>
      requestPath(input).pathname.endsWith('/media')
        ? Response.json({ paging: {} })
        : upstreamPage([]),
    async () => {
      const response = await worker.fetch(new Request('https://worker.test/underwater'), readyEnv);
      assert.equal(response.status, 502);
    },
  );
});

test('equal and invalid timestamps sort deterministically by id', async () => {
  await withWorkerMocks(
    async (input) =>
      requestPath(input).pathname.endsWith('/media')
        ? upstreamPage([
            { id: 'z', timestamp: 'invalid' },
            { id: 'a', timestamp: 'invalid' },
          ])
        : upstreamPage([
            { id: 'm', timestamp: '2026-01-01T00:00:00Z' },
            { id: 'b', timestamp: '2026-01-01T00:00:00Z' },
          ]),
    async () => {
      const response = await worker.fetch(new Request('https://worker.test/underwater'), readyEnv);
      const body = (await response.json()) as { data: Array<{ id: string }> };
      assert.deepEqual(body.data.map((post) => post.id), ['b', 'm', 'a', 'z']);
    },
  );
});

test('filters malformed array entries from successful upstream pages', async () => {
  await withWorkerMocks(
    async (input) =>
      requestPath(input).pathname.endsWith('/media')
        ? Response.json({
            data: [[], { id: 'owned', timestamp: '2026-01-01T00:00:00Z' }],
            paging: {},
          })
        : upstreamPage([]),
    async () => {
      const response = await worker.fetch(new Request('https://worker.test/underwater'), readyEnv);
      const body = (await response.json()) as { data: Array<{ id: string }> };
      assert.deepEqual(body.data, [{ id: 'owned', timestamp: '2026-01-01T00:00:00Z' }]);
    },
  );
});

test('malformed composite cursors are rejected before cache lookup or fetch', async () => {
  assert.equal(validateCursor('abc+def/ghi=='), 'abc+def/ghi==');
  const invalidState = btoa(
    JSON.stringify({
      version: 1,
      media: { after: null, exhausted: false, failures: 0 },
      collaborativeMedia: { after: null, exhausted: true, failures: 2 },
    }),
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
  const rejected = [
    'https://graph.instagram.com/page?after=abc',
    '//graph.instagram.com/page',
    'abc\nxyz',
    'abc%xyz',
    'a'.repeat(1025),
    '',
    invalidState,
  ];
  let fetchCount = 0;

  await withWorkerMocks(
    async () => {
      fetchCount += 1;
      return upstreamPage([]);
    },
    async (capture) => {
      for (const cursor of rejected) {
        const url = new URL('https://worker.test/underwater');
        url.searchParams.set('cursor', cursor);
        const response = await worker.fetch(new Request(url), readyEnv);
        assert.equal(response.status, 400, `expected cursor to be rejected: ${JSON.stringify(cursor)}`);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
      }
      assert.equal(fetchCount, 0);
      assert.equal(capture.matchedKeys.length, 0);
    },
  );
});

test('handler fails closed when origin configuration is missing', async () => {
  const response = await worker.fetch(new Request('https://worker.test/health'), {
    ...readyEnv,
    ALLOWED_ORIGIN: undefined,
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('handler fails closed when allowlist is blank', async () => {
  const response = await worker.fetch(new Request('https://worker.test/health'), {
    ...readyEnv,
    ALLOWED_ORIGIN: '   ',
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('handler fails closed when any allowlist entry is invalid', async () => {
  const response = await worker.fetch(new Request('https://worker.test/health'), {
    ...readyEnv,
    ALLOWED_ORIGIN: 'https://example.com,http://attacker.example',
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('handler accepts both apex and www and echoes the exact request origin in ACAO', async () => {
  for (const origin of [
    'https://tinglingdingphotography.com',
    'https://www.tinglingdingphotography.com',
  ]) {
    const response = await worker.fetch(
      new Request('https://worker.test/health', { headers: { Origin: origin } }),
      productionEnv,
    );
    assert.equal(response.status, 200, `expected 200 for origin: ${origin}`);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Vary'), 'Origin');
  }
});

test('ACAO header never contains a comma for any response', async () => {
  const cases = [
    { path: '/health', origin: 'https://tinglingdingphotography.com' },
    { path: '/health', origin: 'https://www.tinglingdingphotography.com' },
    { path: '/underwater', origin: 'https://www.tinglingdingphotography.com' },
    { path: '/portraits', origin: 'https://tinglingdingphotography.com' },
  ];
  for (const { path, origin } of cases) {
    const response = await worker.fetch(
      new Request(`https://worker.test${path}`, { headers: { Origin: origin } }),
      productionEnv,
    );
    const acao = response.headers.get('Access-Control-Allow-Origin');
    assert.ok(acao, `ACAO missing for ${path} from ${origin}`);
    assert.equal(
      acao.includes(','),
      false,
      `ACAO must never be comma-separated (got "${acao}" for ${path} from ${origin})`,
    );
  }
});

test('handler echoes the exact origin in CORS preflight', async () => {
  const response = await worker.fetch(
    new Request('https://worker.test/underwater', {
      method: 'OPTIONS',
      headers: { Origin: 'https://www.tinglingdingphotography.com' },
    }),
    productionEnv,
  );
  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin'),
    'https://www.tinglingdingphotography.com',
  );
  assert.equal(
    response.headers.get('Access-Control-Allow-Origin')?.includes(','),
    false,
  );
});

test('handler rejects unlisted and lookalike browser origins', async () => {
  const rejected = [
    // Lookalike domain that tries to ride the apex allowlist.
    'https://tinglingdingphotography.com.evil.example',
    // Substring / suffix lookalikes.
    'https://eviltinglingdingphotography.com',
    'https://not-tinglingdingphotography.com',
    // Unrelated attacker origin.
    'https://attacker.example',
    // Alternate port not in the allowlist.
    'https://tinglingdingphotography.com:8443',
    'https://www.tinglingdingphotography.com:8443',
    // Case-sensitive rejection of the apex — only the lowercase form is in the allowlist.
    'https://TINGLINGDINGPHOTOGRAPHY.COM',
    'https://WWW.tinglingdingphotography.com',
    // Non-https is rejected.
    'http://tinglingdingphotography.com',
    'http://www.tinglingdingphotography.com',
    // Wrong scheme.
    'ftp://tinglingdingphotography.com',
    // Malformed Origin header.
    'not-a-url',
    'https://',
    // Trailing slash on the request Origin must not silently match.
    'https://www.tinglingdingphotography.com/',
  ];
  for (const origin of rejected) {
    const response = await worker.fetch(
      new Request('https://worker.test/health', { headers: { Origin: origin } }),
      productionEnv,
    );
    assert.equal(response.status, 403, `expected 403 for origin: ${origin}`);
    const acao = response.headers.get('Access-Control-Allow-Origin');
    if (acao) {
      assert.equal(
        acao.includes(','),
        false,
        `403 ACAO must never be comma-separated (got "${acao}" for ${origin})`,
      );
      // The 403 response uses a single deterministic configured origin.
      assert.equal(acao, 'https://tinglingdingphotography.com');
    }
  }
});

test('handler keeps non-browser behavior deterministic and valid', async () => {
  // No Origin header at all: must use a single, deterministic configured
  // origin in the CORS response header — never a comma-separated value.
  const response = await worker.fetch(
    new Request('https://worker.test/health'),
    productionEnv,
  );
  assert.equal(response.status, 200);
  const acao = response.headers.get('Access-Control-Allow-Origin');
  assert.ok(acao);
  assert.equal(acao.includes(','), false, 'ACAO must not be comma-separated');
  // Deterministic single origin = lexicographically first allowlist entry.
  assert.equal(acao, 'https://tinglingdingphotography.com');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    ok: true,
    collaborativeReady: true,
    version: 'v23.0',
  });
});

test('handler rejects mismatched browser origins in the single-origin dev allowlist', async () => {
  const response = await worker.fetch(
    new Request('https://worker.test/health', {
      headers: { Origin: 'https://attacker.example' },
    }),
    readyEnv,
  );
  assert.equal(response.status, 403);
});

test('health reflects readiness without caching', async () => {
  const response = await worker.fetch(
    new Request('https://worker.test/health', {
      headers: { Origin: 'https://example.com' },
    }),
    readyEnv,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    collaborativeReady: true,
    version: 'v23.0',
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('handler rejects unsupported methods', async () => {
  const response = await worker.fetch(
    new Request('https://worker.test/underwater', {
      method: 'POST',
      headers: { Origin: 'https://example.com' },
    }),
    readyEnv,
  );
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
