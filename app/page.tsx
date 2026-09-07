'use client';

import type { PointerEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useContact } from './components/ContactProvider';
import styles from './page.module.css';

const collections = [
  {
    name: 'Underwater', note: 'Light, tide, and the quiet below.', href: '/underwater/',
    image: '/placeholders/underwater.svg', imageAlt: 'Local placeholder artwork for the Underwater collection', className: styles.underwater,
  },
  {
    name: 'Portraits', note: 'Natural light, honest presence.', href: '/portraits/',
    image: '/placeholders/portraits.svg', imageAlt: 'Local placeholder artwork for the Portraits collection', className: styles.portraits,
  },
  {
    name: 'Climbing', note: 'Movement, texture, and the route ahead.', href: '/climbing/',
    image: '/placeholders/climbing.svg', imageAlt: 'Local placeholder artwork for the Climbing collection', className: styles.climbing,
  },
] as const;

function movePanel(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== 'mouse' || !matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return;
  const panel = event.currentTarget;
  const bounds = panel.getBoundingClientRect();
  const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
  const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
  panel.style.setProperty('--panel-x', `${(x - 0.5) * 8}px`);
  panel.style.setProperty('--panel-y', `${(y - 0.5) * 8}px`);
}

function resetPanel(event: PointerEvent<HTMLDivElement>) {
  event.currentTarget.style.removeProperty('--panel-x');
  event.currentTarget.style.removeProperty('--panel-y');
}

export default function HubPage() {
  const { open: openContact } = useContact();

  return (
    <main data-side="hub" className={styles.home} id="main" tabIndex={-1}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="TingLingDing Photography home">
          <span className={styles.brandName}>TingLingDing</span>
          <span className={styles.brandType}>Photography</span>
        </Link>
        <button type="button" className={styles.contactButton} onClick={openContact}>
          Get in touch <span aria-hidden="true">↗</span>
        </button>
      </header>

      <section className={styles.intro} aria-labelledby="intro-title">
        <p className={styles.eyebrow}>Selected work</p>
        <h1 id="intro-title" className={`display ${styles.title}`}>
          Three ways of paying attention.
        </h1>
        <p className={styles.scrollHint} aria-hidden="true">Explore the collections <span>↓</span></p>
      </section>

      <section className={styles.collections} aria-labelledby="collections-title">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>The collections</p>
          <h2 id="collections-title" className="srOnly">Photography collections</h2>
        </div>

        <div className={styles.collectionGrid}>
          {collections.map((collection) => (
            <article key={collection.name} className={`${styles.collection} ${collection.className}`}>
              <Link
                href={collection.href}
                className={styles.collectionLink}
                aria-label={`${collection.name} collection`}
              >
                <div className={styles.imageFrame} onPointerMove={movePanel} onPointerLeave={resetPanel} data-photo-panel>
                  <Image
                    src={collection.image}
                    alt={collection.imageAlt}
                    width={900}
                    height={1150}
                    priority={collection.name === 'Underwater'}
                    loading={collection.name === 'Underwater' ? undefined : 'lazy'}
                  />
                  <span className={styles.placeholderTag}>Local placeholder · selected work pending</span>
                </div>
                <div className={styles.collectionMeta}>
                  <div>
                    <h3 className={`display ${styles.collectionName}`}>{collection.name}</h3>
                    <p className={styles.collectionNote}>{collection.note}</p>
                  </div>
                  <span className={styles.arrow} aria-hidden="true">↗</span>
                </div>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.about} aria-labelledby="about-title">
        <div>
          <p className={styles.eyebrow}>A little context</p>
          <h2 id="about-title" className={`display ${styles.aboutTitle}`}>Made with attention.</h2>
        </div>
        <p className={styles.introCopy}>
          I’m Michael. Photography is shaped by time in the water, on the wall, and with good friends.
          I make natural-light portraits and follow the details that turn a place into a memory.
        </p>
      </section>

      <section className={styles.recent} aria-labelledby="recent-title">
        <div>
          <p className={styles.eyebrow}>From the field</p>
          <h2 id="recent-title" className={`display ${styles.recentTitle}`}>Recent work</h2>
        </div>
        <div className={styles.recentLinks}>
          <Link href="/underwater/#recent-work" className={styles.recentLink}>
            <span>Underwater</span><span aria-hidden="true">↗</span>
          </Link>
          <Link href="/portraits/#recent-work" className={styles.recentLink}>
            <span>Portraits</span><span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <p>© {new Date().getFullYear()} Michael Ting</p>
        <button type="button" onClick={openContact}>Have an idea? Get in touch <span aria-hidden="true">↗</span></button>
      </footer>
    </main>
  );
}
