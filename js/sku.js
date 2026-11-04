// Tilco SKU engine: build, parse, describe, and version SKUs.
// Pure functions, no DOM, no network. Every rule number refers to section 3 of the convention.
//
// Format: BRAND-[CAPACITY]PRODUCT[-VARIANT][-PACK][-VERSION][-REGION]
//   e.g. TCR-12S-BLBK-P2-V3, TC-05MSYR-P12, PM-HB-SM, TC-30MSYR-V2-EU

export const ALLOWED = /^[A-Z0-9-]+$/;
const CODE = /^[A-Z][A-Z0-9]*$/;

/** Index the registry arrays into lookup maps. */
export function makeRegistry({ brands = [], products = [], variants = [], units = [], regions = [] }) {
  const byCode = (arr) => Object.fromEntries(arr.map((x) => [x.code, x]));
  return {
    brands: byCode(brands),
    products: byCode(products),
    colours: byCode(variants.filter((v) => v.type === 'COLOUR')),
    sizes: byCode(variants.filter((v) => v.type === 'SIZE')),
    units: byCode(units),
    unitByLetter: Object.fromEntries(units.filter((u) => u.letter).map((u) => [u.letter, u])),
    regions: byCode(regions),
  };
}

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** Rules 4 + 5: zero-pad to two digits, three for 100+, bare number = oz. */
export function formatCapacity(value, unitCode, reg) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined) return { error: 'Capacity is required for this product (it comes in more than one size).' };
  if (!Number.isInteger(n)) return { error: 'Capacity must be a whole number. Use a smaller unit if needed (e.g. 2500 mL instead of 2.5 L).' };
  if (n < 1 || n > 999) return { error: 'Capacity must be between 1 and 999.' };
  const unit = reg.units[unitCode];
  if (!unit) return { error: `Unknown capacity unit "${unitCode}".` };
  return { text: String(n).padStart(2, '0') + unit.letter };
}

/**
 * Build a SKU from form input.
 * input: { brand, product, capacity, colours: [], size, pack, version, region }
 * returns { sku, blocks: [{type, text}], errors: [], warnings: [] }
 */
export function buildSku(input, reg) {
  const errors = [], warnings = [], blocks = [];
  const brand = reg.brands[input.brand];
  const product = reg.products[input.product];

  if (!brand) errors.push('Choose a brand.');
  if (!product) errors.push('Choose a product.');
  if (brand && product && product.brand !== brand.code)
    errors.push(`${product.code} is registered under ${product.brand}, not ${brand.code}.`);
  if (product?.status === 'PROPOSED')
    warnings.push(`Product code ${product.code} is still PROPOSED. You can preview the SKU, but it can't be registered or go live until the code is CONFIRMED (rule 14).`);
  if (product?.status === 'DISCONTINUED')
    errors.push(`Product code ${product.code} is discontinued. Codes are never reused (rule 12).`);

  if (brand) blocks.push({ type: 'brand', text: brand.code });

  // Capacity + product (rule 6: capacity only where the family has more than one size)
  let capText = '';
  if (product?.cap_unit) {
    const c = formatCapacity(input.capacity, product.cap_unit, reg);
    if (c.error) errors.push(c.error); else capText = c.text;
  }
  if (product) blocks.push({ type: 'capprod', text: capText + product.code, cap: capText, prod: product.code });

  // Variant: colours in Amazon order, then size (BLBK-XL)
  const colours = (input.colours || []).filter(Boolean);
  if (new Set(colours).size !== colours.length) errors.push('The same colour is selected twice.');
  for (const c of colours) if (!reg.colours[c]) errors.push(`Unknown colour code "${c}".`);
  if (input.size && !reg.sizes[input.size]) errors.push(`Unknown size code "${input.size}".`);
  if (colours.length) blocks.push({ type: 'variant', text: colours.join('') });
  if (input.size) blocks.push({ type: 'variant', text: input.size });

  // Pack (rule 9; singles carry no pack block)
  const pack = input.pack === '' || input.pack == null ? 1 : Number(input.pack);
  if (!Number.isInteger(pack) || pack < 1) errors.push('Pack quantity must be a whole number of 1 or more.');
  else if (pack > 1) blocks.push({ type: 'pack', text: 'P' + pack });

  // Version (rules 1 + 2; V1 never exists)
  const version = input.version == null || input.version === '' ? 1 : Number(input.version);
  if (!Number.isInteger(version) || version < 1) errors.push('Version must be a whole number of 1 or more.');
  else if (version > 1) blocks.push({ type: 'version', text: 'V' + version });

  // Region (rule 11; only when the physical unit differs; always last)
  if (input.region) {
    if (!reg.regions[input.region]) errors.push(`Unknown region "${input.region}".`);
    else blocks.push({ type: 'region', text: input.region });
  }

  const sku = blocks.map((b) => b.text).join('-');
  if (sku && !ALLOWED.test(sku)) errors.push('Only A-Z, 0-9 and hyphens are allowed.');
  return { sku: errors.length && !brand ? '' : sku, blocks, errors, warnings };
}

