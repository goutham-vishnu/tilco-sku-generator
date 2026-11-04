import * as store from './store.js';
import { makeRegistry, buildSku, parseSku, describe, nextVersion, checkNewCode, ordinal } from './sku.js';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const badge = (s) => s ? `<span class="badge ${esc(String(s).replace(/ /g, '_'))}">${esc(s)}</span>` : '';
const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(label)}</option>`;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); }
const msgList = (cls, items) => items.length ? `<div class="msg ${cls}">${items.length === 1 ? esc(items[0]) : '<ul>' + items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>'}</div>` : '';

const MARKETPLACES = ['USA', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'PL', 'JP', 'AU', 'AE', 'SA', 'IN', 'All markets'];
const REASONS = ['New product', 'New Supplier', 'New packaging', 'Relisted ASIN', 'SKU switch', 'New marketplace'];
const LOG_STATUSES = ['ACTIVE', 'SELLING OUT', 'RETIRED'];
const PRODUCT_STATUSES = ['PROPOSED', 'CONFIRMED', 'DISCONTINUED'];

// ---------- state ----------
const S = {
  data: null, reg: null, tab: 'generate', user: null,
  form: { brand: '', product: '', capacity: '', colours: [], size: '', pack: 1, region: '', override: false, version: '' },
  regForm: { asin: '', marketplace: 'USA', reason: '', supplier: '', notes: '', markOld: true },
  decode: '', logQuery: '',
};
const allSkus = () => [...S.data.sku_log.map((r) => r.sku), ...S.data.legacy_map.map((r) => r.new_sku)].filter(Boolean);

async function reload() {
  S.data = await store.loadAll();
  S.reg = makeRegistry(S.data);
}

// ---------- boot ----------
async function boot() {
  if (store.CONFIG_BROKEN) {
    $('#app').innerHTML = `<div class="panel">${msgList('err', ['config.js could not be read, so the site can\'t connect to the database. It usually means a typo in that file, e.g. a missing quote or comma. Open the browser console (F12) to see the exact line.'])}</div>`;
    return;
  }
  if (store.DEMO) $('#demo-banner').hidden = false;
  try {
    S.user = await store.currentUser();
    store.onAuthChange(async (u) => { const had = !!S.user; S.user = u; if (!!u !== had) await start(); });
    await start();
  } catch (e) {
    $('#app').innerHTML = `<div class="panel">${msgList('err', ['Could not start: ' + e.message])}</div>`;
  }
}

async function start() {
  renderUser();
  if (!S.user) { $('#tabs').hidden = true; return renderLogin(); }
  if (!(await store.hasAccess())) { $('#tabs').hidden = true; return renderNoAccess(); }
  $('#tabs').hidden = false;
  try { await reload(); S.loadError = ''; }
  catch (e) { S.data = null; S.loadError = e.message; }
  render();
}

function renderUser() {
  const box = $('#userbox');
  if (!S.user || store.DEMO) { box.innerHTML = store.DEMO ? '<span>Demo mode</span>' : ''; return; }
  box.innerHTML = `<span>${esc(S.user.email)}</span><button class="btn sm" id="signout">Sign out</button>`;
  $('#signout').onclick = async () => { await store.signOut(); S.user = null; start(); };
}

function renderLogin() {
  $('#app').innerHTML = `
    <div class="panel login">
      <h2>Sign in</h2>
      <p class="muted small">Enter your email and we'll send you a sign-in link. ${store.EMAIL_DOMAIN ? `@${esc(store.EMAIL_DOMAIN)} addresses get in straight away; any other address needs adding to Team access by a colleague first.` : ''}</p>
      <form id="login"><div class="field"><input type="email" id="email" required placeholder="you@${esc(store.EMAIL_DOMAIN || 'company.com')}" autocomplete="email"></div>
      <button class="btn primary" type="submit">Send link</button></form>
      <div id="login-msg"></div>
    </div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    try { await store.signIn($('#email').value); $('#login-msg').innerHTML = msgList('ok', ['Check your inbox for the sign-in link.']); }
    catch (err) { $('#login-msg').innerHTML = msgList('err', [err.message]); }
  };
}

function renderNoAccess() {
  $('#app').innerHTML = `
    <div class="panel login">
      <h2>No access yet</h2>
      <p>You're signed in as <strong>${esc(S.user.email)}</strong>, but this address isn't on the Team access list.</p>
      <p class="muted small">Ask a colleague with a @${esc(store.EMAIL_DOMAIN || 'tilcotrading.com')} email to add you under <strong>Team</strong>, then reload this page.</p>
      <button class="btn" id="na-reload">Reload</button>
    </div>`;
  $('#na-reload').onclick = () => location.reload();
}

$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab;
  $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  render();
});

function render() {
  if (!S.data && S.tab !== 'rules') {
    $('#app').innerHTML = `<div class="panel">${msgList('err', ['Could not load data from the database: ' + (S.loadError || 'unknown error')])}
      <p class="hint">Check that supabase/setup.sql was run in Supabase, then reload. If it keeps happening, send this message to whoever maintains the site.</p>
      <button class="btn" id="retry">Try again</button></div>`;
    $('#retry').onclick = () => start();
    return;
  }
  try {
  ({ generate: renderGenerate, decode: renderDecode, log: renderLog, legacy: renderLegacy, registry: renderRegistry, team: renderTeam, rules: renderRules })[S.tab]();
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="panel">${msgList('err', ['Something went wrong showing this tab: ' + e.message])}</div>`;
  }
}

