import type { Metadata } from 'next';
import { SiteNav } from '../components/SiteNav';
import { InstagramFeed } from '../components/InstagramFeed';
import { Footer } from '../components/Footer';

export const metadata: Metadata = {
  title: 'Portraits',
  description:
    'Portrait photography by TingLingDing. Intimate, considered, made for faces.',
  alternates: { canonical: '/portraits/' },
  openGraph: {
    url: '/portraits/',
    images: [{ url: '/og-portraits.png', width: 1200, height: 630, alt: 'Portrait photography' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og-portraits.png'] },
};

const IG_HANDLE = 'tinglingdingportraits';
const IG_PROFILE_URL = `https://instagram.com/${IG_HANDLE}`;

export default function PortraitsPage() {
  return (
    <>
      <SiteNav current="portraits" />

      <main id="main" tabIndex={-1}>
        {/* INSTAGRAM — main content */}
        <InstagramFeed
          handle={IG_HANDLE}
          profileUrl={IG_PROFILE_URL}
          side="portraits"
        />
      </main>

      <Footer side="portraits" igHandle={IG_HANDLE} igProfileUrl={IG_PROFILE_URL} />
    </>
  );
}
