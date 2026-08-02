import assert from "node:assert/strict";
import test from "node:test";
import worker, {
	buildCacheKey,
	buildKvCacheKey,
	DEFAULT_GRAPH_API_VERSION,
	decodeCompositeCursor,
	type Env,
	errorResponse,
	resolveAllowlist,
	resolveGraphApiVersion,
	resolveImageWidth,
	resolveOrigin,
	validateCursor,
} from "../src/index.ts";

const baseEnv = {} as Env;

const productionAllowlist =
	"https://tinglingdingphotography.com,https://www.tinglingdingphotography.com";

test("resolveOrigin fails closed and returns the deterministic first allowlist origin", () => {
	assert.equal(resolveOrigin(baseEnv), null);
	assert.equal(
		resolveOrigin({ ...baseEnv, ALLOWED_ORIGIN: productionAllowlist }),
		"https://tinglingdingphotography.com",
	);
	assert.equal(
		resolveOrigin({
			...baseEnv,
			ALLOWED_ORIGIN:
				"https://www.tinglingdingphotography.com,https://tinglingdingphotography.com",
		}),
		"https://tinglingdingphotography.com",
	);
	assert.equal(
		resolveOrigin({ ...baseEnv, ALLOWED_ORIGIN: "not-a-url" }),
		null,
	);
});

test("resolveAllowlist parses, trims, and dedupes valid entries", () => {
	assert.deepEqual(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: productionAllowlist }),
		[
			"https://tinglingdingphotography.com",
			"https://www.tinglingdingphotography.com",
		],
	);
	// Order does not matter — output is deterministically sorted.
	assert.deepEqual(
		resolveAllowlist({
			...baseEnv,
			ALLOWED_ORIGIN:
				"https://www.tinglingdingphotography.com,https://tinglingdingphotography.com",
		}),
		[
			"https://tinglingdingphotography.com",
			"https://www.tinglingdingphotography.com",
		],
	);
	// Whitespace around entries is trimmed.
	assert.deepEqual(
		resolveAllowlist({
			...baseEnv,
			ALLOWED_ORIGIN: "  https://a.com  ,  https://b.com  ",
		}),
		["https://a.com", "https://b.com"],
	);
	// Exact duplicates collapse to a single entry.
	assert.deepEqual(
		resolveAllowlist({
			...baseEnv,
			ALLOWED_ORIGIN: "https://a.com,https://a.com",
		}),
		["https://a.com"],
	);
	// Mixed-case duplicates normalize via URL.origin (lowercased host).
	assert.deepEqual(
		resolveAllowlist({
			...baseEnv,
			ALLOWED_ORIGIN: "https://A.com,https://a.com/",
		}),
		["https://a.com"],
	);
	// Trailing slash on a single origin normalizes to the bare origin.
	assert.deepEqual(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://a.com/" }),
		["https://a.com"],
	);
});

test("resolveAllowlist fails closed for invalid entries", () => {
	// Absent binding.
	assert.equal(resolveAllowlist(baseEnv), null);
	// Blank binding.
	assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "" }), null);
	assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "   " }), null);
	// Empty comma-delimited entries.
	assert.equal(resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "a,,b" }), null);
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: ",https://a.com" }),
		null,
	);
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://a.com," }),
		null,
	);
	// Non-https is rejected.
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "http://a.com" }),
		null,
	);
	// Credentials are rejected.
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://user@a.com" }),
		null,
	);
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://user:pass@a.com" }),
		null,
	);
	// Non-root path is rejected.
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://a.com/path" }),
		null,
	);
	// Query is rejected.
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://a.com/?q=1" }),
		null,
	);
	// Fragment is rejected.
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "https://a.com/#x" }),
		null,
	);
	// Malformed URL.
	assert.equal(
		resolveAllowlist({ ...baseEnv, ALLOWED_ORIGIN: "not-a-url" }),
		null,
	);
	// Mixed valid + invalid fails the whole configuration closed.
	assert.equal(
		resolveAllowlist({
			...baseEnv,
			ALLOWED_ORIGIN: "https://a.com,http://b.com",
		}),
		null,
	);
});

test("Graph API version is configurable and validated", () => {
	assert.equal(DEFAULT_GRAPH_API_VERSION, "v25.0");
	assert.equal(resolveGraphApiVersion(baseEnv), DEFAULT_GRAPH_API_VERSION);
	assert.equal(
		resolveGraphApiVersion({ ...baseEnv, GRAPH_API_VERSION: "v24.0" }),
		"v24.0",
	);
	assert.equal(
		resolveGraphApiVersion({ ...baseEnv, GRAPH_API_VERSION: "latest" }),
		null,
	);
});

test("error responses are never publicly cached", () => {
	const response = errorResponse("Unavailable.", "https://example.com", 502);
	assert.equal(response.status, 502);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
	assert.equal(
		response.headers.get("Access-Control-Allow-Origin"),
		"https://example.com",
	);
});

test("cache keys vary by account, version, and side", () => {
	const first = buildCacheKey("underwater", "123", "v25.0").url;
	assert.notEqual(first, buildCacheKey("underwater", "456", "v25.0").url);
	assert.notEqual(first, buildCacheKey("underwater", "123", "v24.0").url);
	assert.notEqual(first, buildCacheKey("portraits", "123", "v25.0").url);
});

const readyEnv: Env = {
	IG_ACCESS_TOKEN_UNDERWATER: "secret-1",
	IG_ACCESS_TOKEN_PORTRAITS: "secret-2",
	IG_COLLAB_USER_ID_UNDERWATER: "3",
	IG_COLLAB_USER_ID_PORTRAITS: "4",
	ALLOWED_ORIGIN: "https://example.com",
	GRAPH_API_VERSION: "v25.0",
};

const productionEnv: Env = {
	...readyEnv,
	ALLOWED_ORIGIN: productionAllowlist,
};

interface KvCapture {
	gets: string[];
	puts: Array<{
		key: string;
		value: string;
		expirationTtl: number | undefined;
	}>;
	values: Map<string, string>;
}

