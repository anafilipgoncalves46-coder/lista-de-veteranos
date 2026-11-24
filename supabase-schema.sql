create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text unique,
  name text not null default 'Utilizador',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles alter column email drop not null;
alter table public.profiles add column if not exists name text not null default 'Utilizador';

update public.profiles as profile
set name = coalesce(
  nullif(auth_user.raw_user_meta_data ->> 'name', ''),
  nullif(split_part(coalesce(profile.email, ''), '@', 1), ''),
  'Utilizador'
)
from auth.users as auth_user
where profile.id = auth_user.id
  and profile.name = 'Utilizador';

insert into public.profiles (id, email, name)
select
  auth_user.id,
  auth_user.email,
  coalesce(
    nullif(auth_user.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
    'Utilizador'
  )
from auth.users as auth_user
on conflict (id) do nothing;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  phone text not null check (char_length(btrim(phone)) between 3 and 25),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.contacts add column if not exists contact_year integer;
alter table public.contacts drop constraint if exists contacts_contact_year_check;
alter table public.contacts
  add constraint contacts_contact_year_check
  check (contact_year is null or contact_year between 1 and 9999);

create table if not exists public.call_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  contact_name text not null check (char_length(btrim(contact_name)) between 1 and 60),
  phone text not null check (char_length(btrim(phone)) between 3 and 25),
  attempted_at timestamptz not null default now(),
  outcome text not null default 'calling' check (outcome in ('calling', 'answered', 'no_answer')),
  reminder_at timestamptz,
  reminder_completed_at timestamptz,
  note text,
  check ((outcome = 'no_answer' and reminder_at is not null) or (outcome <> 'no_answer' and reminder_at is null)),
  check (reminder_completed_at is null or outcome = 'no_answer')
);

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.call_logs enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.contacts from anon, authenticated;
grant select, insert, update, delete on public.contacts to authenticated;
revoke all on public.call_logs from anon, authenticated;
grant select on public.call_logs to authenticated;
grant insert (user_id, contact_id, contact_name, phone) on public.call_logs to authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Users can read their own profile and admins can read all" on public.profiles;
create policy "Users can read their own profile and admins can read all"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Authenticated users can read contacts" on public.contacts;
create policy "Authenticated users can read contacts"
  on public.contacts for select to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
        and email is not null
    )
  );

drop policy if exists "Admins can add contacts" on public.contacts;
create policy "Admins can add contacts"
  on public.contacts for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can edit contacts" on public.contacts;
create policy "Admins can edit contacts"
  on public.contacts for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can delete contacts" on public.contacts;
create policy "Admins can delete contacts"
  on public.contacts for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Users can read their own call history" on public.call_logs;
create policy "Users can read their own call history"
  on public.call_logs for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
        and email is not null
    )
  );

drop policy if exists "Users can record their own call attempts" on public.call_logs;
create policy "Users can record their own call attempts"
  on public.call_logs for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.profiles
      where id = (select auth.uid())
        and email is not null
    )
    and outcome = 'calling'
    and reminder_at is null
    and reminder_completed_at is null
  );

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'name', ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Utilizador'
    )
  )
  on conflict (id) do update
  set email = excluded.email,
      name = excluded.name;
  return new;
end;
$$;

revoke all on function public.sync_auth_user_profile() from public, anon, authenticated;

drop trigger if exists sync_auth_user_profile on auth.users;
create trigger sync_auth_user_profile
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.sync_auth_user_profile();

create or replace function public.admin_set_user_role(target_user_id uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  if new_role not in ('user', 'admin') then
    raise exception 'Invalid role';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Administrators cannot change their own role';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(78112026);

  if new_role = 'user' and exists (
    select 1 from public.profiles where id = target_user_id and role = 'admin'
  ) and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'The last administrator cannot be demoted';
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id;

  if not found then
    raise exception 'Account not found';
  end if;
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated;

drop function if exists public.set_call_outcome(uuid, text);
drop function if exists public.set_call_outcome(uuid, text, text);

create or replace function public.set_call_outcome(
  target_call_id uuid,
  call_outcome text,
  call_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if call_outcome is null or call_outcome not in ('answered', 'no_answer') then
    raise exception 'Invalid call outcome';
  end if;

  if call_note is not null and pg_catalog.char_length(call_note) > 1000 then
    raise exception 'Call note is too long';
  end if;

  update public.call_logs
  set outcome = call_outcome,
      reminder_at = case
        when call_outcome = 'no_answer' then pg_catalog.clock_timestamp() + interval '15 minutes'
        else null
      end,
      reminder_completed_at = null,
      note = coalesce(
        nullif(pg_catalog.btrim(call_note), ''),
        case
          when call_outcome = 'no_answer' then 'Não atendeu. Lembrete para voltar a ligar em 15 minutos.'
          else null
        end
      )
  where id = target_call_id
    and user_id = (select auth.uid())
    and outcome = 'calling';

  if not found then
    raise exception 'Call not found or already updated';
  end if;
end;
$$;

revoke all on function public.set_call_outcome(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_call_outcome(uuid, text, text) to authenticated;

create or replace function public.complete_call_reminder(target_call_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.call_logs
  set reminder_completed_at = pg_catalog.clock_timestamp()
  where id = target_call_id
    and user_id = (select auth.uid())
    and outcome = 'no_answer'
    and reminder_completed_at is null;

  if not found then
    raise exception 'Pending reminder not found';
  end if;
end;
$$;

revoke all on function public.complete_call_reminder(uuid) from public, anon, authenticated;
grant execute on function public.complete_call_reminder(uuid) to authenticated;
