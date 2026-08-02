import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("production CSP permits only the Instagram origin used by carousel embeds", () => {
	const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
	const csp = headers
		.split(/\r?\n/)
		.find((line) => line.trimStart().startsWith("Content-Security-Policy:"));

	assert(csp, "Content-Security-Policy header is missing");
	assert.match(csp, /(?:^|;\s*)frame-src https:\/\/www\.instagram\.com(?:;|$)/);
});

test("production CSP allows the Cloudflare Web Analytics beacon and resized feed images", () => {
	const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
	const csp = headers
		.split(/\r?\n/)
		.find((line) => line.trimStart().startsWith("Content-Security-Policy:"));

	assert(csp, "Content-Security-Policy header is missing");
	assert.match(
		csp,
		/(?:^|;\s*)script-src 'self' 'unsafe-inline' https:\/\/\*\.cloudflare\.com https:\/\/\*\.challenges\.cloudflare\.com https:\/\/static\.cloudflareinsights\.com(?:;|$)/,
		"script-src must allow the Pages Web Analytics beacon",
	);
	assert.match(
		csp,
		/(?:^|;\s*)img-src 'self' https:\/\/\*\.cdninstagram\.com https:\/\/\*\.fbcdn\.net https:\/\/ig-proxy\.michaelt604\.workers\.dev data:(?:;|$)/,
		"img-src must allow the ig-proxy image resizing route",
	);
});