function createKvMock(options?: {
	initial?: Record<string, unknown>;
	readError?: Error;
	writeError?: Error;
	writeGate?: Promise<void>;
}): { namespace: KVNamespace; capture: KvCapture } {
	const capture: KvCapture = {
		gets: [],
		puts: [],
		values: new Map(
			Object.entries(options?.initial ?? {}).map(([key, value]) => [
				key,
				JSON.stringify(value),
			]),
		),
	};
	const namespace = {
		get: async (key: string) => {
			capture.gets.push(key);
			if (options?.readError) throw options.readError;
			const value = capture.values.get(key);
			return value === undefined ? null : JSON.parse(value);
		},
		put: async (
			key: string,
			value: string,
			putOptions?: { expirationTtl?: number },
		) => {
			capture.puts.push({
				key,
				value,
				expirationTtl: putOptions?.expirationTtl,
			});
			if (options?.writeGate) await options.writeGate;
			if (options?.writeError) throw options.writeError;
			capture.values.set(key, value);
		},
	} as KVNamespace;
	return { namespace, capture };
}

function cacheEnvelope(
	body: unknown,
	ttlSeconds = 3600,
): Record<string, unknown> {
	return {
		version: 1,
		expiresAt: Date.now() + ttlSeconds * 1000,
		body,
	};
}

interface CacheCapture {
	matchedKeys: Request[];
	puts: Array<{ key: Request; body: string; cacheControl: string | null }>;
}

async function withWorkerMocks(
	fetchImplementation: typeof fetch,
	run: (capture: CacheCapture) => Promise<void>,
	options?: { localCacheValue?: unknown },
): Promise<void> {
	const originalFetch = globalThis.fetch;
	const originalCaches = Reflect.get(globalThis, "caches");
	const capture: CacheCapture = { matchedKeys: [], puts: [] };
	Object.defineProperty(globalThis, "caches", {
		configurable: true,
		value: {
			default: {
				match: async (key: Request) => {
					capture.matchedKeys.push(key);
					return options && "localCacheValue" in options
						? Response.json(options.localCacheValue)
						: undefined;
				},
				put: async (key: Request, response: Response) => {
					capture.puts.push({
						key,
						body: await response.text(),
						cacheControl: response.headers.get("Cache-Control"),
					});
				},
			},
		},
	});
	globalThis.fetch = fetchImplementation;

	try {
		await run(capture);
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "caches", {
			configurable: true,
			value: originalCaches,
		});
	}
}

function upstreamPage(
	data: Record<string, unknown>[],
	after?: string,
	token = "must-not-leak",
): Response {
	return Response.json({
		data,
		...(after
			? {
					paging: {
						next: `https://graph.facebook.com/next?access_token=${token}`,
						cursors: { after },
					},
				}
			: {}),
	});
}

const healthyGraphFetch: typeof fetch = async () => upstreamPage([]);

function requestPath(input: string | URL | Request): URL {
	return new URL(input instanceof Request ? input.url : String(input));
}

test("each account uses its single Facebook token for both Graph edges", async () => {
	const calls: Array<{
		host: string;
		path: string;
		authorization: string | null;
	}> = [];
	await withWorkerMocks(
		async (input, init) => {
			const url = requestPath(input);
			calls.push({
				host: url.hostname,
				path: url.pathname,
				authorization: new Headers(init?.headers).get("Authorization"),
			});
			return upstreamPage([]);
		},
		async () => {
			assert.equal(
				(await worker.fetch(new Request("https://worker.test/underwater"), readyEnv)).status,
				200,
			);
			assert.equal(
				(await worker.fetch(new Request("https://worker.test/portraits"), readyEnv)).status,
				200,
			);
		},
	);
	assert.deepEqual(
		calls
			.map(({ host, path, authorization }) => ({ host, path, authorization }))
			.sort((left, right) => left.path.localeCompare(right.path)),
		[
			{ host: "graph.facebook.com", path: "/v25.0/3/collaborative_media", authorization: "Bearer secret-1" },
			{ host: "graph.facebook.com", path: "/v25.0/3/media", authorization: "Bearer secret-1" },
			{ host: "graph.facebook.com", path: "/v25.0/4/collaborative_media", authorization: "Bearer secret-2" },
			{ host: "graph.facebook.com", path: "/v25.0/4/media", authorization: "Bearer secret-2" },
		].sort((left, right) => left.path.localeCompare(right.path)),
	);
});

test("globally shared KV hit bypasses Instagram Graph requests", async () => {
	const localCacheKey = buildCacheKey("underwater", "3", "v25.0");
	const cacheKey = await buildKvCacheKey(localCacheKey);
	const kv = createKvMock({
		initial: {
			[cacheKey]: cacheEnvelope({ data: [{ id: "cached-post" }] }),
		},
	});
	let upstreamCalls = 0;

	await withWorkerMocks(
		async () => {
			upstreamCalls += 1;
			throw new Error("Graph API must not be called for a KV hit");
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
			);
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), {
				data: [{ id: "cached-post" }],
			});
			assert.equal(upstreamCalls, 0);
			assert.deepEqual(kv.capture.gets, [cacheKey]);
			assert.equal(kv.capture.puts.length, 0);
		},
	);
});

test("KV keys stay below the platform limit for maximum valid cursors", async () => {
	const cursor = compositeCursor("a".repeat(256));
	const localCacheKey = buildCacheKey(
		"underwater",
		"12345678901234567",
		"v25.0",
		cursor,
	);
	assert.equal(
		new TextEncoder().encode(localCacheKey.url).byteLength > 512,
		true,
	);
	const kvCacheKey = await buildKvCacheKey(localCacheKey);
	assert.equal(new TextEncoder().encode(kvCacheKey).byteLength < 512, true);
	assert.match(kvCacheKey, /^ig-feed:v1:[a-f0-9]{64}$/);
});

test("KV hits preserve the original expiry for browser and L1 caching", async () => {
	const localCacheKey = buildCacheKey("underwater", "3", "v25.0");
	const kvCacheKey = await buildKvCacheKey(localCacheKey);
	const kv = createKvMock({
		initial: {
			[kvCacheKey]: cacheEnvelope({ data: [{ id: "cached-post" }] }, 120),
		},
	});

	await withWorkerMocks(
		async () => {
			throw new Error("Graph API must not be called for a KV hit");
		},
		async (capture) => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
			);
			const maxAge = Number.parseInt(
				response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] ??
					"0",
				10,
			);
			assert.equal(maxAge > 0 && maxAge <= 120, true);
			assert.equal(capture.puts.length, 1);
			const l1MaxAge = Number.parseInt(
				capture.puts[0].cacheControl?.match(/max-age=(\d+)/)?.[1] ?? "0",
				10,
			);
			assert.equal(l1MaxAge, maxAge);
		},
	);
});

