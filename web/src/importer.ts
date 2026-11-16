// Import notes from files: Board's own JSON backup or CSV, calendar files (.ics), Google Keep notes
// (Google Takeout JSON), and plain text / Markdown. Pure parsing here; inserting is done by the caller.
import type { Item } from './supabase.ts';
import type { Repeat } from './repeat.ts';

export type Row = Partial<Omit<Item, 'id'>> & { body: string };

export interface Parsed { rows: Row[]; kind: string; dropped: number }

const tagify = (s: string) => s.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40);
const clean = (tags: unknown) =>
  Array.isArray(tags) ? [...new Set(tags.map((t) => tagify(String(t))).filter(Boolean))] : [];
const iso = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ---------- Board JSON backup / Google Keep ----------

const KEEP = (o: Record<string, unknown>) => 'textContent' in o || 'listContent' in o || 'userEditedTimestampUsec' in o;

function fromBoard(o: Record<string, unknown>, ownPrefix: string | null): Row | null {
  const body = String(o.body ?? '').trim();
  const keepPath = (p: unknown) => (typeof p === 'string' && ownPrefix && p.startsWith(ownPrefix) ? p : null);
  const image_path = keepPath(o.image_path);
  const file_path = keepPath(o.file_path);
  if (!body && !o.image_path && !o.file_path && !o.ocr_text) return null;
  const row: Row = {
    // A picture or file note may have no text of its own; only make some up when the attachment can't come along.
    body: body || (image_path || file_path ? '' : String(o.file_name ?? '') || String(o.ocr_text ?? '').split('\n')[0].slice(0, 200) || 'Imported note'),
    url: typeof o.url === 'string' ? o.url : null,
    tags: clean(o.tags),
    due_at: iso(o.due_at),
    all_day: !!o.all_day,
    kind: ['event', 'deadline', 'reminder'].includes(String(o.kind)) ? (o.kind as Item['kind']) : null,
    done: !!o.done, pinned: !!o.pinned, archived: !!o.archived,
    created_at: iso(o.created_at) ?? undefined,
    location: typeof o.location === 'string' ? o.location : null,
    ocr_text: typeof o.ocr_text === 'string' ? o.ocr_text : null,
    remind_offsets: Array.isArray(o.remind_offsets) ? o.remind_offsets.map(Number).filter((n) => n >= 0).slice(0, 8) : undefined,
    repeat: o.repeat && typeof o.repeat === 'object' ? (o.repeat as Repeat) : null,
    image_path, file_path,
    file_type: file_path && (o.file_type === 'audio' || o.file_type === 'pdf') ? o.file_type : null,
    file_name: file_path && typeof o.file_name === 'string' ? o.file_name : null,
    source: 'import',
  };
  if (typeof o.duration_min === 'number' && o.duration_min > 0) row.duration_min = o.duration_min;
  if (!row.due_at) { row.kind = null; row.repeat = null; }
  return row;
}

function fromKeep(o: Record<string, unknown>): Row | null {
  if (o.isTrashed) return null;
  const title = String(o.title ?? '').trim();
  const list = Array.isArray(o.listContent)
    ? (o.listContent as { text?: string; isChecked?: boolean }[]).map((l) => `[${l.isChecked ? 'x' : ' '}] ${l.text ?? ''}`).join('\n')
    : '';
  const text = String(o.textContent ?? '').trim();
  const body = [title, text, list].filter(Boolean).join('\n');
  if (!body) return null;
  const usec = Number(o.createdTimestampUsec ?? o.userEditedTimestampUsec);
  const links = Array.isArray(o.annotations) ? (o.annotations as { url?: string }[]).map((a) => a.url).filter(Boolean) : [];
  return {
    body, source: 'import',
    tags: clean(Array.isArray(o.labels) ? (o.labels as { name?: string }[]).map((l) => l.name ?? '') : []),
    pinned: !!o.isPinned, archived: !!o.isArchived,
    url: (links[0] as string | undefined) ?? null,
    created_at: usec ? new Date(usec / 1000).toISOString() : undefined,
  };
}

