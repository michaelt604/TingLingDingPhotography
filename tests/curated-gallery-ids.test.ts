import assert from 'node:assert/strict';
import test from 'node:test';
import { collections, getCover } from '../app/collections.ts';
import {
	gridButtonLabel,
	pickGridSrc,
	pickViewerSrc,
	shouldPreloadNeighbors,
} from '../app/components/curatedGalleryHelpers.ts';

test('grid and viewer sources fall back to src while no variants are published', () => {
	for (const rec of Object.values(collections)) {
		for (const image of rec.images) {
			assert.equal('gridSrc' in image, false, `${image.id} unexpectedly publishes gridSrc`);
			assert.equal('viewerSrc' in image, false, `${image.id} unexpectedly publishes viewerSrc`);
			assert.equal(pickGridSrc(image), image.src, `${image.id} grid fallback`);
			assert.equal(pickViewerSrc(image), image.src, `${image.id} viewer fallback`);
		}
	}
});

test('published gridSrc/viewerSrc variants win and differ from src', () => {
	const cover = getCover(collections.underwater);
	const withVariants = {
		...cover,
		gridSrc: '/placeholders/underwater-square.svg',
		viewerSrc: '/placeholders/underwater-landscape-alt.svg',
	};
	assert.notEqual(withVariants.gridSrc, cover.src);
	assert.notEqual(withVariants.viewerSrc, cover.src);
	assert.equal(pickGridSrc(withVariants), withVariants.gridSrc);
	assert.equal(pickViewerSrc(withVariants), withVariants.viewerSrc);
});

test('neighbor preloading is skipped only when saveData is on', () => {
	assert.equal(shouldPreloadNeighbors(true), false);
	assert.equal(shouldPreloadNeighbors(false), true);
	assert.equal(shouldPreloadNeighbors(undefined), true);
});

test('grid button labels carry the photo description and ordinal position', () => {
	for (const rec of Object.values(collections)) {
		rec.images.forEach((image, index) => {
			const label = gridButtonLabel(image, index, rec.images.length);
			assert.match(label, new RegExp(`^Open photograph ${index + 1} of ${rec.images.length}: `));
			assert.ok(label.includes(image.alt), `${image.id} label includes its description`);
		});
	}
});

test('every cover keeps a stable photo id shared by its record', () => {
	for (const rec of Object.values(collections)) {
		const cover = getCover(rec);
		assert.ok(cover.id.length > 0, `${rec.id} cover has a stable id`);
		assert.ok(
			rec.images.some((image) => image.id === cover.id),
			`${rec.id} cover id ${cover.id} matches a gallery image id`,
		);
	}
});
