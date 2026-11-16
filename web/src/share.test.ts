import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFor, describe, linkUrl, matches, newToken, normEmail, tokenFromSearch, validEmail, type Share } from './share.ts';

const base: Share = {
  id: 's', owner_id: 'owner', owner_email: 'o@x.com', item_id: null, tag: null,
  recipient_email: 'me@x.com', token: null, can_edit: false, created_at: '2026-11-16T00:00:00Z',
};
const note = { id: 'n1', tags: ['groceries'], user_id: 'owner' };

test('emails are compared without case or spaces', () => {
  assert.equal(normEmail('  Me@X.com '), 'me@x.com');
  assert.ok(validEmail(' a@b.co '));
  assert.ok(!validEmail('a@b'));
  assert.ok(!validEmail('not an email'));
});

test('tokens are long, URL-safe and different each time', () => {
  const a = newToken(), b = newToken();
  assert.equal(a.length, 24);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
});

test('link address keeps the app path and drops anything else', () => {
  assert.equal(linkUrl('abcdefghijklmnopqrstuvwx', 'https://h.io/board-dev/?share=1#more'), 'https://h.io/board-dev/?shared=abcdefghijklmnopqrstuvwx');
  assert.equal(tokenFromSearch('?shared=abcdefghijklmnopqrstuvwx'), 'abcdefghijklmnopqrstuvwx');
  assert.equal(tokenFromSearch('?shared=short'), null);
  assert.equal(tokenFromSearch('?shared=<script>aaaaaaaaaaaaaaaaaaaa'), null);
  assert.equal(tokenFromSearch(''), null);
});

test('a note shared directly can be looked at', () => {
  assert.equal(accessFor(note, [{ ...base, item_id: 'n1' }], 'ME@x.com'), 1);
});

test('a note is shared through its tag, and edit wins over look', () => {
  assert.equal(accessFor(note, [{ ...base, tag: 'groceries', can_edit: true }], 'me@x.com'), 2);
  assert.equal(accessFor(note, [{ ...base, item_id: 'n1' }, { ...base, tag: 'groceries', can_edit: true }], 'me@x.com'), 2);
});

test('shares for someone else, another owner, another tag or a link give no access', () => {
  assert.equal(accessFor(note, [{ ...base, item_id: 'n1', recipient_email: 'other@x.com' }], 'me@x.com'), 0);
  assert.equal(accessFor(note, [{ ...base, item_id: 'n1', owner_id: 'someone' }], 'me@x.com'), 0);
  assert.equal(accessFor(note, [{ ...base, tag: 'work' }], 'me@x.com'), 0);
  assert.equal(accessFor(note, [{ ...base, item_id: 'n1', recipient_email: null, token: 'abcdefghijklmnopqrstuvwx' }], 'me@x.com'), 0);
});

test('matches and describe', () => {
  assert.ok(matches({ item_id: 'n1', tag: null }, { item_id: 'n1' }));
  assert.ok(!matches({ item_id: null, tag: 'a' }, { item_id: 'n1' }));
  assert.ok(matches({ item_id: null, tag: 'a' }, { tag: 'a' }));
  assert.equal(describe({ ...base, can_edit: true }), 'me@x.com · can edit');
  assert.equal(describe({ ...base, recipient_email: null, token: 'abcdefghijklmnopqrstuvwx' }), 'Anyone with the link · can look');
});
