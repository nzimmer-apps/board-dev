import { useEffect, useState } from 'react';
import { imageUrl } from './images';
import { fileUrl } from './files';
import ReminderPicker, { offsetLabel } from './Reminders';
import RepeatPicker from './RepeatPicker';
import { effectiveDue, nextOccurrence, repeatLabel, type Repeat } from './repeat';
import type { Item, TagColors } from './supabase';
import { lines, progress, toggle } from './checklist';

export function fmtDue(it: Pick<Item, 'due_at' | 'all_day'>) {
  if (!it.due_at) return '';
  const d = new Date(it.due_at);
  return d.toLocaleString([], {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    ...(it.all_day ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

/** A one-off dated note whose time has gone by and which hasn't been ticked off. */
export const hasPassed = (i: Item, now = Date.now()) =>
  !!i.due_at && !i.repeat && !i.done && !i.archived &&
  // all-day items count as passed once their day is over
  (i.all_day ? new Date(i.due_at).setHours(23, 59, 59) : new Date(i.due_at).getTime()) < now;

function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LINK_RE = /(https?:\/\/[^\s<>"]+)/g;

const Linked = ({ text }: { text: string }) => (
  <>{text.split(LINK_RE).map((p, i) =>
    i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : <span key={i}>{p}</span>,
  )}</>
);

function Body({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  const all = lines(text);
  if (!all.some((l) => l.check)) return <p className="body"><Linked text={text} /></p>;
  const p = progress(text)!;
  // Plain lines stay as they are; checklist lines become tick boxes.
  return (
    <div className="body">
      {all.map((l, i) =>
        l.check ? (
          <label key={i} className={l.check.done ? 'check done' : 'check'}>
            <input type="checkbox" checked={l.check.done} disabled={!onToggle} onChange={() => onToggle?.(i)} />
            <span><Linked text={l.check.label} /></span>
          </label>
        ) : (
          <div key={i} className="line">{l.text ? <Linked text={l.text} /> : ' '}</div>
        ),
      )}
      <div className="check-progress muted">{p.done}/{p.total} done</div>
    </div>
  );
}

function Picture({ path, onOpen }: { path: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; imageUrl(path).then((u) => live && setUrl(u)); return () => { live = false; }; }, [path]);
  if (!url) return <div className="pic loading" />;
  return <img className="pic" src={url} alt="" loading="lazy" onClick={() => onOpen(url)} />;
}

function Attachment({ item }: { item: Item }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let live = true; fileUrl(item.file_path!).then((u) => live && setUrl(u)); return () => { live = false; }; }, [item.file_path]);
  if (item.file_type === 'audio')
    return url ? <audio className="audio" controls preload="none" src={url} /> : <div className="file muted">🎙 Voice note…</div>;
  return (
    <a className="file" href={url ?? undefined} target="_blank" rel="noreferrer">
      <span aria-hidden>📄</span> {item.file_name || 'PDF'}
    </a>
  );
}

function FoundText({ text, label }: { text: string | null; label: string }) {
  const [open, setOpen] = useState(false);
  if (text === null) return <div className="ocr muted">Reading text…</div>;
  if (!text) return null;
  const short = text.length > 140 && !open;
  return (
    <div className="ocr" onClick={() => setOpen(!open)} title="Text Board read from the attachment (searchable)">
      <span className="ocr-label">{label}</span> {short ? text.slice(0, 140).replace(/\n/g, ' ') + '…' : text}
    </div>
  );
}

interface Props {
  item: Item;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  onRemove: (id: string) => void;
  onTag?: (t: string) => void;
  colors?: TagColors;
  /** Archive screen: show Restore / Delete instead of the usual actions. */
  archived?: boolean;
}

export default function Card({ item, onUpdate, onRemove, onTag, colors, archived }: Props) {
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [body, setBody] = useState(item.body);
  const [due, setDue] = useState(toLocalInput(item.due_at));
  const [tags, setTags] = useState(item.tags.join(' '));
  const [place, setPlace] = useState(item.location ?? '');
  const [remind, setRemind] = useState<number[]>(item.remind_offsets ?? [0]);
  const [repeat, setRepeat] = useState<Repeat | null>(item.repeat);
  // A repeating note shows its next occurrence, not the first one it was created with.
  const shownDue = effectiveDue(item);
  const overdue = shownDue && !item.done && new Date(shownDue) < new Date();
  const passed = !archived && hasPassed(item);
  const created = new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  function openEdit() {
    setBody(item.body);
    setDue(toLocalInput(item.due_at));
    setTags(item.tags.join(' '));
    setPlace(item.location ?? '');
    setRemind(item.remind_offsets ?? [0]);
    setRepeat(item.repeat);
    setEditing((e) => !e);
  }

  function save() {
    onUpdate(item.id, {
      body: body.trim() || item.body,
      due_at: due ? new Date(due).toISOString() : null,
      all_day: due ? item.all_day && due.endsWith('09:00') : false,
      kind: due ? item.kind ?? 'event' : null,
      tags: [...new Set(tags.split(/[\s,#]+/).map((t) => t.toLowerCase()).filter(Boolean))],
      remind_offsets: remind,
      repeat: due ? repeat : null,
      location: place.trim() || null,
    });
    setEditing(false);
  }

  // Repeating: "done" means done for this time, so move on to the next occurrence.
  function tick() {
    if (!item.repeat) return onUpdate(item.id, { done: !item.done });
    const cur = new Date(shownDue!);
    const next = nextOccurrence(new Date(item.due_at!), item.repeat, new Date(Math.max(Date.now(), cur.getTime()) + 60e3));
    if (next) onUpdate(item.id, { due_at: next.toISOString() });
  }

  const cls = ['card', item.pinned && 'pinned', item.done && 'done', item.tags.length && 'tagged', passed && 'passed'].filter(Boolean).join(' ');
  const tint = colors?.[item.tags.find((t) => colors[t]) ?? ''];

  return (
    <article className={cls} style={tint ? { borderLeftColor: tint, borderLeftWidth: 3 } : undefined}>
      <div className="meta">
        <span>{created}{item.source !== 'app' ? ` · ${item.source}` : ''}</span>
        {archived ? (
          <span className="actions">
            <button title="Put back on the board" onClick={() => onUpdate(item.id, { archived: false })}>↩ Restore</button>
            <button title="Delete permanently" className="danger" onClick={() => confirm('Delete this note permanently? This cannot be undone.') && onRemove(item.id)}>Delete</button>
          </span>
        ) : (
          <span className="actions">
            {item.due_at && (
              <button title={item.repeat ? 'Done for this time: skip to the next one' : item.done ? 'Mark not done' : 'Mark done'} onClick={tick}>
                {item.repeat ? '⏭' : item.done ? '↺' : '✓'}
              </button>
            )}
            <button title={item.pinned ? 'Unpin' : 'Pin'} onClick={() => onUpdate(item.id, { pinned: !item.pinned })}>
              {item.pinned ? '★' : '☆'}
            </button>
            <button title="Edit" onClick={openEdit}>✎</button>
            <button title="Archive" onClick={() => onUpdate(item.id, { archived: true })}>⌫</button>
          </span>
        )}
      </div>
      {item.tags.length > 0 && (
        <div className="tags">
          {item.tags.map((t) => (
            <button key={t} className="tag" style={colors?.[t] ? { background: `color-mix(in srgb, ${colors[t]} 25%, var(--panel))`, color: colors[t] } : undefined}
              onClick={() => onTag?.(t)}>#{t}</button>
          ))}
        </div>
      )}
      {editing ? (
        <div className="edit">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          <button type="button" className="small" title="Add a tick-box line" style={{ alignSelf: 'flex-start' }}
            onClick={() => setBody((b) => (b && !b.endsWith('\n') ? b + '\n' : b) + '[ ] ')}>☑ Add checklist item</button>
          <label>Date <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></label>
          {due && <label>Repeats <RepeatPicker value={repeat} onChange={setRepeat} day={new Date(due).getDay()} /></label>}
          {due && <ReminderPicker value={remind} onChange={setRemind} />}
          <label>Place <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Where it happens (optional)" /></label>
          <label>Tags <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="work llc" /></label>
          <div className="row">
            <button className="primary" onClick={save}>Save</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
            <button className="danger" onClick={() => confirm('Delete permanently?') && onRemove(item.id)}>Delete</button>
          </div>
        </div>
      ) : (
        item.body && <Body text={item.body} onToggle={archived ? undefined : (i) => onUpdate(item.id, { body: toggle(item.body, i) })} />
      )}
      {item.image_path && <Picture path={item.image_path} onOpen={setZoom} />}
      {item.file_path && <Attachment item={item} />}
      {(item.image_path || item.file_type === 'pdf') && !editing && <FoundText text={item.ocr_text} label="TEXT" />}
      {zoom && <div className="lightbox" onClick={() => setZoom(null)}><img src={zoom} alt="" /></div>}
      {item.location && !editing && (
        <a className="place" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}`} target="_blank" rel="noreferrer">
          📍 {item.location}
        </a>
      )}
      {shownDue && !editing && (
        <div className={overdue ? 'due overdue' : 'due'}>
          {item.kind === 'deadline' ? 'Due ' : item.kind === 'reminder' ? 'Remind ' : ''}
          {fmtDue({ due_at: shownDue, all_day: item.all_day })}
          {item.repeat && <span className="rep"> · 🔁 {repeatLabel(item.repeat)}</span>}
          {(item.remind_offsets ?? []).length > 0
            ? <span className="muted"> · 🔔 {(item.remind_offsets ?? []).map(offsetLabel).join(', ')}</span>
            : <span className="muted"> · 🔕</span>}
        </div>
      )}
      {passed && !editing && (
        <div className="passed-bar">
          <span className="muted">This has passed.</span>
          <button className="small" onClick={() => onUpdate(item.id, { archived: true })}>Archive</button>
          <button className="small" onClick={() => onUpdate(item.id, { done: true })}>Keep, mark done</button>
          <button className="small danger" onClick={() => confirm('Delete this note permanently?') && onRemove(item.id)}>Delete</button>
        </div>
      )}
    </article>
  );
}
