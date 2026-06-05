import Link from 'next/link';
import styles from './page.module.css';

export default function HubPage() {
  return (
    <main data-side="hub" className={styles.hub} id="main" tabIndex={-1}>
      <div className={styles.split}>
        {/* UNDERWATER HALF */}
        <Link
          href="/underwater/"
          className={`${styles.half} ${styles.halfUnderwater}`}
          data-half="underwater"
          aria-label="Enter underwater & nature"
        >
          <div className={styles.halfBg} aria-hidden="true" />
          <div className={styles.halfContent}>
            <h1 className={`display ${styles.halfTitle}`}>
              Underwater<br />&amp; Nature
            </h1>
          </div>
          <a
            className={styles.halfHint}
            href="https://instagram.com/tinglingdingphotography"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow @tinglingdingphotography on Instagram"
          >
            @tinglingdingphotography
          </a>
        </Link>

        {/* PORTRAIT HALF */}
        <Link
          href="/portraits/"
          className={`${styles.half} ${styles.halfPortrait}`}
          data-half="portrait"
          aria-label="Enter portraits"
        >
          <div className={styles.halfBg} aria-hidden="true" />
          <div className={styles.halfContent}>
            <h1 className={`${styles.halfTitle}`}>
              Portraits
            </h1>
          </div>
          <a
            className={styles.halfHint}
            href="https://instagram.com/tinglingdingportraits"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Follow @tinglingdingportraits on Instagram"
          >
            @tinglingdingportraits
          </a>
        </Link>
      </div>
    </main>
  );
}
