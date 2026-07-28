import styles from './Footer.module.css';

interface Props {
  /** Which side this footer belongs to. Controls the IG handle and accent. */
  side?: 'underwater' | 'portraits' | 'hub';
  igHandle?: string;
  igProfileUrl?: string;
}

export function Footer({ side = 'hub', igHandle, igProfileUrl }: Props) {
  const year = new Date().getFullYear();
  // On side pages, SiteNav already shows the brand. Repeating it in
  // the footer is noise; the hub doesn't have a SiteNav, so the
  // footer's brand is the only place it appears there.
  const showBrand = side === 'hub';
  return (
    <footer
      className={styles.footer}
      data-side={side === 'portraits' ? 'portrait' : side}
    >
      <div className="container">
        <div className={styles.inner}>
          {showBrand ? (
            <div className={styles.brand}>
              <span className={styles.mark} aria-hidden="true">◆</span>
              <span className={styles.name}>TingLingDing Photography</span>
            </div>
          ) : null}
          {igHandle && igProfileUrl && (
            <a
              className={styles.ig}
              href={igProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Follow @${igHandle} on Instagram`}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="2" y="2" width="20" height="20" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="18" cy="6" r="1.2" fill="currentColor" />
              </svg>
              @{igHandle}
            </a>
          )}

          <p className={styles.copy}>
            © {year} Michael Ting
          </p>
        </div>
      </div>
    </footer>
  );
}
