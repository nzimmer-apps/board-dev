// Tag management: rename, merge, recolour, delete, and a list of common tags to pick from.
import { useMemo, useState } from 'react';
import type { Item, TagColors } from './supabase';
import { COMMON_TAGS, TAG_COLORS } from './theme';
import ShareDialog from './ShareDialog';

interface Props {
  items: Item[];
  colors: TagColors;
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onColor: (name: string, color: string | null) => void;
  onOpen: (name: string) => void;
}

const clean = (s: string) => s.trim().replace(/^#+/, '').toLowerCase();
const VALID = /^[\p{L}\p{N}_-]{1,40}$/u;

export default function Tags({ items, colors, onRename, onDelete, onColor, onOpen }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mergeFrom, setMergeFrom] = useState<string | null>(null);
  const [palette, setPalette] = useState<string | null>(null);
  const [sort, setSort] = useState<'count' | 'name'>('count');
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState<string | null>(null);

  const tags = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((i) => i.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => (sort === 'count' ? b[1] - a[1] : 0) || a[0].localeCompare(b[0]));
  }, [items, sort]);
  const used = new Set(tags.map(([t]) => t));
  const untagged = items.filter((i) => !i.tags.length).length;

  async function run(f: () => Promise<void>) {
    setBusy(true);
    try { await f(); } finally { setBusy(false); setEditing(null); setMergeFrom(null); }
  }

  function rename(from: string) {
    const to = clean(name);
    if (!to || to === from) return setEditing(null);
    if (!VALID.test(to)) return alert('Tag names use letters, numbers, - and _ only (no spaces).');
    if (used.has(to) && !confirm(`#${to} already exists. Merge #${from} into it?`)) return;
    run(() => onRename(from, to));
  }

  return (
    <main className="tags-page">
      <div className="page-head">
        <h2>Tags</h2>
        <span className="muted small">{tags.length} tags · {untagged} notes without one</span>
        <span className="chips" style={{ marginLeft: 'auto' }}>
          <button className={sort === 'count' ? 'chip on' : 'chip'} onClick={() => setSort('count')}>Most used</button>
          <button className={sort === 'name' ? 'chip on' : 'chip'} onClick={() => setSort('name')}>A–Z</button>
        </span>
      </div>

      {tags.length === 0 && <p className="muted">No tags yet. Type <code>#work</code> in a note, or tap <b>#</b> next to the box on the Board.</p>}

      <ul className="tag-list">
        {tags.map(([t, n]) => (
          <li key={t}>
            <button className="swatch big" title="Change colour" aria-label={`Colour of ${t}`}
              style={{ background: colors[t] ?? 'transparent' }} onClick={() => setPalette(palette === t ? null : t)} />
            {editing === t ? (
              <form className="inline" onSubmit={(e) => { e.preventDefault(); rename(t); }}>
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" />
                <button className="primary small" disabled={busy}>Save</button>
                <button type="button" className="small" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : mergeFrom === t ? (
              <span className="inline">
                <span className="muted">Merge #{t} into</span>
                <select autoFocus defaultValue="" disabled={busy}
                  onChange={(e) => { const to = e.target.value; if (to && confirm(`Move all ${n} notes from #${t} to #${to}? #${t} will disappear.`)) run(() => onRename(t, to)); }}>
                  <option value="" disabled>choose a tag…</option>
                  {tags.filter(([x]) => x !== t).map(([x]) => <option key={x} value={x}>#{x}</option>)}
                </select>
                <button className="small" onClick={() => setMergeFrom(null)}>Cancel</button>
              </span>
            ) : (
              <>
                <button className="name" title="Show these notes" onClick={() => onOpen(t)}>#{t}</button>
                <span className="muted small">{n} {n === 1 ? 'note' : 'notes'}</span>
                <span className="acts">
                  <button className="small" title="Share every note with this tag" onClick={() => setSharing(t)}>👥 Share</button>
                  <button className="small" onClick={() => { setEditing(t); setName(t); setMergeFrom(null); }}>Rename</button>
                  {tags.length > 1 && <button className="small" onClick={() => { setMergeFrom(t); setEditing(null); }}>Merge</button>}
                  <button className="small danger" disabled={busy}
                    onClick={() => confirm(`Remove #${t} from ${n} ${n === 1 ? 'note' : 'notes'}? The notes themselves stay.`) && run(() => onDelete(t))}>
                    Delete
                  </button>
                </span>
              </>
            )}
            {palette === t && (
              <span className="palette">
                {TAG_COLORS.map((c) => (
                  <button key={c} className={colors[t] === c ? 'swatch big on' : 'swatch big'} style={{ background: c }} aria-label={c}
                    onClick={() => { onColor(t, c); setPalette(null); }} />
                ))}
                <button className="small" onClick={() => { onColor(t, null); setPalette(null); }}>No colour</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {sharing && <ShareDialog target={{ tag: sharing }} label={`#${sharing}`} onClose={() => setSharing(null)} />}

      <section className="suggest">
        <h2>Common tags</h2>
        <p className="muted small">
          The 20 tags people use most in a notes app. They're offered when you tap <b>#</b> on the Board; a tag starts to exist as soon as one note uses it.
        </p>
        <div className="chips wrap">
          {COMMON_TAGS.map((t) => (
            <span key={t} className={used.has(t) ? 'chip on' : 'chip ghost'}>#{t}</span>
          ))}
        </div>
      </section>
    </main>
  );
}
