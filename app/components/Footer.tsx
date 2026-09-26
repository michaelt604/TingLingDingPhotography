import Link from 'next/link';
import { ArrowUpRight, InstagramLogo } from '@phosphor-icons/react/dist/ssr';
import { CONTACT_EMAIL } from './contactMailto';
import styles from './Footer.module.css';

interface Props {
  /** Which collection this footer belongs to. Instagram details remain optional. */
  side?: 'underwater' | 'portraits' | 'climbing' | 'hub';
  igHandle?: string;
  igProfileUrl?: string;
}

/**
 * Footer
 * Renders optional Instagram details and a generic copyright line.
 * Collection pages without a connected account simply omit the Instagram link.
 */
export function Footer({ side, igHandle, igProfileUrl }: Props) {
  // Frozen at build time with `next export`; refreshes on every deploy.
  const year = new Date().getFullYear();
  return (
    <footer
      className={styles.footer}
      data-side={side === 'portraits' ? 'portrait' : side}
    >
      <div className="container">
        {side && side !== 'hub' && (
          <nav className={styles.explore} aria-label="More photography">
            <p>Keep exploring</p>
            <div className={styles.exploreLinks}>
              {[
                { id: 'portraits', title: 'Portraits' },
                { id: 'underwater', title: 'Underwater' },
                { id: 'climbing', title: 'Climbing' },
              ].filter((item) => item.id !== side).map((item) => (
                <Link key={item.id} href={`/${item.id}/`}>
                  {item.title}<ArrowUpRight aria-hidden />
                </Link>
              ))}
            </div>
          </nav>
        )}
        <div className={styles.inner}>
          {igHandle && igProfileUrl && (
            <a
              className={styles.ig}
              href={igProfileUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Follow @${igHandle} on Instagram`}
            >
              <InstagramLogo size={18} aria-hidden />
              @{igHandle}
            </a>
          )}

          <a className={styles.email} href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          <p className={styles.copy}>
            © {year} Michael Ting
          </p>
        </div>
      </div>
    </footer>
  );
}
