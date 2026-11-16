// Repeating items. An item's due_at is its first occurrence; the rule says how it repeats.
// Everything here works in local time, so "7 PM every Monday" stays 7 PM across clock changes.

export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export interface Repeat {
  freq: Freq;
  interval: number; // every N days / weeks / months / years
  days?: number[]; // weekly only: 0 = Sunday … 6 = Saturday
  /** Dates left out ("YYYY-MM-DD", local): skipped, or moved to a separate one-off note. */
  skip?: string[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Local calendar day of an occurrence, the key used in Repeat.skip. */
export const dayKey = (d: Date) => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());

/** The rule with one date skipped (or un-skipped). */
export function withSkip(r: Repeat, d: Date, skip = true): Repeat {
  const k = dayKey(d);
  const rest = (r.skip ?? []).filter((x) => x !== k);
  const next = skip ? [...rest, k].sort() : rest;
  const { skip: _old, ...base } = r;
  return next.length ? { ...base, skip: next } : base;
}

const DAY = 864e5;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) => Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / DAY);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Occurrences with from <= t < to (never before the first one). */
export function occurrences(start: Date, r: Repeat | null | undefined, from: Date, to: Date, max = 400): Date[] {
  if (!r) return start >= from && start < to ? [start] : [];
  const out: Date[] = [];
  const iv = Math.max(1, Math.floor(r.interval || 1));
  const h = start.getHours();
  const mi = start.getMinutes();
  const skip = new Set(r.skip ?? []);
  const push = (d: Date) => { if (d >= start && d >= from && d < to && !skip.has(dayKey(d))) out.push(d); };

  if (r.freq === 'daily' || r.freq === 'weekly') {
    const days = r.freq === 'weekly' ? (r.days?.length ? r.days : [start.getDay()]) : null;
    // Weekly counts whole weeks from the Sunday of the first week, so "every 2 weeks" keeps Mon and Thu together.
    const base = days ? new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay()) : dayStart(start);
    const end = dayDiff(base, to) + 1;
    for (let n = Math.max(0, dayDiff(base, from) - 1); n <= end && out.length < max; n++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n, h, mi);
      if (days ? Math.floor(n / 7) % iv !== 0 || !days.includes(d.getDay()) : n % iv !== 0) continue;
      push(d);
    }
  } else {
    const step = r.freq === 'monthly' ? iv : iv * 12;
    const months = (from.getFullYear() - start.getFullYear()) * 12 + from.getMonth() - start.getMonth();
    for (let k = Math.max(0, Math.floor(months / step) - 1); out.length < max; k++) {
      const m0 = new Date(start.getFullYear(), start.getMonth() + k * step, 1);
      const last = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate();
      // The 31st in a 30-day month lands on the last day.
      const d = new Date(m0.getFullYear(), m0.getMonth(), Math.min(start.getDate(), last), h, mi);
      if (d >= to) break;
      push(d);
    }
  }
  return out;
}

/** First occurrence at or after `after`. */
export function nextOccurrence(start: Date, r: Repeat | null | undefined, after: Date): Date | null {
  if (!r) return start >= after ? start : null;
  const iv = Math.max(1, Math.floor(r.interval || 1));
  const from = after > start ? after : start;
  // Widen the search by one period per upcoming skipped date, so skips never hide the next real one.
  const ahead = (r.skip ?? []).filter((k) => k >= dayKey(from)).length;
  const span = { daily: iv + 1, weekly: iv * 7 + 7, monthly: iv * 31 + 31, yearly: iv * 366 + 366 }[r.freq] * DAY * (1 + ahead);
  return occurrences(start, r, from, new Date(from.getTime() + span), 1)[0] ?? null;
}

/**
 * The date an item should show and notify for: a repeating item rolls forward to its next occurrence
 * once the current one has passed.
 */
export function effectiveDue(it: { due_at: string | null; repeat?: Repeat | null }, now: Date = new Date()): string | null {
  if (!it.due_at || !it.repeat) return it.due_at;
  const start = new Date(it.due_at);
  return (nextOccurrence(start, it.repeat, now) ?? start).toISOString();
}

export function repeatLabel(r: Repeat | null | undefined): string {
  if (!r) return '';
  const iv = Math.max(1, r.interval || 1);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  const every = iv === 1 ? `Every ${unit}` : `Every ${iv} ${unit}s`;
  if (r.freq !== 'weekly' || !r.days?.length) return every;
  const days = [...r.days].sort((a, b) => a - b);
  if (days.join() === '1,2,3,4,5' && iv === 1) return 'Every weekday';
  const names = days.map((d) => DOW[d]).join(', ');
  return iv === 1 ? `Every ${names}` : `${every} on ${names}`;
}

/** iCalendar RRULE value, for calendar export. */
export function rrule(r: Repeat): string {
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly' && r.days?.length)
    parts.push(`BYDAY=${[...r.days].sort((a, b) => a - b).map((d) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][d]).join(',')}`);
  return parts.join(';');
}
