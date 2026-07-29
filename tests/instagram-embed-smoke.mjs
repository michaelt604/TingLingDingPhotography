import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const PORT = 4322;
const SITE = `http://127.0.0.1:${PORT}`;
const COVER_URL = "https://scontent.cdninstagram.com/collab-cover.svg";
const CHILD_URL = "https://scontent.cdninstagram.com/local-carousel-child.svg";
const EMBED_URL = "https://www.instagram.com/p/collab/embed/";

const MOCK_JSON = {
	data: [
		{
			id: "collab-carousel",
			media_type: "CAROUSEL_ALBUM",
			media_url: COVER_URL,
			permalink: "https://www.instagram.com/p/collab/",
			caption: "Collaborator carousel",
			timestamp: "2026-07-28T00:00:00Z",
		},
		{
			id: "local-carousel",
			media_type: "CAROUSEL_ALBUM",
			media_url: COVER_URL,
			permalink: "https://www.instagram.com/p/local-carousel/",
			caption: "Local carousel",
			timestamp: "2026-07-28T00:00:00Z",
			children: [
				{
					id: "local-carousel-child-1",
					media_type: "IMAGE",
					media_url: CHILD_URL,
					permalink: "https://www.instagram.com/p/local-carousel/",
				},
				{
					id: "local-carousel-child-2",
					media_type: "IMAGE",
					media_url: COVER_URL,
					permalink: "https://www.instagram.com/p/local-carousel/",
				},
			],
		},
	],
	paging: {},
};

const COVER_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="100%" height="100%" fill="#d8b4a0"/></svg>';

const CHILD_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="100%" height="100%" fill="#8fb4a8"/></svg>';
const EMBED_HTML = `<!doctype html>
<html lang="en">
  <body>
    <main aria-label="Embedded Instagram carousel">
      <p id="slide">Slide 1</p>
      <button type="button" onclick="document.querySelector('#slide').textContent='Slide 2'">Next</button>
    </main>
  </body>
</html>`;

const server = spawn(
	"python",
	[
		"-m",
		"http.server",
		String(PORT),
		"--bind",
		"127.0.0.1",
		"--directory",
		"out/",
	],
	{ stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.on("data", () => {});
server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

await delay(800);
const browser = await chromium.launch();

try {
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 375, height: 812 },
	]) {
		const context = await browser.newContext({ viewport });
		const page = await context.newPage();

		const fulfillFeed = (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: { "Access-Control-Allow-Origin": "*" },
				body: JSON.stringify(MOCK_JSON),
			});
		await page.route(
			"https://ig-proxy.michaelt604.workers.dev/**",
			fulfillFeed,
		);
		await page.route("http://127.0.0.1:8788/**", fulfillFeed);
		await page.route(COVER_URL, (route) =>
			route.fulfill({
				status: 200,
				contentType: "image/svg+xml",
				body: COVER_SVG,
			}),
		);
		await page.route(CHILD_URL, (route) =>
			route.fulfill({
				status: 200,
				contentType: "image/svg+xml",
				body: CHILD_SVG,
			}),
		);
		await page.route(EMBED_URL, (route) =>
			route.fulfill({
				status: 200,
				contentType: "text/html",
				body: EMBED_HTML,
			}),
		);

		await page.goto(`${SITE}/portraits/`, { waitUntil: "load" });
		const tile = page.getByRole("button", {
			name: /View photo: Collaborator carousel/i,
		});
		await tile.waitFor();
		assert.equal(
			await page.locator("iframe").count(),
			0,
			"the grid must not preload an embed",
		);

		const preloadImageHrefs = await page
			.locator('link[rel="preload"][as="image"]')
			.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
		assert.ok(
			preloadImageHrefs.includes(COVER_URL),
			`expected preload image link for ${COVER_URL}, got ${JSON.stringify(preloadImageHrefs)}`,
		);
		assert.ok(
			preloadImageHrefs.includes(CHILD_URL),
			`expected preload image link for ${CHILD_URL}, got ${JSON.stringify(preloadImageHrefs)}`,
		);

		const preconnectHrefs = await page
			.locator('link[rel="preconnect"]')
			.evaluateAll((els) => els.map((el) => el.getAttribute("href")));
		assert.ok(
			preconnectHrefs.includes("https://www.instagram.com/"),
			`expected preconnect to https://www.instagram.com/, got ${JSON.stringify(preconnectHrefs)}`,
		);
		await tile.click();
		const dialog = page.getByRole("dialog");
		await dialog.waitFor();
		const iframe = dialog.locator("iframe");
		await iframe.waitFor();
		assert.equal(
			await dialog.locator("img").count(),
			0,
			"embed fallback must replace the custom lightbox image",
		);

		const bounds = await iframe.boundingBox();
		assert(bounds, "embed iframe has no rendered bounds");
		assert(bounds.x >= 0 && bounds.y >= 0, "embed starts outside the viewport");
		assert(
			bounds.x + bounds.width <= viewport.width,
			"embed overflows viewport width",
		);
		assert(
			bounds.y + bounds.height <= viewport.height,
			"embed overflows viewport height",
		);

		const frame = page.frameLocator("iframe");
		await frame.getByRole("button", { name: "Next" }).click();
		await frame.getByText("Slide 2").waitFor();

		await dialog.getByRole("button", { name: "Close photo viewer" }).click();
		await dialog.waitFor({ state: "detached" });
		await context.close();
	}
} finally {
	await browser.close();
	server.kill();
}

console.log("Instagram embed smoke test passed");
