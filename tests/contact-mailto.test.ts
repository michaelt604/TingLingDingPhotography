import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactMailto, CONTACT_EMAIL } from '../app/components/contactMailto.ts';

test('buildContactMailto trims and encodes inquiry fields', () => {
  const href = buildContactMailto({
    name: '  Ada Lovelace  ',
    email: ' ada@example.com ',
    topic: ' Underwater session & prints ',
    message: '  Available next month?\nThank you.  ',
  });

  const url = new URL(href);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, CONTACT_EMAIL);
  assert.equal(url.searchParams.get('subject'), 'Underwater session & prints');
  assert.equal(
    url.searchParams.get('body'),
    'Name: Ada Lovelace\nEmail: ada@example.com\n\nAvailable next month?\nThank you.',
  );
});

test('buildContactMailto uses a useful default subject', () => {
  const href = buildContactMailto({
    name: '',
    email: 'person@example.com',
    topic: '   ',
    message: 'Hello',
  });

  const url = new URL(href);
  assert.equal(url.searchParams.get('subject'), 'Inquiry from your photography site');
});