test("corrupt KV values fall through to Graph instead of suppressing the feed", async () => {
	const localCacheKey = buildCacheKey("underwater", "3", "v25.0");
	const kvCacheKey = await buildKvCacheKey(localCacheKey);
	const invalidValues: unknown[] = [
		"not-an-envelope",
		{
			version: 1,
			expiresAt: Date.now() + 3600_000,
			body: { data: "not-an-array" },
		},
		cacheEnvelope({ data: [], paging: { next: "malformed" } }),
		cacheEnvelope({
			data: [{ id: "post", access_token: "must-not-be-served" }],
		}),
	];

	for (const invalidValue of invalidValues) {
		const kv = createKvMock({
			initial: { [kvCacheKey]: invalidValue },
		});
		let upstreamCalls = 0;
		await withWorkerMocks(
			async () => {
				upstreamCalls += 1;
				return upstreamPage([{ id: "fresh-post" }]);
			},
			async () => {
				const response = await worker.fetch(
					new Request("https://worker.test/underwater"),
					{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
				);
				const body = (await response.json()) as {
					data: Array<{ id: string }>;
				};
				assert.equal(response.status, 200);
				assert.equal(upstreamCalls, 2);
				assert.deepEqual(
					body.data.map(({ id }) => id),
					["fresh-post"],
				);
				assert.equal(
					JSON.stringify(body).includes("must-not-be-served"),
					false,
				);
			},
		);
	}
});

test("corrupt L1 values fall through to a valid global KV entry", async () => {
	const localCacheKey = buildCacheKey("underwater", "3", "v25.0");
	const kvCacheKey = await buildKvCacheKey(localCacheKey);
	const kv = createKvMock({
		initial: {
			[kvCacheKey]: cacheEnvelope({ data: [{ id: "global-post" }] }),
		},
	});
	let upstreamCalls = 0;

	await withWorkerMocks(
		async () => {
			upstreamCalls += 1;
			throw new Error("Graph API must not be called for a valid KV hit");
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
			);
			assert.equal(response.status, 200);
			assert.deepEqual(await response.json(), {
				data: [{ id: "global-post" }],
			});
			assert.equal(upstreamCalls, 0);
			assert.deepEqual(kv.capture.gets, [kvCacheKey]);
		},
		{ localCacheValue: { malformed: true } },
	);
});

test("successful cache miss writes a sanitized page to KV for one hour", async () => {
	const kv = createKvMock();

	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			return upstreamPage(
				[{ id: url.pathname.endsWith("/media") ? "owned" : "collab" }],
				"next-page",
			);
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
			);
			assert.equal(response.status, 200);
			assert.equal(kv.capture.puts.length, 1);
			assert.equal(kv.capture.puts[0].expirationTtl, 3600);
			assert.equal(
				new TextEncoder().encode(kv.capture.puts[0].key).byteLength < 512,
				true,
			);
			assert.equal(kv.capture.puts[0].key.includes("secret"), false);
			assert.equal(kv.capture.puts[0].value.includes("secret"), false);
			assert.equal(kv.capture.puts[0].value.includes("must-not-leak"), false);
			assert.equal(
				kv.capture.puts[0].value.includes("graph.facebook.com/next"),
				false,
			);
			const stored = JSON.parse(kv.capture.puts[0].value) as {
				version: number;
				expiresAt: number;
				body: { data: Array<{ id: string }> };
			};
			assert.equal(stored.version, 1);
			assert.equal(stored.expiresAt > Date.now(), true);
			assert.deepEqual(stored.body.data.map(({ id }) => id).sort(), [
				"collab",
				"owned",
			]);
		},
	);
});

test("KV read and write failures never take down a healthy feed request", async () => {
	for (const failure of ["read", "write"] as const) {
		const kv = createKvMock({
			...(failure === "read"
				? { readError: new Error("read failed") }
				: { writeError: new Error("write failed") }),
		});

		await withWorkerMocks(
			async () => upstreamPage([]),
			async () => {
				const response = await worker.fetch(
					new Request("https://worker.test/underwater"),
					{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
				);
				assert.equal(response.status, 200, `${failure} failure`);
				assert.deepEqual(await response.json(), { data: [] });
				assert.equal(kv.capture.gets.length, 1);
				assert.equal(kv.capture.puts.length, 1);
			},
		);
	}
});

test("production ExecutionContext keeps cache writes off the response path", async () => {
	let releaseWrite: (() => void) | undefined;
	const writeGate = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const kv = createKvMock({ writeGate });
	const scheduled: Promise<unknown>[] = [];
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			scheduled.push(promise);
		},
	} as ExecutionContext;

	await withWorkerMocks(
		async () => upstreamPage([]),
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
				ctx,
			);
			assert.equal(response.status, 200);
			assert.equal(scheduled.length, 1);

			let cacheWorkSettled = false;
			const settlementProbe = scheduled[0].then(() => {
				cacheWorkSettled = true;
			});
			await Promise.resolve();
			assert.equal(cacheWorkSettled, false);

			releaseWrite?.();
			await scheduled[0];
			await settlementProbe;
			assert.equal(cacheWorkSettled, true);
			assert.equal(kv.capture.puts.length, 1);
		},
	);
});

test("degraded collaborative responses are not written to KV", async () => {
	const degradedKv = createKvMock();
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			return url.pathname.endsWith("/collaborative_media")
				? new Response(null, { status: 503 })
				: upstreamPage([{ id: "owned" }]);
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: degradedKv.namespace },
			);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("Cache-Control"), "no-store");
			assert.equal(degradedKv.capture.puts.length, 0);
		},
	);
});

test("each composite pagination cursor uses a distinct KV key", async () => {
	const kv = createKvMock();
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			return url.searchParams.get("after")
				? upstreamPage([{ id: "page-2" }])
				: upstreamPage([{ id: "page-1" }], "after-1");
		},
		async () => {
			const first = await worker.fetch(
				new Request("https://worker.test/underwater"),
				{ ...readyEnv, IG_FEED_CACHE: kv.namespace },
			);
			const firstBody = (await first.json()) as {
				paging: { next: string };
			};
			const secondUrl = new URL("https://worker.test/underwater");
			secondUrl.searchParams.set("cursor", firstBody.paging.next);
			const second = await worker.fetch(new Request(secondUrl), {
				...readyEnv,
				IG_FEED_CACHE: kv.namespace,
			});
			assert.equal(second.status, 200);
			assert.equal(kv.capture.puts.length, 2);
			assert.notEqual(kv.capture.puts[0].key, kv.capture.puts[1].key);
		},
	);
});