export function parseJson(text: string, ownPrefix: string | null = null): Parsed {
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [data];
  let keep = 0;
  const rows: Row[] = [];
  let dropped = 0;
  for (const x of list) {
    if (!x || typeof x !== 'object') { dropped++; continue; }
    const o = x as Record<string, unknown>;
    const r = KEEP(o) ? (keep++, fromKeep(o)) : fromBoard(o, ownPrefix);
    if (r) rows.push(r); else dropped++;
  }
  return { rows, dropped, kind: keep ? 'Google Keep' : 'Board backup' };
}

// ---------- CSV (Board's own export, or any sheet with a text/title/note column) ----------

export function csvRows(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim()));
}

export function parseCsv(text: string): Parsed {
  const [head, ...data] = csvRows(text);
  if (!head) return { rows: [], dropped: 0, kind: 'CSV' };
  const h = head.map((x) => x.trim().toLowerCase());
  const col = (...names: string[]) => names.map((n) => h.indexOf(n)).find((i) => i >= 0) ?? -1;
  const ti = col('text', 'body', 'note', 'notes', 'title', 'content', 'subject');
  if (ti < 0) return { rows: [], dropped: data.length, kind: 'CSV' };
  const [tg, dt, ad, loc, link, done, pin, arch, created, len, kind] =
    [col('tags', 'labels', 'category'), col('date', 'due', 'start', 'start date'), col('all_day'), col('location', 'place'), col('link', 'url'),
      col('done', 'completed'), col('pinned'), col('archived'), col('created'), col('length_minutes'), col('kind')];
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').replace(/^'(?=[=+\-@])/, '').trim() : '');
  const yes = (v: string) => /^(true|yes|1|x)$/i.test(v);
  let dropped = 0;
  const rows: Row[] = [];
  for (const r of data) {
    const body = get(r, ti);
    if (!body) { dropped++; continue; }
    const due = iso(get(r, dt).replace(' ', 'T'));
    const k = get(r, kind);
    const row: Row = {
      body, source: 'import',
      tags: clean(get(r, tg).split(/[\s,;]+/)),
      due_at: due, all_day: due ? yes(get(r, ad)) : false,
      kind: due ? ((['event', 'deadline', 'reminder'].includes(k) ? k : 'event') as Item['kind']) : null,
      location: get(r, loc) || null, url: get(r, link) || null,
      done: yes(get(r, done)), pinned: yes(get(r, pin)), archived: yes(get(r, arch)),
      created_at: iso(get(r, created).replace(' ', 'T')) ?? undefined,
    };
    const mins = parseInt(get(r, len), 10);
    if (due && mins > 0) row.duration_min = mins;
    rows.push(row);
  }
  return { rows, dropped, kind: 'CSV' };
}

// ---------- Calendar files (.ics) ----------

const unfoldIcs = (t: string) => t.replace(/\r?\n[ \t]/g, '');
const icsText = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/** DTSTART value → instant. "Z" is UTC; floating and TZID times are read as this device's local time. */
function icsDate(v: string): { d: Date; allDay: boolean } | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4]) return { d: new Date(+m[1], +m[2] - 1, +m[3], 9), allDay: true };
  const parts = [+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)] as const;
  return { d: m[7] ? new Date(Date.UTC(...parts)) : new Date(...parts), allDay: false };
}

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function icsRepeat(rule: string): Repeat | null {
  const p = Object.fromEntries(rule.split(';').map((kv) => kv.split('=') as [string, string]));
  const FREQS: Record<string, Repeat['freq']> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  const freq = FREQS[p.FREQ ?? ''];
  if (!freq) return null;
  const r: Repeat = { freq, interval: Math.max(1, parseInt(p.INTERVAL ?? '1', 10) || 1) };
  if (freq === 'weekly' && p.BYDAY) {
    const days = p.BYDAY.split(',').map((x) => DAYS.indexOf(x.slice(-2))).filter((x) => x >= 0);
    if (days.length) r.days = days;
  }
  return r;
}

