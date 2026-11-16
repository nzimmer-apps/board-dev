// Settings: colour theme, export, import, account.
import { useState } from 'react';
import { THEMES, type ThemeId } from './theme';
import { FORMATS, build, fetchAll, save, type Format } from './export';
import { supabase, type Item } from './supabase';
import Import from './Import';
import Notifications from './Notifications';

export function ThemeSwatches({ theme, onTheme }: { theme: ThemeId; onTheme: (t: ThemeId) => void }) {
  return (
    <div className="themes">
      {THEMES.map((t) => (
        <button key={t.id} className={theme === t.id ? 'theme on' : 'theme'} aria-pressed={theme === t.id} onClick={() => onTheme(t.id)}>
          <span className="dot" style={{ background: t.bg, borderColor: t.accent }}><i style={{ background: t.accent }} /></span>
          {t.name}
        </button>
      ))}
    </div>
  );
}

interface Props {
  theme: ThemeId;
  onTheme: (t: ThemeId) => void;
  email: string;
  flash: (m: string) => void;
  onImported: () => void;
  items: Item[];
}

export default function More({ theme, onTheme, email, flash, onImported, items }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function run(format: Format, how: 'save' | 'copy') {
    setBusy(format + how);
    try {
      const items = await fetchAll();
      const file = build(format, items);
      if (how === 'copy') {
        await navigator.clipboard.writeText(file.text);
        flash(`Copied ${items.length} notes`);
      } else {
        const r = await save(file);
        flash(r === 'downloaded' ? `Saved ${file.name}` : 'Exported');
      }
    } catch (e) {
      flash(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="more">
      <section>
        <h2>Colour theme</h2>
        <ThemeSwatches theme={theme} onTheme={onTheme} />
        <p className="muted small">Saved on this device. Each tag can have its own colour too, under Tags.</p>
      </section>

      <Notifications items={items} flash={flash} />

      <section>
        <h2>Export</h2>
        <p className="muted small">Every export includes archived notes. Images, PDFs and recordings stay in Board; their text is included.</p>
        <ul className="exports">
          {FORMATS.map((f) => (
            <li key={f.id}>
              <div>
                <b>{f.name}</b>
                <div className="muted small">{f.hint}</div>
              </div>
              <span className="acts">
                <button className="small primary" disabled={!!busy} onClick={() => run(f.id, 'save')}>{busy === f.id + 'save' ? '…' : 'Download'}</button>
                <button className="small" disabled={!!busy} onClick={() => run(f.id, 'copy')}>{busy === f.id + 'copy' ? '…' : 'Copy'}</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Import flash={flash} onImported={onImported} />

      <section>
        <h2>Account</h2>
        <p className="muted small">Signed in as {email}</p>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </section>
    </main>
  );
}
