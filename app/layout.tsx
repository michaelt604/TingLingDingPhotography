import type { Metadata, Viewport } from 'next';
import { DM_Serif_Display, JetBrains_Mono, Outfit } from 'next/font/google';
import { ContactProvider } from './components/ContactProvider';
import './globals.css';

const dmSerif = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-dm-serif',
  display: 'swap',
});
const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-outfit',
  display: 'swap',
});
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

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
    images: [
      {
        url: '/og-default.png',
        width: 1200,
        height: 630,
        alt: 'TingLingDing Photography — underwater, nature, and portraits',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteName,
    description: siteDescription,
    images: ['/og-default.png'],
  },
  icons: {
    icon: '/brand-mark.png',
    apple: '/brand-mark.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#07111a',
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
    <html
      lang="en"
      className={`${dmSerif.variable} ${outfit.variable} ${jetBrainsMono.variable}`}
    >
      <body>
        {/* Skip link — visible only when keyboard-focused, jumps past the sticky nav. */}
        <a href="#main" className="skip-link">Skip to main content</a>
        <ContactProvider>{children}</ContactProvider>
      </body>
    </html>
  );
}
