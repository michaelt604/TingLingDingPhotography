'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
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

  const value: ContactContextValue = {
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };

  return (
    <ContactContext.Provider value={value}>
      {children}
      <ContactModal open={isOpen} onClose={() => setIsOpen(false)} />
    </ContactContext.Provider>
  );
}

export function useContact() {
  const ctx = useContext(ContactContext);
  if (!ctx) throw new Error('useContact must be used within ContactProvider');
  return ctx;
}
