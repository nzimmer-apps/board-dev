// Checklists inside a note: lines written as "[ ] milk" or "- [x] eggs" show as tick boxes.
// The note text stays the single source of truth, so checklists sync, search and export like any note.

const LINE_RE = /^(\s*(?:[-*]\s+)?)\[( |x|X)?\](\s+)(.*)$/;

export interface Line { text: string; check: null | { done: boolean; label: string } }

export function lines(body: string): Line[] {
  return body.split('\n').map((text) => {
    const m = text.match(LINE_RE);
    return { text, check: m ? { done: !!m[2] && m[2] !== ' ', label: m[4] } : null };
  });
}

/** Tick or untick the checkbox on line `index`; other lines are left exactly as they were. */
export function toggle(body: string, index: number): string {
  const all = body.split('\n');
  const m = all[index]?.match(LINE_RE);
  if (!m) return body;
  const done = !!m[2] && m[2] !== ' ';
  all[index] = `${m[1]}[${done ? ' ' : 'x'}]${m[3]}${m[4]}`;
  return all.join('\n');
}

export function progress(body: string): { done: number; total: number } | null {
  const checks = lines(body).filter((l) => l.check);
  return checks.length ? { done: checks.filter((l) => l.check!.done).length, total: checks.length } : null;
}
