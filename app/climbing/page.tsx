import type { Metadata } from 'next';
import { CuratedGallery } from '../components/CuratedGallery';
import { Footer } from '../components/Footer';
import { SiteNav } from '../components/SiteNav';
import { getCollection } from '../collections';
import styles from '../components/CollectionPage.module.css';

export const metadata: Metadata = {
	title: 'Climbing',
	description:
		'Climbing photography by TingLingDing. Movement, texture, and quiet focus on the wall.',
	alternates: { canonical: '/climbing/' },
	openGraph: {
		type: 'website',
		siteName: 'TingLingDing Photography',
		url: '/climbing/',
		images: [{ url: '/og-default.png', width: 1200, height: 630, alt: 'Climbing photography' }],
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
						Lines, holds, and the patience of finding the next move.
					</p>
				</header>
				<p className={styles.placeholderNotice} data-placeholder-notice>
					Placeholder artwork is used while selected photographs are being prepared.
				</p>
				<div className={styles.galleryWrap}>
					<CuratedGallery images={collection.images} title={collection.title} />
				</div>
			</main>
			<Footer side="climbing" />
		</>
	);
}
