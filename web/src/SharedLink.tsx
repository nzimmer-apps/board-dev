// What someone sees when they open a share link: the shared note(s), read-only, no account needed.
import { useEffect, useState } from 'react';
import { supabase, APP_NAME, type Item } from './supabase';
import { Body, fmtRange } from './Card';
import { effectiveDue, repeatLabel } from './repeat';

type LinkItem = Omit<Item, 'image_path' | 'file_path' | 'user_id'> & { image_url: string | null; file_url: string | null };

export default function SharedLink({ token }: { token: string }) {
  const [data, setData] = useState<{ title: string | null; items: LinkItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions.invoke('shared', { body: { token } }).then(async ({ data, error }) => {
      if (!error) return setData(data);
      // The function's own message ("turned off", "not valid") is in the response body.
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
      setError(body?.error ?? 'Could not open this link.');
    });
  }, [token]);

  const home = location.origin + location.pathname;
  return (
    <div className="app shared-link">
      <header className="top">
        <span className="brand">{APP_NAME}</span>
        <a className="small" href={home}>Open my own Board</a>
      </header>
      <main>
        {error && <p className="muted">{error}</p>}
        {!error && !data && <p className="muted">Loading…</p>}
        {data && (
          <>
            <div className="page-head">
              <h2>{data.title ? `Shared notes: ${data.title}` : 'A shared note'}</h2>
              <span className="muted small">Read-only</span>
            </div>
            {data.items.length === 0 && <p className="muted">Nothing in here right now.</p>}
            <div className="grid">
              {data.items.map((it) => {
                const due = effectiveDue(it as unknown as Item);
                return (
                  <article key={it.id} className={it.done ? 'card done' : 'card'}>
                    {it.tags.length > 0 && <div className="tags">{it.tags.map((t) => <span key={t} className="tag">#{t}</span>)}</div>}
                    {it.body && <Body text={it.body} />}
                    {it.image_url && <img className="pic" src={it.image_url} alt="" loading="lazy" />}
                    {it.file_url && (it.file_type === 'audio'
                      ? <audio className="audio" controls preload="none" src={it.file_url} />
                      : <a className="file" href={it.file_url} target="_blank" rel="noreferrer"><span aria-hidden>📄</span> {it.file_name || 'PDF'}</a>)}
                    {it.location && (
                      <a className="place" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(it.location)}`} target="_blank" rel="noreferrer">📍 {it.location}</a>
                    )}
                    {due && (
                      <div className="due">
                        {fmtRange({ due_at: due, all_day: it.all_day, duration_min: it.duration_min })}
                        {it.repeat && <span className="rep"> · 🔁 {repeatLabel(it.repeat)}</span>}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
