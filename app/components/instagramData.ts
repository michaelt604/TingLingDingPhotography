export interface IGPost {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url: string;
  permalink: string;
  thumbnail_url?: string;
  caption?: string;
  timestamp: string;
}

const MEDIA_TYPES = new Set<IGPost['media_type']>([
  'IMAGE',
  'VIDEO',
  'CAROUSEL_ALBUM',
]);

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isInstagramHost(hostname: string): boolean {
  return hostname === 'instagram.com' || hostname.endsWith('.instagram.com');
}

function isInstagramMediaUrl(value: unknown): value is string {
  if (!isHttpsUrl(value)) return false;
  const hostname = new URL(value).hostname;
  return (
    hostname === 'cdninstagram.com' ||
    hostname.endsWith('.cdninstagram.com') ||
    hostname === 'fbcdn.net' ||
    hostname.endsWith('.fbcdn.net')
  );
}

export function normalizeInstagramPosts(payload: unknown): IGPost[] {
  if (!payload || typeof payload !== 'object') return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return data.filter((candidate): candidate is IGPost => {
    if (!candidate || typeof candidate !== 'object') return false;
    const post = candidate as Partial<IGPost>;
    return (
      typeof post.id === 'string' &&
      MEDIA_TYPES.has(post.media_type as IGPost['media_type']) &&
      isInstagramMediaUrl(post.media_url) &&
      isHttpsUrl(post.permalink) &&
      isInstagramHost(new URL(post.permalink).hostname) &&
      typeof post.timestamp === 'string' &&
      (post.thumbnail_url === undefined || isInstagramMediaUrl(post.thumbnail_url)) &&
      (post.caption === undefined || typeof post.caption === 'string')
    );
  });
}

export function mergeInstagramPosts<T extends IGPost>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const uniquePosts = new Map<string, T>();
  for (const post of [...existing, ...incoming]) {
    if (!uniquePosts.has(post.id)) uniquePosts.set(post.id, post);
  }

  return [...uniquePosts.values()].sort((left, right) => {
    const leftTime = Date.parse(left.timestamp);
    const rightTime = Date.parse(right.timestamp);
    const normalizedLeftTime = Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime;
    const normalizedRightTime = Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime;
    return normalizedRightTime - normalizedLeftTime || left.id.localeCompare(right.id);
  });
}
