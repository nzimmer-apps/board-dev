import { useEffect, useState } from 'react';
import type { Item } from './supabase';
import { isTauri, getAutostart, setAutostart } from './native';
import { pushState, enablePush, disablePush, type PushState } from './push';

// More → Notifications: web push for this browser, and "start with Windows" in the Windows app.
export default function Notifications({ items, flash }: { items: Item[]; flash: (m: string) => void }) {
  const [push, setPush] = useState<PushState | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setPush).catch(() => setPush('unsupported'));
    getAutostart().then(setAuto).catch(() => setAuto(null));
  }, []);

  if (push === 'unsupported' && auto === null && !isTauri) return null;

  const togglePush = async () => {
    setBusy(true);
    try {
      const s = push === 'on' ? await disablePush() : await enablePush(items);
      setPush(s);
      flash(s === 'on' ? 'Notifications on for this browser' : s === 'blocked' ? 'Notifications are blocked in this browser’s site settings' : 'Notifications off for this browser');
    } catch (e) {
      flash(`Could not turn on notifications: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleAuto = async () => {
    try {
      await setAutostart(!auto);
      setAuto(await getAutostart());
    } catch (e) {
      flash((e as Error).message);
    }
  };

  return (
    <section>
      <h2>Notifications</h2>
      {push && push !== 'unsupported' && (
        <>
          <label className="switch-row">
            <input type="checkbox" checked={push === 'on'} disabled={busy || push === 'blocked'} onChange={togglePush} />
            <span>Reminders in this browser, even when Board is closed</span>
          </label>
          <p className="muted small">
            {push === 'blocked'
              ? 'This browser is blocking notifications from Board. Allow them in the site settings (the icon left of the address), then come back here.'
              : 'Turn this on once on each computer or phone browser you want reminders on. On iPhone, add Board to your home screen first.'}
          </p>
        </>
      )}
      {isTauri && auto !== null && (
        <>
          <label className="switch-row">
            <input type="checkbox" checked={auto} onChange={toggleAuto} />
            <span>Start with Windows</span>
          </label>
          <p className="muted small">Board waits in the tray after you sign in to Windows, so reminders keep coming after a restart.</p>
        </>
      )}
    </section>
  );
}
