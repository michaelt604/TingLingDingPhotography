'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react/dist/ssr';
import { Contact } from './Contact';
import { lockBodyScroll } from './bodyScrollLock';
import { useContact } from './ContactProvider';
import { useDialogIsolation } from './dialogIsolation';
import styles from './ContactModal.module.css';

const EXIT_MS = 160;

interface Props {
  open: boolean;
  onClose: () => void;
  side: 'underwater' | 'portraits' | 'climbing' | 'hub';
}

/**
 * ContactModal
 * Renders the controlled Contact form inside a dialog. Triggered by the
 * "Get in touch" pill in the header (see ContactProvider). The draft lives
 * in ContactProvider and is passed through, so the text survives Esc / X /
 * backdrop close and SPA navigation, starts empty on reload, and is never
 * cleared when the mailto link opens.
 *
 * Rendered via portal into #dialog-host (a sibling of #app-content, see
 * root layout), so the useDialogIsolation call below can mark #app-content
 * inert while this stays interactive.
 *
 * Accessibility:
 *  - Closes on backdrop click, X button, or ESC
 *  - Locks body scroll while open (ref-counted, safe with stacked dialogs)
 *  - Focuses the first form input on open
 *  - Traps Tab within the dialog
 *  - Returns focus to the trigger element on close
 *  - role="dialog" + aria-modal="true" for screen readers
 */
export function ContactModal({ open, onClose, side }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const { draft, setDraft } = useContact();
  // Stays mounted briefly after close so the exit can play; focus and inert are released immediately.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setHost(document.getElementById('dialog-host'));
  }, []);

  // Keep #app-content inert while open. Declared BEFORE the focus effect
  // below on purpose: same-component cleanups run in declaration order, so
  // inert is removed before the focus-restore cleanup runs. (When this lived
  // in the provider, the child's restore ran first and focus() into the
  // still-inert subtree was a silent no-op.)
  useDialogIsolation(open);

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
      // Restore focus to the trigger. Inert on #app-content is already
      // removed by the isolation cleanup above, so this lands. No-ops when
      // the trigger is gone (route change while open).
      const trigger = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [open, onClose]);

  if (!open && !mounted) return null;

  const node = (
    <div
      className={styles.overlay}
      data-side={side === 'portraits' ? 'portrait' : side}
      data-closing={open ? undefined : ''}
      inert={!open}
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
          <X size={20} aria-hidden />
        </button>

        <Contact
          heading="Get in touch"
          headingId="contact-modal-title"
          draft={draft}
          onDraftChange={setDraft}
        />
      </div>
    </div>
  );

  if (host) return createPortal(node, host);
  return node;
}
