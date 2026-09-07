import type { Metadata } from 'next';
import { CuratedGallery } from '../components/CuratedGallery';
import { Footer } from '../components/Footer';
import { InstagramFeed } from '../components/InstagramFeed';
import { SiteNav } from '../components/SiteNav';
import { getCollection } from '../collections';
import styles from '../components/CollectionPage.module.css';

export const metadata: Metadata = {
	title: 'Portraits',
	description:
		'Portrait photography by TingLingDing. Intimate, considered images made for faces.',
	alternates: { canonical: '/portraits/' },
	openGraph: {
		type: 'website',
		siteName: 'TingLingDing Photography',
		url: '/portraits/',
		images: [{ url: '/og-portraits.png', width: 1200, height: 630, alt: 'Portrait photography' }],
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
						Natural-light portraits shaped by trust, presence, and a little room to breathe.
					</p>
				</header>
				<p className={styles.placeholderNotice} data-placeholder-notice>
					Placeholder artwork is used while selected photographs are being prepared.
				</p>
				<div className={styles.galleryWrap}>
					<CuratedGallery images={collection.images} title={collection.title} />
				</div>
				<section id="recent-work" className={styles.recent}>
					<header className={styles.recentHeader}>
						<p className={styles.recentKicker}>From the feed</p>
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
