'use client';

import type { ReactNode } from 'react';
import { useContact } from './ContactProvider';

interface Props {
  children: ReactNode;
  className?: string;
  /** Optional override for the rendered tag — defaults to <button> */
  as?: 'button' | 'a';
}

/**
 * GetInTouchButton
 * A button that opens the global contact modal (see ContactProvider).
 * Use this anywhere on the site where a "Get in touch" CTA makes sense —
 * the modal is mounted at the root and available on every page.
 */
export function GetInTouchButton({ children, className, as = 'button' }: Props) {
  const { open } = useContact();

  if (as === 'a') {
    return (
      <a
        href="#contact"
        onClick={(e) => {
          e.preventDefault();
          open();
        }}
        className={className}
        role="button"
      >
        {children}
      </a>
    );
  }

  return (
    <button type="button" onClick={open} className={className}>
      {children}
    </button>
  );
}
