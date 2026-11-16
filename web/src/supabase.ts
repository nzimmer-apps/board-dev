import { createClient } from '@supabase/supabase-js';
import type { Repeat } from './repeat';

// Both values are public by design (the anon key only works within Row Level Security).
// Set them in config.json at build time via the Pages workflow, or in web/.env.local for dev.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Display name, e.g. "Board Dev" for the development build. */
export const APP_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) || 'Board';

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: true, autoRefreshToken: true } },
);

export interface Item {
  id: string;
  body: string;
  url: string | null;
  tags: string[];
  source: string;
  due_at: string | null;
  all_day: boolean;
  kind: 'event' | 'deadline' | 'reminder' | null;
  done: boolean;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  image_path: string | null;
  ocr_text: string | null;
  remind_offsets: number[];
  repeat: Repeat | null;
  location: string | null;
  file_path: string | null;
  file_type: 'audio' | 'pdf' | null;
  file_name: string | null;
  /** One extra reminder at this time (snooze). */
  snoozed_until: string | null;
  /** Event length in minutes, null = no end time. */
  duration_min: number | null;
}

export const ITEM_COLS =
  'id,body,url,tags,source,due_at,all_day,kind,done,pinned,archived,created_at,image_path,ocr_text,remind_offsets,repeat,location,file_path,file_type,file_name,snoozed_until,duration_min';

/** Tag colours, keyed by tag name. */
export type TagColors = Record<string, string>;
