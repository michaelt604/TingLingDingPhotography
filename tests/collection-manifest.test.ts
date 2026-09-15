import assert from 'node:assert/strict';
import test from 'node:test';
import { collections, getCollection, getCover } from '../app/collections.ts';

// Intended homepage covers — pinned so a silent reorder of images[] fails loudly.
const expectedCover: Record<string, string> = {
	underwater: 'underwater-02',
	portraits: 'portraits-01',
	climbing: 'climbing-01',
};

test('collection image ids are unique within each collection', () => {
	for (const rec of Object.values(collections)) {
		const ids = rec.images.map((image) => image.id);
		assert.equal(new Set(ids).size, ids.length, `${rec.id} has duplicate image ids`);
	}
});

test('coverId resolves to an existing image and getCover derives it', () => {
	for (const rec of Object.values(collections)) {
		const match = rec.images.find((image) => image.id === rec.coverId);
		assert(match, `${rec.id} coverId ${rec.coverId} does not match any image`);
		assert.equal(getCover(rec), match);
	}
});

test('homepage-cover derivation equals the intended first image', () => {
	for (const rec of Object.values(collections)) {
		assert.equal(rec.coverId, expectedCover[rec.id], `${rec.id} cover changed unexpectedly`);
		assert.equal(getCover(rec).id, rec.images[0]?.id, `${rec.id} cover is not images[0]`);
	}
});

test('getCover falls back to images[0] for an unknown coverId', () => {
	const rec = getCollection('underwater');
	assert.equal(getCover({ ...rec, coverId: 'missing' }), rec.images[0]);
});

test('every image has a non-empty src and alt and positive dimensions', () => {
	for (const rec of Object.values(collections)) {
		assert(rec.images.length > 0, `${rec.id} has no images`);
		for (const image of rec.images) {
			assert(image.src.trim().length > 0, `${image.id} has an empty src`);
			assert(image.alt.trim().length > 0, `${image.id} has an empty alt`);
			assert(image.width > 0, `${image.id} has a non-positive width`);
			assert(image.height > 0, `${image.id} has a non-positive height`);
		}
	}
});