// ---------- SKU display ----------
function skuHtml(blocks) {
  if (!blocks.length) return '<span class="muted" style="font-size:16px;font-weight:400">Choose a brand and product to start</span>';
  return blocks.map((b) => `<span class="blk ${b.type}">${esc(b.text)}</span>`).join('<span class="dash">-</span>');
}
const LEGEND = `<div class="legend">
  <span><i style="background:var(--b-brand)"></i>Brand</span><span><i style="background:var(--b-capprod)"></i>Capacity + product</span>
  <span><i style="background:var(--b-variant)"></i>Variant</span><span><i style="background:var(--b-pack)"></i>Pack</span>
  <span><i style="background:var(--b-version)"></i>Version</span><span><i style="background:var(--b-region)"></i>Marketplace</span></div>`;

// ---------- GENERATE ----------
function computeDraft() {
  const f = S.form;
  const base = buildSku({ ...f, version: 1 }, S.reg);
  let auto = { next: 1, matches: [] };
  if (!base.errors.length && base.sku) auto = nextVersion(base.sku, allSkus(), S.reg);
  const version = f.override && f.version !== '' ? Number(f.version) : auto.next;
  const result = buildSku({ ...f, version }, S.reg);
  return { result, auto, version };
}

function renderGenerate() {
  const f = S.form, reg = S.reg, d = S.data;
  const products = d.products.filter((p) => p.brand === f.brand && p.status !== 'DISCONTINUED');
  const product = reg.products[f.product];
  const unit = product?.cap_unit ? reg.units[product.cap_unit] : null;
  const colours = d.variants.filter((v) => v.type === 'COLOUR');
  const sizes = d.variants.filter((v) => v.type === 'SIZE');

  $('#app').innerHTML = `
  <div class="grid">
    <section class="panel">
      <h2>Product details</h2>
      <div class="field"><label for="f-brand">Brand</label>
        <select id="f-brand"><option value="">Choose…</option>${d.brands.map((b) => opt(b.code, `${b.name} (${b.code})`, f.brand)).join('')}</select></div>
      <div class="field"><label for="f-product">Product</label>
        <select id="f-product" ${f.brand ? '' : 'disabled'}><option value="">${f.brand ? 'Choose…' : 'Choose a brand first'}</option>
        ${products.map((p) => opt(p.code, `${p.name} (${p.code})${p.status === 'PROPOSED' ? ' · proposed' : ''}`, f.product)).join('')}
        ${f.brand ? `<option value="__new"${S.newProd ? ' selected' : ''}>+ New product…</option>` : ''}</select>
        ${f.brand && !products.length && !S.newProd ? '<div class="hint">No products registered for this brand yet. Choose "+ New product…" to add one.</div>' : ''}
        ${S.newProd ? newProductForm() : ''}
        ${product?.notes ? `<div class="hint">${esc(product.notes)}</div>` : ''}</div>
      ${unit ? `<div class="field"><label for="f-cap">Capacity</label>
        <div class="suffix"><input id="f-cap" type="number" min="1" max="999" step="1" inputmode="numeric" value="${esc(f.capacity)}" placeholder="e.g. ${unit.code === 'OZ' ? '12' : unit.code === 'L' ? '1' : '30'}"><span>${esc(unit.short)}</span></div>
        <div class="hint">This product comes in more than one size, so capacity is part of the SKU.</div></div>` : ''}
      <div class="field"><span class="label">Colours <span class="muted" style="font-weight:400">(optional, only if it varies)</span></span>
        <div class="chips" id="f-colours">${colours.map((c) => {
          const i = f.colours.indexOf(c.code);
          return `<button type="button" class="chip" data-c="${esc(c.code)}" aria-pressed="${i >= 0}">${i >= 0 ? `<span class="n">${i + 1}</span>` : ''}${esc(c.name)} <code>${esc(c.code)}</code></button>`;
        }).join('')}</div>
        <div class="hint">Click colours in the order Amazon lists them. Blue then Black gives <code>BLBK</code>. ${f.colours.length ? '<button type="button" class="link" id="f-clear">Clear colours</button>' : ''}</div></div>
      <div class="row">
        <div class="field"><label for="f-size">Size</label>
          <select id="f-size">${opt('', 'None', f.size)}${sizes.map((s) => opt(s.code, `${s.name} (${s.code})`, f.size)).join('')}</select></div>
        <div class="field"><label for="f-pack">Units in pack</label>
          <input id="f-pack" type="number" min="1" step="1" inputmode="numeric" value="${esc(f.pack)}"></div>
      </div>
      <div class="field"><label for="f-region">Marketplace suffix</label>
        <select id="f-region">${opt('', 'None (US, or shared across marketplaces)', f.region)}${d.regions.map((r) => opt(r.code, `${r.name} only (-${r.code})`, f.region)).join('')}</select>
        <div class="hint">Add one when this SKU is opened for a single marketplace (or the unit differs there). Each marketplace suffix keeps its own version count.</div></div>
      <div class="field"><label class="inline"><input type="checkbox" id="f-override" ${f.override ? 'checked' : ''}> Set the version number by hand</label>
        ${f.override ? `<input id="f-version" type="number" min="1" step="1" value="${esc(f.version)}" placeholder="e.g. 3" style="margin-top:6px">
        <div class="hint">1 means the first SKU (no version block). Use this to reuse an existing SKU for a new marketplace, or when older versions aren't in the log yet.</div>` : ''}</div>
      <button type="button" class="btn" id="f-reset">Start over</button>
    </section>
    <section class="panel sticky" id="out"></section>
  </div>`;

  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('#f-brand', 'change', (e) => { f.brand = e.target.value; f.product = ''; f.capacity = ''; S.newProd = null; renderGenerate(); });
  on('#f-product', 'change', (e) => {
    if (e.target.value === '__new') { S.newProd = { name: '', code: '', touched: false, unit: '' }; f.product = ''; renderGenerate(); $('#np2-name')?.focus(); return; }
    S.newProd = null; f.product = e.target.value; if (!S.reg.products[f.product]?.cap_unit) f.capacity = ''; renderGenerate();
  });
  if (S.newProd) bindNewProductForm();
  on('#f-cap', 'input', (e) => { f.capacity = e.target.value === '' ? '' : Number(e.target.value); updateOutput(); });
  on('#f-pack', 'input', (e) => { f.pack = e.target.value === '' ? '' : Number(e.target.value); updateOutput(); });
  on('#f-size', 'change', (e) => { f.size = e.target.value; updateOutput(); });
  on('#f-region', 'change', (e) => { f.region = e.target.value; updateOutput(); });
  on('#f-override', 'change', (e) => { f.override = e.target.checked; if (f.override && f.version === '') f.version = computeDraft().auto.next; renderGenerate(); });
  on('#f-version', 'input', (e) => { f.version = e.target.value; updateOutput(); });
  on('#f-clear', 'click', () => { f.colours = []; renderGenerate(); });
  on('#f-reset', 'click', () => { S.newProd = null; Object.assign(f, { brand: '', product: '', capacity: '', colours: [], size: '', pack: 1, region: '', override: false, version: '' }); renderGenerate(); });
  $('#f-colours').addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const c = b.dataset.c, i = f.colours.indexOf(c);
    if (i >= 0) f.colours.splice(i, 1); else f.colours.push(c);
    renderGenerate();
  });
  updateOutput();
}

// ---------- new product, inline ----------
const allProductCodes = () => S.data.products.map((p) => p.code);
/** Suggest a 3-letter code from the product name that isn't taken and doesn't clash with a variant code. */
function suggestCode(name) {
  const words = name.toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter((w) => w && !['AND', 'WITH', 'FOR', 'THE', 'OF', 'A'].includes(w));
  if (!words.length) return '';
  const cands = [];
  const initials = words.map((w) => w[0]).join('');
  if (initials.length >= 3) cands.push(initials.slice(0, 3));
  const first = words[0], cons = first[0] + first.slice(1).replace(/[AEIOU]/g, '');
  cands.push((initials.slice(0, 2) + (words[words.length - 1].slice(1).replace(/[AEIOU]/g, '') || 'X')).slice(0, 3));
  cands.push((initials + cons.slice(1)).slice(0, 3), cons.slice(0, 3), first.slice(0, 3));
  for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') cands.push((initials.slice(0, 2) || first.slice(0, 2)) + a);
  const taken = new Set(allProductCodes());
  return cands.find((c) => c.length === 3 && !taken.has(c) && !S.reg.colours[c] && !S.reg.sizes[c]) || '';
}
function newProductForm() {
  const n = S.newProd, b = S.reg.brands[S.form.brand];
  const chk = n.code ? checkNewCode('product', n.code, S.reg, allProductCodes()) : { errors: [], warnings: [] };
  return `<div class="panel" style="margin-top:10px;box-shadow:none;background:var(--bg)">
    <strong>New ${esc(b?.name || '')} product</strong>
    <div class="field" style="margin-top:10px"><label for="np2-name">Product family</label><input id="np2-name" value="${esc(n.name)}" placeholder="e.g. Silicone bath mat"></div>
    <div class="row">
      <div class="field"><label for="np2-code">Code</label><input id="np2-code" value="${esc(n.code)}" maxlength="5" spellcheck="false" placeholder="3 letters">
        <div class="hint">Suggested from the name. You can change it.</div></div>
      <div class="field"><label for="np2-unit">Sizes</label><select id="np2-unit">${opt('', 'One size (no capacity)', n.unit)}${S.data.units.map((u) => opt(u.code, `Several, in ${u.name.toLowerCase()}`, n.unit)).join('')}</select></div>
    </div>
    <div id="np2-msg">${msgList('err', chk.errors) + msgList('warn', chk.warnings)}</div>
    <div class="toolbar"><button type="button" class="btn primary" id="np2-add" ${!n.name.trim() || !n.code || chk.errors.length ? 'disabled' : ''}>Add product</button><button type="button" class="btn" id="np2-cancel">Cancel</button></div>
    <div class="hint">It's added to the Registry as PROPOSED. You can preview SKUs straight away; confirm the code before registering one (rule 14).</div>
  </div>`;
}
function bindNewProductForm() {
  const n = S.newProd;
  const refresh = (focusId) => { const el = $(focusId), pos = el?.selectionStart; renderGenerate(); const x = $(focusId); if (x) { x.focus(); try { x.setSelectionRange(pos, pos); } catch {} } };
  $('#np2-name').addEventListener('input', (e) => { n.name = e.target.value; if (!n.touched) n.code = suggestCode(n.name); refresh('#np2-name'); });
  $('#np2-code').addEventListener('input', (e) => { n.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); n.touched = !!n.code; refresh('#np2-code'); });
  $('#np2-unit').addEventListener('change', (e) => { n.unit = e.target.value; });
  $('#np2-cancel').onclick = () => { S.newProd = null; renderGenerate(); };
  $('#np2-add').onclick = async () => {
    const chk = checkNewCode('product', n.code, S.reg, allProductCodes());
    if (chk.errors.length) return;
    if (chk.warnings.length && !confirm(chk.warnings.join('\n\n') + '\n\nAdd it anyway?')) return;
    try {
      await store.addProduct({ code: chk.code, name: n.name.trim(), brand: S.form.brand, cap_unit: n.unit || null, status: 'PROPOSED', notes: 'Added from the Generate page' });
      await reload();
      S.form.product = chk.code; S.form.capacity = ''; S.newProd = null;
      toast(`${chk.code} added as PROPOSED`);
      renderGenerate();
    } catch (err) { toast(err.message); }
  };
}

function updateOutput() {
  const out = $('#out'); if (!out) return;
  const { result: r, auto } = computeDraft();
  const f = S.form, rf = S.regForm;
  const product = S.reg.products[f.product];
  const ready = r.sku && !r.errors.length;
  const parsed = ready ? parseSku(r.sku, S.reg) : null;
  const proposed = product?.status === 'PROPOSED';
  const existsHere = ready && S.data.sku_log.some((x) => x.sku === r.sku && x.marketplace === rf.marketplace);
  const prev = auto.matches.length ? auto.matches[auto.matches.length - 1] : null;

  let versionNote = '';
  if (ready && !f.override) {
    versionNote = auto.matches.length
      ? `This is the ${ordinal(auto.next)} SKU for this product. Earlier SKUs (log and legacy): ${auto.matches.map((m) => `<code>${esc(m.sku)}</code>`).join(', ')}.`
      : 'No earlier SKU for this product in the log, so this is the 1st SKU (no version block).';
  }

  const blockers = [];
  if (!ready) blockers.push('Fix the errors above first.');
  if (proposed) blockers.push(`Product code ${product.code} is still PROPOSED. It must be CONFIRMED before a SKU can be registered.`);
  if (existsHere) blockers.push(`${r.sku} is already registered for ${rf.marketplace}.`);

  out.innerHTML = `
    <h2>Your SKU</h2>
    <div class="sku" id="sku-out">${skuHtml(r.blocks)}</div>
    ${LEGEND}
    ${parsed ? `<p class="decoded">${esc(describe(parsed, S.reg))}</p>` : ''}
    ${versionNote ? `<p class="hint">${versionNote}</p>` : ''}
    ${msgList('err', r.errors.filter(() => f.brand))}
    ${msgList('warn', r.warnings)}
    <div class="toolbar" style="margin-top:14px"><button class="btn primary" id="copy" ${ready ? '' : 'disabled'}>Copy SKU</button></div>
    <details ${rf.open ? 'open' : ''} id="regbox" style="margin-top:6px">
      <summary><strong>Register in the SKU Log</strong> <span class="muted small">(rule 15)</span></summary>
      <div style="margin-top:12px">
        <div class="row">
          <div class="field"><label for="r-mp">Marketplace</label><input id="r-mp" list="mp-list" value="${esc(rf.marketplace)}">
            <datalist id="mp-list">${MARKETPLACES.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
          <div class="field"><label for="r-asin">ASIN</label><input id="r-asin" value="${esc(rf.asin)}" placeholder="B0…"></div>
        </div>
        <div class="row">
          <div class="field"><label for="r-reason">Reason</label><input id="r-reason" list="reason-list" value="${esc(rf.reason)}">
            <datalist id="reason-list">${REASONS.map((m) => `<option value="${esc(m)}">`).join('')}</datalist></div>
          <div class="field"><label for="r-supplier">Supplier</label><input id="r-supplier" value="${esc(rf.supplier)}"></div>
        </div>
        <div class="field"><label for="r-notes">Notes</label><input id="r-notes" value="${esc(rf.notes)}"></div>
        ${prev ? `<label class="inline small field"><input type="checkbox" id="r-old" ${rf.markOld ? 'checked' : ''}> Mark <code>${esc(prev.sku)}</code> as SELLING OUT</label>` : ''}
        ${msgList('warn', ready ? blockers : [])}
        ${ready && proposed ? `<p class="small" style="margin:6px 0 10px">Has this code been agreed? <button type="button" class="link" id="confirm-code">Confirm ${esc(product.code)} now</button></p>` : ''}
        <button class="btn primary" id="register" ${blockers.length ? 'disabled' : ''}>Register ${ready ? esc(r.sku) : 'SKU'}</button>
      </div>
    </details>`;

  const cc = $('#confirm-code');
  if (cc) cc.onclick = async () => {
    if (!confirm(`Confirm product code ${product.code} (${product.name})? Once a SKU goes live with it, the code can never change or be reused.`)) return;
    try { await store.updateProduct(product.code, { status: 'CONFIRMED' }); await reload(); toast(`${product.code} confirmed`); updateOutput(); }
    catch (err) { toast(err.message); }
  };
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(r.sku); toast(`Copied ${r.sku}`); } catch { toast('Copy failed. Select the SKU and copy it manually.'); } };
  $('#regbox').addEventListener('toggle', (e) => { rf.open = e.target.open; });
  const bind = (id, key, rerender) => { const el = $(id); if (el) el.addEventListener('input', (e) => { rf[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (rerender) updateOutputKeepFocus(id); }); };
  bind('#r-mp', 'marketplace', true); bind('#r-asin', 'asin'); bind('#r-reason', 'reason'); bind('#r-supplier', 'supplier'); bind('#r-notes', 'notes');
  const old = $('#r-old'); if (old) old.onchange = (e) => { rf.markOld = e.target.checked; };
  $('#register').onclick = async () => {
    const btn = $('#register'); btn.disabled = true;
    try {
      if (!rf.marketplace.trim()) throw new Error('Marketplace is required.');
      await store.addLog({ sku: r.sku, product: describe(parsed, S.reg), asin: rf.asin.trim().toUpperCase(), marketplace: rf.marketplace.trim(), reason: rf.reason.trim(), supplier: rf.supplier.trim(), notes: rf.notes.trim(), status: 'ACTIVE' });
      if (prev && rf.markOld) for (const row of S.data.sku_log.filter((x) => x.sku === prev.sku && x.status === 'ACTIVE')) await store.setLogStatus(row.id, 'SELLING OUT');
      await reload();
      toast(`${r.sku} registered`);
      Object.assign(rf, { asin: '', notes: '' });
      updateOutput();
    } catch (e) { toast(e.message); btn.disabled = false; }
  };
}
function updateOutputKeepFocus(id) {
  const el = $(id), pos = el?.selectionStart;
  updateOutput();
  const n = $(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }
}

// ---------- DECODE ----------
function renderDecode() {
  $('#app').innerHTML = `
    <section class="panel">
      <h2>Decode a SKU</h2>
      <div class="field"><input id="d-in" value="${esc(S.decode)}" placeholder="Paste a SKU, e.g. TCR-12S-BLBK-P2-V3 or a legacy SKU" autocomplete="off" spellcheck="false"></div>
      <div id="d-out"></div>
    </section>`;
  const inp = $('#d-in');
  inp.addEventListener('input', () => { S.decode = inp.value; decodeOut(); });
  inp.focus();
  decodeOut();
}
function decodeOut() {
  const raw = S.decode.trim().toUpperCase(), out = $('#d-out');
  if (!raw) { out.innerHTML = ''; return; }
  const legacy = S.data.legacy_map.find((x) => x.legacy_sku.toUpperCase() === raw);
  const target = legacy ? legacy.new_sku : raw;
  const p = parseSku(target, S.reg);
  const rows = S.data.sku_log.filter((x) => x.sku === p.sku);
  let html = '';
  if (legacy) html += msgList('ok', [`Legacy SKU (stays as it is on the marketplace). For version counting it counts as ${legacy.new_sku}.`]);
  if (!p.errors.length) {
    const b = buildSku({ brand: p.brand, product: p.product, capacity: p.capacity, colours: p.colours, size: p.size, pack: p.pack, version: p.version, region: p.region }, S.reg);
    // keep a legacy P1 visible as written, before the version/region blocks
    const blocks = [...b.blocks];
    if (p.hasP1) { const i = blocks.findIndex((x) => x.type === 'version' || x.type === 'region'); blocks.splice(i < 0 ? blocks.length : i, 0, { type: 'pack', text: 'P1' }); }
    html += `<div class="sku">${skuHtml(blocks)}</div>${LEGEND}<p class="decoded">${esc(describe(p, S.reg))}</p>`;
    const prod = S.reg.products[p.product];
    if (prod) html += `<p class="hint">Product code ${esc(prod.code)} ${badge(prod.status)}</p>`;
  } else if (!legacy) {
    html += msgList('err', p.errors.concat(['If this is an old-format SKU, add it in the Legacy tab so it can be looked up.']));
  }
  html += msgList('warn', p.warnings);
  if (rows.length) html += `<h3>In the SKU Log</h3>${logTable(rows, false)}`;
  else if (!p.errors.length) html += '<p class="hint">Not registered in the SKU Log yet.</p>';
  out.innerHTML = html;
}

// ---------- LOG ----------
function logTable(rows, editable = true) {
  if (!rows.length) return '<p class="muted">No entries.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Product</th><th>ASIN</th><th>Marketplace</th><th>Opened</th><th>Reason</th><th>Supplier</th><th>Status</th><th>Notes</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><code>${esc(r.sku)}</code></td><td>${esc(r.product)}</td><td>${esc(r.asin)}</td><td>${esc(r.marketplace)}</td><td>${esc(r.opened || '')}</td><td>${esc(r.reason)}</td><td>${esc(r.supplier)}</td>
      <td>${editable ? `<select data-id="${esc(r.id)}">${LOG_STATUSES.map((s) => opt(s, s, r.status)).join('')}</select>` : badge(r.status)}</td><td>${esc(r.notes)}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderLog() {
  const q = S.logQuery.toLowerCase();
  const rows = S.data.sku_log.filter((r) => !q || Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)));
  $('#app').innerHTML = `
    <div class="toolbar"><h2 style="margin:0">SKU Log</h2><span class="muted small">${rows.length} of ${S.data.sku_log.length}</span><span class="spacer"></span>
      <input id="l-q" placeholder="Search SKU, ASIN, supplier…" value="${esc(S.logQuery)}"><button class="btn" id="l-csv">Export CSV</button></div>
    ${logTable(rows)}
    <p class="hint">Entries can't be deleted. A SKU is never reused, so set it to RETIRED instead.</p>`;
  const qi = $('#l-q');
  qi.addEventListener('input', () => { S.logQuery = qi.value; const p = qi.selectionStart; renderLog(); const n = $('#l-q'); n.focus(); n.setSelectionRange(p, p); });
  $$('select[data-id]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await store.setLogStatus(isNaN(sel.dataset.id) ? sel.dataset.id : Number(sel.dataset.id), sel.value); await reload(); toast('Status updated'); }
    catch (e) { toast(e.message); renderLog(); }
  }));
  $('#l-csv').onclick = () => downloadCsv('sku-log.csv', S.data.sku_log, ['sku', 'product', 'asin', 'marketplace', 'opened', 'reason', 'supplier', 'status', 'notes']);
}
function downloadCsv(name, rows, cols) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- LEGACY ----------
function renderLegacy() {
  const rows = [...S.data.legacy_map].sort((x, y) => String(x.new_sku).localeCompare(String(y.new_sku), 'en', { numeric: true }));
  const q = (S.legacyQuery || '').toLowerCase();
  const shown = rows.filter((r) => !q || [r.legacy_sku, r.new_sku, r.product, r.asin, r.marketplaces].some((v) => String(v || '').toLowerCase().includes(q)));
  $('#app').innerHTML = `
    <div>
      <section>
        <h2>Legacy mapping</h2>
        <p class="muted small">Old SKUs stay exactly as they are on Amazon and Walmart. "Counts as" is only the label the site uses to work out the next version number. It is not a rename.</p>
        <div class="toolbar"><input id="lg-q" placeholder="Search legacy SKU, label, product, ASIN…" value="${esc(S.legacyQuery || '')}"><span class="muted small">${shown.length} of ${rows.length}</span></div>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Legacy SKU</th><th>Counts as</th><th>Product</th><th>Marketplaces</th><th>ASIN</th><th>Status</th></tr></thead><tbody>
          ${shown.slice(0, 300).map((r) => `<tr><td><code>${esc(r.legacy_sku)}</code></td><td><code>${esc(r.new_sku)}</code></td><td>${esc(r.product)}</td><td>${esc(r.marketplaces || '')}</td><td>${esc(r.asin || '')}</td><td>${badge(r.status)}</td></tr>`).join('')}
        </tbody></table></div>${shown.length > 300 ? '<p class="hint">Showing the first 300. Search to narrow down.</p>' : ''}` : '<p class="muted">No legacy SKUs mapped yet.</p>'}
      </section>
      <details class="panel" style="margin-top:20px;max-width:640px">
        <summary>Add a legacy SKU</summary>
        <div style="margin-top:12px">
        <form id="lg">
          <div class="field"><label for="lg-old">Legacy SKU (as on Amazon)</label><input id="lg-old" required spellcheck="false"></div>
          <div class="field"><label for="lg-new">New name</label><input id="lg-new" required spellcheck="false" placeholder="e.g. TCR-12S-BLBK-P2-V3"><div id="lg-new-msg"></div></div>
          <div class="field"><label for="lg-prod">Product</label><input id="lg-prod"></div>
          <div class="row"><div class="field"><label for="lg-status">Status</label><select id="lg-status">${LOG_STATUSES.map((s) => opt(s, s, 'ACTIVE')).join('')}</select></div>
            <div class="field"><label for="lg-notes">Notes</label><input id="lg-notes"></div></div>
          <button class="btn primary" type="submit">Add mapping</button>
        </form>
        </div>
      </details>
    </div>`;
  const lq = $('#lg-q');
  lq.addEventListener('input', () => { S.legacyQuery = lq.value; const p = lq.selectionStart; renderLegacy(); const n = $('#lg-q'); n.focus(); n.setSelectionRange(p, p); });
  const nw = $('#lg-new');
  nw.addEventListener('input', () => {
    const p = parseSku(nw.value, S.reg);
    $('#lg-new-msg').innerHTML = nw.value ? (p.errors.length ? msgList('err', p.errors) : `<p class="hint">${esc(describe(p, S.reg))}</p>`) : '';
    if (!p.errors.length && !$('#lg-prod').value) $('#lg-prod').placeholder = describe(p, S.reg);
  });
  $('#lg').onsubmit = async (e) => {
    e.preventDefault();
    const p = parseSku(nw.value, S.reg);
    if (p.errors.length) return toast('The new name is not a valid SKU.');
    try {
      await store.addLegacy({ legacy_sku: $('#lg-old').value.trim(), new_sku: p.sku, product: $('#lg-prod').value.trim() || describe(p, S.reg), status: $('#lg-status').value, notes: $('#lg-notes').value.trim() });
      await reload(); toast('Mapping added'); renderLegacy();
    } catch (err) { toast(err.message); }
  };
}

// ---------- REGISTRY ----------
function renderRegistry() {
  const d = S.data, reg = S.reg;
  const unitName = (u) => u ? `${reg.units[u]?.name || u}` : '<span class="muted">one size</span>';
  $('#app').innerHTML = `
    <h2>Product codes</h2>
    <p class="muted small">One row per product family. Set a code to CONFIRMED once agreed. SKUs can't be registered while their code is PROPOSED. Codes are never deleted or reused; use DISCONTINUED.</p>
    <div class="table-wrap"><table><thead><tr><th>Code</th><th>Product family</th><th>Brand</th><th>Capacity</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      ${d.products.map((p) => `<tr><td><code>${esc(p.code)}</code></td><td>${esc(p.name)}</td><td>${esc(p.brand)}</td><td>${unitName(p.cap_unit)}</td>
        <td><select data-prod="${esc(p.code)}">${PRODUCT_STATUSES.map((s) => opt(s, s, p.status)).join('')}</select></td><td>${esc(p.notes)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="toolbar" style="margin-top:10px"><button class="btn" id="confirm-all">Mark all PROPOSED as CONFIRMED</button></div>

    <div class="grid" style="margin-top:20px">
      <section class="panel"><h2>Add a product code</h2>
        <form id="np">
          <div class="row"><div class="field"><label for="np-code">Code</label><input id="np-code" required maxlength="5" spellcheck="false"></div>
            <div class="field"><label for="np-brand">Brand</label><select id="np-brand" required>${d.brands.map((b) => opt(b.code, `${b.name} (${b.code})`)).join('')}</select></div></div>
          <div class="field"><label for="np-name">Product family</label><input id="np-name" required></div>
          <div class="field"><label for="np-unit">Capacity</label><select id="np-unit">${opt('', 'One size, no capacity block', '')}${d.units.map((u) => opt(u.code, `Comes in several sizes, measured in ${u.name.toLowerCase()}`)).join('')}</select></div>
          <div class="field"><label for="np-notes">Notes</label><input id="np-notes"></div>
          <div id="np-msg"></div>
          <button class="btn primary" type="submit">Add as PROPOSED</button>
        </form>
      </section>
      <section class="panel"><h2>Add a brand, colour, size or region</h2>
        <form id="nv">
          <div class="row"><div class="field"><label for="nv-kind">Type</label><select id="nv-kind">${opt('colour', 'Colour')}${opt('size', 'Size')}${opt('brand', 'Brand')}${opt('region', 'Region')}</select></div>
            <div class="field"><label for="nv-code">Code</label><input id="nv-code" required maxlength="3" spellcheck="false"></div></div>
          <div class="field"><label for="nv-name">Name</label><input id="nv-name" required></div>
          <div id="nv-msg"></div>
          <button class="btn primary" type="submit">Add</button>
        </form>
      </section>
    </div>

    <div class="grid" style="margin-top:20px">
      <section><h3>Brands</h3><div class="table-wrap"><table><thead><tr><th>Code</th><th>Brand</th><th>Notes</th></tr></thead><tbody>
        ${d.brands.map((b) => `<tr><td><code>${esc(b.code)}</code></td><td>${esc(b.name)}</td><td>${esc(b.notes)}</td></tr>`).join('')}</tbody></table></div>
        <h3>Regions</h3><div class="table-wrap"><table><tbody>${d.regions.map((r) => `<tr><td><code>${esc(r.code)}</code></td><td>${esc(r.name)}</td></tr>`).join('')}</tbody></table></div></section>
      <section><h3>Variant codes</h3><div class="table-wrap"><table><thead><tr><th>Code</th><th>Meaning</th><th>Type</th><th>Notes</th></tr></thead><tbody>
        ${d.variants.map((v) => `<tr><td><code>${esc(v.code)}</code></td><td>${esc(v.name)}</td><td>${esc(v.type === 'COLOUR' ? 'Colour' : 'Size')}</td><td>${esc(v.notes)}</td></tr>`).join('')}</tbody></table></div></section>
    </div>`;

  $$('select[data-prod]').forEach((sel) => sel.addEventListener('change', async () => {
    try { await store.updateProduct(sel.dataset.prod, { status: sel.value }); await reload(); toast(`${sel.dataset.prod} → ${sel.value}`); }
    catch (e) { toast(e.message); renderRegistry(); }
  }));
  $('#confirm-all').onclick = async () => {
    const list = d.products.filter((p) => p.status === 'PROPOSED');
    if (!list.length) return toast('Nothing is PROPOSED.');
    if (!confirm(`Confirm all ${list.length} PROPOSED product codes?`)) return;
    for (const p of list) await store.updateProduct(p.code, { status: 'CONFIRMED' });
    await reload(); toast(`${list.length} codes confirmed`); renderRegistry();
  };

  const allCodes = { product: d.products.map((p) => p.code), brand: d.brands.map((b) => b.code), colour: d.variants.map((v) => v.code), size: d.variants.map((v) => v.code), region: d.regions.map((r) => r.code) };
  const live = (inp, kind, msg) => () => { inp.value = inp.value.toUpperCase(); const c = checkNewCode(kind(), inp.value, reg, allCodes[kind()]); $(msg).innerHTML = inp.value ? msgList('err', c.errors) + msgList('warn', c.warnings) : ''; return c; };
  const npCheck = live($('#np-code'), () => 'product', '#np-msg');
  $('#np-code').addEventListener('input', npCheck);
  $('#np').onsubmit = async (e) => {
    e.preventDefault();
    const c = npCheck(); if (c.errors.length) return;
    if (c.warnings.length && !confirm(c.warnings.join('\n\n') + '\n\nAdd it anyway?')) return;
    try {
      await store.addProduct({ code: c.code, name: $('#np-name').value.trim(), brand: $('#np-brand').value, cap_unit: $('#np-unit').value || null, status: 'PROPOSED', notes: $('#np-notes').value.trim() });
      await reload(); toast(`${c.code} added as PROPOSED`); renderRegistry();
    } catch (err) { toast(err.message); }
  };
  const nvCheck = live($('#nv-code'), () => $('#nv-kind').value, '#nv-msg');
  $('#nv-code').addEventListener('input', nvCheck);
  $('#nv-kind').addEventListener('change', nvCheck);
  $('#nv').onsubmit = async (e) => {
    e.preventDefault();
    const kind = $('#nv-kind').value, c = nvCheck(); if (c.errors.length) return;
    if (c.warnings.length && !confirm(c.warnings.join('\n\n') + '\n\nAdd it anyway?')) return;
    const name = $('#nv-name').value.trim();
    try {
      if (kind === 'brand') await store.addBrand({ code: c.code, name });
      else if (kind === 'region') await store.addRegion({ code: c.code, name });
      else await store.addVariant({ code: c.code, name, type: kind === 'colour' ? 'COLOUR' : 'SIZE' });
      await reload(); toast(`${c.code} added`); renderRegistry();
    } catch (err) { toast(err.message); }
  };
}

// ---------- TEAM ----------
function renderTeam() {
  const rows = S.data.allowed_emails || [];
  const fmt = (d) => d ? new Date(d).toISOString().slice(0, 10) : '';
  if (S.data.teamError) {
    $('#app').innerHTML = `<div class="panel">${msgList('err', ['The Team access list is not set up in the database yet (' + S.data.teamError + ').'])}
      <p>To fix it, in Supabase open <strong>SQL Editor → New query</strong>, paste in the whole of <code>supabase/002_team_access.sql</code> and click <strong>Run</strong>. Then reload this page.</p>
      <p class="hint">Everything else on the site works without it. @tilcotrading.com users can already sign in; only outside emails need this list.</p></div>`;
    return;
  }
  $('#app').innerHTML = `
    <div class="grid">
      <section>
        <h2>Team access</h2>
        <p class="muted small">Anyone with a @${esc(store.EMAIL_DOMAIN || 'tilcotrading.com')} email can sign in without being added. Everyone else, e.g. Gmail users, needs to be on this list. Access is checked by the database, not just the website.</p>
        ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Added by</th><th>Added</th><th></th></tr></thead><tbody>
          ${rows.map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(r.name)}</td><td>${esc(r.added_by)}</td><td>${esc(fmt(r.created_at))}</td>
            <td><button class="btn sm" data-rm="${esc(r.email)}">Remove</button></td></tr>`).join('')}
        </tbody></table></div>` : '<p class="muted">No outside emails added yet.</p>'}
      </section>
      <section class="panel">
        <h2>Add someone</h2>
        <form id="tm">
          <div class="field"><label for="tm-email">Email</label><input id="tm-email" type="email" required placeholder="name@gmail.com" autocomplete="off"></div>
          <div class="field"><label for="tm-name">Name</label><input id="tm-name" placeholder="Optional"></div>
          <button class="btn primary" type="submit">Give access</button>
          <p class="hint">They can then sign in with that exact address. Removing them takes effect on their next page load.</p>
        </form>
      </section>
    </div>`;
  $('#tm').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#tm-email').value.trim().toLowerCase();
    if (store.EMAIL_DOMAIN && email.endsWith('@' + store.EMAIL_DOMAIN)) return toast(`@${store.EMAIL_DOMAIN} addresses already have access.`);
    try { await store.addAccess(email, $('#tm-name').value); await reload(); toast(`${email} can now sign in`); renderTeam(); }
    catch (err) { toast(err.message); }
  };
  $$('button[data-rm]').forEach((b) => b.addEventListener('click', async () => {
    const email = b.dataset.rm;
    const self = S.user?.email?.toLowerCase() === email;
    if (!confirm(self ? `This is you. Removing ${email} will lock you out. Continue?` : `Remove access for ${email}?`)) return;
    try { await store.removeAccess(email); await reload(); toast(`${email} removed`); renderTeam(); }
    catch (err) { toast(err.message); }
  }));
}

