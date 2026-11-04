// Builds supabase/setup.sql = schema + seed data from js/seed.js + the rule-14 trigger.
// Run with: node scripts/make-setup-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import * as seed from '../js/seed.js';

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, cols, rows) =>
  rows.length ? `insert into public.${table} (${cols.join(', ')}) values\n` +
    rows.map((r) => '  (' + cols.map((c) => q(r[c])).join(', ') + ')').join(',\n') + '\non conflict do nothing;\n' : '';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const sql = [
  schema,
  '\n-- ---------- Seed data (from SKU Naming Convention — Tilco (FINAL).xlsx) ----------\n',
  insert('brands', ['code', 'name', 'notes'], seed.brands.map((b) => ({ notes: '', ...b }))),
  insert('units', ['code', 'letter', 'name', 'short', 'sort'], seed.units.map((u, i) => ({ ...u, sort: i }))),
  insert('products', ['code', 'name', 'brand', 'status', 'cap_unit', 'notes'], seed.products),
  insert('variants', ['code', 'name', 'type', 'notes', 'sort'], seed.variants.map((v, i) => ({ notes: '', ...v, sort: i }))),
  insert('regions', ['code', 'name'], seed.regions),
  insert('sku_log', ['sku', 'product', 'asin', 'marketplace', 'opened', 'reason', 'supplier', 'status', 'notes'],
    seed.sku_log.map((r) => ({ asin: '', reason: '', supplier: '', notes: '', opened: null, ...r }))),
  insert('legacy_map', ['legacy_sku', 'new_sku', 'product', 'status', 'notes'], seed.legacy_map),
  '\n-- Enforce rule 14 for everything logged from now on.\n',
  'drop trigger if exists sku_product_confirmed on public.sku_log;\n',
  'create trigger sku_product_confirmed before insert on public.sku_log for each row execute function public.check_sku_product_confirmed();\n',
].join('\n');

writeFileSync(new URL('../supabase/setup.sql', import.meta.url), sql);
console.log('Wrote supabase/setup.sql');