function compositeCursor(mediaAfter: string | null = null): string {
	return btoa(
		JSON.stringify({
			version: 3,
			media: { after: mediaAfter, exhausted: false, failures: 0 },
			collaborativeMedia: { after: null, exhausted: true, failures: 0 },
		}),
	)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

test("later Facebook pages fail without changing hosts", async () => {
	const calls: Array<{ host: string; after: string | null }> = [];
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			calls.push({
				host: url.hostname,
				after: url.searchParams.get("after"),
			});
			return new Response(null, { status: 503 });
		},
		async () => {
			const url = new URL("https://worker.test/portraits");
			url.searchParams.set("cursor", compositeCursor("facebook-next"));
			const response = await worker.fetch(new Request(url), readyEnv);
			assert.equal(response.status, 502);
			assert.equal(calls.every(({ host }) => host === "graph.facebook.com"), true);
			assert.equal(
				calls.some(
					({ host, after }) =>
						host === "graph.facebook.com" && after === "facebook-next",
				),
				true,
			);
		},
	);
});

test("degraded collaborator responses are returned without edge caching", async () => {
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			return url.pathname.endsWith("/collaborative_media")
				? new Response(null, { status: 503 })
				: upstreamPage([{ id: "owned" }]);
		},
		async (capture) => {
			const response = await worker.fetch(
				new Request("https://worker.test/portraits"),
				readyEnv,
			);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("Cache-Control"), "no-store");
			const body = (await response.json()) as { data: Array<{ id: string }> };
			assert.deepEqual(body.data, [{ id: "owned" }]);
			assert.equal(capture.puts.length, 0);
		},
	);
});

test("legacy provider cursors are rejected before fetching", async () => {
	let fetchCount = 0;
	await withWorkerMocks(
		async () => {
			fetchCount += 1;
			return upstreamPage([]);
		},
		async () => {
			const legacyCursor = btoa(
				JSON.stringify({
					version: 2,
					ownedMediaProvider: "facebook",
					media: { after: null, exhausted: false, failures: 0 },
					collaborativeMedia: { after: null, exhausted: true, failures: 0 },
				}),
			)
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/u, "");
			const portraits = new URL("https://worker.test/portraits");
			portraits.searchParams.set("cursor", legacyCursor);
			assert.equal(
				(await worker.fetch(new Request(portraits), readyEnv)).status,
				400,
			);
			assert.equal(fetchCount, 0);
		},
	);
});

test("merges owned and collaborative posts by descending timestamp, dedupes ids, and expands carousels", async () => {
	const calls: URL[] = [];
	await withWorkerMocks(
		async (input, init) => {
			const url = requestPath(input);
			calls.push(url);
			assert.equal(
				new Headers(init?.headers).get("Authorization"),
				"Bearer secret-1",
			);
			if (url.pathname.endsWith("/media")) {
				return upstreamPage([
					{
						id: "duplicate",
						media_type: "IMAGE",
						timestamp: "2026-01-02T00:00:00Z",
					},
					{
						id: "carousel",
						media_type: "CAROUSEL_ALBUM",
						timestamp: "2026-01-01T00:00:00Z",
						children: {
							data: [
								{
									id: "child",
									media_type: "IMAGE",
									media_url: "https://cdninstagram.com/child.jpg",
								},
							],
						},
					},
				]);
			}
			if (url.pathname.endsWith("/collaborative_media")) {
				return upstreamPage([
					{
						id: "newest",
						media_type: "IMAGE",
						timestamp: "2026-01-03T00:00:00Z",
					},
					{
						id: "duplicate",
						media_type: "IMAGE",
						timestamp: "2026-01-02T00:00:00Z",
					},
				]);
			}
			return new Response(null, { status: 404 });
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			assert.equal(response.status, 200);
			const body = (await response.json()) as {
				data: Array<Record<string, unknown>>;
			};
			assert.deepEqual(
				body.data.map((post) => post.id),
				["newest", "duplicate", "carousel"],
			);
			assert.deepEqual(body.data[2].children, [
				{
					id: "child",
					media_type: "IMAGE",
					media_url: "https://cdninstagram.com/child.jpg",
				},
			]);
			assert.deepEqual(
				calls.map((url) => url.pathname).sort(),
				["/v25.0/3/collaborative_media", "/v25.0/3/media"],
			);
			for (const url of calls) {
				assert.equal(url.hostname, "graph.facebook.com");
				assert.equal(url.searchParams.get("limit"), "9");
				assert.equal(
					url.searchParams.get("fields"),
					"id,media_type,media_url,permalink,thumbnail_url,caption,timestamp,children{id,media_type,media_url,permalink,thumbnail_url}",
				);
			}
		},
	);
});

