import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lines, progress, toggle } from './checklist.ts';

const body = 'Groceries\n[ ] milk\n- [x] eggs\n* [] bread\nnot a [ ] box';

test('finds tick boxes in the usual spellings', () => {
  const l = lines(body);
  assert.deepEqual(l.map((x) => x.check?.done ?? null), [null, false, true, false, null]);
  assert.equal(l[1].check?.label, 'milk');
});

test('toggles one line and leaves the rest alone', () => {
  const once = toggle(body, 1);
  assert.equal(once.split('\n')[1], '[x] milk');
  assert.equal(toggle(once, 1), body);
  assert.equal(toggle(body, 2).split('\n')[2], '- [ ] eggs');
  assert.equal(toggle(body, 3).split('\n')[3], '* [x] bread');
  assert.equal(toggle(body, 0), body);
});

test('counts progress', () => {
  assert.deepEqual(progress(body), { done: 1, total: 3 });
  assert.equal(progress('no boxes here'), null);
});
