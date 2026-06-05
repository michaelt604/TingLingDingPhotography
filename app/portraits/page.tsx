import type { Metadata } from 'next';
import { SiteNav } from '../components/SiteNav';
import { InstagramFeed } from '../components/InstagramFeed';
import { Footer } from '../components/Footer';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'Portraits',
  description:
    'Portrait photography by TingLingDing. Intimate, considered, made for faces.',
  alternates: { canonical: '/portraits/' },
};

const IG_HANDLE = 'tinglingdingportraits';
const IG_PROFILE_URL = `https://instagram.com/${IG_HANDLE}`;

export default function PortraitsPage() {
  return (
    <>
      <SiteNav current="portraits" />

      <main id="main" tabIndex={-1}>
        {/* COMPACT HERO BAR with auto-cycling purple gradient — matches /underwater structure. */}
        <section className={styles.hero} aria-label="Header">
          <div className={styles.heroBg} aria-hidden="true">
            <div className={styles.heroSlide} />
            <div className={styles.heroSlide} />
            <div className={styles.heroSlide} />
          </div>

          <div className={`container ${styles.heroInner}`}>
            <h1 className={`display ${styles.heroTitle}`}>
              Honest portraits, made on request.
            </h1>
          </div>
        </section>

        {/* INSTAGRAM — main content */}
        <InstagramFeed
          handle={IG_HANDLE}
          profileUrl={IG_PROFILE_URL}
          bookingNote="Currently booking for August 2026."
          side="portraits"
        />
      </main>

      <Footer side="portraits" igHandle={IG_HANDLE} igProfileUrl={IG_PROFILE_URL} />
    </>
  );
}
