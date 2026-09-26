import type { Metadata } from 'next';
import { ArrowDown } from '@phosphor-icons/react/dist/ssr';
import { CuratedGallery } from '../components/CuratedGallery';
import { Footer } from '../components/Footer';
import { InstagramFeed } from '../components/InstagramFeed';
import { SiteNav } from '../components/SiteNav';
import { getCollection } from '../collections';
import styles from '../components/CollectionPage.module.css';

export const metadata: Metadata = {
	title: 'Portraits',
	description:
		'Natural-light portraits by Michael Ting. Outdoor photography celebrating natural beauty, from open landscapes to city streets.',
	alternates: { canonical: '/portraits/' },
	openGraph: {
		type: 'website',
		siteName: 'TingLingDing Photography',
		url: '/portraits/',
		title: 'Portraits',
		description:
			'Natural-light portraits by Michael Ting. Outdoor photography celebrating natural beauty, from open landscapes to city streets.',
		images: [{ url: '/og-portraits.png', width: 1200, height: 630, alt: 'Warm-toned portrait placeholder artwork for the Portraits collection' }],
	},
	twitter: { card: 'summary_large_image', images: ['/og-portraits.png'] },
};

const IG_HANDLE = 'tinglingdingportraits';
const IG_PROFILE_URL = `https://instagram.com/${IG_HANDLE}`;
const collection = getCollection('portraits');

export default function PortraitsPage() {
	return (
		<>
			<SiteNav current="portraits" />
			<main id="main" className={styles.page} tabIndex={-1}>
				<header className={styles.intro}>
					<h1 className={styles.title}>{collection.title}</h1>
					<p className={styles.description}>
						Natural light, outdoor spaces, and the person in front of the camera. From open landscapes to city streets, I’m drawn to portraits that feel relaxed and true to the person.
					</p>
					<a className={styles.recentJump} href="#recent-work">Latest on Instagram <ArrowDown aria-hidden /></a>
				</header>
				<p className={styles.placeholderNotice} data-placeholder-notice>
					Placeholder artwork is used while selected photographs are being prepared.
				</p>
				<div className={styles.galleryWrap} data-collection="portraits">
					<CuratedGallery images={collection.images} title={collection.title} />
				</div>
				<section id="recent-work" className={styles.recent}>
					<header className={styles.recentHeader}>
						<h2 className={styles.recentTitle}>Recent work</h2>
					</header>
					<div className={styles.recentFeed}>
						<InstagramFeed
							handle={IG_HANDLE}
							profileUrl={IG_PROFILE_URL}
							side="portraits"
						/>
					</div>
				</section>
			</main>
			<Footer side="portraits" igHandle={IG_HANDLE} igProfileUrl={IG_PROFILE_URL} />
		</>
	);
}
