import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snoozeUntil } from './snooze.ts';

test('snooze times', () => {
  const now = new Date(2026, 10, 16, 22, 30);
  assert.equal(snoozeUntil('10m', now).getTime(), now.getTime() + 10 * 60e3);
  assert.equal(snoozeUntil('1h', now).getTime(), now.getTime() + 60 * 60e3);
  assert.equal(snoozeUntil('3h', now).getDate(), 17); // rolls past midnight
  const t = snoozeUntil('tomorrow', now);
  assert.deepEqual([t.getDate(), t.getHours(), t.getMinutes()], [17, 9, 0]);
});
