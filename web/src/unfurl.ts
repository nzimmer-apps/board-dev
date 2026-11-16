// Ask the "unfurl" edge function what a link is: its title and, for event pages, when and where.
import { supabase } from './supabase';
import { findEventDate } from './parse';

export interface LinkInfo {
  title: string | null;
  /** null when the page gave no usable date */
  due_at: string | null;
  all_day: boolean;
  /** Event length from the page's end time, if it gave one. */
  duration_min: number | null;
  location: string | null;
  /** True when the link looks like an event page even if we could not read its date. */
  looksLikeEvent: boolean;
}

const EVENT_URL_RE = /(facebook\.com\/events\/|fb\.me\/e\/|fb\.com\/events\/|eventbrite\.[a-z.]+\/e\/|meetup\.com\/[^/]+\/events\/|lu\.ma\/|partiful\.com\/e\/|\/events?\/[^/?#]+)/i;
export const looksLikeEventUrl = (url: string) => EVENT_URL_RE.test(url);

/** "2026-12-05" → all-day; "2026-12-05T19:00" → that local time; with an offset → that instant. */
export function eventStart(raw: string): { due_at: string; all_day: boolean } | null {
  const s = raw.trim();
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return { due_at: new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3], 9).toISOString(), all_day: true };
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const f = findEventDate(s);
    return f ? { due_at: f.due_at, all_day: f.all_day } : null;
  }
  return { due_at: d.toISOString(), all_day: false };
}

/** Strip the " | Facebook" / " - Eventbrite" style suffix sites add to page titles. */
const cleanTitle = (t: string | null) => t?.replace(/\s+[|·–-]\s+(Facebook|Eventbrite|Meetup|Luma|Partiful)\s*$/i, '').trim() || null;

export async function unfurl(url: string): Promise<LinkInfo | null> {
  const looksLikeEvent = looksLikeEventUrl(url);
  const { data, error } = await supabase.functions.invoke('unfurl', { body: { url } });
  if (error || !data) return looksLikeEvent ? { title: null, due_at: null, all_day: false, duration_min: null, location: null, looksLikeEvent } : null;
  const generic = /^(facebook|log in|log into facebook|sign in|error|access denied|just a moment)/i;
  let title = cleanTitle(data.event?.name ?? data.title ?? null);
  if (title && generic.test(title)) title = null;
  let start = data.event?.start ? eventStart(String(data.event.start)) : null;
  // No structured date: event pages often say it in the description ("Saturday, December 5 at 7 PM").
  if (!start && (looksLikeEvent || data.event)) {
    const f = findEventDate(`${data.title ?? ''}\n${data.description ?? ''}`);
    if (f) start = { due_at: f.due_at, all_day: f.all_day };
  }
  // The page's end time, as a length, when it is after the start.
  const end = start && data.event?.end ? eventStart(String(data.event.end)) : null;
  const mins = start && end ? Math.round((new Date(end.due_at).getTime() - new Date(start.due_at).getTime()) / 60e3) : 0;
  return {
    title,
    due_at: start?.due_at ?? null,
    all_day: start?.all_day ?? false,
    duration_min: mins > 0 && mins <= 43200 ? mins : null,
    location: data.event?.location ?? null,
    looksLikeEvent: looksLikeEvent || !!data.event,
  };
}
