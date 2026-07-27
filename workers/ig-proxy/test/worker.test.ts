import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCacheKey,
  DEFAULT_GRAPH_API_VERSION,
  errorResponse,
  resolveAllowlist,
  resolveGraphApiVersion,
  resolveOrigin,
  type Env,
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
  ALLOWED_ORIGIN: 'https://example.com',
  GRAPH_API_VERSION: 'v23.0',
};

const productionEnv: Env = {
  ...readyEnv,
  ALLOWED_ORIGIN: productionAllowlist,
};

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
  assert.deepEqual(await response.json(), { ok: true, version: 'v23.0' });
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
  assert.deepEqual(await response.json(), { ok: true, version: 'v23.0' });
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
