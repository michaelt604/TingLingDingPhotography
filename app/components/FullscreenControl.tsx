'use client';

import { useEffect, useState, type RefObject } from 'react';
import styles from './FullscreenControl.module.css';

export function FullscreenControl({ targetRef }: { targetRef: RefObject<HTMLDivElement | null> }) {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setAvailable(Boolean(document.fullscreenEnabled && targetRef.current?.requestFullscreen));
    const update = () => setActive(document.fullscreenElement === targetRef.current);
    document.addEventListener('fullscreenchange', update);
    update();
    return () => document.removeEventListener('fullscreenchange', update);
  }, [targetRef]);
  if (!available) return null;
  const toggle = async () => {
    setError('');
    try {
      if (document.fullscreenElement === targetRef.current) await document.exitFullscreen();
      else await targetRef.current?.requestFullscreen();
    } catch {
      setError('Fullscreen is unavailable. You can still browse here.');
    }
  };
  return <>
    <button type="button" className={styles.button} onClick={toggle} aria-label={active ? 'Exit fullscreen' : 'Enter fullscreen'} title={active ? 'Exit fullscreen' : 'Enter fullscreen'}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d={active ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'} />
      </svg>
    </button>
    {error && <p role="status" className={styles.error}>{error}</p>}
  </>;
}