/** Split "12GS" / "03LURN" / "PCR" into capacity + product using the registry. */
function splitCapProd(tok, reg) {
  const m = tok.match(/^(\d*)([A-Z][A-Z0-9]*)$/);
  if (!m) return { error: `"${tok}" is not a valid capacity + product block (product codes never start with a digit, rule 7).` };
  const [, digits, rest] = m;
  if (!digits) return { product: rest };

  // Candidates: bare number = oz, or first letter is a unit letter.
  const cands = [{ unit: 'OZ', product: rest }];
  if (reg.unitByLetter[rest[0]] && rest.length > 1) cands.push({ unit: reg.unitByLetter[rest[0]].code, product: rest.slice(1) });
  const known = cands.filter((c) => reg.products[c.product]);
  // Prefer the reading whose unit matches the product's registered unit (resolves 12GS = 12 oz glass shaker, not 12 g shaker).
  const pick = known.find((c) => reg.products[c.product].cap_unit === c.unit) || known[0] || cands[cands.length - 1];
  return { digits, unit: pick.unit, product: pick.product, ambiguous: known.length > 1 };
}

/** Parse any SKU in the new format. Returns parts plus errors/warnings; never throws. */
export function parseSku(raw, reg) {
  const sku = String(raw || '').trim().toUpperCase();
  const out = { sku, colours: [], size: '', pack: 1, version: 1, region: '', errors: [], warnings: [] };
  if (!sku) { out.errors.push('Empty SKU.'); return out; }
  if (!ALLOWED.test(sku)) out.errors.push('Contains characters other than A-Z, 0-9 and hyphen.');
  const t = sku.split('-');
  if (t.some((x) => x === '')) { out.errors.push('Empty block (double hyphen or trailing hyphen).'); return out; }
  if (t.length < 2) { out.errors.push('Needs at least a brand and a product block.'); return out; }

  out.brand = t[0];
  if (!reg.brands[out.brand]) out.errors.push(`Unknown brand code "${out.brand}".`);

  const cp = splitCapProd(t[1], reg);
  if (cp.error) { out.errors.push(cp.error); return out; }
  out.product = cp.product;
  if (!reg.products[cp.product]) out.errors.push(`Unknown product code "${cp.product}".`);
  if (cp.digits) {
    out.capacity = Number(cp.digits);
    out.unit = cp.unit;
    const expect = String(out.capacity).padStart(2, '0');
    if (cp.digits !== expect) out.errors.push(`Capacity "${cp.digits}" should be written "${expect}" (rule 4).`);
  }

  // Peel trailing blocks: region, version, pack. Whatever remains is the variant.
  let rest = t.slice(2);
  if (rest.length && reg.regions[rest[rest.length - 1]]) out.region = rest.pop();
  if (rest.length && /^V\d+$/.test(rest[rest.length - 1])) {
    out.version = Number(rest.pop().slice(1));
    if (out.version <= 1) out.errors.push('V1 (or V0) never exists. The first SKU has no version block (rule 1).');
  }
  if (rest.length && /^P\d+$/.test(rest[rest.length - 1])) {
    out.pack = Number(rest.pop().slice(1));
    if (out.pack === 1) { out.warnings.push('P1 is not used for singles. Leave the pack block out.'); out.hasP1 = true; }
    if (out.pack === 0) out.errors.push('P0 is not a valid pack.');
  }
  for (const tok of rest) {
    if (reg.sizes[tok] && !out.size) { out.size = tok; continue; }
    const pairs = tok.match(/.{1,2}/g) || [];
    if (!out.colours.length && !out.size && tok.length % 2 === 0 && pairs.every((p) => reg.colours[p])) { out.colours = pairs; continue; }
    out.errors.push(`"${tok}" is not a recognised variant, pack, version or region block.`);
  }
  return out;
}

