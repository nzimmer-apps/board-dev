// Export everything (including the archive) as JSON, CSV, Markdown or an .ics calendar file.
import { supabase, ITEM_COLS, type Item } from './supabase';
import { repeatLabel, rrule } from './repeat';

export type Format = 'json' | 'csv' | 'md' | 'ics';
export const FORMATS: { id: Format; name: string; hint: string }[] = [
  { id: 'json', name: 'Full backup (JSON)', hint: 'Every field of every note. Best for safekeeping or moving to another tool.' },
  { id: 'csv', name: 'Spreadsheet (CSV)', hint: 'Opens in Excel or Google Sheets, one row per note.' },
  { id: 'md', name: 'Readable notes (Markdown)', hint: 'Plain text grouped by tag. Pastes well into Notion, Obsidian or a document.' },
  { id: 'ics', name: 'Calendar file (.ics)', hint: 'Dated notes only, with repeats and warnings. Import into Google Calendar, Outlook or Apple Calendar.' },
];

export async function fetchAll(): Promise<Item[]> {
  const out: Item[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('items').select(ITEM_COLS).order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Item[]));
    if (!data || data.length < 1000) return out;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const local = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function toCsv(items: Item[]): string {
  const cols = ['created', 'text', 'tags', 'date', 'all_day', 'length_minutes', 'kind', 'repeats', 'notify_minutes_before', 'location', 'link', 'done', 'pinned', 'archived', 'attachment', 'text_in_attachment'];
  // A leading = + - @ would run as a formula in a spreadsheet: neutralise it.
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = items.map((i) => [
    local(i.created_at), i.body, i.tags.join(' '), i.due_at ? local(i.due_at) : '', i.all_day, i.duration_min ?? '', i.kind ?? '', repeatLabel(i.repeat),
    (i.remind_offsets ?? []).join(' '), i.location ?? '', i.url ?? '', i.done, i.pinned, i.archived,
    i.image_path ? 'image' : i.file_type ?? '', i.ocr_text ?? '',
  ]);
  return '\uFEFF' + [cols, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function toMarkdown(items: Item[]): string {
  const groups = new Map<string, Item[]>();
  for (const i of items) for (const t of i.tags.length ? i.tags : ['untagged']) groups.set(t, [...(groups.get(t) ?? []), i]);
  const names = [...groups.keys()].sort((a, b) => (a === 'untagged' ? 1 : b === 'untagged' ? -1 : a.localeCompare(b)));
  const line = (i: Item) => {
    const bits = [
      i.due_at ? `📅 ${local(i.due_at)}${i.repeat ? ` (${repeatLabel(i.repeat).toLowerCase()})` : ''}` : '',
      i.location ? `📍 ${i.location}` : '',
      i.image_path ? '🖼 image' : i.file_type === 'audio' ? '🎙 voice note' : i.file_type === 'pdf' ? `📄 ${i.file_name ?? 'PDF'}` : '',
      i.archived ? 'archived' : '',
    ].filter(Boolean);
    const text = (i.body || i.ocr_text?.split('\n')[0] || '(no text)').replace(/\n/g, '\n  ');
    return `- ${i.due_at ? (i.done ? '[x] ' : '[ ] ') : ''}${text}${bits.length ? `\n  _${bits.join(' · ')}_` : ''}`;
  };
  return `# Board export\n\n_${items.length} notes · ${local(new Date().toISOString())}_\n\n` +
    names.map((n) => `## ${n === 'untagged' ? 'Untagged' : '#' + n}\n\n${groups.get(n)!.map(line).join('\n')}\n`).join('\n');
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
// Lines over 75 bytes must be folded; fold by characters, conservatively.
const fold = (l: string) => (l.length <= 70 ? l : l.match(/.{1,70}/gu)!.join('\r\n '));
const icsLocal = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsUtc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/** Dated, un-archived notes as calendar events. Times are "floating": they show at the same clock time wherever imported. */
export function toIcs(items: Item[]): string {
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Board//Board export//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Board'];
  for (const i of items) {
    if (!i.due_at || i.archived) continue;
    const d = new Date(i.due_at);
    const title = i.body.split('\n')[0] || i.file_name || 'Board note';
    out.push('BEGIN:VEVENT', `UID:${i.id}@board`, `DTSTAMP:${icsUtc(new Date())}`);
    if (i.all_day) {
      const days = Math.max(1, Math.round((i.duration_min ?? 0) / 1440));
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
      out.push(`DTSTART;VALUE=DATE:${icsLocal(d).slice(0, 8)}`, `DTEND;VALUE=DATE:${icsLocal(next).slice(0, 8)}`);
    } else {
      // No length given: an hour, the usual calendar default.
      out.push(`DTSTART:${icsLocal(d)}`, `DTEND:${icsLocal(new Date(d.getTime() + (i.duration_min ?? 60) * 60e3))}`);
    }
    if (i.repeat) out.push(`RRULE:${rrule(i.repeat)}`);
    out.push(`SUMMARY:${icsText(title)}`);
    const desc = [i.body.split('\n').slice(1).join('\n'), i.tags.length ? '#' + i.tags.join(' #') : ''].filter(Boolean).join('\n');
    if (desc) out.push(`DESCRIPTION:${icsText(desc)}`);
    if (i.location) out.push(`LOCATION:${icsText(i.location)}`);
    if (i.url) out.push(`URL:${i.url}`);
    for (const m of i.remind_offsets ?? []) out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, `TRIGGER:-PT${m}M`, 'END:VALARM');
    out.push('END:VEVENT');
  }
  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}

export function build(format: Format, items: Item[]): { name: string; mime: string; text: string } {
  const day = local(new Date().toISOString()).slice(0, 10);
  if (format === 'json') return { name: `board-${day}.json`, mime: 'application/json', text: JSON.stringify({ exported_at: new Date().toISOString(), items }, null, 2) };
  if (format === 'csv') return { name: `board-${day}.csv`, mime: 'text/csv', text: toCsv(items) };
  if (format === 'md') return { name: `board-${day}.md`, mime: 'text/markdown', text: toMarkdown(items) };
  return { name: `board-${day}.ics`, mime: 'text/calendar', text: toIcs(items) };
}

/** Hand the file to the device: the share sheet where there is one for files (phones), a download elsewhere. */
export async function save(file: { name: string; mime: string; text: string }): Promise<'shared' | 'downloaded'> {
  const blob = new Blob([file.text], { type: `${file.mime};charset=utf-8` });
  const f = new File([blob], file.name, { type: file.mime });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [f] })) {
    try { await navigator.share({ files: [f], title: file.name }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'shared'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return 'downloaded';
}
