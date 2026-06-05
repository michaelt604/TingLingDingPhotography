'use client';

import Link from 'next/link';
import { useContact } from './ContactProvider';
import styles from './SiteNav.module.css';

interface Props {
  current: 'underwater' | 'portraits';
}

/**
 * SiteNav
 * Sticky top nav for the two side pages (underwater, portraits).
 * - Brand mark on the left
 * - "Get in touch" pill (opens the contact modal — available on every page)
 * - One link to the OTHER side, named plainly ("Underwater" / "Portrait")
 */
export function SiteNav({ current }: Props) {
  const { open: openContact } = useContact();

  const otherLabel = current === 'underwater' ? 'Portrait' : 'Underwater';
  const otherHref = current === 'underwater' ? '/portraits/' : '/underwater/';

  return (
    <header className={styles.nav}>
      <Link href="/" className={styles.brand} aria-label="TingLingDing Photography">
        <span className={styles.brandMark} aria-hidden="true">◆</span>
        <span className={styles.brandText}>TingLingDing</span>
      </Link>

      <div className={styles.actions}>
        <Link href={otherHref} className={styles.link} aria-label={`Switch to ${otherLabel}`}>
          <span>{otherLabel}</span>
        </Link>
        <button
          type="button"
          onClick={openContact}
          className={styles.cta}
          aria-label="Open contact form"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-10 6L2 7" />
          </svg>
          <span>Get in touch</span>
        </button>
      </div>
    </header>
  );
}
