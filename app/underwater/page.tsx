import type { Metadata } from 'next';
import { SiteNav } from '../components/SiteNav';
import { InstagramFeed } from '../components/InstagramFeed';
import { Footer } from '../components/Footer';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Underwater & Nature',
  description:
    'Underwater and nature photography by TingLingDing. Cinematic, deep, full of blue.',
  alternates: { canonical: '/underwater/' },
  openGraph: {
    url: '/underwater/',
  },
};

const IG_HANDLE = 'tinglingdingphotography';
const IG_PROFILE_URL = `https://instagram.com/${IG_HANDLE}`;

export default function UnderwaterPage() {
  return (
    <>
      <SiteNav current="underwater" />

      <main id="main" tabIndex={-1}>
        {/* COMPACT HERO BAR with auto-cycling gradient background.
            Title text is per your call, no buttons. "Get in touch" lives in the header. */}
        <section className={styles.hero} aria-label="Hero">
          <div className={styles.heroBg} aria-hidden="true">
            <div className={styles.heroSlide} />
            <div className={styles.heroSlide} />
            <div className={styles.heroSlide} />
          </div>

          <div className={`container ${styles.heroInner}`}>
            <h1 className={`display ${styles.heroTitle}`}>
              The world below the surface.
            </h1>
          </div>
        </section>

        {/* INSTAGRAM — main content */}
        <InstagramFeed
          handle={IG_HANDLE}
          profileUrl={IG_PROFILE_URL}
          side="underwater"
        />
      </main>

      <Footer side="underwater" igHandle={IG_HANDLE} igProfileUrl={IG_PROFILE_URL} />
    </>
  );
}
