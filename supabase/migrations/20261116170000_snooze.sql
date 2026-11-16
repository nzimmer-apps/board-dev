-- Snooze: one extra reminder at this time, on top of the item's usual warnings.
-- Cleared when the item is ticked off or the snooze is cancelled.
alter table public.items add column if not exists snoozed_until timestamptz;
