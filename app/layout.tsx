import type { Metadata, Viewport } from 'next';
import { ContactProvider } from './components/ContactProvider';
import './globals.css';

const siteUrl = 'https://tinglingdingphotography.com';
const siteName = 'TingLingDing Photography';
const siteDescription =
  'TingLingDing — photography across two worlds. Underwater & nature, and portraits.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteName,
    template: `%s · ${siteName}`,
  },
  description: siteDescription,
  applicationName: siteName,
  authors: [{ name: 'TingLingDing' }],
  keywords: [
    'underwater photography',
    'nature photography',
    'portrait photography',
    'TingLingDing',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName,
    title: siteName,
    description: siteDescription,
    url: siteUrl,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteName,
    description: siteDescription,
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a1424',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Serif+Display&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        {/* Skip link — visible only when keyboard-focused, jumps past the sticky nav. */}
        <a href="#main" className="skip-link">Skip to main content</a>
        <ContactProvider>{children}</ContactProvider>
      </body>
    </html>
  );
}
