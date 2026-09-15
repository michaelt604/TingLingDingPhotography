'use client';

import { useEffect } from 'react';

/**
 * useDialogIsolation
 * While `open`, marks #app-content inert so focus and assistive tech stay
 * inside the dialog layer. #dialog-host is a sibling of #app-content, never
 * a descendant, so portaled dialogs stay interactive. Restores the prior
 * inert state on cleanup — rapid close, unmount, and route change safe.
 */
export function useDialogIsolation(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    if (typeof document === 'undefined') return;
    const content = document.getElementById('app-content');
    if (!content) return;
    const hadInert = content.hasAttribute('inert');
    const previousValue = content.getAttribute('inert');
    content.setAttribute('inert', '');
    return () => {
      if (hadInert) {
        content.setAttribute('inert', previousValue ?? '');
      } else {
        content.removeAttribute('inert');
      }
    };
  }, [open]);
}
