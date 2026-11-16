import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueue, loadQueue, flushQueue, isNetworkError, type Store } from './offlineQueue.ts';

const mem = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

test('queue keeps notes in order and ignores repeats of the same id', () => {
  const s = mem();
  enqueue(s, [{ id: 'a', body: 'one' }]);
  enqueue(s, [{ id: 'a', body: 'one' }, { id: 'b', body: 'two' }]);
  assert.deepEqual(loadQueue(s).map((r) => r.id), ['a', 'b']);
});

test('broken storage reads as an empty queue', () => {
  assert.deepEqual(loadQueue({ getItem: () => '{nope', setItem() {} }), []);
});

test('flush sends everything and empties the queue', async () => {
  const s = mem();
  enqueue(s, [{ id: 'a' }, { id: 'b' }]);
  let got = 0;
  const r = await flushQueue(s, async (rows) => { got = rows.length; return null; });
  assert.equal(got, 2);
  assert.deepEqual(r, { sent: 2, left: 0, error: null });
  assert.equal(loadQueue(s).length, 0);
});

test('a connection failure keeps the notes for next time', async () => {
  const s = mem();
  enqueue(s, [{ id: 'a' }]);
  const r = await flushQueue(s, async () => 'Failed to fetch');
  assert.equal(r.left, 1);
  assert.equal(loadQueue(s).length, 1);
});

test('a server rejection is reported and does not block the queue forever', async () => {
  const s = mem();
  enqueue(s, [{ id: 'a' }]);
  const r = await flushQueue(s, async () => 'new row violates check constraint');
  assert.equal(r.error, 'new row violates check constraint');
  assert.equal(loadQueue(s).length, 0);
});

test('notes added during a send survive it', async () => {
  const s = mem();
  enqueue(s, [{ id: 'a' }]);
  const r = await flushQueue(s, async () => { enqueue(s, [{ id: 'late' }]); return null; });
  assert.equal(r.left, 1);
  assert.deepEqual(loadQueue(s).map((x) => x.id), ['late']);
});

test('isNetworkError recognises browser offline messages', () => {
  assert.ok(isNetworkError('TypeError: Failed to fetch'));
  assert.ok(isNetworkError('Load failed'));
  assert.ok(!isNetworkError('permission denied'));
});

test('editing or deleting a waiting note changes the waiting copy', async () => {
  const { patchQueued } = await import('./offlineQueue.ts');
  const s = mem();
  enqueue(s, [{ id: 'a', body: 'old' }, { id: 'b' }]);
  assert.ok(patchQueued(s, 'a', { body: 'new', done: true }));
  assert.equal(loadQueue(s)[0].body, 'new');
  assert.ok(patchQueued(s, 'b', null));
  assert.deepEqual(loadQueue(s).map((r) => r.id), ['a']);
  assert.ok(!patchQueued(s, 'zzz', { body: 'x' }));
});
