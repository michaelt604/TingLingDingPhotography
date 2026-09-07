import type { ReactNode } from 'react';

export default function ClimbingLayout({ children }: { children: ReactNode }) {
	return <div data-side="climbing">{children}</div>;
}
