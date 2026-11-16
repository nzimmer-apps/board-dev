// The next few dates of a repeating note, each of which can be skipped or moved on its own.
// Moving one date skips it in the series and makes a separate one-off note at the new time.
import { useState } from 'react';
import { dayKey, occurrences, withSkip } from './repeat';
import type { Item } from './supabase';

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const label = (d: Date, allDay: boolean) =>
  d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', ...(allDay ? {} : { hour: 'numeric', minute: '2-digit' }) });

interface Props {
  item: Item;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  /** Creates the one-off copy when a date is moved; without it only Skip is offered. */
  onInsert?: (row: Partial<Item>) => Promise<boolean>;
  count?: number;
}

export default function Upcoming({ item, onUpdate, onInsert, count = 6 }: Props) {
  const [moving, setMoving] = useState<string | null>(null);
  const [to, setTo] = useState('');
  if (!item.due_at || !item.repeat) return null;
  const rule = item.repeat;
  const skipped = new Set(rule.skip ?? []);
  // List the plain series (skips included) so a skipped date can be put back.
  const { skip: _s, ...plain } = rule;
  const now = new Date();
  const dates = occurrences(new Date(item.due_at), plain, now, new Date(now.getTime() + 400 * 864e5), count + skipped.size).slice(0, count + skipped.size);

  async function move(d: Date) {
    if (!to || !onInsert) return;
    const ok = await onInsert({
      body: item.body, tags: item.tags, url: item.url, kind: item.kind ?? 'event', location: item.location,
      remind_offsets: item.remind_offsets, duration_min: item.duration_min, all_day: false,
      due_at: new Date(to).toISOString(), repeat: null, source: 'app',
    });
    if (ok) onUpdate(item.id, { repeat: withSkip(rule, d) });
    setMoving(null);
  }

  return (
    <div className="upcoming">
      <div className="muted small">Next dates: skip one, or change just that one.</div>
      {dates.map((d) => {
        const k = dayKey(d);
        const off = skipped.has(k);
        return (
          <div key={k} className={off ? 'occ skipped' : 'occ'}>
            <span className="when">{label(d, item.all_day)}</span>
            {off ? (
              <>
                <span className="muted small">Skipped</span>
                <button className="small" onClick={() => onUpdate(item.id, { repeat: withSkip(rule, d, false) })}>Undo</button>
              </>
            ) : moving === k ? (
              <>
                <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
                <button className="small primary" disabled={!to} onClick={() => move(d)}>Move</button>
                <button className="small" onClick={() => setMoving(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="small" onClick={() => onUpdate(item.id, { repeat: withSkip(rule, d) })}>Skip</button>
                {onInsert && <button className="small" onClick={() => { setMoving(k); setTo(toInput(d)); }}>Change</button>}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
