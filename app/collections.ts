export type CollectionId = 'underwater' | 'portraits' | 'climbing';

export interface CollectionImage {
	id: string;
	src: string;
	width: number;
	height: number;
	alt: string;
}

export interface CollectionRecord {
	id: CollectionId;
	title: string;
	images: readonly CollectionImage[];
}

const underwaterImages = [
	{
		id: 'underwater-01',
		src: '/placeholders/underwater.svg',
		width: 900,
		height: 1150,
		alt: 'Abstract underwater-toned placeholder artwork with drifting lines and bubbles.',
	},
	{
		id: 'underwater-03',
		src: '/placeholders/underwater-square.svg',
		width: 1000,
		height: 1000,
		alt: 'Abstract underwater-toned square placeholder artwork with layered arcs.',
	},
	{
		id: 'underwater-02',
		src: '/placeholders/underwater-landscape.svg',
		width: 1400,
		height: 860,
		alt: 'Abstract underwater-toned landscape placeholder artwork with a soft horizon.',
	},
	{
		id: 'underwater-05',
		src: '/placeholders/underwater-square-alt.svg',
		width: 1100,
		height: 1100,
		alt: 'Abstract underwater-toned square placeholder artwork with fine flowing lines.',
	},
	{
		id: 'underwater-04',
		src: '/placeholders/underwater-landscape-alt.svg',
		width: 1600,
		height: 900,
		alt: 'Abstract underwater-toned landscape placeholder artwork with a deep gradient.',
	},
] satisfies readonly CollectionImage[];

const portraitsImages = [
	{
		id: 'portraits-01',
		src: '/placeholders/portraits.svg',
		width: 900,
		height: 1150,
		alt: 'Abstract warm-toned portrait placeholder artwork.',
	},
	{
		id: 'portraits-03',
		src: '/placeholders/portraits-square.svg',
		width: 1000,
		height: 1000,
		alt: 'Abstract warm-toned square placeholder artwork with layered shapes.',
	},
	{
		id: 'portraits-02',
		src: '/placeholders/portraits-landscape.svg',
		width: 1400,
		height: 860,
		alt: 'Abstract warm-toned landscape placeholder artwork with a quiet light shape.',
	},
	{
		id: 'portraits-05',
		src: '/placeholders/portraits-square-alt.svg',
		width: 1100,
		height: 1100,
		alt: 'Abstract warm-toned square placeholder artwork with a soft central glow.',
	},
	{
		id: 'portraits-04',
		src: '/placeholders/portraits-landscape-alt.svg',
		width: 1600,
		height: 900,
		alt: 'Abstract warm-toned landscape placeholder artwork with a curved silhouette.',
	},
] satisfies readonly CollectionImage[];

const climbingImages = [
	{
		id: 'climbing-01',
		src: '/placeholders/climbing.svg',
		width: 900,
		height: 1150,
		alt: 'Abstract rock-toned climbing placeholder artwork with a route line.',
	},
	{
		id: 'climbing-03',
		src: '/placeholders/climbing-square.svg',
		width: 1000,
		height: 1000,
		alt: 'Abstract rock-toned square placeholder artwork with layered planes.',
	},
	{
		id: 'climbing-02',
		src: '/placeholders/climbing-landscape.svg',
		width: 1400,
		height: 860,
		alt: 'Abstract rock-toned landscape placeholder artwork with angular ridges.',
	},
	{
		id: 'climbing-05',
		src: '/placeholders/climbing-square-alt.svg',
		width: 1100,
		height: 1100,
		alt: 'Abstract rock-toned square placeholder artwork with a climbing route motif.',
	},
	{
		id: 'climbing-04',
		src: '/placeholders/climbing-landscape-alt.svg',
		width: 1600,
		height: 900,
		alt: 'Abstract rock-toned landscape placeholder artwork with a distant ridge.',
	},
] satisfies readonly CollectionImage[];

export const collections = {
	underwater: {
		id: 'underwater',
		title: 'Underwater',
		images: underwaterImages,
	},
	portraits: {
		id: 'portraits',
		title: 'Portraits',
		images: portraitsImages,
	},
	climbing: {
		id: 'climbing',
		title: 'Climbing',
		images: climbingImages,
	},
} satisfies Record<CollectionId, CollectionRecord>;

export function getCollection(id: CollectionId): CollectionRecord {
	return collections[id];
}
