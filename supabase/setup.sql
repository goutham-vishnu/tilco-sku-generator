-- Tilco SKU Generator: database schema for Supabase.
-- Run once in Supabase → SQL Editor (setup.sql = this file + seed data).
-- Access: only signed-in users with an @tilcotrading.com email can read or write.
-- Nothing can be deleted (codes and SKUs are never reused, rules 12 + 15).

create or replace function public.is_tilco() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@tilcotrading.com'
$$;

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


-- ---------- Seed data (from SKU Naming Convention — Tilco (FINAL).xlsx) ----------

insert into public.brands (code, name, notes) values
  ('TC', 'Tilcare', 'Core consumer health / personal care'),
  ('PM', 'Pill Mill', 'Pill management'),
  ('TCR', 'Tilcore', 'Never write as TCORE or TILCORE'),
  ('TCC', 'Tilcare Chew Chew', 'Sensory / chew products'),
  ('GP', 'GyraPress', 'Coffee devices'),
  ('TV', 'Tilvolt', 'Scope to confirm (open decision 5)')
on conflict do nothing;

insert into public.units (code, letter, name, short, sort) values
  ('OZ', '', 'Ounces', 'oz', '0'),
  ('L', 'L', 'Litres', 'L', '1'),
  ('M', 'M', 'Millilitres', 'mL', '2'),
  ('G', 'G', 'Grams', 'g', '3'),
  ('C', 'C', 'Centimetres', 'cm', '4')
on conflict do nothing;

insert into public.products (code, name, brand, status, cap_unit, notes) values
  ('S', 'Protein shaker, plastic', 'TCR', 'PROPOSED', 'OZ', 'Capacity in oz, e.g. 12S'),
  ('GS', 'Protein shaker, glass', 'TCR', 'PROPOSED', 'OZ', 'e.g. 12GS'),
  ('URN', 'Urinal bottle', 'TC', 'PROPOSED', 'L', 'Capacity in L, e.g. 01LURN / 03LURN'),
  ('BP', 'Bedpan', 'TC', 'PROPOSED', null, ''),
  ('SYR', 'Oral / medical syringe', 'TC', 'PROPOSED', 'M', 'Capacity in mL: 01M 03M 05M 20M 30M'),
  ('SYP', 'Pet insulin syringe (U40)', 'TC', 'PROPOSED', null, ''),
  ('EWM', 'Ear washer, manual', 'TC', 'PROPOSED', null, ''),
  ('EWV', 'Ear washer, vacuum', 'TC', 'PROPOSED', null, 'See open decision 1'),
  ('EWK', 'Ear wax removal kit', 'TC', 'PROPOSED', null, ''),
  ('EAD', 'Ear dryer', 'TC', 'PROPOSED', null, ''),
  ('EPB', 'Ear popper, balloon', 'TC', 'PROPOSED', null, ''),
  ('EPU', 'Ear popper, electric', 'TC', 'PROPOSED', null, ''),
  ('PCR', 'Pill crusher, manual', 'PM', 'PROPOSED', null, ''),
  ('PCE', 'Pill crusher, electric', 'PM', 'PROPOSED', null, ''),
  ('PCS', 'Pill crusher, electric small', 'PM', 'PROPOSED', null, ''),
  ('PCT', 'Pill cutter', 'PM', 'PROPOSED', null, 'Changed from PCS (was a duplicate)'),
  ('PB', 'Pill bags', 'PM', 'PROPOSED', null, 'Pack size in the pack block: P100 / P500'),
  ('HB', 'Holder belt', 'PM', 'PROPOSED', null, 'Size in the variant block: SM / XL. Brand: open decision 2'),
  ('CHW', 'Chew necklace / sensory aid', 'TCC', 'PROPOSED', null, ''),
  ('ICL', 'Insulin cooler', 'TC', 'PROPOSED', null, ''),
  ('SRK', 'Sinus rinse kit', 'TC', 'PROPOSED', null, ''),
  ('DRM', 'Derma roller', 'TC', 'PROPOSED', null, ''),
  ('CLN', 'Clothesline', 'TC', 'PROPOSED', null, ''),
  ('TWB', 'Travel wash bag', 'TC', 'PROPOSED', null, ''),
  ('VNT', 'HVAC vent deflector', 'TC', 'PROPOSED', null, ''),
  ('LOF', 'Loofah', 'TC', 'PROPOSED', null, ''),
  ('HWB', 'Hair washing basin', 'TC', 'PROPOSED', null, ''),
  ('BRT', 'Breather', 'TC', 'PROPOSED', null, 'Changed from BR (clashed with colour Brown)'),
  ('PMS', 'Pet massager', 'TC', 'PROPOSED', null, ''),
  ('CP', 'Coffee press filter', 'GP', 'PROPOSED', null, ''),
  ('TPC', 'Toothpaste caps', 'TC', 'PROPOSED', null, 'Added: used in SKU Log (TC-TPC-P6-V4) but missing from the registry')
