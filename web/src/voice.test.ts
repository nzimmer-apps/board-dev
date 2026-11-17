import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planVoice, spokenTags, isPlaceholderBody } from './voice.ts';

const now = new Date(2026, 10, 17, 12, 0); // Tue 17 Nov 2026, noon

test('day + time in what was said books it', () => {
  const p = planVoice('Dentist appointment next Tuesday at 3 pm', '', [0], now);
  assert.ok(p.booking);
  const d = new Date(p.booking!.due_at);
  assert.equal(d.getDate(), 24);
  assert.equal(d.getHours(), 15);
  assert.equal(p.booking!.kind, 'event');
  assert.deepEqual(p.booking!.remind_offsets, [0]);
  assert.equal(p.ask, null);
  assert.equal(p.body, 'Dentist appointment next Tuesday at 3 pm');
});

test('a day without a time is only suggested', () => {
  const p = planVoice('call mom tomorrow', '', [0], now);
  assert.equal(p.booking, null);
  assert.ok(p.ask);
  assert.equal(p.ask!.all_day, true);
});

test('no date: just a note', () => {
  const p = planVoice('pick up milk and eggs', '', [0], now);
  assert.equal(p.booking, null);
  assert.equal(p.ask, null);
  assert.equal(p.body, 'pick up milk and eggs');
});

test('spoken hashtags become tags', () => {
  assert.equal(spokenTags('league night hashtag Darts'), 'league night #darts');
  const p = planVoice('Darts league Thursday at 7:30 pm hash tag darts', '', [0], now);
  assert.deepEqual(p.tags, ['darts']);
  assert.equal(p.body, 'Darts league Thursday at 7:30 pm');
  assert.equal(new Date(p.booking!.due_at).getHours(), 19);
});

test('typed caption and spoken reminder times are used', () => {
  const p = planVoice('meeting with Sam November 20th at 10 am, notify me 1 hour before', '#work', [0], now);
  assert.deepEqual(p.tags, ['work']);
  assert.deepEqual(p.booking!.remind_offsets, [60]);
  assert.equal(new Date(p.booking!.due_at).getDate(), 20);
});

test('time ranges keep their length', () => {
  const p = planVoice('party Saturday 7 to 10 pm', '', [0], now);
  assert.equal(p.booking!.duration_min, 180);
});

test('silence gives an empty plan', () => {
  assert.deepEqual(planVoice('  ', '', [0], now), { body: '', tags: [], url: null, booking: null, ask: null });
});

test('placeholder bodies are recognised', () => {
  assert.ok(isPlaceholderBody('Voice note · Nov 17, 6:10 AM', 'Voice note 0:12'));
  assert.ok(isPlaceholderBody('memo.m4a', 'memo.m4a'));
  assert.ok(isPlaceholderBody('Audio note', null));
  assert.ok(!isPlaceholderBody('Grocery list', 'Voice note 0:12'));
});
