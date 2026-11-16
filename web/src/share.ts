// Sharing a note or a tag, with a person (by email) or through a secret read-only link.
// The database decides who can see what (see migration 20261116220000_sharing.sql); these helpers only shape the UI.
import type { Item } from './supabase';

export interface Share {
  id: string;
  owner_id: string;
  owner_email: string | null;
  item_id: string | null;
  tag: string | null;
  recipient_email: string | null;
  token: string | null;
  can_edit: boolean;
  created_at: string;
}
export const SHARE_COLS = 'id,owner_id,owner_email,item_id,tag,recipient_email,token,can_edit,created_at';

/** What is being shared: one note, or every note with a tag. */
export type ShareTarget = { item_id: string; tag?: undefined } | { tag: string; item_id?: undefined };

export const normEmail = (s: string) => s.trim().toLowerCase();
export const validEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail(s));

/** 24 random URL-safe characters (144 bits): not guessable. */
export function newToken(bytes = 18): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The address someone opens to read a link share. `base` is the web app's own address. */
export function linkUrl(token: string, base: string): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('shared', token);
  return u.toString();
}

/** The token in the current address, if this page was opened from a share link. */
export function tokenFromSearch(search: string): string | null {
  const t = new URLSearchParams(search).get('shared');
  return t && /^[A-Za-z0-9_-]{20,100}$/.test(t) ? t : null;
}

export const matches = (s: Pick<Share, 'item_id' | 'tag'>, t: ShareTarget) =>
  t.item_id ? s.item_id === t.item_id : s.tag === t.tag;

/** For a note someone shared with me: 0 = not shared, 1 = can look, 2 = can edit. */
export function accessFor(item: Pick<Item, 'id' | 'tags'> & { user_id: string }, shares: Share[], myEmail: string): 0 | 1 | 2 {
  const me = normEmail(myEmail);
  let best: 0 | 1 | 2 = 0;
  for (const s of shares) {
    if (s.owner_id !== item.user_id || s.recipient_email !== me) continue;
    if (s.item_id !== item.id && !(s.tag && item.tags.includes(s.tag))) continue;
    best = s.can_edit ? 2 : best || 1;
    if (best === 2) break;
  }
  return best;
}

/** One line describing a share for the list in the share window. */
export function describe(s: Share): string {
  if (s.token) return 'Anyone with the link · can look';
  return `${s.recipient_email} · ${s.can_edit ? 'can edit' : 'can look'}`;
}
