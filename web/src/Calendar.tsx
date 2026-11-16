import { useMemo, useState } from 'react';
import type { Item, TagColors } from './supabase';
import Card from './Card';
import { occurrences } from './repeat';

interface Props {
  items: Item[];
  colors: TagColors;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  onRemove: (id: string) => void;
  onInsert?: (row: Partial<Item>) => Promise<boolean>;
}

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function Calendar({ items, colors, onUpdate, onRemove, onInsert }: Props) {
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState<Date>(today);

  const cells = useMemo(() => {
    const first = new Date(month);
    first.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
  }, [month]);

  // Every occurrence that falls in the visible six weeks (repeating items appear on each of their days).
  const byDay = useMemo(() => {
    const from = cells[0];
    const to = new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate() + 1);
    const m = new Map<string, { i: Item; at: Date }[]>();
    items.filter((i) => i.due_at).forEach((i) => {
      for (const at of occurrences(new Date(i.due_at!), i.repeat, from, to, 60)) {
        const k = key(at);
        m.set(k, [...(m.get(k) ?? []), { i, at }]);
      }
    });
    m.forEach((list) => list.sort((a, b) => a.at.getTime() - b.at.getTime()));
    return m;
  }, [items, cells]);

  const dayItems = byDay.get(key(picked)) ?? [];
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <main className="calendar">
      <div className="cal-head">
        <button onClick={() => shift(-1)} aria-label="Previous month">‹</button>
        <h2>{month.toLocaleString([], { month: 'long', year: 'numeric' })}</h2>
        <button onClick={() => shift(1)} aria-label="Next month">›</button>
        <button className="small" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setPicked(today); }}>Today</button>
      </div>
      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((d) => {
          const list = byDay.get(key(d)) ?? [];
          const cls = [
            'day',
            d.getMonth() !== month.getMonth() && 'other',
            key(d) === key(today) && 'today',
            key(d) === key(picked) && 'picked',
          ].filter(Boolean).join(' ');
          return (
            <button key={d.toISOString()} className={cls} onClick={() => setPicked(d)}>
              <span className="num">{d.getDate()}</span>
              {list.slice(0, 3).map(({ i, at }) => (
                <span key={`${i.id}@${at.getTime()}`} className={`pill ${i.kind ?? ''} ${i.done ? 'done' : ''}`}>
                  {i.repeat ? '🔁 ' : ''}{i.body.split('\n')[0] || i.file_name || 'Attachment'}
                </span>
              ))}
              {list.length > 3 && <span className="more">+{list.length - 3}</span>}
            </button>
          );
        })}
      </div>
      <section className="day-list">
        <h2>{picked.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
        {dayItems.length === 0 ? (
          <p className="muted">Nothing scheduled.</p>
        ) : (
          <div className="grid">
            {dayItems.map(({ i, at }) => (
              <div key={`${i.id}@${at.getTime()}`}>
                {i.repeat && !i.all_day && <div className="occ muted">{time(at)} on this day</div>}
                <Card item={i} colors={colors} onUpdate={onUpdate} onRemove={onRemove} onInsert={onInsert} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