test("carousels the list edges did not expand inline fall back to per-post children fetches", async () => {
	let childrenCalls = 0;
	await withWorkerMocks(
		async (input, init) => {
			const url = requestPath(input);
			assert.equal(
				new Headers(init?.headers).get("Authorization"),
				"Bearer secret-2",
			);
			const carousel = (id: string, timestamp: string) => ({
				id,
				media_type: "CAROUSEL_ALBUM",
				timestamp,
			});
			if (url.pathname.endsWith("/media")) {
				// Owned edge: inline children are populated, but one post
				// comes back with an empty connection and one with none.
				return upstreamPage([
					{
						id: "carousel-a",
						media_type: "CAROUSEL_ALBUM",
						timestamp: "2026-01-03T00:00:00Z",
						children: {
							data: [
								{
									id: "child-carousel-a",
									media_type: "IMAGE",
									media_url: "https://cdninstagram.com/child-carousel-a.jpg",
								},
							],
						},
					},
					carousel("carousel-b", "2026-01-02T00:00:00Z"),
					{
						...carousel("carousel-c", "2026-01-01T00:00:00Z"),
						children: { data: [] },
					},
				]);
			}
			if (url.pathname.endsWith("/collaborative_media")) {
				// Collaborative edge: carousels come back without any
				// inline children, so the fallback must fetch them.
				return upstreamPage([
					carousel("carousel-d", "2026-01-05T00:00:00Z"),
					carousel("carousel-e", "2026-01-03T00:00:00Z"),
				]);
			}
			if (/^\/v25\.0\/[^/]+$/.test(url.pathname) && url.searchParams.get("fields")?.includes("children{")) {
				// Single-media node read: nested children expansion is
				// the primary fallback for carousels the list edges omit.
				const parentId = url.pathname.split("/")[2];
				assert.equal(
					new Headers(init?.headers).get("Authorization"),
					"Bearer secret-2",
				);
				return Response.json({
					id: parentId,
					media_type: "CAROUSEL_ALBUM",
					children: {
						data: [
							{
								id: `child-${parentId}`,
								media_type: "IMAGE",
								media_url: `https://cdninstagram.com/child-${parentId}.jpg`,
							},
						],
					},
				});
			}
			if (url.pathname.endsWith("/children")) {
				childrenCalls += 1;
				return new Response(null, { status: 403 });
			}
			return new Response(null, { status: 404 });
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/portraits"),
				readyEnv,
			);
			assert.equal(response.status, 200);
			const body = (await response.json()) as { data: Array<Record<string, unknown>> };
			assert.equal(childrenCalls, 0, "the node read should resolve children without the /children edge");
			assert.deepEqual(
				body.data.map((post) => post.id),
				["carousel-d", "carousel-a", "carousel-e", "carousel-b", "carousel-c"],
			);
			for (const post of body.data) {
				assert.equal(Array.isArray(post.children), true, `${post.id} must have children`);
				assert.equal(
					(post.children as Array<{ id: string }>)[0]?.id,
					`child-${post.id}`,
					`${post.id} children must come from its own fetch`,
				);
			}
		},
	);
});

test("keeps tokens and upstream next URLs out of responses and cache keys", async () => {
	const requestUrls: string[] = [];
	await withWorkerMocks(
		async (input, init) => {
			const url = requestPath(input);
			requestUrls.push(url.href);
			assert.equal(
				new Headers(init?.headers).get("Authorization"),
				"Bearer secret-1",
			);
			return upstreamPage(
				[],
				url.pathname.endsWith("/collaborative_media")
					? "collab-after"
					: "media-after",
			);
		},
		async (capture) => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			const responseText = await response.text();
			assert.equal(response.status, 200);
			assert.equal(responseText.includes("secret-1"), false);
			assert.equal(responseText.includes("must-not-leak"), false);
			assert.equal(responseText.includes("graph.facebook.com/next"), false);
			assert.equal(
				requestUrls.every((url) => !url.includes("secret-1")),
				true,
			);
			assert.equal(
				capture.matchedKeys.every((key) => !key.url.includes("secret-1")),
				true,
			);
			assert.equal(
				capture.puts.every(
					({ key, body }) => !`${key.url}${body}`.includes("secret-1"),
				),
				true,
			);
			assert.equal(
				capture.puts.every(({ body }) => !body.includes("must-not-leak")),
				true,
			);
		},
	);
});

test("composite pagination advances and exhausts each source independently", async () => {
	const calls: Array<{ source: string; after: string | null }> = [];
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			const collaborative = url.pathname.endsWith("/collaborative_media");
			const source = collaborative ? "collaborativeMedia" : "media";
			const after = url.searchParams.get("after");
			calls.push({ source, after });

			if (!collaborative && after === null)
				return upstreamPage([{ id: "m1" }], "media-1");
			if (!collaborative && after === "media-1")
				return upstreamPage([{ id: "m2" }]);
			if (collaborative && after === null)
				return upstreamPage([{ id: "c1" }], "collab-1");
			if (collaborative && after === "collab-1") {
				return upstreamPage([{ id: "c2" }], "collab-2");
			}
			if (collaborative && after === "collab-2")
				return upstreamPage([{ id: "c3" }]);
			return new Response(null, { status: 500 });
		},
		async () => {
			const first = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			const firstBody = (await first.json()) as { paging: { next: string } };
			const firstCursor = decodeCompositeCursor(firstBody.paging.next);
			assert.ok(firstCursor);
			assert.deepEqual(firstCursor.media, {
				after: "media-1",
				exhausted: false,
				failures: 0,
			});
			assert.deepEqual(firstCursor.collaborativeMedia, {
				after: "collab-1",
				exhausted: false,
				failures: 0,
			});

			const secondUrl = new URL("https://worker.test/underwater");
			secondUrl.searchParams.set("cursor", firstBody.paging.next);
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
				after: "collab-2",
				exhausted: false,
				failures: 0,
			});

			const thirdUrl = new URL("https://worker.test/underwater");
			thirdUrl.searchParams.set("cursor", secondBody.paging.next);
			const third = await worker.fetch(new Request(thirdUrl), readyEnv);
			assert.deepEqual(await third.json(), { data: [{ id: "c3" }] });
			assert.deepEqual(calls, [
				{ source: "media", after: null },
				{ source: "collaborativeMedia", after: null },
				{ source: "media", after: "media-1" },
				{ source: "collaborativeMedia", after: "collab-1" },
				{ source: "collaborativeMedia", after: "collab-2" },
			]);
		},
	);
});

test("returns owned posts when collaborative media fails", async () => {
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			if (url.pathname.endsWith("/collaborative_media")) {
				return new Response(null, { status: 503 });
			}
			return upstreamPage([
				{ id: "owned", media_type: "IMAGE", timestamp: "2026-01-01T00:00:00Z" },
			]);
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			assert.equal(response.status, 200);
			const body = (await response.json()) as {
				data: Array<Record<string, unknown>>;
				paging: { next: string };
			};
			assert.deepEqual(body.data, [
				{ id: "owned", media_type: "IMAGE", timestamp: "2026-01-01T00:00:00Z" },
			]);
			assert.deepEqual(
				decodeCompositeCursor(body.paging.next)?.collaborativeMedia,
				{
					after: null,
					exhausted: false,
					failures: 1,
				},
			);
		},
	);
});

test("preserves the 502 response when owned media fails", async () => {
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			return url.pathname.endsWith("/media")
				? new Response(null, { status: 503 })
				: upstreamPage([{ id: "collaborative" }]);
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			assert.equal(response.status, 502);
			assert.deepEqual(await response.json(), {
				error: "Instagram feed is temporarily unavailable.",
			});
			assert.equal(response.headers.get("Cache-Control"), "no-store");
		},
	);
});