/** Plain-English reading of a parsed SKU. */
export function describe(p, reg) {
  const parts = [];
  const b = reg.brands[p.brand];
  parts.push(b ? b.name : p.brand);
  const prod = reg.products[p.product];
  let prodText = prod ? prod.name : p.product;
  if (p.capacity) prodText = `${p.capacity} ${reg.units[p.unit]?.short || p.unit} ${prodText.charAt(0).toLowerCase() + prodText.slice(1)}`;
  parts.push(prodText);
  if (p.colours?.length) parts.push(p.colours.map((c) => reg.colours[c]?.name || c).join(' & '));
  if (p.size) parts.push(reg.sizes[p.size]?.name || p.size);
  parts.push(p.pack > 1 ? `${p.pack}-pack` : 'Single');
  parts.push(`${ordinal(p.version)} SKU`);
  if (p.region) parts.push(`${reg.regions[p.region]?.name || p.region}-specific unit`);
  return parts.join(' · ');
}

/**
 * The identity of a product for version counting: everything except the version.
 * Region is part of the key (each region keeps its own counter, decided 4 Nov 2026).
 * P1 is treated as a single, so legacy P1 SKUs count towards the same product.
 */
export function baseKey(p) {
  const cap = p.capacity ? `${p.capacity}${p.unit}` : '';
  return [p.brand, cap + '|' + p.product, p.colours.join(''), p.size, p.pack > 1 ? 'P' + p.pack : '', p.region].join('/');
}

/**
 * Work out the next version for a draft SKU.
 * existing: array of SKU strings already in the log / legacy mapping.
 * returns { next, matches: [{sku, version}] } where next = 1 means "first SKU, no version block".
 */
export function nextVersion(draftSku, existing, reg) {
  const d = parseSku(draftSku, reg);
  const key = baseKey(d);
  const matches = [];
  for (const s of existing) {
    const p = parseSku(s, reg);
    if (!p.product) continue;
    if (baseKey(p) === key) matches.push({ sku: p.sku, version: p.version });
  }
  matches.sort((a, b) => a.version - b.version);
  const max = matches.reduce((m, x) => Math.max(m, x.version), 0);
  return { next: max + 1, matches };
}

/** Checks for new registry codes (rules 7, 8, 12 and the BR/BRT lesson). */
export function checkNewCode(kind, code, reg, allCodesEverUsed = []) {
  const errors = [], warnings = [];
  code = String(code || '').trim().toUpperCase();
  if (!code) errors.push('Code is required.');
  else if (!CODE.test(code)) errors.push('Codes are uppercase letters and digits only, and never start with a digit.');
  if (allCodesEverUsed.includes(code)) errors.push(`${code} is already used (or was used before). Codes are never reused (rule 12).`);
  if (kind === 'brand' && !/^[A-Z]{2,3}$/.test(code)) errors.push('Brand codes are 2-3 letters.');
  if (kind === 'colour' && !/^[A-Z]{2}$/.test(code)) errors.push('Colour codes are exactly two letters.');
  if (kind === 'product') {
    if (reg.colours[code] || reg.sizes[code]) warnings.push(`${code} is also a variant code. That is what forced BR → BRT; consider another code.`);
    if (reg.unitByLetter[code[0]]) warnings.push(`${code} starts with a unit letter (${code[0]}). With a capacity in front (e.g. 12${code}) it can be misread as a unit. It still works because the registry resolves it, but avoid if you can.`);
  }
  if ((kind === 'colour' || kind === 'size') && reg.products[code]) warnings.push(`${code} is also a product code.`);
  return { code, errors, warnings };
}
