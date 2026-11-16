-- Sharing: a note or a whole tag can be shared with another Board user (by email) or through a secret link.
--
--   * One row in `shares` per share. Exactly one of item_id / tag says WHAT is shared, and exactly one of
--     recipient_email / token says WITH WHOM (a person, or anyone holding the link).
--   * A person sees what is shared with them once they sign in with that email (it must be confirmed).
--     can_edit lets them change the text, dates and ticks; only the owner can pin, archive, delete or re-own a note.
--   * Links are always read-only. They are opened through the `shared` edge function, which looks the token up
--     with the service key, so nobody without the link can list or guess them.

create table if not exists public.shares (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  owner_email     text,
  item_id         uuid references public.items(id) on delete cascade,
  tag             text,
  recipient_email text,
  token           text unique,
  can_edit        boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint shares_one_target check ((item_id is null) <> (tag is null)),
  constraint shares_one_audience check ((recipient_email is null) <> (token is null)),
  constraint shares_link_read_only check (token is null or not can_edit),
  constraint shares_token_long check (token is null or length(token) >= 20),
  constraint shares_email_lower check (recipient_email is null or recipient_email = lower(trim(recipient_email))),
  constraint shares_tag_lower check (tag is null or tag = lower(tag))
);
create unique index if not exists shares_person_item on public.shares (owner_id, item_id, recipient_email) where item_id is not null and recipient_email is not null;
create unique index if not exists shares_person_tag on public.shares (owner_id, tag, recipient_email) where tag is not null and recipient_email is not null;
create index if not exists shares_recipient on public.shares (recipient_email) where recipient_email is not null;
create index if not exists shares_item on public.shares (item_id) where item_id is not null;
create index if not exists items_image_path on public.items (image_path) where image_path is not null;
create index if not exists items_file_path on public.items (file_path) where file_path is not null;

-- The signed-in user's email, only once it is confirmed (so nobody can claim someone else's address).
create or replace function public.my_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;

-- 0 = not shared with me, 1 = I can look, 2 = I can edit.
create or replace function public.share_access(p_owner uuid, p_item uuid, p_tags text[]) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(case when s.can_edit then 2 else 1 end), 0)
    from public.shares s
   where s.owner_id = p_owner
     and s.recipient_email is not null
     and s.recipient_email = public.my_email()
     and (s.item_id = p_item or s.tag = any(p_tags))
$$;

-- An attachment is readable when the note it belongs to is shared with me.
create or replace function public.can_read_shared_file(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.items i
     where (i.image_path = p_path or i.file_path = p_path)
       and public.share_access(i.user_id, i.id, i.tags) >= 1
  )
$$;

revoke execute on function public.my_email() from public, anon;
revoke execute on function public.share_access(uuid, uuid, text[]) from public, anon;
revoke execute on function public.can_read_shared_file(text) from public, anon;
grant execute on function public.my_email() to authenticated;
grant execute on function public.share_access(uuid, uuid, text[]) to authenticated;
grant execute on function public.can_read_shared_file(text) to authenticated;

-- Owner's email is copied onto the share so the other person can see who it is from.
create or replace function public.shares_fill_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.owner_email := (select lower(email) from auth.users where id = new.owner_id);
  return new;
end $$;
drop trigger if exists shares_fill_owner on public.shares;
create trigger shares_fill_owner before insert or update of owner_id on public.shares
  for each row execute function public.shares_fill_owner();

alter table public.shares enable row level security;
drop policy if exists "own shares" on public.shares;
create policy "own shares" on public.shares for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (item_id is null or exists (select 1 from public.items i where i.id = item_id and i.user_id = (select auth.uid())))
    and (recipient_email is null or recipient_email is distinct from public.my_email())
  );
drop policy if exists "shares with me" on public.shares;
create policy "shares with me" on public.shares for select to authenticated
  using (recipient_email = (select public.my_email()));
-- The person a share was meant for may also remove it ("leave").
drop policy if exists "leave shares" on public.shares;
create policy "leave shares" on public.shares for delete to authenticated
  using (recipient_email = (select public.my_email()));

-- Notes: the owner's own policy stays; these add read / edit for people they were shared with.
drop policy if exists "shared items read" on public.items;
create policy "shared items read" on public.items for select to authenticated
  using (user_id <> (select auth.uid()) and public.share_access(user_id, id, tags) >= 1);
drop policy if exists "shared items edit" on public.items;
create policy "shared items edit" on public.items for update to authenticated
  using (user_id <> (select auth.uid()) and public.share_access(user_id, id, tags) = 2)
  with check (public.share_access(user_id, id, tags) = 2);

-- Someone editing a shared note can't take it over or change the owner's own board (pin, archive, attachments).
create or replace function public.items_guard_shared_edit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and old.user_id <> auth.uid() then
    if new.user_id is distinct from old.user_id or new.archived is distinct from old.archived
       or new.pinned is distinct from old.pinned or new.image_path is distinct from old.image_path
       or new.file_path is distinct from old.file_path or new.source is distinct from old.source then
      raise exception 'Only the owner of this note can do that';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists items_guard_shared_edit on public.items;
create trigger items_guard_shared_edit before update on public.items
  for each row execute function public.items_guard_shared_edit();

-- Attachments of shared notes.
drop policy if exists "shared images read" on storage.objects;
create policy "shared images read" on storage.objects for select to authenticated
  using (bucket_id = 'images' and public.can_read_shared_file(name));
drop policy if exists "shared files read" on storage.objects;
create policy "shared files read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.can_read_shared_file(name));

-- Live updates for the share list.
do $$ begin
  alter publication supabase_realtime add table public.shares;
exception when duplicate_object then null; end $$;