test("collaborative failures retry once, recover, and then stop after two consecutive failures", async () => {
	let collaborativeAttempts = 0;
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			if (url.pathname.endsWith("/media")) {
				return upstreamPage([{ id: "owned" }]);
			}

			collaborativeAttempts += 1;
			if (collaborativeAttempts === 2) {
				return upstreamPage([{ id: "collaborative-recovered" }], "collab-next");
			}
			return new Response(null, { status: 503 });
		},
		async () => {
			const first = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			const firstBody = (await first.json()) as {
				data: Array<{ id: string }>;
				paging: { next: string };
			};
			assert.deepEqual(firstBody.data, [{ id: "owned" }]);
			assert.deepEqual(
				decodeCompositeCursor(firstBody.paging.next)?.collaborativeMedia,
				{
					after: null,
					exhausted: false,
					failures: 1,
				},
			);

			const secondUrl = new URL("https://worker.test/underwater");
			secondUrl.searchParams.set("cursor", firstBody.paging.next);
			const second = await worker.fetch(new Request(secondUrl), readyEnv);
			const secondBody = (await second.json()) as {
				data: Array<{ id: string }>;
				paging: { next: string };
			};
			assert.deepEqual(secondBody.data, [{ id: "collaborative-recovered" }]);
			assert.deepEqual(
				decodeCompositeCursor(secondBody.paging.next)?.collaborativeMedia,
				{
					after: "collab-next",
					exhausted: false,
					failures: 0,
				},
			);

			const thirdUrl = new URL("https://worker.test/underwater");
			thirdUrl.searchParams.set("cursor", secondBody.paging.next);
			const third = await worker.fetch(new Request(thirdUrl), readyEnv);
			const thirdBody = (await third.json()) as {
				data: unknown[];
				paging: { next: string };
			};
			assert.deepEqual(thirdBody.data, []);
			assert.deepEqual(
				decodeCompositeCursor(thirdBody.paging.next)?.collaborativeMedia,
				{
					after: "collab-next",
					exhausted: false,
					failures: 1,
				},
			);

			const fourthUrl = new URL("https://worker.test/underwater");
			fourthUrl.searchParams.set("cursor", thirdBody.paging.next);
			const fourth = await worker.fetch(new Request(fourthUrl), readyEnv);
			assert.deepEqual(await fourth.json(), { data: [] });
			assert.equal(collaborativeAttempts, 4);
		},
	);
});

test("malformed upstream data falls back for collaborative media and fails owned media", async () => {
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			return url.pathname.endsWith("/media")
				? upstreamPage([{ id: "owned" }])
				: Response.json({ paging: {} });
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			const body = (await response.json()) as {
				data: Array<{ id: string }>;
				paging: { next: string };
			};
			assert.equal(response.status, 200);
			assert.deepEqual(body.data, [{ id: "owned" }]);
			assert.equal(
				decodeCompositeCursor(body.paging.next)?.collaborativeMedia.failures,
				1,
			);
		},
	);

	await withWorkerMocks(
		async (input) =>
			requestPath(input).pathname.endsWith("/media")
				? Response.json({ paging: {} })
				: upstreamPage([]),
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			assert.equal(response.status, 502);
		},
	);
});

test("equal and invalid timestamps sort deterministically by id", async () => {
	await withWorkerMocks(
		async (input) =>
			requestPath(input).pathname.endsWith("/media")
				? upstreamPage([
						{ id: "z", timestamp: "invalid" },
						{ id: "a", timestamp: "invalid" },
					])
				: upstreamPage([
						{ id: "m", timestamp: "2026-01-01T00:00:00Z" },
						{ id: "b", timestamp: "2026-01-01T00:00:00Z" },
					]),
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			const body = (await response.json()) as { data: Array<{ id: string }> };
			assert.deepEqual(
				body.data.map((post) => post.id),
				["b", "m", "a", "z"],
			);
		},
	);
});

test("filters malformed array entries from successful upstream pages", async () => {
	await withWorkerMocks(
		async (input) =>
			requestPath(input).pathname.endsWith("/media")
				? Response.json({
						data: [[], { id: "owned", timestamp: "2026-01-01T00:00:00Z" }],
						paging: {},
					})
				: upstreamPage([]),
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/underwater"),
				readyEnv,
			);
			const body = (await response.json()) as { data: Array<{ id: string }> };
			assert.deepEqual(body.data, [
				{ id: "owned", timestamp: "2026-01-01T00:00:00Z" },
			]);
		},
	);
});

test("malformed composite cursors are rejected before cache lookup or fetch", async () => {
	assert.equal(validateCursor("abc+def/ghi=="), "abc+def/ghi==");
	const invalidState = btoa(
		JSON.stringify({
			version: 1,
			media: { after: null, exhausted: false, failures: 0 },
			collaborativeMedia: { after: null, exhausted: true, failures: 2 },
		}),
	)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
	const rejected = [
		"https://graph.facebook.com/page?after=abc",
		"//graph.facebook.com/page",
		"abc\nxyz",
		"abc%xyz",
		"a".repeat(1025),
		"",
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
				const url = new URL("https://worker.test/underwater");
				url.searchParams.set("cursor", cursor);
				const response = await worker.fetch(new Request(url), readyEnv);
				assert.equal(
					response.status,
					400,
					`expected cursor to be rejected: ${JSON.stringify(cursor)}`,
				);
				assert.equal(response.headers.get("Cache-Control"), "no-store");
			}
			assert.equal(fetchCount, 0);
			assert.equal(capture.matchedKeys.length, 0);
		},
	);
});

