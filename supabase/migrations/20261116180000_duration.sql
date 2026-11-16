-- How long an event lasts, in minutes (up to 30 days). Null = no end time.
-- A length rather than an end time, so repeating events keep it on every occurrence.
alter table public.items add column if not exists duration_min int
  check (duration_min is null or duration_min between 1 and 43200);
