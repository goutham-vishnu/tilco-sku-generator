// Data layer. Uses Supabase when config.js has credentials, otherwise an in-memory demo
// store seeded from the Excel (changes are lost on reload).
import * as seed from './seed.js';

const cfg = window.SKU_CONFIG || {};
export const DEMO = !(cfg.supabaseUrl && cfg.supabaseAnonKey);
export const EMAIL_DOMAIN = (cfg.allowedEmailDomain || '').toLowerCase();

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }
  return sb;
}
const ok = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

// ---------- demo store ----------
const clone = (x) => JSON.parse(JSON.stringify(x));
const today = () => new Date().toISOString().slice(0, 10);
const demo = {
  brands: clone(seed.brands), products: clone(seed.products), variants: clone(seed.variants),
  units: clone(seed.units), regions: clone(seed.regions),
  sku_log: seed.sku_log.map((r, i) => ({ id: i + 1, opened: null, ...r })),
  legacy_map: seed.legacy_map.map((r, i) => ({ id: i + 1, ...r })),
};
let demoId = 1000;

// ---------- auth ----------
export async function currentUser() {
  if (DEMO) return { email: 'demo@local' };
  const c = await client();
  const { data } = await c.auth.getSession();
  return data.session?.user || null;
}
export async function onAuthChange(fn) {
  if (DEMO) return;
  (await client()).auth.onAuthStateChange((_e, session) => fn(session?.user || null));
}
export async function signIn(email) {
  email = email.trim().toLowerCase();
  if (EMAIL_DOMAIN && !email.endsWith('@' + EMAIL_DOMAIN)) throw new Error(`Use your @${EMAIL_DOMAIN} email address.`);
  const c = await client();
  ok(await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }));
}
export async function signOut() { if (!DEMO) await (await client()).auth.signOut(); }

// ---------- reads ----------
export async function loadAll() {
  if (DEMO) return clone(demo);
  const c = await client();
  const [brands, products, variants, units, regions, sku_log, legacy_map] = await Promise.all([
    c.from('brands').select('*').order('code'),
    c.from('products').select('*').order('code'),
    c.from('variants').select('*').order('type').order('sort'),
    c.from('units').select('*').order('sort'),
    c.from('regions').select('*').order('code'),
    c.from('sku_log').select('*').order('created_at', { ascending: false }),
    c.from('legacy_map').select('*').order('created_at', { ascending: false }),
  ]).then((rs) => rs.map(ok));
  return { brands, products, variants, units, regions, sku_log, legacy_map };
}

// ---------- writes ----------
async function insert(table, row) {
  if (DEMO) {
    const r = { id: ++demoId, ...row };
    if (table === 'sku_log' && demo.sku_log.some((x) => x.sku === row.sku && x.marketplace === row.marketplace))
      throw new Error(`${row.sku} is already registered for ${row.marketplace}.`);
    if (['brands', 'products', 'variants', 'regions'].includes(table) && demo[table].some((x) => x.code === row.code))
      throw new Error(`${row.code} already exists.`);
    if (table === 'legacy_map' && demo.legacy_map.some((x) => x.legacy_sku === row.legacy_sku))
      throw new Error(`${row.legacy_sku} is already mapped.`);
    demo[table].unshift(r);
    return r;
  }
  const c = await client();
  const res = await c.from(table).insert(row).select().single();
  if (res.error?.code === '23505') throw new Error('That entry already exists.');
  return ok(res);
}
async function update(table, match, patch) {
  if (DEMO) {
    const [k, v] = Object.entries(match)[0];
    const r = demo[table].find((x) => x[k] === v);
    if (r) Object.assign(r, patch);
    return r;
  }
  const c = await client();
  let q = c.from(table).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  return ok(await q.select().single());
}

export const addLog = (row) => insert('sku_log', { opened: today(), ...row });
export const setLogStatus = (id, status) => update('sku_log', { id }, { status });
export const addLegacy = (row) => insert('legacy_map', row);
export const addBrand = (row) => insert('brands', row);
export const addProduct = (row) => insert('products', row);
export const addVariant = (row) => insert('variants', row);
export const addRegion = (row) => insert('regions', row);
export const updateProduct = (code, patch) => update('products', { code }, patch);