test("handler fails closed when origin configuration is missing", async () => {
	const response = await worker.fetch(
		new Request("https://worker.test/health"),
		{
			...readyEnv,
			ALLOWED_ORIGIN: undefined,
		},
	);
	assert.equal(response.status, 503);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("handler fails closed when allowlist is blank", async () => {
	const response = await worker.fetch(
		new Request("https://worker.test/health"),
		{
			...readyEnv,
			ALLOWED_ORIGIN: "   ",
		},
	);
	assert.equal(response.status, 503);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("handler fails closed when any allowlist entry is invalid", async () => {
	const response = await worker.fetch(
		new Request("https://worker.test/health"),
		{
			...readyEnv,
			ALLOWED_ORIGIN: "https://example.com,http://attacker.example",
		},
	);
	assert.equal(response.status, 503);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("handler accepts both apex and www and echoes the exact request origin in ACAO", async () => {
	await withWorkerMocks(healthyGraphFetch, async () => {
		for (const origin of [
			"https://tinglingdingphotography.com",
			"https://www.tinglingdingphotography.com",
		]) {
			const response = await worker.fetch(
				new Request("https://worker.test/health", {
					headers: { Origin: origin },
				}),
				productionEnv,
			);
			assert.equal(response.status, 200, `expected 200 for origin: ${origin}`);
			assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
			assert.equal(response.headers.get("Vary"), "Origin");
		}
	});
});

test("ACAO header never contains a comma for any response", async () => {
	const cases = [
		{ path: "/health", origin: "https://tinglingdingphotography.com" },
		{ path: "/health", origin: "https://www.tinglingdingphotography.com" },
		{ path: "/underwater", origin: "https://www.tinglingdingphotography.com" },
		{ path: "/portraits", origin: "https://tinglingdingphotography.com" },
	];
	await withWorkerMocks(healthyGraphFetch, async () => {
		for (const { path, origin } of cases) {
			const response = await worker.fetch(
				new Request(`https://worker.test${path}`, {
					headers: { Origin: origin },
				}),
				productionEnv,
			);
			const acao = response.headers.get("Access-Control-Allow-Origin");
			assert.ok(acao, `ACAO missing for ${path} from ${origin}`);
			assert.equal(
				acao.includes(","),
				false,
				`ACAO must never be comma-separated (got "${acao}" for ${path} from ${origin})`,
			);
		}
	});
});

test("handler echoes the exact origin in CORS preflight", async () => {
	const response = await worker.fetch(
		new Request("https://worker.test/underwater", {
			method: "OPTIONS",
			headers: { Origin: "https://www.tinglingdingphotography.com" },
		}),
		productionEnv,
	);
	assert.equal(response.status, 204);
	assert.equal(
		response.headers.get("Access-Control-Allow-Origin"),
		"https://www.tinglingdingphotography.com",
	);
	assert.equal(
		response.headers.get("Access-Control-Allow-Origin")?.includes(","),
		false,
	);
});

test("handler rejects unlisted and lookalike browser origins", async () => {
	const rejected = [
		// Lookalike domain that tries to ride the apex allowlist.
		"https://tinglingdingphotography.com.evil.example",
		// Substring / suffix lookalikes.
		"https://eviltinglingdingphotography.com",
		"https://not-tinglingdingphotography.com",
		// Unrelated attacker origin.
		"https://attacker.example",
		// Alternate port not in the allowlist.
		"https://tinglingdingphotography.com:8443",
		"https://www.tinglingdingphotography.com:8443",
		// Case-sensitive rejection of the apex — only the lowercase form is in the allowlist.
		"https://TINGLINGDINGPHOTOGRAPHY.COM",
		"https://WWW.tinglingdingphotography.com",
		// Non-https is rejected.
		"http://tinglingdingphotography.com",
		"http://www.tinglingdingphotography.com",
		// Wrong scheme.
		"ftp://tinglingdingphotography.com",
		// Malformed Origin header.
		"not-a-url",
		"https://",
		// Trailing slash on the request Origin must not silently match.
		"https://www.tinglingdingphotography.com/",
	];
	for (const origin of rejected) {
		const response = await worker.fetch(
			new Request("https://worker.test/health", {
				headers: { Origin: origin },
			}),
			productionEnv,
		);
		assert.equal(response.status, 403, `expected 403 for origin: ${origin}`);
		const acao = response.headers.get("Access-Control-Allow-Origin");
		if (acao) {
			assert.equal(
				acao.includes(","),
				false,
				`403 ACAO must never be comma-separated (got "${acao}" for ${origin})`,
			);
			// The 403 response uses a single deterministic configured origin.
			assert.equal(acao, "https://tinglingdingphotography.com");
		}
	}
});

test("handler keeps non-browser behavior deterministic and valid", async () => {
	// No Origin header at all: must use a single, deterministic configured
	// origin in the CORS response header — never a comma-separated value.
	await withWorkerMocks(healthyGraphFetch, async () => {
		const response = await worker.fetch(
			new Request("https://worker.test/health"),
			productionEnv,
		);
		assert.equal(response.status, 200);
		const acao = response.headers.get("Access-Control-Allow-Origin");
		assert.ok(acao);
		assert.equal(acao.includes(","), false, "ACAO must not be comma-separated");
		// Deterministic single origin = lexicographically first allowlist entry.
		assert.equal(acao, "https://tinglingdingphotography.com");
		assert.equal(response.headers.get("Cache-Control"), "no-store");
	});
});

test("handler rejects mismatched browser origins in the single-origin dev allowlist", async () => {
	const response = await worker.fetch(
		new Request("https://worker.test/health", {
			headers: { Origin: "https://attacker.example" },
		}),
		readyEnv,
	);
	assert.equal(response.status, 403);
});

test("health probes actual Graph paths without exposing credentials", async () => {
	const requested: Array<{ host: string; path: string }> = [];
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			requested.push({ host: url.hostname, path: url.pathname });
			return upstreamPage([]);
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/health", {
					headers: { Origin: "https://example.com" },
				}),
				readyEnv,
			);
			assert.equal(response.status, 200);
			const responseText = await response.text();
			assert.equal(responseText.includes("secret-"), false);
			assert.deepEqual(JSON.parse(responseText), {
				ok: true,
				collaborativeReady: true,
				version: "v25.0",
				feeds: {
					underwater: {
						ok: true,
						collaborativeOk: true,
					},
					portraits: {
						ok: true,
						collaborativeOk: true,
					},
				},
			});
			assert.equal(response.headers.get("Cache-Control"), "no-store");
			const cachedResponse = await worker.fetch(
				new Request("https://worker.test/health", {
					headers: { Origin: "https://example.com" },
				}),
				readyEnv,
			);
			assert.equal(cachedResponse.status, 200);
		},
	);
	assert.deepEqual(
		requested.sort((left, right) => left.path.localeCompare(right.path)),
		[
			{ host: "graph.facebook.com", path: "/v25.0/3/collaborative_media" },
			{ host: "graph.facebook.com", path: "/v25.0/3/media" },
			{ host: "graph.facebook.com", path: "/v25.0/4/collaborative_media" },
			{ host: "graph.facebook.com", path: "/v25.0/4/media" },
		].sort((left, right) => left.path.localeCompare(right.path)),
	);
});

test("health returns 503 when a required account media probe fails", async () => {
	await withWorkerMocks(
		async (input) => {
			const url = requestPath(input);
			if (url.pathname === "/v25.0/3/media") {
				return Response.json(
					{ error: { type: "OAuthException", code: 190 } },
					{ status: 401 },
				);
			}
			return upstreamPage([]);
		},
		async () => {
			const response = await worker.fetch(
				new Request("https://worker.test/health"),
				readyEnv,
			);
			assert.equal(response.status, 503);
			assert.equal(response.headers.get("Cache-Control"), "no-store");
			const body = (await response.json()) as {
				ok: boolean;
				feeds: { underwater: { ok: boolean }; portraits: { ok: boolean } };
			};
			assert.equal(body.ok, false);
			assert.equal(body.feeds.underwater.ok, false);
			assert.equal(body.feeds.portraits.ok, true);
		},
	);
});

test("handler rejects unsupported methods", async () => {
	const response = await worker.fetch(
		new Request("https://worker.test/underwater", {
			method: "POST",
			headers: { Origin: "https://example.com" },
		}),
		readyEnv,
	);
	assert.equal(response.status, 405);
	assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("image width clamps to the supported range and defaults when invalid", () => {
	assert.equal(resolveImageWidth(null), 800);
	assert.equal(resolveImageWidth("abc"), 800);
	assert.equal(resolveImageWidth(""), 800);
	assert.equal(resolveImageWidth("50"), 100);
	assert.equal(resolveImageWidth("2000"), 1600);
	assert.equal(resolveImageWidth("900"), 900);
});

test("image proxy rejects missing, foreign, and non-https sources", async () => {
	const cases = [
		"https://worker.test/img",
		"https://worker.test/img?u=https%3A%2F%2Fevil.example.com%2Fphoto.jpg",
		"https://worker.test/img?u=https%3A%2F%2Fwww.instagram.com%2Fp%2Fabc%2F",
		"https://worker.test/img?u=http%3A%2F%2Fscontent.cdninstagram.com%2Fphoto.jpg",
	];
	for (const url of cases) {
		const response = await worker.fetch(new Request(url), readyEnv);
		assert.equal(response.status, 400, `expected 400 for: ${url}`);
		assert.equal(response.headers.get("Cache-Control"), "no-store");
	}
});

test("image proxy passes resize options upstream and caches the result in KV", async () => {
	const { namespace, capture } = createKvMock();
	const upstreamCalls: { input: string; cf?: RequestInit["cf"] }[] = [];
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (promise: Promise<unknown>) => {
			pending.push(promise);
		},
	} as unknown as ExecutionContext;

	await withWorkerMocks(
		async (input, init) => {
			upstreamCalls.push({ input: String(input), cf: init?.cf });
			return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
				headers: { "Content-Type": "image/png" },
			});
		},
		async () => {
			const response = await worker.fetch(
				new Request(
					"https://worker.test/img?u=https%3A%2F%2Fscontent.cdninstagram.com%2Fv%2Ft51%2Fphoto.jpg&w=600",
				),
				{ ...readyEnv, IG_FEED_CACHE: namespace },
				ctx,
			);
			assert.equal(response.status, 200);
			assert.equal(response.headers.get("Content-Type"), "image/png");
			assert.equal(
				response.headers.get("Cache-Control"),
				"public, max-age=2592000, immutable",
			);
		},
	);

	const upstreamCall = upstreamCalls[0];
	assert.ok(upstreamCall, "upstream fetch should have been called");
	assert.equal(
		upstreamCall.input,
		"https://scontent.cdninstagram.com/v/t51/photo.jpg",
	);
	const imageOptions = upstreamCall.cf?.image as Record<string, unknown> | undefined;
	assert.equal(imageOptions?.width, 600);
	assert.equal(imageOptions?.fit, "scale-down");
	assert.equal(imageOptions?.quality, 85);
	assert.equal(imageOptions?.format, "auto");
	assert.equal(upstreamCall.cf?.cacheTtl, 2592000);

	await Promise.all(pending);
	assert.equal(capture.puts.length, 1);
	const firstPut = capture.puts[0];
	assert.ok(firstPut, "expected one KV write");
	const envelope = JSON.parse(firstPut.value) as {
		version: number;
		contentType: string;
		data: string;
	};
	assert.equal(envelope.version, 1);
	assert.equal(envelope.contentType, "image/png");
	assert.equal(envelope.data, "iVBORw==");
	assert.equal(firstPut.expirationTtl, 2592000);
});

