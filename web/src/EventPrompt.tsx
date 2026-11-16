// "Is this an event?" – shown when Board finds a date in a screenshot, PDF, voice note or shared link.
// Nothing goes on the calendar until the user confirms the title, date, tag and warning times.
import { useState } from 'react';
import ReminderPicker from './Reminders';
import type { Item } from './supabase';

export interface Proposal {
  itemId: string;
  /** Where the date came from, e.g. "screenshot", "PDF", "voice note", "link". */
  from: string;
  title: string;
  due_at: string | null;
  all_day: boolean;
  /** Length in minutes when the source gave an end time. */
  duration_min?: number | null;
  location: string | null;
  tags: string[];
  /** Appended under the title when saving (the link itself, for shared links). */
  keep?: string;
  /** The words the date was read from, so the user can judge it. */
  quote?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (iso: string | null, allDay: boolean) => {
  if (!iso) return '';
  const d = new Date(iso);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return allDay ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

interface Props {
  proposal: Proposal;
  more: number;
  onConfirm: (id: string, patch: Partial<Item>) => void;
  onSkip: () => void;
}

export default function EventPrompt({ proposal: p, more, onConfirm, onSkip }: Props) {
  const [title, setTitle] = useState(p.title);
  const [allDay, setAllDay] = useState(p.all_day);
  const [when, setWhen] = useState(toInput(p.due_at, p.all_day));
  const [ends, setEnds] = useState(
    p.due_at && p.duration_min && !p.all_day ? toInput(new Date(new Date(p.due_at).getTime() + p.duration_min * 60e3).toISOString(), false) : '',
  );
  const [place, setPlace] = useState(p.location ?? '');
  const [tags, setTags] = useState([...new Set([...p.tags, 'event'])].join(' '));
  const [remind, setRemind] = useState<number[]>([60, 1440]);

  function flipAllDay(v: boolean) {
    setAllDay(v);
    setWhen((w) => (!w ? w : v ? w.slice(0, 10) : `${w.slice(0, 10)}T09:00`));
  }

  function confirm() {
    if (!when) return;
    const d = allDay ? new Date(`${when}T09:00`) : new Date(when);
    const mins = !allDay && ends ? Math.round((new Date(ends).getTime() - d.getTime()) / 60e3) : 0;
    onConfirm(p.itemId, {
      duration_min: mins > 0 && mins <= 43200 ? mins : allDay ? (p.duration_min ?? null) : null,
      body: [title.trim() || p.title, p.keep].filter(Boolean).join('\n'),
      due_at: d.toISOString(),
      all_day: allDay,
      kind: 'event',
      tags: [...new Set(tags.split(/[\s,#]+/).map((t) => t.toLowerCase()).filter(Boolean))],
      remind_offsets: remind,
      location: place.trim() || null,
    });
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Add to calendar?">
      <div className="sheet">
        <h2>{p.due_at ? 'Add this to your calendar?' : 'When is this event?'}</h2>
        <p className="muted small">
          {p.due_at
            ? `Board found a date in this ${p.from}. Check the details before it goes on the calendar.`
            : `This ${p.from} looks like an event, but its page didn't give Board a date. Set it here to put it on the calendar.`}
        </p>
        {p.quote && <p className="quote">“{p.quote}”</p>}
        <label>Title <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>When
          <input type={allDay ? 'date' : 'datetime-local'} value={when} onChange={(e) => setWhen(e.target.value)} autoFocus={!p.due_at} />
        </label>
        {!allDay && when && (
          <label>Ends <span className="muted small">(optional)</span>
            <input type="datetime-local" value={ends} min={when} onChange={(e) => setEnds(e.target.value)} />
          </label>
        )}
        <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => flipAllDay(e.target.checked)} /> All day</label>
        <label>Place <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Optional" /></label>
        <label>Tags <input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <div className="field"><span className="muted small">When should Board warn you?</span><ReminderPicker value={remind} onChange={setRemind} /></div>
        <div className="row end">
          <button onClick={onSkip}>Not an event</button>
          <button className="primary" disabled={!when} onClick={confirm}>Add to calendar</button>
        </div>
        {more > 0 && <p className="muted small">{more} more to check after this.</p>}
      </div>
    </div>
  );
}
