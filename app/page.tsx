'use client';

import type { PointerEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react/dist/ssr';
import Image from 'next/image';
import { useContact } from './components/ContactProvider';
import { CONTACT_EMAIL } from './components/contactMailto';
import { LatestFrames } from './components/LatestFrames';
import { collections as records, getCover } from './collections';
import styles from './page.module.css';

const collectionCards = [
  {
    id: 'portraits' as const, note: 'Outdoor portraits in natural light.', href: '/portraits/',
    className: styles.portraits,
  },
  {
    id: 'underwater' as const, note: 'Photographs from below the surface.', href: '/underwater/',
    className: styles.underwater,
  },
  {
    id: 'climbing' as const, note: 'Friends and days on the wall.', href: '/climbing/',
    className: styles.climbing,
  },
] as const;

const instagramAccounts = [
  { handle: 'tinglingdingportraits', label: 'Portraits' },
  { handle: 'tinglingdingphotography', label: 'Underwater' },
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
          <span className={styles.brandType}>Michael Ting</span>
        </Link>
        <nav className={styles.headerNav} aria-label="Sections">
          <a href="#work">Work</a>
          <a href="#recent">Recent</a>
          <a href="#about">About</a>
        </nav>
        <button type="button" className={styles.contactButton} onClick={openContact}>
          Get in touch <ArrowUpRight aria-hidden />
        </button>
      </header>

      <section className={styles.intro} aria-labelledby="intro-title">
        <h1 id="intro-title" className={`display ${styles.title}`}>
          People, places, and time outside.
        </h1>
        <div className={styles.introFoot}>
          <p className={styles.summary}>
            Portraits in natural light, moments below the surface, and days spent climbing with friends.
          </p>
          <nav className={styles.shortcuts} aria-label="Collection shortcuts">
            {collectionCards.map((card) => (
              <Link key={card.id} href={card.href} className={styles.shortcutLink}>
                {records[card.id].title} <ArrowRight aria-hidden />
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section id="work" className={styles.collections} aria-labelledby="collections-title">
        <h2 id="collections-title" className="srOnly">Photography collections</h2>
        <div className={styles.collectionGrid}>
          {collectionCards.map((card, cardIndex) => {
            const record = records[card.id];
            const cover = getCover(record);
            return (
              <article key={record.id} className={`${styles.collection} ${card.className}`}>
                <a
                  href={card.href}
                  className={styles.collectionLink}
                  aria-label={`View ${record.title.toLowerCase()} photographs`}
                >
                  <div className={styles.imageFrame} onPointerMove={movePanel} onPointerLeave={resetPanel} data-photo-panel>
                    <Image
                      src={cover.src}
                      alt={cover.alt}
                      width={cover.width}
                      height={cover.height}
                      sizes="(max-width: 720px) 100vw, 33vw"
                      style={cover.focal ? { objectPosition: `${cover.focal.x}% ${cover.focal.y}%` } : undefined}
                      data-route-image={record.id}
                      data-cover-id={cover.id}
                      priority={cardIndex === 0}
                      loading={cardIndex === 0 ? undefined : 'lazy'}
                    />
                  </div>
                  <div className={styles.collectionMeta}>
                    <div>
                      <h3 className={`display ${styles.collectionName}`}>{record.title}</h3>
                      <p className={styles.collectionNote}>{card.note}</p>
                    </div>
                    <ArrowUpRight className={styles.arrow} aria-hidden />
                  </div>
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <section id="recent" className={styles.recent} aria-labelledby="recent-title">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="recent-title" className={`display ${styles.sectionTitle}`}>Latest frames</h2>
          </div>
          <div className={styles.recentLinks}>
            <Link href="/portraits/#recent-work" className={styles.recentLink}>
              <span>Portraits feed</span><ArrowRight aria-hidden />
            </Link>
            <Link href="/underwater/#recent-work" className={styles.recentLink}>
              <span>Underwater feed</span><ArrowRight aria-hidden />
            </Link>
          </div>
        </div>
        <LatestFrames />
      </section>

      <section id="about" className={styles.about} aria-labelledby="about-title">
        <div>
          <h2 id="about-title" className={`display ${styles.aboutTitle}`}>Hi, I’m Michael.</h2>
        </div>
        <div className={styles.introCopy}>
          <p>
            Photography brings together the things I enjoy most: getting outside, spending time with people,
            and exploring somewhere I haven’t been before. This is where I share those experiences,
            from a portrait session on land to a quiet moment on a dive.
          </p>
          <p>
            In portraits, I’m drawn to natural beauty and the way someone settles into being themselves.
            I mostly work outdoors with available light, whether that’s an open landscape or a downtown street.
          </p>
          <p>
            Underwater, the camera lets me bring a little of the dive back to the surface.
            Climbing is more informal: friends, days on the wall, and photographs made along the way.
            If you have an idea for a shoot or want to make something together, I’d love to hear it.
          </p>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <button type="button" className={`display ${styles.footerCta}`} onClick={openContact}>
            Have an idea? Get in touch <ArrowUpRight aria-hidden />
          </button>
          <ul className={styles.footerLinks}>
            <li><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
            {instagramAccounts.map((account) => (
              <li key={account.handle}>
                <a href={`https://instagram.com/${account.handle}`} target="_blank" rel="noopener noreferrer">
                  Instagram · {account.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.copyright}>© {new Date().getFullYear()} Michael Ting</p>
      </footer>
    </main>
  );
}
