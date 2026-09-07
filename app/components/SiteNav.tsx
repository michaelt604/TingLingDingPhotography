'use client';

import Link from 'next/link';
import { useContact } from './ContactProvider';
import styles from './SiteNav.module.css';

type Collection = 'underwater' | 'portraits' | 'climbing';

interface Props {
  current: Collection | 'hub';
}

/**
 * SiteNav
 * Sticky top nav for the collection pages.
 * - Brand mark on the left
 * - "Get in touch" pill (opens the contact modal — available on every page)
 * - A compact link to each collection, with the current page exposed to assistive technology
 */
export function SiteNav({ current }: Props) {
  const { open: openContact } = useContact();
  const collections: Array<{ key: Collection; label: string; href: string }> = [
    { key: 'underwater', label: 'Underwater', href: '/underwater/' },
    { key: 'portraits', label: 'Portraits', href: '/portraits/' },
    { key: 'climbing', label: 'Climbing', href: '/climbing/' },
  ];

  return (
    <header className={styles.nav}>
      <Link href="/" className={styles.brand} aria-label="TingLingDing Photography">
        <span className={styles.brandText}>TingLingDing</span>
      </Link>

      <div className={styles.actions}>
        <nav className={styles.links} aria-label="Primary">
          {collections.map((collection) => (
            <Link
              key={collection.key}
              href={collection.href}
              className={styles.link}
              aria-current={current === collection.key ? 'page' : undefined}
            >
              {collection.label}
            </Link>
          ))}
        </nav>
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
