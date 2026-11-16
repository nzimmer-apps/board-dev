// Native shell integration (Android via Capacitor, Windows via Tauri).
// In a normal browser every function here is a no-op, so the web app is unchanged.
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Item } from './supabase';
import { occurrences } from './repeat';

export const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const isNativeApp = isAndroid || isTauri;

interface Shared {
  text: string | null;
  image?: string | null; // base64 JPEG, already downscaled natively
  file?: string | null; // base64 PDF or audio, as shared
  fileType?: string | null;
  fileName?: string | null;
  error?: string | null; // a file was shared but couldn't be passed on
}
type Quick = { mode: 'note' | 'voice' | null };
interface ShareIntentPlugin {
  takePending(): Promise<Shared>;
  addListener(event: 'shared', cb: (d: Shared) => void): Promise<{ remove: () => void }>;
  takeQuick(): Promise<Quick>;
  addListener(event: 'quick', cb: (d: Quick) => void): Promise<{ remove: () => void }>;
}

/** Android home-screen widget: "note" = open ready to type, "voice" = start a voice note. */
export async function onQuick(cb: (mode: 'note' | 'voice') => void): Promise<() => void> {
  if (!isAndroid) return () => {};
  const handle = (d: Quick) => { if (d.mode) cb(d.mode); };
  handle(await ShareIntent.takeQuick().catch(() => ({ mode: null }) as Quick));
  const h = await ShareIntent.addListener('quick', handle);
  return () => h.remove();
}
const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');

const b64ToBlob = (b64: string, type = 'image/jpeg') => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/** Text, images, PDFs or audio shared into the Android app from other apps' share sheet. */
export async function onShared(
  onText: (text: string) => void,
  onImage: (img: Blob, caption: string) => void,
  onFile?: (file: File, caption: string) => void,
  onError?: (message: string) => void,
): Promise<() => void> {
  if (!isAndroid) return () => {};
  const handle = (d: Shared) => {
    if (d.file && d.fileType && onFile) {
      const name = d.fileName || (d.fileType === 'application/pdf' ? 'Shared.pdf' : 'Shared audio');
      // The caption is only what the user typed, not the file name some apps also put in the text.
      const caption = d.text && d.text !== d.fileName ? d.text : '';
      onFile(new File([b64ToBlob(d.file, d.fileType)], name, { type: d.fileType }), caption);
    } else if (d.error) onError?.(`${d.fileName ?? 'That file'} ${d.error}`);
    else if (d.image) onImage(b64ToBlob(d.image), d.text ?? '');
    else if (d.text) onText(d.text);
  };
  handle(await ShareIntent.takePending().catch(() => ({ text: null }) as Shared));
  const h = await ShareIntent.addListener('shared', handle);
  return () => h.remove();
}

// ---------- Reminders ----------

// One entry per (occurrence, chosen offset): fires at that occurrence's time minus the offset.
interface Alert { i: Item; due: Date; t: number; off: number; key: string; snooze?: boolean }
const alerts = (items: Item[], fromMs: number, toMs: number): Alert[] =>
  items
    .filter((i) => (i.due_at || i.snoozed_until) && !i.done && !i.archived)
    .flatMap((i): Alert[] => {
      // A snooze is one extra alert at the chosen time.
      const snz = i.snoozed_until ? new Date(i.snoozed_until) : null;
      const extra: Alert[] = snz ? [{ i, due: snz, t: snz.getTime(), off: 0, key: `${i.id}:snooze:${snz.getTime()}`, snooze: true }] : [];
      if (!i.due_at) return extra;
      const offs = i.remind_offsets ?? [0];
      const lead = Math.max(0, ...offs) * 60e3;
      // Repeating items: every occurrence whose alerts could land in the window.
      const dues = i.repeat
        ? occurrences(new Date(i.due_at!), i.repeat, new Date(fromMs), new Date(toMs + lead), 80)
        : [new Date(i.due_at!)];
      return [...extra, ...dues.flatMap((due) =>
        offs.map((off) => ({ i, due, t: due.getTime() - off * 60e3, off, key: `${i.id}:${off}:${due.getTime()}` })),
      )];
    })
    .filter(({ t }) => t > fromMs && t < toMs)
    .sort((a, b) => a.t - b.t);

const label = (i: Item) =>
  i.kind === 'deadline' ? 'Deadline' : i.kind === 'reminder' ? 'Reminder' : 'Event';

