import type { Metadata } from 'next';
import { SiteNav } from '../components/SiteNav';
import { InstagramFeed } from '../components/InstagramFeed';
import { Footer } from '../components/Footer';

export const metadata: Metadata = {
  title: 'Underwater & Nature',
  description:
    'Underwater and nature photography by TingLingDing. Cinematic, deep, full of blue.',
  alternates: { canonical: '/underwater/' },
  openGraph: {
    url: '/underwater/',
    images: ['/og-default.png'],
  },
};

const IG_HANDLE = 'tinglingdingphotography';
const IG_PROFILE_URL = `https://instagram.com/${IG_HANDLE}`;

export default function UnderwaterPage() {
  return (
    <>
      <SiteNav current="underwater" />

      <main id="main" tabIndex={-1}>
        <h1 className="srOnly">The world below the surface.</h1>

        {/* INSTAGRAM — main content */}
        <InstagramFeed
          handle={IG_HANDLE}
          profileUrl={IG_PROFILE_URL}
          side="underwater"
        />
      </main>

      <Footer side="underwater" igHandle={IG_HANDLE} igProfileUrl={IG_PROFILE_URL} />
    </>
  );
}
