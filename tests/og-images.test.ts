import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const appDir = resolve(import.meta.dirname, "../app");
const publicDir = resolve(import.meta.dirname, "../public");
const metadataFiles = ["layout.tsx", "underwater/page.tsx", "portraits/page.tsx"];

function referencedOgImages(file: string): string[] {
	const source = readFileSync(resolve(appDir, file), "utf8");
	const matches = source.matchAll(/['"]([^'"]*\/og-[a-z-]+\.(?:png|svg|jpg))['"]/g);
	return [...matches].map((match) => match[1] ?? "");
}

test("every Open Graph image referenced in metadata is a raster file that exists in public/", () => {
	for (const file of metadataFiles) {
		for (const ogUrl of referencedOgImages(file)) {
			assert.match(
				ogUrl,
				/\.(?:png|jpg)$/,
				`${file} references ${ogUrl} — social platforms do not support SVG og:image`,
			);
			const relative = ogUrl.replace(/^\//, "");
			assert(
				existsSync(resolve(publicDir, relative)),
				`${file} references ${ogUrl} which does not exist in public/`,
			);
		}
	}
});

test("every og-*.png in public/ is raster (PNG magic bytes) and non-empty", () => {
	for (const fileName of readdirSync(publicDir)) {
		if (!/^og-.+\.png$/.test(fileName)) continue;
		const bytes = readFileSync(resolve(publicDir, fileName));
		assert.equal(
			bytes[0],
			0x89,
			`${fileName} does not start with the PNG magic bytes`,
		);
		assert(bytes.length > 1024, `${fileName} looks empty (${bytes.length} bytes)`);
	}
});
