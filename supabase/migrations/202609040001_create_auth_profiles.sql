-- Entertainment AI identity profiles for Supabase Auth users.
-- Taste and onboarding data remain in public.user_profiles.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

comment on table public.profiles is 'Public-facing identity metadata synchronized from Supabase Auth.';
comment on column public.profiles.id is 'Supabase Auth user identifier.';
comment on column public.profiles.email is 'Account email copied from auth.users for application display.';
comment on column public.profiles.full_name is 'Display name supplied by Google OAuth or email signup.';
comment on column public.profiles.avatar_url is 'Profile image supplied by the OAuth provider.';
comment on column public.profiles.created_at is 'Time the application identity profile was created.';

create or replace function public.create_identity_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'username'), ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'), '')
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);
  return new;
end;
$$;

drop trigger if exists auth_user_created_identity_profile on auth.users;
create trigger auth_user_created_identity_profile
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.create_identity_profile_for_new_user();

insert into public.profiles (id, email, full_name, avatar_url, created_at)
select
  id,
  email,
  nullif(coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name', raw_user_meta_data ->> 'username'), ''),
  nullif(coalesce(raw_user_meta_data ->> 'avatar_url', raw_user_meta_data ->> 'picture'), ''),
  created_at
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
for select to authenticated using ((select auth.uid()) = id);
create policy profiles_insert_own on public.profiles
for insert to authenticated with check ((select auth.uid()) = id);
create policy profiles_update_own on public.profiles
for update to authenticated
using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

grant select, insert, update on table public.profiles to authenticated;
grant all on table public.profiles to service_role;
revoke execute on function public.create_identity_profile_for_new_user() from public, anon, authenticated;

commit;
