-- Tilco SKU Generator: database schema for Supabase.
-- Run once in Supabase → SQL Editor (setup.sql = this file + seed data).
-- Access: only signed-in users with an @tilcotrading.com email, or an email on the Team access list, can read or write.
-- Nothing can be deleted (codes and SKUs are never reused, rules 12 + 15).

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

create table if not exists public.brands (
  code text primary key check (code ~ '^[A-Z]{2,3}$'),
  name text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.units (
  code text primary key,
  letter text not null default '',
  name text not null,
  short text not null,
  sort int not null default 100
);

create table if not exists public.products (
  code text primary key check (code ~ '^[A-Z][A-Z0-9]*$'),
  name text not null,
  brand text not null references public.brands(code),
  status text not null default 'PROPOSED' check (status in ('PROPOSED', 'CONFIRMED', 'DISCONTINUED')),
  cap_unit text references public.units(code),
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.variants (
  code text primary key check (code ~ '^[A-Z]+$'),
  name text not null,
  type text not null check (type in ('COLOUR', 'SIZE')),
  notes text not null default '',
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.regions (
  code text primary key check (code ~ '^[A-Z]{2,3}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sku_log (
  id bigint generated always as identity primary key,
  sku text not null check (sku ~ '^[A-Z0-9-]+$'),
  product text not null default '',
  asin text not null default '',
  marketplace text not null,
  opened date default current_date,
  reason text not null default '',
  supplier text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SELLING OUT', 'RETIRED')),
  notes text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  unique (sku, marketplace)
);

create table if not exists public.legacy_map (
  id bigint generated always as identity primary key,
  legacy_sku text not null unique,
  new_sku text not null check (new_sku ~ '^[A-Z0-9-]+$'),
  product text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SELLING OUT', 'RETIRED')),
  notes text not null default '',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

-- Row level security: Tilco users only, no deletes.
do $$
declare t text;
begin
  foreach t in array array['brands','units','products','variants','regions','sku_log','legacy_map'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "tilco read" on public.%I', t);
    execute format('create policy "tilco read" on public.%I for select to authenticated using (public.is_tilco())', t);
    if t <> 'units' then
      execute format('drop policy if exists "tilco insert" on public.%I', t);
      execute format('create policy "tilco insert" on public.%I for insert to authenticated with check (public.is_tilco())', t);
    end if;
    execute format('revoke delete on public.%I from anon, authenticated', t);
    execute format('revoke update on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Only these columns can ever change. Codes and SKUs are fixed once created.
drop policy if exists "tilco update" on public.products;
create policy "tilco update" on public.products for update to authenticated using (public.is_tilco()) with check (public.is_tilco());
grant update (status, name, notes) on public.products to authenticated;

drop policy if exists "tilco update" on public.sku_log;
create policy "tilco update" on public.sku_log for update to authenticated using (public.is_tilco()) with check (public.is_tilco());
grant update (status, notes, asin, reason, supplier) on public.sku_log to authenticated;

drop policy if exists "tilco update" on public.legacy_map;
create policy "tilco update" on public.legacy_map for update to authenticated using (public.is_tilco()) with check (public.is_tilco());
grant update (status, notes) on public.legacy_map to authenticated;

-- Rule 14, enforced in the database too: a SKU can't be logged while its product code is not CONFIRMED.
-- Rows imported by the setup script bypass this (they're inserted before the trigger exists).
create or replace function public.check_sku_product_confirmed() returns trigger
language plpgsql as $$
declare cp text; prod text; st text;
begin
  cp := split_part(new.sku, '-', 2);
  prod := regexp_replace(cp, '^[0-9]+', '');
  select status into st from public.products where code = prod;
  if st is null and prod ~ '^[LMGC]' then
    select status into st from public.products where code = substr(prod, 2);
  end if;
  if st is distinct from 'CONFIRMED' then
    raise exception 'Product code in % is not CONFIRMED (rule 14).', new.sku;
  end if;
  return new;
end $$;

-- Team access list: members can add and remove outside emails (removing is allowed here, unlike codes and SKUs).
alter table public.allowed_emails enable row level security;
drop policy if exists "tilco read" on public.allowed_emails;
create policy "tilco read" on public.allowed_emails for select to authenticated using (public.is_tilco());
drop policy if exists "tilco insert" on public.allowed_emails;
create policy "tilco insert" on public.allowed_emails for insert to authenticated with check (public.is_tilco());
drop policy if exists "tilco delete" on public.allowed_emails;
create policy "tilco delete" on public.allowed_emails for delete to authenticated using (public.is_tilco());
revoke update on public.allowed_emails from anon, authenticated;
