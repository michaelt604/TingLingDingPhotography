import assert from "node:assert/strict";
import test from "node:test";
import { buildOptimizedImageUrl, clampImageWidth } from "../app/components/instagramImageUrl.ts";

const PROXY_URL = "https://ig-proxy.michaelt604.workers.dev";
const IG_SRC =
	"https://scontent-den2-1.cdninstagram.com/v/t51.82787-15/621729107_photo.jpg";

test("clampImageWidth bounds widths to the proxy-supported range", () => {
	assert.equal(clampImageWidth(800), 800);
	assert.equal(clampImageWidth(50), 100);
	assert.equal(clampImageWidth(4000), 1600);
	assert.equal(clampImageWidth(0), 800);
	assert.equal(clampImageWidth(Number.NaN), 800);
});

test("buildOptimizedImageUrl rewrites Instagram CDN sources to the /img route", () => {
	const url = new URL(buildOptimizedImageUrl(IG_SRC, 800, PROXY_URL));
	assert.equal(url.origin, "https://ig-proxy.michaelt604.workers.dev");
	assert.equal(url.pathname, "/img");
	assert.equal(url.searchParams.get("u"), IG_SRC);
	assert.equal(url.searchParams.get("w"), "800");
});

test("buildOptimizedImageUrl returns the source unchanged without a proxy URL", () => {
	assert.equal(buildOptimizedImageUrl(IG_SRC, 800, undefined), IG_SRC);
	assert.equal(buildOptimizedImageUrl(IG_SRC, 800, ""), IG_SRC);
});

test("buildOptimizedImageUrl refuses non-Instagram hosts", () => {
	for (const src of [
		"https://evil.example.com/photo.jpg",
		"https://graph.facebook.com/photo.jpg",
		"http://scontent.cdninstagram.com/photo.jpg",
		"not-a-url",
	]) {
		assert.equal(buildOptimizedImageUrl(src, 800, PROXY_URL), src, `expected unchanged: ${src}`);
	}
});

test("buildOptimizedImageUrl clamps the requested width", () => {
	const url = new URL(buildOptimizedImageUrl(IG_SRC, 4000, PROXY_URL));
	assert.equal(url.searchParams.get("w"), "1600");
});
