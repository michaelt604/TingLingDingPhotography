import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactMailto, buildContactText, CONTACT_EMAIL } from '../app/components/contactMailto.ts';

test('buildContactMailto trims and encodes inquiry fields', () => {
  const href = buildContactMailto({
    name: '  Ada Lovelace  ',
    email: ' ada@example.com ',
    topic: ' Underwater session & prints ',
    timeframe: ' October 2026 ',
    location: ' Vancouver, BC ',
    message: '  Available next month?\nThank you.  ',
  });

  const url = new URL(href);
  assert.equal(url.protocol, 'mailto:');
  assert.equal(url.pathname, CONTACT_EMAIL);
  assert.equal(url.searchParams.get('subject'), 'Underwater session & prints');
  assert.equal(
    url.searchParams.get('body'),
    'Name: Ada Lovelace\nEmail: ada@example.com\nDate / timeframe: October 2026\nLocation: Vancouver, BC\n\nAvailable next month?\nThank you.',
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
  assert.equal(url.searchParams.get('body'), 'Email: person@example.com\n\nHello');
});

test('buildContactText matches the mailto body without URL encoding', () => {
  const draft = {
    name: '  Ada Lovelace  ',
    email: ' ada@example.com ',
    topic: ' Underwater session & prints ',
    timeframe: ' October 2026 ',
    location: ' Vancouver, BC ',
    message: '  Available next month?\nThank you.  ',
  };

  const href = buildContactMailto(draft);
  const body = new URL(href).searchParams.get('body');
  assert.equal(buildContactText(draft), body);
  assert.equal(
    buildContactText(draft),
    'Name: Ada Lovelace\nEmail: ada@example.com\nDate / timeframe: October 2026\nLocation: Vancouver, BC\n\nAvailable next month?\nThank you.',
  );
});

test('buildContactText omits untouched fields and caps a very long message', () => {
  assert.equal(
    buildContactText({
      name: '',
      email: 'person@example.com',
      topic: '   ',
      message: 'Hello',
    }),
    'Email: person@example.com\n\nHello',
  );
  const long = `x${'y'.repeat(2000)}`;
  const longDraft = { name: 'Ada', email: '', topic: 'Hi', message: long };
  const text = buildContactText(longDraft);
  assert.ok(text.length < `Name: Ada\n\n${long}`.length, 'caps a very long message');
  assert.equal(
    text,
    new URL(buildContactMailto(longDraft)).searchParams.get('body'),
    'capped text still matches the mailto body',
  );
});
