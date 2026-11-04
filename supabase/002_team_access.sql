-- Run this once in Supabase → SQL Editor if you already ran setup.sql before 4 Nov 2026.
-- Adds the Team access list so people without a @tilcotrading.com email can be let in.

-- Outside team members (e.g. Gmail users) who may use the site. @tilcotrading.com emails don't need a row.
create table if not exists public.allowed_emails (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  name text not null default '',
  added_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

-- Who may use the site: any @tilcotrading.com email, or an email on the allowed list.
-- security definer so it can read allowed_emails without tripping over that table's own policies.
create or replace function public.is_tilco() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@tilcotrading.com'
      or exists (select 1 from public.allowed_emails where email = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
grant execute on function public.is_tilco() to authenticated;

-- Team access list: members can add and remove outside emails (removing is allowed here, unlike codes and SKUs).
alter table public.allowed_emails enable row level security;
drop policy if exists "tilco read" on public.allowed_emails;
create policy "tilco read" on public.allowed_emails for select to authenticated using (public.is_tilco());
drop policy if exists "tilco insert" on public.allowed_emails;
create policy "tilco insert" on public.allowed_emails for insert to authenticated with check (public.is_tilco());
drop policy if exists "tilco delete" on public.allowed_emails;
create policy "tilco delete" on public.allowed_emails for delete to authenticated using (public.is_tilco());
revoke update on public.allowed_emails from anon, authenticated;