const when = (a: Alert) => {
  if (a.off === 0) return a.i.kind === 'deadline' ? 'due now' : 'now';
  const d = a.due;
  const sameDay = new Date(a.t).toDateString() === d.toDateString();
  return 'at ' + d.toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const title = (a: Alert) => a.snooze ? `⏰ Snoozed ${label(a.i).toLowerCase()}` : `${label(a.i)} ${when(a)}`;
const text = (i: Item) => (i.body.split('\n')[0] || i.file_name || 'Image note').slice(0, 120);

// Stable 31-bit int from the uuid, required by Android notification ids.
const notifId = (id: string) => {
  let h = 0;
  for (const c of id) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 2147483647 || 1;
};

let lastAndroidSig = '';
let androidActionsReady = false;

/** Android: "Snooze 10 min" / "Snooze 1 hr" buttons on every reminder. */
async function androidSnoozeButtons() {
  if (androidActionsReady) return;
  androidActionsReady = true;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.registerActionTypes({
    types: [{ id: 'board-alert', actions: [{ id: '10m', title: 'Snooze 10 min' }, { id: '1h', title: 'Snooze 1 hr' }] }],
  });
  await LocalNotifications.addListener('localNotificationActionPerformed', async ({ actionId, notification }) => {
    const itemId = notification.extra?.itemId as string | undefined;
    if (!itemId || (actionId !== '10m' && actionId !== '1h')) return;
    const { supabase } = await import('./supabase');
    const { snoozeUntil } = await import('./snooze');
    await supabase.from('items').update({ snoozed_until: snoozeUntil(actionId).toISOString() }).eq('id', itemId);
  });
}

/** Android: (re)schedule OS notifications for the next 30 days of dated items. */
async function syncAndroid(items: Item[]) {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const next = alerts(items, Date.now(), Date.now() + 30 * 864e5).slice(0, 60);
  const sig = next.map((a) => `${a.key}@${a.t}:${a.i.body.length}`).join('|');
  if (sig === lastAndroidSig) return;
  lastAndroidSig = sig;
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display === 'prompt' || perm.display === 'prompt-with-rationale')
    perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return;
  await androidSnoozeButtons().catch((e) => console.warn('snooze buttons', e));
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications });
  if (!next.length) return;
  await LocalNotifications.schedule({
    notifications: next.map((a) => ({
      id: notifId(a.key),
      title: title(a),
      body: text(a.i),
      schedule: { at: new Date(a.t), allowWhileIdle: true },
      extra: { itemId: a.i.id },
      actionTypeId: 'board-alert',
    })),
  });
}

// Windows: no OS scheduler, so check once a minute while the app runs (it lives in the tray).
let tauriItems: Item[] = [];
let tauriTimer: number | undefined;
const fired = new Set<string>();

async function tauriTick() {
  const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === 'granted';
  if (!ok) return;
  const now = Date.now();
  for (const a of alerts(tauriItems, now - 10 * 60e3, now + 1)) {
    const k = `${a.key}@${a.t}`;
    if (fired.has(k)) continue;
    fired.add(k);
    sendNotification({ title: title(a), body: text(a.i) });
  }
}

export function syncReminders(items: Item[]) {
  if (isAndroid) syncAndroid(items).catch((e) => console.warn('reminders', e));
  if (isTauri) {
    tauriItems = items;
    if (tauriTimer === undefined) {
      tauriTick().catch(() => {});
      tauriTimer = window.setInterval(() => tauriTick().catch(() => {}), 30e3);
    }
  }
}

/** Windows: Ctrl+Alt+B from anywhere shows the window and focuses quick-add. */
export async function registerHotkey(focusCapture: () => void) {
  if (!isTauri) return;
  const { register, isRegistered } = await import('@tauri-apps/plugin-global-shortcut');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  // The dev build uses its own shortcut so it can run next to the real app.
  const combo = (import.meta.env.VITE_HOTKEY as string | undefined) || 'CommandOrControl+Alt+B';
  if (await isRegistered(combo)) return;
  await register(combo, async (e) => {
    if (e.state !== 'Pressed') return;
    const w = getCurrentWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
    focusCapture();
  });
}

/** Windows app: open links in the default browser instead of inside the app window. */
if (isTauri) {
  document.addEventListener('click', async (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href^="http"]') as HTMLAnchorElement | null;
    if (!a) return;
    e.preventDefault();
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    openUrl(a.href).catch(() => {});
  });
}

/** Windows app: start with Windows (hidden in the tray) so reminders keep coming after a restart. On by default. */
export async function getAutostart(): Promise<boolean | null> {
  if (!isTauri) return null;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}
export async function setAutostart(on: boolean) {
  if (!isTauri) return;
  const { enable, disable } = await import('@tauri-apps/plugin-autostart');
  await (on ? enable() : disable());
}
if (isTauri) {
  try {
    if (!localStorage.getItem('board-autostart-set')) {
      setAutostart(true).then(() => localStorage.setItem('board-autostart-set', '1')).catch(() => {});
    }
  } catch { /* storage blocked: leave it */ }
}

/** Web push: the next 30 days of reminders, worked out here (in this device's time zone) for the server to send. */
export function upcomingAlerts(items: Item[], now = Date.now()) {
  return alerts(items, now, now + 30 * 864e5).slice(0, 250).map((a) => ({
    key: `${a.key}@${a.t}`, fire_at: new Date(a.t).toISOString(), title: title(a), body: text(a.i), item_id: a.i.id,
  }));
}