export function parseIcs(text: string): Parsed {
  const rows: Row[] = [];
  let dropped = 0;
  for (const block of unfoldIcs(text).split(/BEGIN:VEVENT/).slice(1)) {
    const ev = block.split(/END:VEVENT/)[0];
    const props = new Map<string, { params: string; value: string }[]>();
    for (const line of ev.split(/\r?\n/)) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (m) props.set(m[1], [...(props.get(m[1]) ?? []), { params: m[2], value: m[3] }]);
    }
    const one = (k: string) => props.get(k)?.[0]?.value;
    const start = one('DTSTART') ? icsDate(one('DTSTART')!) : null;
    const title = icsText(one('SUMMARY') ?? '').trim();
    if (!start || !title || /CANCELLED/i.test(one('STATUS') ?? '')) { dropped++; continue; }
    const desc = icsText(one('DESCRIPTION') ?? '').trim();
    const row: Row = {
      body: [title, desc].filter(Boolean).join('\n').slice(0, 20000), source: 'import',
      due_at: start.d.toISOString(), all_day: start.allDay, kind: 'event', tags: ['event'],
      location: icsText(one('LOCATION') ?? '').trim() || null,
      url: one('URL') ?? null,
    };
    const end = one('DTEND') ? icsDate(one('DTEND')!) : null;
    if (end) {
      const mins = Math.round((end.d.getTime() - start.d.getTime()) / 60e3);
      // A one-day all-day event is just "all day", not a length.
      if (mins > 0 && mins <= 43200 && !(start.allDay && mins <= 1440)) row.duration_min = mins;
    }
    const rr = one('RRULE');
    if (rr && !/UNTIL|COUNT/.test(rr)) row.repeat = icsRepeat(rr);
    if (row.repeat) {
      const skip = (props.get('EXDATE') ?? []).flatMap((x) => x.value.split(',')).map(icsDate).filter(Boolean)
        .map((x) => { const d = x!.d; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
      if (skip.length) row.repeat.skip = [...new Set(skip)].sort();
    }
    rows.push(row);
  }
  return { rows, dropped, kind: 'calendar' };
}

// ---------- Plain text / Markdown ----------

/** Board's Markdown export, or any notes file: "## #tag" headings + "- " bullets, else one note per paragraph. */
export function parseText(text: string): Parsed {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const bullets = lines.filter((l) => /^\s*[-*]\s+/.test(l)).length;
  const rows: Row[] = [];
  if (bullets >= 2 && bullets >= lines.filter((l) => l.trim() && !/^#/.test(l) && !/^\s{2,}/.test(l)).length / 2) {
    let tag: string | null = null;
    let cur: Row | null = null;
    for (const l of lines) {
      const hd = l.match(/^#{1,6}\s+(.*)$/);
      if (hd) { const t = hd[1].trim(); tag = /^#\S+$/.test(t) ? tagify(t) : null; cur = null; continue; }
      const b = l.match(/^\s*[-*]\s+(?:\[( |x)\]\s+)?(.*)$/i);
      if (b && !/^\s{2,}_/.test(l)) {
        cur = { body: b[2].trim(), tags: tag ? [tag] : [], source: 'import', done: b[1]?.toLowerCase() === 'x' };
        if (cur.body) rows.push(cur);
      } else if (cur && /^\s{2,}\S/.test(l) && !/^\s{2,}_.*_\s*$/.test(l)) cur.body += '\n' + l.trim();
    }
  } else {
    for (const para of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
      const body = para.trim();
      if (body && !/^# Board export$/.test(body)) rows.push({ body: body.slice(0, 20000), tags: [], source: 'import' });
    }
  }
  return { rows, dropped: 0, kind: 'text' };
}

/** Pick a parser from the file name and contents. */
export function parseFile(name: string, text: string, ownPrefix: string | null = null): Parsed {
  const n = name.toLowerCase();
  if (n.endsWith('.ics') || /^BEGIN:VCALENDAR/m.test(text.slice(0, 200))) return parseIcs(text);
  if (n.endsWith('.json') || /^\s*[[{]/.test(text)) return parseJson(text, ownPrefix);
  if (n.endsWith('.csv')) return parseCsv(text);
  return parseText(text);
}

/** Same text, date and attachment = same note, so importing a file twice adds nothing the second time. */
export const sameKey = (r: { body: string; due_at?: string | null; image_path?: string | null; file_path?: string | null }) =>
  `${r.body.trim().replace(/\s+/g, ' ').toLowerCase()}|${r.due_at ? new Date(r.due_at).getTime() : ''}|${r.image_path ?? r.file_path ?? ''}`;
