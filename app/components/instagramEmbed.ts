const INSTAGRAM_POST_PATH = /^\/(p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/;

/**
 * Converts a public Instagram post permalink into Instagram's official
 * interactive embed URL. Returning null keeps untrusted or malformed URLs out
 * of the iframe boundary.
 */
export function getInstagramEmbedUrl(permalink: string): string | null {
  try {
    const url = new URL(permalink);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'instagram.com' && hostname !== 'www.instagram.com')) {
      return null;
    }

    const match = url.pathname.match(INSTAGRAM_POST_PATH);
    if (!match) return null;

    const [, kind, shortcode] = match;
    return `https://www.instagram.com/${kind}/${shortcode}/embed/`;
  } catch {
    return null;
  }
}
