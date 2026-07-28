import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeInstagramPosts,
  normalizeInstagramPosts,
  type IGPost,
} from '../app/components/instagramData.ts';
import { getInstagramFeedDisplayState } from '../app/components/instagramFeedState.ts';

test('normalizeInstagramPosts keeps only valid HTTPS Instagram posts', () => {
  const posts = normalizeInstagramPosts({
    data: [
      {
        id: '1',
        media_type: 'IMAGE',
        media_url: 'https://cdninstagram.com/image.jpg',
        permalink: 'https://www.instagram.com/p/example/',
        timestamp: '2026-07-26T00:00:00Z',
      },
      {
        id: '2',
        media_type: 'IMAGE',
        media_url: 'javascript:alert(1)',
        permalink: 'https://example.com/not-instagram',
        timestamp: '2026-07-26T00:00:00Z',
      },
      {
        id: '3',
        media_type: 'IMAGE',
        media_url: 'https://cdninstagram.com/image.jpg',
        permalink: 'https://evilinstagram.com/p/lookalike/',
        timestamp: '2026-07-26T00:00:00Z',
      },
      {
        id: '4',
        media_type: 'IMAGE',
        media_url: 'https://images.example.com/not-allowed.jpg',
        permalink: 'https://instagram.com/p/example/',
        timestamp: '2026-07-26T00:00:00Z',
      },
    ],
  });

  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.id, '1');
});

test('normalizeInstagramPosts rejects malformed payloads', () => {
  assert.deepEqual(normalizeInstagramPosts(null), []);
  assert.deepEqual(normalizeInstagramPosts({ data: 'not-an-array' }), []);
});

test('mergeInstagramPosts globally sorts and dedupes accumulated pages', () => {
  const post = (id: string, timestamp: string): IGPost => ({
    id,
    media_type: 'IMAGE',
    media_url: `https://cdninstagram.com/${id}.jpg`,
    permalink: `https://www.instagram.com/p/${id}/`,
    timestamp,
  });

  const firstPage = [
    post('newest-owned', '2026-07-28T12:00:00Z'),
    post('duplicate', '2026-07-28T10:00:00Z'),
  ];
  const secondPage = [
    post('collaborative-between-pages', '2026-07-28T11:00:00Z'),
    post('duplicate', '2026-07-28T10:00:00Z'),
    post('oldest', 'invalid'),
  ];

  assert.deepEqual(
    mergeInstagramPosts(firstPage, secondPage).map(({ id }) => id),
    ['newest-owned', 'collaborative-between-pages', 'duplicate', 'oldest'],
  );
});

test('an empty initial page keeps pagination visible when a retry cursor exists', () => {
  assert.deepEqual(
    getInstagramFeedDisplayState({
      hasProxy: true,
      postCount: 0,
      nextCursor: 'collaborative-retry',
      hasInitialLoaded: true,
    }),
    {
      showRealPosts: false,
      showPlaceholder: false,
      showPagination: true,
    },
  );
});
