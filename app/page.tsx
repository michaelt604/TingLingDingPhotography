import Link from 'next/link';
import styles from './page.module.css';

export default function HubPage() {
  return (
    <main data-side="hub" className={styles.hub} id="main" tabIndex={-1}>
      <div className={styles.split}>
        {/* UNDERWATER HALF
            The half is a div (not a link) so we can have the IG handle
            as a real <a> sibling without nesting <a> inside <a>.
            The main "enter" link is an absolutely-positioned <Link>
            covering the whole half; the IG hint sits above it via z-index. */}
        <div className={`${styles.half} ${styles.halfUnderwater}`} data-half="underwater">
          <div className={styles.halfBg} aria-hidden="true" />
          <Link
            href="/underwater/"
            className={styles.halfMainLink}
            aria-label="Enter underwater & nature"
          />
          <div className={styles.halfContent} aria-hidden="true">
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
        </div>

        {/* PORTRAIT HALF */}
        <div className={`${styles.half} ${styles.halfPortrait}`} data-half="portrait">
          <div className={styles.halfBg} aria-hidden="true" />
          <Link
            href="/portraits/"
            className={styles.halfMainLink}
            aria-label="Enter portraits"
          />
          <div className={styles.halfContent} aria-hidden="true">
            <h1 className={`display ${styles.halfTitle}`}>
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
        </div>
      </div>
    </main>
  );
}
