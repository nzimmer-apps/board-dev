// Web push: lets reminders reach this browser when no Board tab is open.
// The browser gives us a push address; the server (supabase/functions/push) sends to it when a reminder is due.
import { supabase, type Item } from './supabase';
import { isNativeApp, upcomingAlerts } from './native';

export const pushSupported = () =>
  !isNativeApp && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const urlKey = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) return reg;
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  return navigator.serviceWorker.ready;
}

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

export async function enablePush(items: Item[]): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const { data: cfg, error } = await supabase.from('push_config').select('public_key').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!cfg?.public_key) throw new Error('The notification server is still starting up. Try again in a minute.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, cfg.public_key)) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(cfg.public_key) });
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error: e2 } = await supabase.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (e2) throw e2;
  lastSig = '';
  await syncPushSchedule(items);
  return 'on';
}

function sameKey(sub: PushSubscription, key: string) {
  const k = sub.options.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k), b = urlKey(key);
  return a.length === b.length && a.every((x, n) => x === b[n]);
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  return 'off';
}

// Upload the upcoming reminders whenever they change. Every client does this (also the Android and Windows apps),
// so a browser with push on stays up to date wherever notes are edited. The server ignores it if no browser has push on.
let lastSig = '';
let timer: number | undefined;
export function syncPushSchedule(items: Item[]): Promise<void> {
  window.clearTimeout(timer);
  return new Promise((done) => {
    timer = window.setTimeout(async () => {
      const rows = upcomingAlerts(items);
      const sig = rows.map((r) => `${r.key}:${r.title}:${r.body}`).join('|');
      if (sig !== lastSig) {
        const { error } = await supabase.rpc('set_push_schedule', { rows });
        if (!error) lastSig = sig;
      }
      done();
    }, 1500);
  });
}
