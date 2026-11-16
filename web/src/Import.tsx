// Import notes from files. Shows what was found before anything is saved.
import { useRef, useState } from 'react';
import { parseFile, sameKey, type Row } from './importer';
import { fetchAll } from './export';
import { supabase } from './supabase';

interface Found { name: string; kind: string; rows: Row[]; dropped: number; error?: string }

export default function Import({ flash, onImported }: { flash: (m: string) => void; onImported: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [fresh, setFresh] = useState<Row[]>([]);
  const [dupes, setDupes] = useState(0);
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const { data } = await supabase.auth.getUser();
      const own = data.user ? `${data.user.id}/` : null;
      const out: Found[] = [];
      for (const f of Array.from(files).slice(0, 500)) {
        if (f.size > 20e6) { out.push({ name: f.name, kind: '', rows: [], dropped: 0, error: 'too big (over 20 MB)' }); continue; }
        try {
          const p = parseFile(f.name, await f.text(), own);
          out.push({ name: f.name, ...p });
        } catch (e) {
          out.push({ name: f.name, kind: '', rows: [], dropped: 0, error: (e as Error).message.slice(0, 80) });
        }
      }
      // Leave out anything already in Board (and repeats within the files themselves).
      const have = new Set((await fetchAll()).map(sameKey));
      const keep: Row[] = [];
      let same = 0;
      for (const r of out.flatMap((f) => f.rows)) {
        const k = sameKey(r);
        if (have.has(k)) { same++; continue; }
        have.add(k);
        keep.push(r);
      }
      setFound(out);
      setFresh(keep);
      setDupes(same);
    } catch (e) {
      flash(`Could not read: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function save() {
    setBusy(true);
    let done = 0;
    try {
      for (let i = 0; i < fresh.length; i += 200) {
        // Rows from different files carry different fields: fill the gaps with column defaults, not nulls.
        const { error } = await supabase.from('items').insert(fresh.slice(i, i + 200), { defaultToNull: false });
        if (error) throw error;
        done += Math.min(200, fresh.length - i);
      }
      flash(`Imported ${done} note${done === 1 ? '' : 's'}`);
      setFound(null);
      setFresh([]);
      onImported();
    } catch (e) {
      flash(`Stopped after ${done}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const dated = fresh.filter((r) => r.due_at).length;
  const archived = fresh.filter((r) => r.archived).length;

  return (
    <section>
      <h2>Import</h2>
      <p className="muted small">
        Bring notes in from a Board backup (.json or .csv), a calendar file (.ics from Google, Outlook or Apple),
        Google Keep (the .json files in a Google Takeout download) or plain text and Markdown. You'll see what was found before anything is saved.
        Notes already in Board are skipped.
      </p>
      <input ref={input} type="file" multiple hidden accept=".json,.csv,.ics,.txt,.md,.markdown,application/json,text/csv,text/calendar,text/plain,text/markdown"
        onChange={(e) => pick(e.target.files)} />
      {!found && <button disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Reading…' : 'Choose files…'}</button>}
      {found && (
        <div className="import-found">
          <ul>
            {found.map((f, i) => (
              <li key={i} className="small">
                <b>{f.name}</b>{' '}
                {f.error ? <span className="danger-text">couldn't read: {f.error}</span>
                  : <span className="muted">{f.kind} · {f.rows.length} note{f.rows.length === 1 ? '' : 's'}{f.dropped ? ` · ${f.dropped} skipped (empty or cancelled)` : ''}</span>}
              </li>
            ))}
          </ul>
          <p>
            <b>{fresh.length}</b> new note{fresh.length === 1 ? '' : 's'} to add
            {dated ? `, ${dated} with dates` : ''}{archived ? `, ${archived} going straight to Archive` : ''}.
            {dupes > 0 && <span className="muted"> {dupes} already in Board, left out.</span>}
          </p>
          {fresh.length > 0 && (
            <ul className="import-preview small">
              {fresh.slice(0, 5).map((r, i) => <li key={i}>{r.body.split('\n')[0].slice(0, 80)}</li>)}
              {fresh.length > 5 && <li className="muted">…and {fresh.length - 5} more</li>}
            </ul>
          )}
          <div className="row">
            <button className="primary" disabled={busy || !fresh.length} onClick={save}>{busy ? 'Importing…' : `Import ${fresh.length}`}</button>
            <button disabled={busy} onClick={() => { setFound(null); setFresh([]); }}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
