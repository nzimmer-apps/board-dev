-- Notes brought in from a file (backup, calendar, Google Keep, text) are marked source = 'import'.
alter table public.items drop constraint if exists items_source_check;
alter table public.items add constraint items_source_check
  check (source in ('app','share','extension','email','sms','import'));
