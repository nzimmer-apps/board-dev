import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, configured, ITEM_COLS, APP_NAME, type Item, type TagColors } from './supabase';
import { parseAll, parseInput, findEventDate } from './parse';
import Auth from './Auth';
import Board from './Board';
import Calendar from './Calendar';
import Archive from './Archive';
import Tags from './Tags';
import More, { ThemeSwatches } from './More';
import EventPrompt, { type Proposal } from './EventPrompt';
import { onShared, onQuick, syncReminders, registerHotkey } from './native';
import { shrink, upload, readText, download, removeImage } from './images';
import { uploadFile, downloadFile, removeFile, pdfText, audioKind } from './files';
import { unfurl, looksLikeEventUrl } from './unfurl';
import { applyTheme, getTheme, type ThemeId } from './theme';
import { repeatLabel } from './repeat';

type View = 'board' | 'calendar' | 'archive' | 'tags' | 'more';
const VIEWS: View[] = ['board', 'calendar', 'archive', 'tags', 'more'];
const fromHash = (): View => VIEWS.find((v) => location.hash === `#${v}`) ?? 'board';
const asItems = (d: unknown) => (d ?? []) as Item[];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [archived, setArchived] = useState<Item[] | null>(null);
  const [colors, setColors] = useState<TagColors>({});
  const [view, setView] = useState<View>(fromHash);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>(getTheme);
  const [themeOpen, setThemeOpen] = useState(false);
  const [prompts, setPrompts] = useState<Proposal[]>([]);
  const [jump, setJump] = useState<{ tag: string; n: number } | null>(null);
  const shareHandled = useRef(false);

  useEffect(() => { applyTheme(theme); }, [theme]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const toastTimer = useRef<number>();
  const flash = useCallback((m: string) => {
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3000);
  }, []);

  const viewRef = useRef(view);
  viewRef.current = view;

  const loadArchived = useCallback(async () => {
    const { data, error } = await supabase.from('items').select(ITEM_COLS).eq('archived', true).order('created_at', { ascending: false }).limit(1000);
    if (error) flash(error.message);
    else setArchived(asItems(data));
  }, [flash]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('items')
      .select(ITEM_COLS)
      .eq('archived', false)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) flash(error.message);
    else setItems(asItems(data));
    if (viewRef.current === 'archive') loadArchived();
  }, [flash, loadArchived]);

  const loadColors = useCallback(async () => {
    const { data } = await supabase.from('categories').select('name,color');
    if (data) setColors(Object.fromEntries(data.filter((c) => c.color).map((c) => [c.name, c.color as string])));
  }, []);

  // Initial load + live sync from other devices
  useEffect(() => {
    if (!session) return;
    load();
    loadColors();
    const ch = supabase
      .channel('items')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => loadColors())
      .subscribe();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      supabase.removeChannel(ch);
      window.removeEventListener('focus', onFocus);
    };
  }, [session, load, loadColors]);

  useEffect(() => { if (session && view === 'archive') loadArchived(); }, [session, view, loadArchived]);

  const ask = useCallback((p: Proposal) => setPrompts((ps) => (ps.some((x) => x.itemId === p.itemId) ? ps : [...ps, p])), []);

  const update = useCallback(
    async (id: string, patch: Partial<Item>) => {
      // Archiving / restoring moves a note between the two lists.
      if (patch.archived === true) {
        setItems((xs) => {
          const it = xs.find((x) => x.id === id);
          if (it) setArchived((a) => (a ? [{ ...it, ...patch }, ...a.filter((x) => x.id !== id)] : a));
          return xs.filter((x) => x.id !== id);
        });
      } else if (patch.archived === false) {
        setArchived((a) => {
          const it = a?.find((x) => x.id === id);
          if (it) setItems((xs) => [{ ...it, ...patch }, ...xs.filter((x) => x.id !== id)].sort((x, y) => y.created_at.localeCompare(x.created_at)));
          return a ? a.filter((x) => x.id !== id) : a;
        });
      } else {
        setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
        setArchived((a) => (a ? a.map((x) => (x.id === id ? { ...x, ...patch } : x)) : a));
      }
      const { error } = await supabase.from('items').update(patch).eq('id', id);
      if (error) { flash(error.message); load(); }
      else if (patch.archived === true) flash('Archived · find it under Archive');
      else if (patch.archived === false) flash('Back on the board');
    },
    [flash, load],
  );

  // A saved link: fetch its title, and if it is an event page offer to put it on the calendar.
  const enrichLink = useCallback(
    async (it: Item) => {
      if (!it.url || it.due_at) return;
      const info = await unfurl(it.url).catch(() => null);
      if (!info) return;
      const bare = it.body.trim() === it.url;
      const typed = it.body.replace(it.url, '').trim().split('\n')[0];
      const title = typed || info.title || '';
      if (info.due_at || info.looksLikeEvent) {
        ask({
          itemId: it.id, from: 'link', title: title || 'Event', due_at: info.due_at, all_day: info.all_day, duration_min: info.duration_min,
          location: info.location, tags: it.tags, keep: it.url,
        });
      } else if (bare && info.title) {
        update(it.id, { body: `${info.title}\n${it.url}` });
      }
    },
    [ask, update],
  );

  const add = useCallback(
    async (raw: string, source = 'app', picked: number[] = [0]) => {
      const parsed = parseAll(raw);
      const rows = parsed.map(({ remind, duration, ...p }) => ({ ...p, duration_min: duration, source, remind_offsets: remind ?? picked }));
      const stamp = Date.now();
      const optimistic: Item[] = rows.map((r, n) => ({
        id: `tmp-${stamp}-${n}`, ...r, done: false, pinned: false, archived: false, created_at: new Date().toISOString(),
        image_path: null, ocr_text: null, location: null, file_path: null, file_type: null, file_name: null, snoozed_until: null,
      }));
      setItems((xs) => [...optimistic, ...xs]);
      const { data, error } = await supabase.from('items').insert(rows).select(ITEM_COLS);
      setItems((xs) => xs.filter((x) => !optimistic.some((o) => o.id === x.id)));
      if (error) {
        flash(`Not saved: ${error.message}`);
        return false;
      }
      const saved = asItems(data);
      setItems((xs) => [...saved, ...xs.filter((x) => !saved.some((s) => s.id === x.id))]);
      const p = rows[0];
      const bell = p.due_at && p.remind_offsets.length ? ' 🔔' : '';
      const when = p.due_at
        ? p.repeat
          ? ` · 🔁 ${rows.map((r) => repeatLabel(r.repeat)).join(' + ')}`
          : ` · ${new Date(p.due_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', ...(p.all_day ? {} : { hour: 'numeric', minute: '2-digit' }) })}`
        : '';
      flash(`Saved${rows.length > 1 ? ` ${rows.length} items` : ''}${p.tags.length ? ` to #${p.tags.join(' #')}` : ''}${when}${bell}`);
      if (saved.length === 1 && saved[0].url && !saved[0].due_at) {
        if (looksLikeEventUrl(saved[0].url)) flash('Saved · checking the event link…');
        enrichLink(saved[0]);
      }
      return true;
    },
    [flash, enrichLink],
  );

  // A single new note built elsewhere (e.g. one date of a repeating note moved to its own time).
  const insertItem = useCallback(
    async (row: Partial<Item>) => {
      const { data, error } = await supabase.from('items').insert(row).select(ITEM_COLS).single();
      if (error) { flash(`Not saved: ${error.message}`); return false; }
      const it = data as unknown as Item;
      setItems((xs) => [it, ...xs.filter((x) => x.id !== it.id)]);
      flash('Saved as its own note');
      return true;
    },
    [flash],
  );

  const remove = useCallback(
    async (id: string) => {
      const it = items.find((x) => x.id === id) ?? archived?.find((x) => x.id === id);
      setItems((xs) => xs.filter((x) => x.id !== id));
      setArchived((a) => (a ? a.filter((x) => x.id !== id) : a));
      setPrompts((ps) => ps.filter((p) => p.itemId !== id));
      const { error } = await supabase.from('items').delete().eq('id', id);
      if (error) { flash(error.message); load(); return; }
      if (it?.image_path) removeImage(it.image_path).catch(() => {});
      if (it?.file_path) removeFile(it.file_path).catch(() => {});
    },
    [flash, load, items, archived],
  );

  // Attachments: upload → item row. Text is read afterwards in the queue below.
  const localBlobs = useRef(new Map<string, Blob>());
  const addFile = useCallback(
    async (file: Blob, caption = '', source = 'app', picked: number[] = [0]) => {
      const name = file instanceof File ? file.name : '';
      const isPdf = file.type === 'application/pdf';
      const isAudio = file.type.startsWith('audio/');
      flash(isPdf ? 'Uploading PDF…' : isAudio ? 'Uploading audio…' : 'Uploading image…');
      try {
        const { remind, duration, ...p } = parseInput(caption);
        const row: Partial<Item> = { ...p, duration_min: duration, body: caption.trim() ? p.body : '', source, remind_offsets: remind ?? picked };
        if (isPdf || isAudio) {
          const kind = isPdf ? { type: 'application/pdf', ext: 'pdf' } : audioKind(file.type);
          row.file_path = await uploadFile(file, kind.ext, kind.type);
          row.file_type = isPdf ? 'pdf' : 'audio';
          row.file_name = name || (isPdf ? 'Document.pdf' : 'Audio');
          if (isAudio) { row.ocr_text = ''; if (!row.body) row.body = name || 'Audio note'; }
          localBlobs.current.set(row.file_path, file);
        } else {
          const blob = await shrink(file);
          row.image_path = await upload(blob);
          localBlobs.current.set(row.image_path, blob);
        }
        const { data, error } = await supabase.from('items').insert(row).select(ITEM_COLS).single();
        if (error) throw error;
        setItems((xs) => [data as unknown as Item, ...xs]);
        flash(isAudio ? 'Audio saved' : `${isPdf ? 'PDF' : 'Image'} saved · reading text…`);
        return true;
      } catch (e) {
        flash(`Not saved: ${(e as Error).message}`);
        return false;
      }
    },
    [flash],
  );

  // Voice note: the recording is kept, and what was said (where the browser can transcribe) becomes the note text.
  const addVoice = useCallback(
    async (audio: Blob, transcript: string, caption: string, seconds: number) => {
      flash('Saving voice note…');
      try {
        const kind = audioKind(audio.type);
        const path = await uploadFile(audio, kind.ext, kind.type);
        const said = [caption, transcript].filter(Boolean).join('\n');
        // Tags come out of the words; any date in them is confirmed with the user below rather than applied silently.
        const p = parseInput(said);
        const stamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const row: Partial<Item> = {
          body: said ? said.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1').trim() || said : `Voice note · ${stamp}`,
          tags: p.tags, url: p.url, source: 'app', file_path: path, file_type: 'audio',
          file_name: `Voice note ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, ocr_text: transcript,
        };
        const { data, error } = await supabase.from('items').insert(row).select(ITEM_COLS).single();
        if (error) throw error;
        const it = data as unknown as Item;
        setItems((xs) => [it, ...xs]);
        flash(transcript ? 'Voice note saved with its words' : 'Voice note saved');
        const found = said ? findEventDate(said) : null;
        if (found) ask({ itemId: it.id, from: 'voice note', title: it.body.split('\n')[0].slice(0, 120), due_at: found.due_at, all_day: found.all_day, location: null, tags: it.tags, quote: found.text });
        return true;
      } catch (e) {
        flash(`Voice note not saved: ${(e as Error).message}`);
        return false;
      }
    },
    [flash, ask],
  );

  // Text queue: any image or PDF without text yet gets read on this device, one at a time.
  const ocrBusy = useRef(false);
  const ocrFailed = useRef(new Set<string>());
  useEffect(() => {
    if (!session || ocrBusy.current) return;
    const next = items.find((i) => (i.image_path || i.file_type === 'pdf') && i.ocr_text === null && !i.id.startsWith('tmp-') && !ocrFailed.current.has(i.id));
    if (!next) return;
    ocrBusy.current = true;
    (async () => {
      const path = (next.image_path ?? next.file_path)!;
      try {
        const blob = localBlobs.current.get(path) ?? (next.image_path ? await download(path) : await downloadFile(path));
        if (!blob) throw new Error('download failed');
        const text = next.image_path ? await readText(blob) : await pdfText(blob);
        localBlobs.current.delete(path);
        await update(next.id, { ocr_text: text });
        if (text) flash(`Read ${text.split(/\s+/).length} words from the ${next.image_path ? 'image' : 'PDF'}`);
        // A date in a screenshot or PDF is only a suggestion: ask before it goes on the calendar.
        const found = text && !next.due_at ? findEventDate(text) : null;
        if (found) {
          const firstLine = text.split('\n').find((l) => l.trim().length > 3 && !l.includes(found.text))?.trim() ?? '';
          ask({
            itemId: next.id, from: next.image_path ? 'screenshot' : 'PDF',
            title: (next.body.split('\n')[0] || firstLine || next.file_name || 'Event').slice(0, 120),
            due_at: found.due_at, all_day: found.all_day, location: null, tags: next.tags, quote: found.text,
          });
        }
      } catch (e) {
        console.warn('read text', e);
        ocrFailed.current.add(next.id);
        if (!next.image_path) update(next.id, { ocr_text: '' });
      } finally {
        ocrBusy.current = false;
        setItems((xs) => [...xs]); // nudge the queue to look for the next one
      }
    })();
  }, [session, items, update, flash, ask]);

  // Android share sheet → manifest share_target opens ./?share=1&title=…&text=…&url=…
  useEffect(() => {
    if (!session || shareHandled.current) return;
    const q = new URLSearchParams(location.search);
    if (!q.has('share')) return;
    shareHandled.current = true;
    const parts = [q.get('title'), q.get('text'), q.get('url')]
      .map((s) => (s ?? '').trim())
      .filter(Boolean);
    // Many apps put the URL inside "text" too — drop exact duplicates.
    const body = [...new Set(parts)].join('\n');
    history.replaceState(null, '', location.pathname + location.hash);
    if (body) add(body, 'share');
  }, [session, add]);

  // Native apps: share sheet (Android), reminders (both), global hotkey (Windows)
  useEffect(() => {
    if (!session) return;
    let off = () => {};
    onShared(
      (text) => add(text, 'share'),
      (img, caption) => addFile(img, caption, 'share'),
      (file, caption) => addFile(file, caption, 'share'),
      (msg) => flash(msg),
    ).then((f) => (off = f));
    return () => off();
  }, [session, add, addFile, flash]);

  useEffect(() => {
    if (session) syncReminders(items);
  }, [session, items]);

  // Android widget taps.
  useEffect(() => {
    if (!session) return;
    let off = () => {};
    onQuick((mode) => {
      setView('board');
      window.dispatchEvent(new CustomEvent('board-quick', { detail: mode }));
    }).then((f) => (off = f));
    return () => off();
  }, [session]);

  useEffect(() => {
    registerHotkey(() => {
      setView('board');
      window.dispatchEvent(new Event('board-focus-capture'));
    }).catch((e) => console.warn('hotkey', e));
  }, []);

  useEffect(() => {
    history.replaceState(null, '', `${location.pathname}${location.search}${view === 'board' ? '' : `#${view}`}`);
  }, [view]);

  // ---- tags ----
  const renameTag = useCallback(async (from: string, to: string) => {
    const { data, error } = await supabase.rpc('rename_tag', { p_old: from, p_new: to });
    if (error) flash(error.message);
    else flash(`#${from} → #${to} on ${data} ${data === 1 ? 'note' : 'notes'}`);
    await Promise.all([load(), loadColors()]);
  }, [flash, load, loadColors]);

  const deleteTag = useCallback(async (name: string) => {
    const { data, error } = await supabase.rpc('delete_tag', { p_name: name });
    if (error) flash(error.message);
    else flash(`Removed #${name} from ${data} ${data === 1 ? 'note' : 'notes'}`);
    await Promise.all([load(), loadColors()]);
  }, [flash, load, loadColors]);

  const colorTag = useCallback(async (name: string, color: string | null) => {
    setColors((c) => { const n = { ...c }; if (color) n[name] = color; else delete n[name]; return n; });
    const { error } = await supabase.from('categories').upsert({ name, color }, { onConflict: 'user_id,name' });
    if (error) { flash(error.message); loadColors(); }
  }, [flash, loadColors]);

  if (!configured)
    return (
      <div className="auth">
        <h1 className="brand">{APP_NAME}</h1>
        <p className="note">Not configured yet: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</p>
      </div>
    );
  if (session === undefined) return <div className="auth muted">Loading…</div>;
  if (!session) return <Auth />;

  const tab = (v: View, label: string) => (
    <button className={view === v ? 'tab on' : 'tab'} onClick={() => setView(v)}>{label}</button>
  );

  return (
    <div className="app">
      <header className="top">
        <span className="brand">{APP_NAME}</span>
        <nav>
          {tab('board', 'Board')}
          {tab('calendar', 'Calendar')}
          {tab('archive', 'Archive')}
          {tab('tags', 'Tags')}
          {tab('more', 'More')}
        </nav>
        <button className="icon" title="Colour theme" aria-expanded={themeOpen} onClick={() => setThemeOpen((o) => !o)}>🎨</button>
        {themeOpen && (
          <div className="theme-pop" onClick={() => setThemeOpen(false)}>
            <ThemeSwatches theme={theme} onTheme={setTheme} />
          </div>
        )}
      </header>
      {view === 'board' && (
        <Board items={items} colors={colors} jump={jump} onAdd={add} onAddFile={addFile} onAddVoice={addVoice} onUpdate={update} onRemove={remove} onInsert={insertItem} onError={flash} />
      )}
      {view === 'calendar' && <Calendar items={items} colors={colors} onUpdate={update} onRemove={remove} onInsert={insertItem} />}
      {view === 'archive' && <Archive items={archived} colors={colors} onUpdate={update} onRemove={remove} />}
      {view === 'tags' && (
        <Tags items={items} colors={colors} onRename={renameTag} onDelete={deleteTag} onColor={colorTag}
          onOpen={(t) => { setJump({ tag: t, n: Date.now() }); setView('board'); }} />
      )}
      {view === 'more' && <More theme={theme} onTheme={setTheme} email={session.user.email ?? ''} flash={flash} onImported={load} />}
      {prompts[0] && (
        <EventPrompt
          key={prompts[0].itemId}
          proposal={prompts[0]}
          more={prompts.length - 1}
          onConfirm={(id, patch) => { update(id, patch); setPrompts((ps) => ps.slice(1)); flash('Added to your calendar 📅'); }}
          onSkip={() => setPrompts((ps) => ps.slice(1))}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