on conflict do nothing;

insert into public.variants (code, name, type, notes, sort) values
  ('BK', 'Black', 'COLOUR', '', '0'),
  ('BL', 'Blue', 'COLOUR', '', '1'),
  ('WH', 'White', 'COLOUR', '', '2'),
  ('GY', 'Grey', 'COLOUR', 'Not to be confused with GR (Green)', '3'),
  ('GR', 'Green', 'COLOUR', '', '4'),
  ('RD', 'Red', 'COLOUR', '', '5'),
  ('PK', 'Pink', 'COLOUR', '', '6'),
  ('PU', 'Purple', 'COLOUR', '', '7'),
  ('OR', 'Orange', 'COLOUR', '', '8'),
  ('YL', 'Yellow', 'COLOUR', '', '9'),
  ('CL', 'Clear', 'COLOUR', '', '10'),
  ('BG', 'Beige', 'COLOUR', '', '11'),
  ('BR', 'Brown', 'COLOUR', '', '12'),
  ('S', 'Small', 'SIZE', '', '13'),
  ('M', 'Medium', 'SIZE', '', '14'),
  ('L', 'Large', 'SIZE', '', '15'),
  ('XL', 'Extra Large', 'SIZE', '', '16'),
  ('SM', 'Small/Medium, one combined size', 'SIZE', 'Only for products sold as a single S/M size (Holder Belt)', '17')
on conflict do nothing;

insert into public.regions (code, name) values
  ('EU', 'Europe'),
  ('JP', 'Japan'),
  ('UK', 'United Kingdom'),
  ('CA', 'Canada'),
  ('AU', 'Australia')
on conflict do nothing;

insert into public.sku_log (sku, product, asin, marketplace, opened, reason, supplier, status, notes) values
  ('TC-01LURN-P1-V11', 'Male Urinal 1 pack', 'B07V2D9KY1', 'USA', null, 'New Supplier', 'Winona', 'ACTIVE', 'Known exception: live with P1 (Amazon SKUs cannot be renamed). New singles never get P1.'),
  ('TC-01LURN-P2-V11', 'Male Urinal 2 pack', 'B07Z88ZHR3', 'USA', null, 'New Supplier', 'Winona', 'ACTIVE', ''),
  ('TC-01LURN-P3-V11', 'Male Urinal 3 pack', 'B07MBB6B6K', 'USA', null, 'New Supplier', 'Winona', 'ACTIVE', ''),
  ('TC-PMS-V3', 'Electric Pet Massager', 'B09NQ6QW4Q', 'USA', null, 'New Supplier', 'Hangzhou Manqi Trading Co., Ltd.', 'ACTIVE', ''),
  ('TC-PMS-V2', 'Electric Pet Massager', 'B09NQ6QW4Q', 'JP', null, '', '', 'ACTIVE', ''),
  ('TC-TPC-P6-V4', 'Toothpaste Caps', 'B09CYM5MFM', 'JP', null, 'will be pack in tin box', '', 'ACTIVE', ''),
  ('TC-BP-V2', 'Bedpan', 'B09CV1HWBV', 'All Markets except CA', null, '', '', 'ACTIVE', '')
on conflict do nothing;



-- Enforce rule 14 for everything logged from now on.

drop trigger if exists sku_product_confirmed on public.sku_log;

create trigger sku_product_confirmed before insert on public.sku_log for each row execute function public.check_sku_product_confirmed();
