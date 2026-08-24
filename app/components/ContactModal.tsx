'use client';

import { useEffect, useRef } from 'react';
import { Contact } from './Contact';
import { lockBodyScroll } from './bodyScrollLock';
import styles from './ContactModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  side: 'underwater' | 'portraits';
}

/**
 * ContactModal
 * Renders the Contact form inside a dialog. Triggered by the
 * "Get in touch" pill in the header (see ContactProvider).
 *
 * Accessibility:
 *  - Closes on backdrop click, X button, or ESC
 *  - Locks body scroll while open
 *  - Focuses the first form input on open
 *  - Traps Tab within the dialog
 *  - Returns focus to the trigger element on close
 *  - role="dialog" + aria-modal="true" for screen readers
 */
export function ContactModal({ open, onClose, side }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    // Remember what was focused so we can restore on close
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    // Lock body scroll while modal is open
    const unlockBody = lockBodyScroll();

    // Move focus into the dialog (first form input, fall back to dialog itself)
    const dialog = dialogRef.current;
    if (dialog) {
      // Defer to next tick so the dialog is mounted and focusable
      requestAnimationFrame(() => {
        const focusable = dialog.querySelector<HTMLElement>(
          'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
        );
        // Skip the close button — focus the first field so the user can start typing
        const firstInput = dialog.querySelector<HTMLElement>(
          'input, textarea, select'
        );
        (firstInput ?? focusable ?? dialog).focus();
      });
    }

    // Handle ESC + Tab focus trap
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'input, textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);

      if (focusable.length === 0) return;

      // Length > 0 guarantees these are defined, but with
      // noUncheckedIndexedAccess TS doesn't know that.
      const [first] = focusable;
      const last = focusable.at(-1);
      if (!first || !last) return;
      const active = document.activeElement as HTMLElement;

      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      unlockBody();
      window.removeEventListener('keydown', onKey);
      // Restore focus to whatever opened the modal
      previouslyFocusedRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      data-side={side === 'underwater' ? 'underwater' : 'portrait'}
      role="presentation"
    >
      <button
        type="button"
        className={styles.backdrop}
        onClick={onClose}
        tabIndex={-1}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-modal-title"
        tabIndex={-1}
      >
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close contact form"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>

        <Contact
          heading="Get in touch"
          headingId="contact-modal-title"
          side={side}
        />
      </div>
    </div>
  );
}
