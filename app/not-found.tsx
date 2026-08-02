import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Page not found | TingLingDing Photography',
};

export default function NotFound() {
  return (
    <main data-side="hub" className={styles.notFound} id="main" tabIndex={-1}>
      <div className={styles.inner}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>This page doesn&rsquo;t exist (yet).</h1>
        <p className={styles.subtitle}>
          The link may be old, mistyped, or part of a shot that&rsquo;s still being
          edited. Head back to the hub or jump straight into one of the two sides.
        </p>
        <nav className={styles.actions} aria-label="Site sections">
          <Link href="/" className={`${styles.link} ${styles.linkPrimary}`}>
            <span className={styles.linkDot} aria-hidden="true">
              <Image src="/brand-mark.png" alt="" width={18} height={18} unoptimized />
            </span>
            <span>Hub</span>
          </Link>
          <Link href="/underwater/" className={styles.link}>Underwater</Link>
          <Link href="/portraits/" className={styles.link}>Portraits</Link>
        </nav>
      </div>
    </main>
  );
}
