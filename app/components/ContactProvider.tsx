'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import { ContactModal } from './ContactModal';

interface ContactContextValue {
  open: () => void;
  close: () => void;
}

const ContactContext = createContext<ContactContextValue | null>(null);

/**
 * ContactProvider
 * Holds the open/close state for the contact modal.
 * Wraps the whole app from the root layout, so the header's
 * "Get in touch" pill can open it from any page.
 */
export function ContactProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const side = pathname.startsWith('/underwater') ? 'underwater' : 'portraits';

  // Stable identity: ContactModal's [open, onClose] effect re-runs whenever
  // this component re-renders while open, so an inline arrow would re-trigger
  // its focus restore/cleanup on every render.
  const close = useCallback(() => setIsOpen(false), []);

  const value: ContactContextValue = {
    open: () => setIsOpen(true),
    close,
  };

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