test("image KV hits are served without another upstream fetch", async () => {
	const { namespace, capture } = createKvMock();
	let upstreamCalls = 0;
	const pending: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (promise: Promise<unknown>) => {
			pending.push(promise);
		},
	} as unknown as ExecutionContext;

	await withWorkerMocks(
		async () => {
			upstreamCalls += 1;
			return new Response(new Uint8Array([1, 2, 3]), {
				headers: { "Content-Type": "image/jpeg" },
			});
		},
		async () => {
			const env = { ...readyEnv, IG_FEED_CACHE: namespace };
			const url =
				"https://worker.test/img?u=https%3A%2F%2Fscontent.cdninstagram.com%2Fv%2Ft51%2Fphoto.jpg&w=800";
			const first = await worker.fetch(new Request(url), env, ctx);
			assert.equal(first.status, 200);
			await Promise.all(pending);
			const second = await worker.fetch(new Request(url), env, ctx);
			assert.equal(second.status, 200);
			assert.equal(upstreamCalls, 1, "KV hit must bypass the upstream fetch");
			assert.equal(capture.puts.length, 1);
		},
	);
});

test("image proxy upstream failures return an error and never write to KV", async () => {
	const { namespace, capture } = createKvMock();
	await withWorkerMocks(
		async () => new Response("boom", { status: 500 }),
		async () => {
			const response = await worker.fetch(
				new Request(
					"https://worker.test/img?u=https%3A%2F%2Fscontent.cdninstagram.com%2Fv%2Ft51%2Fphoto.jpg",
				),
				{ ...readyEnv, IG_FEED_CACHE: namespace },
			);
			assert.equal(response.status, 500);
			assert.equal(response.headers.get("Cache-Control"), "no-store");
			assert.equal(capture.puts.length, 0);
		},
	);
});
