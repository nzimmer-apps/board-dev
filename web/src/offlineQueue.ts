// Notes typed while offline wait here (in the browser's local storage) and are sent when the connection is back.
// Each queued row carries its own id, so sending the same row twice can never make a duplicate.

export type Store = Pick<Storage, 'getItem' | 'setItem'>;
export type QueuedRow = Record<string, unknown> & { id: string };

const KEY = 'board-offline-queue';

export function loadQueue(store: Store): QueuedRow[] {
  try {
    const v = JSON.parse(store.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string') : [];
  } catch {
    return [];
  }
}

function save(store: Store, rows: QueuedRow[]) {
  store.setItem(KEY, JSON.stringify(rows));
}

export function enqueue(store: Store, rows: QueuedRow[]): QueuedRow[] {
  const q = loadQueue(store);
  const next = [...q, ...rows.filter((r) => !q.some((x) => x.id === r.id))];
  save(store, next);
  return next;
}

// True when a failure means "could not reach the server" (worth retrying), not "the server said no".
export function isNetworkError(message: string | undefined | null): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|offline|timed out|fetch failed/i.test(message ?? '');
}

// Sends everything waiting. Rows that go through are removed; if one fails, it and the rest stay for next time.
// `send` returns an error message, or null on success.
export async function flushQueue(
  store: Store,
  send: (rows: QueuedRow[]) => Promise<string | null>,
): Promise<{ sent: number; left: number; error: string | null }> {
  const q = loadQueue(store);
  if (!q.length) return { sent: 0, left: 0, error: null };
  const error = await send(q);
  if (error) {
    // A rejected row (not a connection problem) would block the queue forever: drop it after reporting.
    if (!isNetworkError(error)) {
      save(store, []);
      return { sent: 0, left: 0, error };
    }
    return { sent: 0, left: q.length, error };
  }
  // Keep anything added while we were sending.
  const now = loadQueue(store).filter((r) => !q.some((x) => x.id === r.id));
  save(store, now);
  return { sent: q.length, left: now.length, error: null };
}

// Editing or deleting a note that hasn't been sent yet changes the waiting copy. Returns true if the id was queued.
export function patchQueued(store: Store, id: string, patch: Record<string, unknown> | null): boolean {
  const q = loadQueue(store);
  if (!q.some((r) => r.id === id)) return false;
  save(store, patch === null ? q.filter((r) => r.id !== id) : q.map((r) => (r.id === id ? { ...r, ...patch, id } : r)));
  return true;
}
