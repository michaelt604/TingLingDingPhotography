'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { ContactModal } from './ContactModal';
import type { ContactDraft } from './contactMailto';

const EMPTY_DRAFT: ContactDraft = {
  name: '',
  email: '',
  timeframe: '',
  location: '',
  topic: '',
  message: '',
};

interface ContactContextValue {
  /** The shared inquiry draft. Empty strings on reload; never persisted. */
  draft: ContactDraft;
  /** Merges a partial update into the draft. Never clears on mailto open. */
  setDraft: (patch: Partial<ContactDraft>) => void;
  /** Whether the contact dialog is open. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

/**
 * Wave 2 contract for a controlled Contact form. Defined here so Wave 2
 * can adopt it without changing the provider shape; Contact stays
 * self-contained until then.
 */
export interface ContactControlledProps {
  draft: ContactDraft;
  onDraftChange: (patch: Partial<ContactDraft>) => void;
  heading?: string;
  headingId?: string;
  side?: 'underwater' | 'portraits' | 'climbing' | 'hub';
}

const ContactContext = createContext<ContactContextValue | null>(null);

/**
 * ContactProvider
 * Owns the contact dialog state: the shared draft plus open/close.
 * The draft starts empty, survives close/reopen and SPA navigation
 * (state lives at the root layout), and is never cleared when the
 * mailto link opens. Wraps the whole app from the root layout, so the
 * header's "Get in touch" pill can open it from any page.
 */
export function ContactProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<ContactDraft>(EMPTY_DRAFT);
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const side = pathname.startsWith('/underwater')
    ? 'underwater'
    : pathname.startsWith('/portraits')
      ? 'portraits'
      : pathname.startsWith('/climbing')
        ? 'climbing'
        : 'hub';

  // Inert isolation lives in ContactModal, ordered before its focus restore.

  const setDraft = useCallback(
    (patch: Partial<ContactDraft>) =>
      setDraftState((prev) => ({ ...prev, ...patch })),
    [],
  );

  // Stable identity: ContactModal's [open, onClose] effect re-runs whenever
  // this component re-renders while open, so an inline arrow would re-trigger
  // its focus restore/cleanup on every render.
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo<ContactContextValue>(
    () => ({ draft, setDraft, isOpen, open, close }),
    [draft, setDraft, isOpen, open, close],
  );

  return (
    <ContactContext.Provider value={value}>
      {children}
      <ContactModal
        open={isOpen}
        onClose={close}
        side={side}
      />
    </ContactContext.Provider>
  );
}

export function useContact() {
  const ctx = useContext(ContactContext);
  if (!ctx) throw new Error('useContact must be used within ContactProvider');
  return ctx;
}
