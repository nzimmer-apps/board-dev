import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item, TagColors } from './supabase';
import Card, { fmtDue, fmtRange, hasPassed } from './Card';
import ReminderPicker, { offsetLabel } from './Reminders';
import { parseAll } from './parse';
import { effectiveDue, occurrences, repeatLabel } from './repeat';
import { canRecord, useRecorder } from './files';
import { COMMON_TAGS } from './theme';

interface Props {
  items: Item[];
  colors: TagColors;
  onAdd: (raw: string, source?: string, remind?: number[]) => Promise<boolean>;
  onAddFile: (file: Blob, caption: string, source?: string, remind?: number[]) => Promise<boolean>;
  onAddVoice: (audio: Blob, transcript: string, caption: string, seconds: number) => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  onRemove: (id: string) => void;
  onInsert?: (row: Partial<Item>) => Promise<boolean>;
  onError: (msg: string) => void;
  /** Set from the Tags screen to open the board filtered to one tag. */
  jump?: { tag: string; n: number } | null;
}

const ACCEPT = 'image/*,application/pdf,audio/*';
const isAttachable = (f: File) => f.type.startsWith('image/') || f.type.startsWith('audio/') || f.type === 'application/pdf';
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Board({ items, colors, jump, onAdd, onAddFile, onAddVoice, onUpdate, onRemove, onInsert, onError }: Props) {
  const [draft, setDraft] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  useEffect(() => { if (jump) { setTag(jump.tag); setQ(''); } }, [jump]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [remind, setRemind] = useState<number[]>([0]);
  const [picking, setPicking] = useState(false);
  // Live preview: show the detected dates, repeats and notification choices while typing.
  const preview = useMemo(() => (draft.trim() ? parseAll(draft).filter((p) => p.due_at) : []), [draft]);
  const typedRemind = preview[0]?.remind ?? null;

  const rec = useRecorder((audio, transcript, seconds) => {
    const caption = draft.trim();
    setDraft('');
    onAddVoice(audio, transcript, caption, seconds);
  }, onError);

  // Attachments use the typed text (if any) as their caption, so "#receipts" + a photo is filed under receipts.
  async function addFiles(files: Iterable<File>) {
    const ok = [...files].filter(isAttachable);
    if (!ok.length) return;
    const caption = draft.trim();
    setDraft('');
    for (const f of ok) await onAddFile(f, caption, 'app', remind);
    setRemind([0]);
  }

  useEffect(() => {
    const f = () => setTimeout(() => inputRef.current?.focus(), 50);
    window.addEventListener('board-focus-capture', f);
    return () => window.removeEventListener('board-focus-capture', f);
  }, []);

  // Android widget: "note" = ready to type, "voice" = start recording.
  const startRec = useRef(rec.start);
  startRec.current = rec.start;
  useEffect(() => {
    const q = (e: Event) => {
      const mode = (e as CustomEvent<string>).detail;
      if (mode === 'voice' && canRecord) setTimeout(() => startRec.current(), 150);
      else setTimeout(() => inputRef.current?.focus(), 150);
    };
    window.addEventListener('board-quick', q);
    return () => window.removeEventListener('board-quick', q);
  }, []);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  // Re-evaluate "passed" / "upcoming" as time moves on, without waiting for a data change.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60e3); return () => window.clearInterval(t); }, []);

  // Every occurrence in the coming week, so a Mon + Thu repeat shows both days.
  const upcoming = useMemo(() => {
    const from = new Date(now);
    const to = new Date(now + 7 * 864e5);
    return items
      .filter((i) => i.due_at && !i.done)
      .flatMap((i) => occurrences(new Date(i.due_at!), i.repeat, from, to, 14).map((at) => ({ i, due: at.toISOString() })))
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 10);
  }, [items, now]);

  const passed = useMemo(
    () => items.filter((i) => hasPassed(i, now)).sort((a, b) => b.due_at!.localeCompare(a.due_at!)),
    [items, now],
  );

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((i) => !tag || i.tags.includes(tag))
      .filter((i) => {
        if (!terms.length) return true;
        const hay = `${i.body} ${i.ocr_text ?? ''} ${i.url ?? ''} ${i.location ?? ''} ${i.file_name ?? ''} ${i.tags.map((t) => '#' + t).join(' ')} ${fmtDue({ due_at: effectiveDue(i), all_day: i.all_day })} ${repeatLabel(i.repeat)}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
  }, [items, q, tag]);

  async function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    const ok = await onAdd(text, 'app', remind);
    if (!ok) setDraft(text);
    else setRemind([0]);
    inputRef.current?.focus();
  }

  // Quick tags: the ones already in use first, then common ones not used yet.
  const used = tagCounts.map(([t]) => t);
  const quick = [...used, ...COMMON_TAGS.filter((t) => !used.includes(t))].slice(0, 30);
  const addTag = (t: string) => {
    if (new RegExp(`(^|\\s)#${t}(\\s|$)`, 'i').test(draft)) return;
    setDraft((d) => `${d.trimEnd()}${d.trim() ? ' ' : ''}#${t} `);
    inputRef.current?.focus();
  };

  return (
    <main>
      <div
        className={dragging ? 'capture dragging' : 'capture'}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
      >
        <textarea
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some(isAttachable)) { e.preventDefault(); addFiles(files); }
          }}
          ref={inputRef}
          value={draft}
          rows={2}
          placeholder="Type anything…  #tag  ·  'call John fri 3pm'  ·  'darts every mon 7pm, notify 2 hours before'"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <div className="capture-btns">
          <button title="Quick tags" aria-pressed={picking} className={picking ? 'on' : ''} onClick={() => setPicking((p) => !p)}>#</button>
          <button title="Attach images, screenshots, PDFs or audio (or paste / drop them)" onClick={() => fileRef.current?.click()}>📎</button>
          {canRecord && !rec.recording && <button title="Record a voice note" onClick={rec.start}>🎙</button>}
          <button className="primary" onClick={submit} disabled={!draft.trim()}>Add</button>
        </div>
      </div>

      {rec.recording && (
        <div className="recording" role="status">
          <span className="dot" /> Recording {clock(rec.seconds)}
          <button className="primary small" onClick={rec.stop}>Stop &amp; save</button>
          <button className="small" onClick={rec.cancel}>Discard</button>
        </div>
      )}

      {picking && (
        <div className="chips quick">
          {quick.map((t) => (
            <button key={t} className={used.includes(t) ? 'chip' : 'chip ghost'} onClick={() => addTag(t)}>#{t}</button>
          ))}
        </div>
      )}

      {preview.length > 0 && (
        <div className="preview">
          {preview.map((p, n) => (
            <span className="when" key={n}>
              {p.kind === 'deadline' ? 'Due ' : p.kind === 'reminder' ? 'Remind ' : '📅 '}
              {fmtDue(p)}
              {p.repeat && ` · 🔁 ${repeatLabel(p.repeat)}`}
            </span>
          ))}
          {preview[0].tags.length > 0 && <span className="muted">#{preview[0].tags.join(' #')}</span>}
          {typedRemind
            ? <span className="muted">🔔 {typedRemind.map((m) => (m === 0 ? 'at time' : `${offsetLabel(m)} before`)).join(', ')}</span>
            : <ReminderPicker value={remind} onChange={setRemind} />}
        </div>
      )}

      <div className="filters">
        <input className="search" type="search" placeholder="Search text, #tags, places or dates…" value={q}
          onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button className={!tag ? 'chip on' : 'chip'} onClick={() => setTag(null)}>All {items.length}</button>
          {tagCounts.map(([t, n]) => (
            <button key={t} className={tag === t ? 'chip on' : 'chip'} onClick={() => setTag(tag === t ? null : t)}>
              {colors[t] && <span className="swatch" style={{ background: colors[t] }} />}#{t} <span className="muted">{n}</span>
            </button>
          ))}
        </div>
      </div>

      {passed.length > 0 && !q && !tag && (
        <section className="upcoming passed-list">
          <h2>
            Passed · {passed.length}
            {passed.length > 1 && (
              <button className="small" onClick={() => confirm(`Archive all ${passed.length} passed items? You can restore them from Archive.`) && passed.forEach((i) => onUpdate(i.id, { archived: true }))}>
                Archive all
              </button>
            )}
          </h2>
          <ul>
            {passed.slice(0, 6).map((i) => (
              <li key={i.id}>
                <span className="when">{fmtRange(i)}</span>
                <span className="what">{i.body.split('\n')[0] || i.file_name || 'Attachment'}</span>
                <span className="acts">
                  <button className="small" title="Move to Archive" onClick={() => onUpdate(i.id, { archived: true })}>Archive</button>
                  <button className="small" title="Keep it on the board, ticked off" onClick={() => onUpdate(i.id, { done: true })}>Done</button>
                  <button className="small danger" title="Delete permanently" onClick={() => confirm('Delete this note permanently?') && onRemove(i.id)}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
          {passed.length > 6 && <p className="muted small">…and {passed.length - 6} more below.</p>}
        </section>
      )}

      {upcoming.length > 0 && !q && !tag && (
        <section className="upcoming">
          <h2>Next 7 days</h2>
          <ul>
            {upcoming.map(({ i, due }) => (
              <li key={i.id + due}>
                {i.repeat
                  ? <span className="tick" title={repeatLabel(i.repeat)}>🔁</span>
                  : <button className="tick" title="Mark done" onClick={() => onUpdate(i.id, { done: true })}>○</button>}
                <span className="when">{fmtRange({ due_at: due, all_day: i.all_day, duration_min: i.duration_min })}</span>
                <span className="what">{i.body.split('\n')[0] || i.file_name || 'Attachment'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="empty muted">{items.length ? 'Nothing matches.' : 'Your board is empty. Add your first thought above, or share something to Board from any app.'}</p>
      ) : (
        <div className="grid">
          {shown.map((i) => (
            <Card key={i.id} item={i} colors={colors} onUpdate={onUpdate} onRemove={onRemove} onInsert={onInsert} onTag={setTag} />
          ))}
        </div>
      )}
    </main>
  );
}
