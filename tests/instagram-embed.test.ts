import assert from 'node:assert/strict';
import test from 'node:test';

import { getInstagramEmbedUrl } from '../app/components/instagramEmbed.ts';

test('builds official embed URLs for supported Instagram post permalinks', () => {
  assert.equal(
    getInstagramEmbedUrl('https://www.instagram.com/p/Da5vra1AGcv/'),
    'https://www.instagram.com/p/Da5vra1AGcv/embed/',
  );
  assert.equal(
    getInstagramEmbedUrl('https://instagram.com/reel/ABC_123-xy?utm_source=ig_web_copy_link'),
    'https://www.instagram.com/reel/ABC_123-xy/embed/',
  );
});

test('rejects URLs that are not trusted Instagram post permalinks', () => {
  const invalid = [
    'http://www.instagram.com/p/Da5vra1AGcv/',
    'https://evil.example/p/Da5vra1AGcv/',
    'https://www.instagram.com.evil.example/p/Da5vra1AGcv/',
    'https://www.instagram.com/tinglingdingportraits/',
    'javascript:alert(1)',
    'not a url',
  ];

  for (const value of invalid) {
    assert.equal(getInstagramEmbedUrl(value), null, value);
  }
});
