// Snooze choices shared by the card menu and the Android notification buttons.

export type SnoozeChoice = '10m' | '1h' | '3h' | 'tomorrow';

export const SNOOZE_CHOICES: { id: SnoozeChoice; label: string }[] = [
  { id: '10m', label: '10 minutes' },
  { id: '1h', label: '1 hour' },
  { id: '3h', label: '3 hours' },
  { id: 'tomorrow', label: 'Tomorrow 9 AM' },
];

/** When a snooze chosen at `now` should ring again. */
export function snoozeUntil(choice: SnoozeChoice, now = new Date()): Date {
  if (choice === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  const mins = choice === '10m' ? 10 : choice === '1h' ? 60 : 180;
  return new Date(now.getTime() + mins * 60e3);
}

export function snoozeLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  return d.toLocaleString([], sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
