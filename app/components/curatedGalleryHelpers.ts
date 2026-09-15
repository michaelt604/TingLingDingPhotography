'use client';

import type { CollectionImage } from '../collections';

/** Grid tile source: responsive variant when present, canonical src otherwise. */
export function pickGridSrc(image: CollectionImage): string {
	return image.gridSrc ?? image.src;
}

/** Viewer source: viewer variant when present, canonical src otherwise. */
export function pickViewerSrc(image: CollectionImage): string {
	return image.viewerSrc ?? image.src;
}

/** Neighbor preloading is skipped when the platform reports data saving. */
export function shouldPreloadNeighbors(saveData: boolean | undefined): boolean {
	return saveData !== true;
}

/** Grid button accessible name: photo description plus ordinal position. */
export function gridButtonLabel(image: CollectionImage, index: number, total: number): string {
	return `Open photograph ${index + 1} of ${total}: ${image.alt}`;
}
