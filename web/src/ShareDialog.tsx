// The "Share" window for one note or one tag: who has it, add a person, make or turn off a link.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { SHARE_COLS, describe, linkUrl, newToken, normEmail, validEmail, type Share, type ShareTarget } from './share';
import { isNativeApp } from './native';

// Inside the phone/Windows apps the page address isn't a web address, so links point at the website.
const SITE = (import.meta.env.VITE_SITE_URL as string | undefined) || '';
const appBase = () => (isNativeApp && SITE ? SITE : location.origin + location.pathname);

interface Props {
  target: ShareTarget;
  /** "this note" or "#groceries", for the title. */
  label: string;
  onClose: () => void;
}

export default function ShareDialog({ target, label, onClose }: Props) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    let q = supabase.from('shares').select(SHARE_COLS).eq('owner_id', s.session?.user.id ?? '');
    q = target.item_id ? q.eq('item_id', target.item_id) : q.eq('tag', target.tag!);
    const { data, error } = await q.order('created_at');
    if (error) setMsg(error.message);
    else setShares((data ?? []) as Share[]);
  }, [target.item_id, target.tag]);
  useEffect(() => { load(); }, [load]);

  const what = target.item_id ? { item_id: target.item_id } : { tag: target.tag };
  const link = shares?.find((s) => s.token);
  const people = shares?.filter((s) => s.recipient_email) ?? [];

  async function run(f: () => Promise<string | null>) {
    setBusy(true);
    setMsg(null);
    try {
      const err = await f();
      if (err) setMsg(err);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const addPerson = () => run(async () => {
    const e = normEmail(email);
    if (!validEmail(e)) return 'Type their full email address.';
    const { error } = await supabase.from('shares').insert({ ...what, recipient_email: e, can_edit: canEdit });
    if (error) return error.code === '23505' ? 'Already shared with that address.' : error.message.includes('row-level') ? "That's your own address." : error.message;
    setEmail('');
    return null;
  });

  const setEdit = (s: Share, v: boolean) => run(async () => {
    const { error } = await supabase.from('shares').update({ can_edit: v }).eq('id', s.id);
    return error?.message ?? null;
  });

  const stop = (s: Share) => run(async () => {
    const { error } = await supabase.from('shares').delete().eq('id', s.id);
    return error?.message ?? null;
  });

  const makeLink = () => run(async () => {
    const { error } = await supabase.from('shares').insert({ ...what, token: newToken() });
    return error?.message ?? null;
  });

  async function copy(url: string) {
    try { await navigator.clipboard.writeText(url); setMsg('Link copied'); }
    catch { setMsg('Select the link and copy it'); }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Share ${label}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet share-sheet">
        <h2>Share {label}</h2>
        {target.tag && <p className="muted small">Every note with #{target.tag} is shared, including ones you add later.</p>}

        <div className="field">
          <span>With a person who uses Board</span>
          <form className="row" onSubmit={(e) => { e.preventDefault(); addPerson(); }}>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="their email" aria-label="Their email" autoFocus />
            <button className="primary" disabled={busy || !email.trim()}>Share</button>
          </form>
          <label className="check"><input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} /> They can edit (text, dates, ticks)</label>
          <span className="muted small">No email is sent. Tell them; it shows under <b>Shared</b> when they sign in with that address.</span>
        </div>

        {people.length > 0 && (
          <ul className="share-list">
            {people.map((s) => (
              <li key={s.id}>
                <span className="who">{s.recipient_email}</span>
                <label className="check small"><input type="checkbox" checked={s.can_edit} disabled={busy} onChange={(e) => setEdit(s, e.target.checked)} /> can edit</label>
                <button className="small danger" disabled={busy} onClick={() => stop(s)} title={describe(s)}>Stop sharing</button>
              </li>
            ))}
          </ul>
        )}

        <div className="field">
          <span>With a link (anyone who has it can look, no account needed)</span>
          {link ? (
            <>
              <div className="row">
                <input readOnly value={linkUrl(link.token!, appBase())} aria-label="Share link" onFocus={(e) => e.target.select()} />
                <button className="small" onClick={() => copy(linkUrl(link.token!, appBase()))}>Copy</button>
              </div>
              <button className="small danger" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => stop(link)}>Turn off the link</button>
            </>
          ) : (
            <button className="small" style={{ justifySelf: 'start' }} disabled={busy || shares === null} onClick={makeLink}>Make a link</button>
          )}
        </div>

        {msg && <p className="small" role="status">{msg}</p>}
        <div className="row end"><button onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
