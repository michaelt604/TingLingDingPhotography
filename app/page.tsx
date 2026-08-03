import Link from 'next/link';
import styles from './page.module.css';
import { CONTACT_EMAIL } from './components/contactMailto';

export default function HubPage() {
  return (
    <main data-side="hub" className={styles.hub} id="main" tabIndex={-1}>
      <h1 className="srOnly">TingLingDing Photography</h1>

      <div className={styles.siteHeader} aria-hidden="true">
        <span className={styles.siteName}>TingLingDing</span>
        <span className={styles.siteType}>Photography</span>
      </div>

      <a
        className={styles.homeContact}
        href={`mailto:${CONTACT_EMAIL}`}
        aria-label="Email TingLingDing Photography"
      >
        Get in touch
      </a>

      <div className={styles.split}>
        <section
          className={`${styles.half} ${styles.halfUnderwater}`}
          data-half="underwater"
          aria-labelledby="underwater-title"
        >
          <div className={styles.halfBg} aria-hidden="true" />
          <Link
            href="/underwater/"
            className={styles.halfMainLink}
            aria-label="Enter underwater & nature"
          />
          <div className={styles.halfContent}>
            <p className={styles.halfKicker}>01 / Underwater &amp; nature</p>
            <h2 id="underwater-title" className={`display ${styles.halfTitle}`}>
              Underwater<br />&amp; Nature
            </h2>
            <span className={styles.halfCta} aria-hidden="true">
              Explore collection <span className={styles.halfArrow}>↗</span>
            </span>
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
        </section>

        <section
          className={`${styles.half} ${styles.halfPortrait}`}
          data-half="portrait"
          aria-labelledby="portrait-title"
        >
          <div className={styles.halfBg} aria-hidden="true" />
          <Link
            href="/portraits/"
            className={styles.halfMainLink}
            aria-label="Enter portraits"
          />
          <div className={styles.halfContent}>
            <p className={styles.halfKicker}>02 / Portraits</p>
            <h2 id="portrait-title" className={`display ${styles.halfTitle}`}>
              Portraits
            </h2>
            <span className={styles.halfCta} aria-hidden="true">
              Explore collection <span className={styles.halfArrow}>↗</span>
            </span>
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
        </section>
      </div>
    </main>
  );
}
