import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, parseAll, parseRows } from './parse.ts';

// Thursday 2026-11-12 10:00 local
const NOW = new Date(2026, 10, 12, 10, 0, 0);
const at = (iso: string | null) => { const d = new Date(iso!); return [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; };

test('time ranges give a start and a length', () => {
  const a = parseInput('band practice sat 7-10pm', NOW);
  assert.deepEqual(at(a.due_at), [11, 14, 19, 0]);
  assert.equal(a.duration, 180);
  assert.equal(a.body, 'band practice sat 7-10pm');

  const b = parseInput('dentist friday from 2 to 3:30pm', NOW);
  assert.deepEqual(at(b.due_at), [11, 13, 14, 0]);
  assert.equal(b.duration, 90);

  const c = parseInput('brunch sun 11-1pm', NOW); // 11 am to 1 pm
  assert.deepEqual(at(c.due_at), [11, 15, 11, 0]);
  assert.equal(c.duration, 120);

  const d = parseInput('shift fri 10pm-6am', NOW); // overnight
  assert.equal(d.duration, 480);
});

test('"for 2 hours" and friends', () => {
  const a = parseInput('workshop tomorrow 6pm for 2 hours', NOW);
  assert.deepEqual(at(a.due_at), [11, 13, 18, 0]);
  assert.equal(a.duration, 120);
  assert.equal(a.body, 'workshop tomorrow 6pm for 2 hours');
  assert.equal(parseInput('call mum sat 2pm for an hour', NOW).duration, 60);
  assert.equal(parseInput('standup mon 9am for 15 min', NOW).duration, 15);
  assert.equal(parseInput('nap sat 3pm for half an hour', NOW).duration, 30);
});

test('multi-day dates become an all-day length', () => {
  const a = parseInput('craft fair Dec 5 - Dec 7', NOW);
  assert.equal(a.all_day, true);
  assert.equal(a.duration, 2 * 1440);
});

test('no length without a date, and none when not said', () => {
  assert.equal(parseInput('read for 2 hours', NOW).duration, null);
  assert.equal(parseInput('lunch fri 1pm', NOW).duration, null);
  assert.equal(parseInput('call 555-1234', NOW).duration, null);
});

test('repeating events keep their length', () => {
  const [r] = parseAll('league every thursday 7-10pm', NOW);
  assert.deepEqual(r.repeat, { freq: 'weekly', interval: 1, days: [4] });
  assert.deepEqual(at(r.due_at), [11, 12, 19, 0]);
  assert.equal(r.duration, 180);
});

test('parseRows stores the length as duration_min', () => {
  const [r] = parseRows('gym mon 6-7am', NOW) as Record<string, unknown>[];
  assert.equal(r.duration_min, 60);
  assert.equal('duration' in r, false);
  const [s] = parseRows('plain note', NOW) as Record<string, unknown>[];
  assert.equal('duration_min' in s, false);
});
