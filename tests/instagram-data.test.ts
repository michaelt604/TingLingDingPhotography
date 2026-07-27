import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeInstagramPosts } from '../app/components/instagramData.ts';

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
