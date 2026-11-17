// What a voice note said → the note's text, tags, and (when it names a day and a time) its calendar booking.
import { parseInput, findEventDate } from './parse.ts';
import type { Repeat } from './repeat.ts';

/** Speech engines write tags out as words: "hashtag darts" / "hash tag darts" → "#darts". */
export function spokenTags(text: string): string {
  return text.replace(/\bhash\s?tag\s+([\p{L}\p{N}_-]{1,40})/giu, (_m, t: string) => `#${t.toLowerCase()}`);
}

/** Placeholder text a voice note or audio file gets before its words are known. */
export function isPlaceholderBody(body: string, fileName: string | null): boolean {
  const b = body.trim();
  return !b || b === fileName || /^Voice note · /.test(b) || b === 'Audio note' || b === 'Shared audio';
}

export interface VoiceBooking {
  due_at: string;
  all_day: false;
  kind: 'event' | 'deadline' | 'reminder';
  repeat: Repeat | null;
  duration_min: number | null;
  remind_offsets: number[];
}

export interface VoicePlan {
  /** The note's text: caption + transcript, with #tags taken out. '' when nothing was said. */
  body: string;
  tags: string[];
  url: string | null;
  /** Day and time both said: book it straight away. */
  booking: VoiceBooking | null;
  /** Only a day was said ("call mom tomorrow"): ask before it goes on the calendar. */
  ask: { due_at: string; all_day: boolean; text: string } | null;
}

/**
 * Read a voice note. `picked` is the reminder choice from the capture box, used unless
 * the note itself said when to warn ("notify me an hour before").
 */
export function planVoice(transcript: string, caption = '', picked: number[] = [0], now: Date = new Date()): VoicePlan {
  const said = [caption.trim(), spokenTags(transcript.trim())].filter(Boolean).join('\n');
  if (!said) return { body: '', tags: [], url: null, booking: null, ask: null };
  const p = parseInput(said, now);
  const body = said.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, '$1').replace(/[ \t]{2,}/g, ' ').trim() || said;
  if (p.due_at && !p.all_day) {
    return {
      body, tags: p.tags, url: p.url, ask: null,
      booking: {
        due_at: p.due_at, all_day: false, kind: p.kind ?? 'event', repeat: p.repeat,
        duration_min: p.duration, remind_offsets: p.remind ?? picked,
      },
    };
  }
  return { body, tags: p.tags, url: p.url, booking: null, ask: findEventDate(said, now) };
}
