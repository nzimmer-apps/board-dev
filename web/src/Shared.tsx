// "Shared" screen: notes and tags other people shared with me, grouped by who shared them.
import Card from './Card';
import type { Item, TagColors } from './supabase';
import { accessFor, type Share } from './share';

export type SharedItem = Item & { user_id: string };

interface Props {
  items: SharedItem[] | null;
  shares: Share[];
  myEmail: string;
  colors: TagColors;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  onLeave: (s: Share) => void;
}

export default function Shared({ items, shares, myEmail, colors, onUpdate, onLeave }: Props) {
  const toMe = shares.filter((s) => s.recipient_email && s.recipient_email === myEmail.toLowerCase());
  const owners = [...new Set(toMe.map((s) => s.owner_id))];
  const from = (owner: string) => toMe.find((s) => s.owner_id === owner)?.owner_email ?? 'someone';

  if (items === null) return <main className="shared"><p className="muted">Loading…</p></main>;
  if (!toMe.length)
    return (
      <main className="shared">
        <div className="page-head"><h2>Shared with you</h2></div>
        <p className="muted">Nothing yet. When someone shares a note or a tag with your email address, it shows up here.</p>
        <p className="muted small">To share your own, tap 👥 on a note, or <b>Share</b> next to a tag under Tags.</p>
      </main>
    );

  return (
    <main className="shared">
      <div className="page-head"><h2>Shared with you</h2></div>
      {owners.map((o) => {
        const mine = toMe.filter((s) => s.owner_id === o);
        const notes = items.filter((i) => i.user_id === o);
        return (
          <section key={o} className="shared-from">
            <h3>From {from(o)}</h3>
            <ul className="share-list">
              {mine.map((s) => (
                <li key={s.id}>
                  <span className="who">{s.tag ? `#${s.tag}` : 'One note'}</span>
                  <span className="muted small">{s.can_edit ? 'you can edit' : 'view only'}</span>
                  <button className="small" onClick={() => confirm(`Stop seeing ${s.tag ? `#${s.tag}` : 'this note'} from ${from(o)}? Only they can share it again.`) && onLeave(s)}>Leave</button>
                </li>
              ))}
            </ul>
            {notes.length === 0 && <p className="muted small">No notes in it right now.</p>}
            <div className="grid">
              {notes.map((it) => (
                <Card key={it.id} item={it} colors={colors} onUpdate={onUpdate} onRemove={() => {}}
                  shared={{ from: from(o), canEdit: accessFor(it, toMe, myEmail) === 2 }} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
