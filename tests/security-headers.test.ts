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
