import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occurrences, nextOccurrence, effectiveDue, withSkip, dayKey, rrule, type Repeat } from './repeat.ts';

const d = (y: number, m: number, day: number, h = 0, mi = 0) => new Date(y, m - 1, day, h, mi);
// Dart league: Mondays and Thursdays 7 PM, from Mon 2026-11-16.
const START = d(2026, 11, 16, 19);
const RULE: Repeat = { freq: 'weekly', interval: 1, days: [1, 4] };

test('a skipped date drops out of the list', () => {
  const r = withSkip(RULE, d(2026, 11, 19, 19));
  assert.deepEqual(r.skip, ['2026-11-19']);
  const got = occurrences(START, r, d(2026, 11, 16), d(2026, 11, 27)).map(dayKey);
  assert.deepEqual(got, ['2026-11-16', '2026-11-23', '2026-11-26']);
});

test('next occurrence jumps over skipped dates, even several in a row', () => {
  let r = withSkip(RULE, d(2026, 11, 19));
  r = withSkip(r, d(2026, 11, 23));
  r = withSkip(r, d(2026, 11, 26));
  assert.equal(dayKey(nextOccurrence(START, r, d(2026, 11, 17))!), '2026-11-30');
  assert.equal(dayKey(new Date(effectiveDue({ due_at: START.toISOString(), repeat: r }, d(2026, 11, 17))!)), '2026-11-30');
});

test('un-skipping puts it back and drops the empty list', () => {
  const r = withSkip(withSkip(RULE, d(2026, 11, 19)), d(2026, 11, 19), false);
  assert.deepEqual(r, RULE);
  assert.equal('skip' in r, false);
});

test('skips do not change the RRULE text', () => {
  assert.equal(rrule(withSkip(RULE, d(2026, 11, 19))), 'FREQ=WEEKLY;BYDAY=MO,TH');
});
