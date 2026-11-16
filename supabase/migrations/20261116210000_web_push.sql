-- Web push: reminders reach a browser even when no Board tab is open.
--
-- How it fits together:
--   * Each browser that turns on notifications saves its push address in push_subscriptions.
--   * The app works out the next 30 days of reminder times (it already does this for Android, in the
--     user's own time zone) and stores them in push_schedule with set_push_schedule().
--   * Every minute pg_cron calls the `push` edge function, which sends whatever has come due.
--   * The signing keys (VAPID) are made by the edge function on its first run. The private half lives in
--     Supabase Vault and is never shown to anyone; the public half is in push_config for browsers to read.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions" on public.push_subscriptions
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);

create table if not exists public.push_schedule (
  user_id  uuid not null references auth.users(id) on delete cascade,
  key      text not null,
  fire_at  timestamptz not null,
  title    text not null,
  body     text not null,
  item_id  uuid,
  sent_at  timestamptz,
  primary key (user_id, key)
);
alter table public.push_schedule enable row level security;
create index if not exists push_schedule_due on public.push_schedule (fire_at) where sent_at is null;

-- Only the public key; readable by signed-in users.
create table if not exists public.push_config (
  id         int primary key default 1 check (id = 1),
  public_key text not null
);
alter table public.push_config enable row level security;
drop policy if exists "read push config" on public.push_config;
create policy "read push config" on public.push_config for select to authenticated using (true);

-- Replace this user's upcoming (unsent) reminders with a fresh list. Already-sent ones are kept so they never repeat.
create or replace function public.set_push_schedule(rows jsonb)
returns int language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if not exists (select 1 from public.push_subscriptions where user_id = uid) then return 0; end if;
  delete from public.push_schedule where user_id = uid and sent_at is null;
  insert into public.push_schedule (user_id, key, fire_at, title, body, item_id)
  select uid, r->>'key', (r->>'fire_at')::timestamptz, left(r->>'title', 200), left(r->>'body', 300), nullif(r->>'item_id', '')::uuid
  from jsonb_array_elements(coalesce(rows, '[]'::jsonb)) r
  where (r->>'fire_at')::timestamptz > now() - interval '2 minutes'
  limit 300
  on conflict (user_id, key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
-- The function runs as the caller, so it needs these rights; RLS still limits them to the caller's rows.
grant delete, insert on public.push_schedule to authenticated;
drop policy if exists "own push schedule write" on public.push_schedule;
create policy "own push schedule write" on public.push_schedule
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Vault access for the edge function only (it calls these with the service role).
create or replace function public.push_secret(secret_name text)
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name limit 1
$$;
create or replace function public.push_save_keys(private_jwk text, public_key text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from vault.secrets where name = 'push_vapid_private') then return; end if;
  perform vault.create_secret(private_jwk, 'push_vapid_private');
  insert into public.push_config (id, public_key) values (1, public_key)
    on conflict (id) do update set public_key = excluded.public_key;
end $$;
revoke all on function public.push_secret(text) from public, anon, authenticated;
revoke all on function public.push_save_keys(text, text) from public, anon, authenticated;
grant execute on function public.push_secret(text) to service_role;
grant execute on function public.push_save_keys(text, text) to service_role;

-- A random password the timer sends so only it can trigger sending. Made here, never printed.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_cron') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_cron');
  end if;
end $$;

-- Every minute: call the push function. The project URL comes from the vault secret 'project_url'
-- (set once per project: select vault.create_secret('https://<ref>.supabase.co', 'project_url');).
select cron.unschedule('board-push') where exists (select 1 from cron.job where jobname = 'board-push');
select cron.schedule('board-push', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
$$);
