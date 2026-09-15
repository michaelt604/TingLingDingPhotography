import type { Metadata } from 'next';
import { CuratedGallery } from '../components/CuratedGallery';
import { Footer } from '../components/Footer';
import { SiteNav } from '../components/SiteNav';
import { getCollection } from '../collections';
import styles from '../components/CollectionPage.module.css';

export const metadata: Metadata = {
	title: 'Climbing',
	description:
		'Climbing photography by Michael Ting. Friends, movement, and days spent on the wall.',
	alternates: { canonical: '/climbing/' },
	openGraph: {
		type: 'website',
		siteName: 'TingLingDing Photography',
		url: '/climbing/',
		title: 'Climbing',
		description:
			'Climbing photography by Michael Ting. Friends, movement, and days spent on the wall.',
		images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'Designed site fallback artwork used while Climbing photographs are being prepared' }],
	},
	twitter: { card: 'summary_large_image', images: ['/og-default.png'] },
};

const collection = getCollection('climbing');

export default function ClimbingPage() {
	return (
		<>
			<SiteNav current="climbing" />
			<main id="main" className={styles.page} tabIndex={-1}>
				<header className={styles.intro}>
					<h1 className={styles.title}>{collection.title}</h1>
					<p className={styles.description}>
						Mostly friends, photographed on days we’re out climbing together. I pick up the camera when something catches my eye, from working through a move to taking a break between climbs.
					</p>
				</header>
				<p className={styles.placeholderNotice} data-placeholder-notice>
					Placeholder artwork is used while selected photographs are being prepared.
				</p>
				<div className={styles.galleryWrap} data-collection="climbing">
					<CuratedGallery images={collection.images} title={collection.title} />
				</div>
			</main>
			<Footer side="climbing" />
		</>
	);
}
