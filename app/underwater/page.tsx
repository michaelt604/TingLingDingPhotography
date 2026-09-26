import type { Metadata } from 'next';
import { ArrowDown } from '@phosphor-icons/react/dist/ssr';
import { CuratedGallery } from '../components/CuratedGallery';
import { Footer } from '../components/Footer';
import { InstagramFeed } from '../components/InstagramFeed';
import { SiteNav } from '../components/SiteNav';
import { getCollection } from '../collections';
import styles from '../components/CollectionPage.module.css';

export const metadata: Metadata = {
	title: 'Underwater',
	description:
		'Underwater photography by Michael Ting. Photographs from his dives, sharing the light, movement, and experiences below the surface.',
	alternates: { canonical: '/underwater/' },
	openGraph: {
		type: 'website',
		siteName: 'TingLingDing Photography',
		url: '/underwater/',
		title: 'Underwater',
		description:
			'Underwater photography by Michael Ting. Photographs from his dives, sharing the light, movement, and experiences below the surface.',
		images: [{ url: '/og-underwater.png', width: 1200, height: 630, alt: 'Underwater-toned seascape placeholder artwork for the Underwater collection' }],
	},
	twitter: { card: 'summary_large_image', images: ['/og-underwater.png'] },
};

const IG_HANDLE = 'tinglingdingphotography';
const IG_PROFILE_URL = `https://instagram.com/${IG_HANDLE}`;
const collection = getCollection('underwater');

export default function UnderwaterPage() {
	return (
		<>
			<SiteNav current="underwater" />
			<main id="main" className={styles.page} tabIndex={-1}>
				<header className={styles.intro}>
					<h1 className={styles.title}>{collection.title}</h1>
					<p className={styles.description}>
						Diving is one of my passions. These photographs are a way to share what I see beneath the surface: the changing light, the movement, and the moments I want to bring back with me.
					</p>
					<a className={styles.recentJump} href="#recent-work">Latest on Instagram <ArrowDown aria-hidden /></a>
				</header>
				<p className={styles.placeholderNotice} data-placeholder-notice>
					Placeholder artwork is used while selected photographs are being prepared.
				</p>
				<div className={styles.galleryWrap} data-collection="underwater">
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
							side="underwater"
						/>
					</div>
				</section>
			</main>
			<Footer side="underwater" igHandle={IG_HANDLE} igProfileUrl={IG_PROFILE_URL} />
		</>
	);
}
