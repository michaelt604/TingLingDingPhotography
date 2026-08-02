import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchWithTimeout,
  IG_REQUEST_TIMEOUT_MS,
  RequestTimeoutError,
} from '../app/components/instagramFetch.ts';

test('IG_REQUEST_TIMEOUT_MS is 9000', () => {
  assert.equal(IG_REQUEST_TIMEOUT_MS, 9000);
});

test('fetchWithTimeout rejects with RequestTimeoutError when the deadline fires first', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });

  await assert.rejects(
    fetchWithTimeout('https://example.com/api', 5),
    (error: unknown) => {
      assert.ok(error instanceof RequestTimeoutError);
      assert.equal((error as Error).message, 'Request timed out');
      return true;
    },
  );
});

test('fetchWithTimeout returns the response when fetch resolves before the deadline', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 200 }));

  const result = await fetchWithTimeout('https://example.com/api', 1000);
  assert.equal(result.status, 200);
});

test('fetchWithTimeout rethrows non-timeout errors unchanged', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('network down');
  });

  await assert.rejects(
    fetchWithTimeout('https://example.com/api', 1000),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.equal((error as Error).message, 'network down');
      return true;
    },
  );
});
