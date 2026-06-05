import type { ReactNode } from 'react';

export default function UnderwaterLayout({ children }: { children: ReactNode }) {
  return <div data-side="underwater">{children}</div>;
}
