'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, type PointerEvent } from 'react';
import styles from './page.module.css';

export default function HubPage() {
  // Spotlight position for the next rAF tick. pointermove can fire several
  // times per frame; coalescing to the last event per frame keeps us to one
  // style write per frame.
  const pendingSpot = useRef<{ el: HTMLElement; mx: number; my: number } | null>(null);
  const rafSpot = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafSpot.current !== null) cancelAnimationFrame(rafSpot.current);
    };
  }, []);

  const setSpot = useCallback((el: HTMLElement, mx: number, my: number) => {
    el.style.setProperty('--mx', mx.toFixed(3));
    el.style.setProperty('--my', my.toFixed(3));
  }, []);

  const flushSpot = useCallback(() => {
    rafSpot.current = null;
    const spot = pendingSpot.current;
    pendingSpot.current = null;
    if (spot) setSpot(spot.el, spot.mx, spot.my);
  }, [setSpot]);

  const queueSpot = useCallback(
    (el: HTMLElement, mx: number, my: number) => {
      pendingSpot.current = { el, mx, my };
      if (rafSpot.current === null) rafSpot.current = requestAnimationFrame(flushSpot);
    },
    [flushSpot],
  );

  // Relative cursor position (0..1) within the half the pointer is over.
  const onHalfPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      queueSpot(
        e.currentTarget,
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      );
    },
    [queueSpot],
  );

  // Drop the spotlight back to center when the pointer leaves the split.
  // Direct writes here: pendingSpot is a single coalescing slot, so queueing
  // both halves would clobber the first reset before the rAF flush runs.
  const onSplitPointerLeave = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.querySelectorAll('[data-half]').forEach((half) => {
        setSpot(half as HTMLElement, 0.5, 0.5);
      });
    },
    [setSpot],
  );

  return (
    <main data-side="hub" className={styles.hub} id="main" tabIndex={-1}>
      <h1 className="srOnly">TingLingDing Photography</h1>
      <div className={styles.split} onPointerLeave={onSplitPointerLeave}>
        {/* UNDERWATER HALF
            The half is a div (not a link) so we can have the IG handle
            as a real <a> sibling without nesting <a> inside <a>.
            The main "enter" link is an absolutely-positioned <Link>
            covering the whole half; the IG hint sits above it via z-index. */}
        <div
          className={`${styles.half} ${styles.halfUnderwater}`}
          data-half="underwater"
          onPointerMove={onHalfPointerMove}
        >
          <div className={styles.halfBg} aria-hidden="true" />
          <Link
            href="/underwater/"
            className={styles.halfMainLink}
            aria-label="Enter underwater & nature"
          />
          <div className={styles.halfContent}>
            <h2 className={`display ${styles.halfTitle}`}>
              Underwater<br />&amp; Nature
            </h2>
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
        <div
          className={`${styles.half} ${styles.halfPortrait}`}
          data-half="portrait"
          onPointerMove={onHalfPointerMove}
        >
          <div className={styles.halfBg} aria-hidden="true" />
          <Link
            href="/portraits/"
            className={styles.halfMainLink}
            aria-label="Enter portraits"
          />
          <div className={styles.halfContent}>
            <h2 className={`display ${styles.halfTitle}`}>
              Portraits
            </h2>
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