// ---------- RULES ----------
function renderRules() {
  $('#app').innerHTML = `
  <div class="grid rules">
    <section class="panel">
      <h2>The format</h2>
      <div class="sku" style="font-size:24px">${skuHtml([{ type: 'brand', text: 'TCR' }, { type: 'capprod', text: '12S' }, { type: 'variant', text: 'BLBK' }, { type: 'pack', text: 'P2' }, { type: 'version', text: 'V3' }, { type: 'region', text: 'EU' }])}</div>${LEGEND}
      <ol>
        <li>The 1st SKU has no version block. V1 never exists.</li>
        <li>Every new SKU for the same product takes the next V number. The reason goes in the SKU Log, never in the SKU.</li>
        <li>Brand codes are never varied.</li>
        <li>Capacity is zero-padded to two digits; 100+ uses three (100M).</li>
        <li>A bare number means ounces. L litre, M millilitre, G gram, C centimetre.</li>
        <li>Capacity only when the product family comes in more than one size.</li>
        <li>Product codes never start with a digit.</li>
        <li>Fixed-width product codes within a family (PCR / PCE / PCS).</li>
        <li>Pack quantity lives in the pack block. Singles carry no pack block.</li>
        <li>Never encode anything that changes: supplier, cost, year, channel.</li>
        <li>One SKU across marketplaces for new listings. A SKU opened for one marketplace only (or whose unit differs there) ends with that marketplace: -CA, -UK, -EU, -JP or -WM (Walmart). Each suffix keeps its own version count.</li>
        <li>A code is never reused, including after a product is discontinued.</li>
        <li>New SKUs only, no retrofitting. Legacy SKUs go in the Legacy mapping.</li>
        <li>Register the code before it goes live. Nothing goes live while its code is PROPOSED.</li>
        <li>Every SKU gets a row in the SKU Log.</li>
      </ol>
      <p class="hint">Allowed characters: A-Z, 0-9 and hyphen only.</p>
    </section>
    <section>
      <div class="panel">
        <h2>Decisions made 4 Nov 2026</h2>
        <ul>
          <li><strong>Marketplace suffixes keep their own version count.</strong> A SKU opened only for Japan is <code>TC-PMS-JP</code>, then <code>TC-PMS-V2-JP</code>, independent of the US / shared SKU. The suffix always comes last. Walmart is <code>-WM</code>.</li>
          <li><strong>Live exceptions:</strong> <code>TC-PMS-V2</code> and <code>TC-TPC-P6-V4</code> went live in Japan without <code>-JP</code>. They count towards Japan, so the next ones are <code>TC-PMS-V3-JP</code> and <code>TC-TPC-P6-V5-JP</code>.</li>
          <li><strong>Brands from legacy SKUs:</strong> TCORE items (shakers, washer bags, clotheslines, air vents) are Tilcore. The Beard and Hair Roller (old TCR-001) is Tilcare. The holder belt is Pill Mill.</li>
          <li><strong>Glass shakers</strong> come in one size, so no capacity block: <code>TCR-GS-BK</code>.</li>
          <li><strong>PROPOSED codes:</strong> the generator previews the SKU with a warning, but it can't be registered until the code is CONFIRMED.</li>
          <li><strong><code>TC-01LURN-P1-V11</code></strong> is live on Amazon and stays as is (known exception). It counts as the single for versioning, so the next single 1 L urinal is <code>TC-01LURN-V12</code>. New SKUs never get P1.</li>
          <li><strong>TPC (Toothpaste caps)</strong> added to the product registry under TC; it was used in the log but missing.</li>
        </ul>
      </div>
      <div class="panel" style="margin-top:20px">
        <h2>Open decisions</h2>
        <ol>
          <li><s>Ear washer "manual vacuum"</s>: settled as EWV (only one vacuum model exists).</li>
          <li><s>Holder belt brand</s>: settled as Pill Mill (legacy SKUs are PMTH / PMHB).</li>
          <li>Confirm all PROPOSED product codes.</li>
          <li>Insulin syringes (0.3 / 0.5 mL, needle gauge) can't be written yet. Needs a capacity rule.</li>
          <li>Tilvolt (TV) scope.</li>
        </ol>
        <p class="hint">Owner: Tilen</p>
      </div>
    </section>
  </div>`;
}

boot();
