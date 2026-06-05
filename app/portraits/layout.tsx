import type { ReactNode } from 'react';

export default function PortraitsLayout({ children }: { children: ReactNode }) {
  return <div data-side="portrait">{children}</div>;
}
