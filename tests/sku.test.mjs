// Run with: node tests/sku.test.mjs
import assert from 'node:assert/strict';
import * as seed from '../js/seed.js';
import { makeRegistry, buildSku, parseSku, describe, nextVersion, checkNewCode } from '../js/sku.js';

const reg = makeRegistry(seed);
let n = 0;
const t = (name, fn) => { fn(); n++; };

// Every worked example from section 2 of the convention: [expected SKU, input]
const examples = [
  ['TCR-12S-BLBK-P2', { brand: 'TCR', product: 'S', capacity: 12, colours: ['BL', 'BK'], pack: 2 }],
  ['TCR-12S-BLBK-P2-V2', { brand: 'TCR', product: 'S', capacity: 12, colours: ['BL', 'BK'], pack: 2, version: 2 }],
  ['TCR-12S-BLBK-P2-V3', { brand: 'TCR', product: 'S', capacity: 12, colours: ['BL', 'BK'], pack: 2, version: 3 }],
  ['TCR-GS-CL', { brand: 'TCR', product: 'GS', colours: ['CL'] }], // Excel had 12GS; glass shakers come in one size, so no capacity (4 Nov 2026)
  ['TC-01LURN', { brand: 'TC', product: 'URN', capacity: 1 }],
  ['TC-03LURN', { brand: 'TC', product: 'URN', capacity: 3 }],
  ['TC-30MSYR', { brand: 'TC', product: 'SYR', capacity: 30 }],
  ['TC-05MSYR-P12', { brand: 'TC', product: 'SYR', capacity: 5, pack: 12 }],
  ['PM-PCR', { brand: 'PM', product: 'PCR' }],
  ['PM-PCE', { brand: 'PM', product: 'PCE' }],
  ['PM-PCS', { brand: 'PM', product: 'PCS' }],
  ['PM-PCT', { brand: 'PM', product: 'PCT' }],
  ['PM-PB-P100', { brand: 'PM', product: 'PB', pack: 100 }],
  ['PM-PB-P500', { brand: 'PM', product: 'PB', pack: 500 }],
  ['PM-HB-SM', { brand: 'PM', product: 'HB', size: 'SM' }],
  ['PM-HB-XL', { brand: 'PM', product: 'HB', size: 'XL' }],
  ['TC-EWM', { brand: 'TC', product: 'EWM' }],
  ['TCC-CHW-BL-P3', { brand: 'TCC', product: 'CHW', colours: ['BL'], pack: 3 }],
  ['TC-30MSYR-EU', { brand: 'TC', product: 'SYR', capacity: 30, region: 'EU' }],
];

for (const [want, input] of examples) {
  t('build ' + want, () => {
    const r = buildSku(input, reg);
    assert.deepEqual(r.errors, [], want + ' errors: ' + r.errors);
    assert.equal(r.sku, want);
  });
  t('roundtrip ' + want, () => {
    const p = parseSku(want, reg);
    assert.deepEqual(p.errors, [], want + ' parse errors: ' + p.errors);
    const back = buildSku({ brand: p.brand, product: p.product, capacity: p.capacity, colours: p.colours, size: p.size, pack: p.pack, version: p.version, region: p.region }, reg);
    assert.equal(back.sku, want);
  });
}

t('describe matches the sheet', () => {
  assert.equal(describe(parseSku('TCR-12S-BLBK-P2-V3', reg), reg), 'Tilcore · 12 oz protein shaker, plastic · Blue & Black · 2-pack · 3rd SKU');
});
t('grams capacity: 90 g loofah', () => { assert.equal(buildSku({ brand: 'TC', product: 'LOF', capacity: 90 }, reg).sku, 'TC-90GLOF'); assert.equal(parseSku('TC-90GLOF', reg).product, 'LOF'); });
t('Walmart suffix keeps its own count', () => assert.equal(nextVersion('TC-EXH-WM', ['TC-EXH', 'TC-EXH-V2', 'TC-EXH-WM'], reg).next, 2));
t('marketplace suffix described', () => assert.match(describe(parseSku('TC-PMS-V3-JP', reg), reg), /Japan only/));
t('Tilcore owns washer bag, clothesline, air vent', () => ['TWB','CLN','VNT'].forEach((c) => assert.equal(reg.products[c].brand, 'TCR')));
t('colour + size', () => assert.equal(buildSku({ brand: 'PM', product: 'HB', colours: ['BL', 'BK'], size: 'XL' }, reg).sku, 'PM-HB-BLBK-XL'));
t('100+ capacity uses three digits', () => assert.equal(buildSku({ brand: 'TC', product: 'SYR', capacity: 100 }, reg).sku, 'TC-100MSYR'));
t('capacity required when product has sizes', () => assert.ok(buildSku({ brand: 'TC', product: 'URN' }, reg).errors.length));
t('decimal capacity rejected', () => assert.ok(buildSku({ brand: 'TC', product: 'URN', capacity: 2.5 }, reg).errors.length));
t('PROPOSED gives a warning, not an error', () => {
  const r = buildSku({ brand: 'PM', product: 'PCR' }, reg);
  assert.equal(r.errors.length, 0); assert.equal(r.warnings.length, 1);
});
t('wrong brand for product', () => assert.ok(buildSku({ brand: 'PM', product: 'URN', capacity: 1 }, reg).errors.length));
t('V1 never produced', () => assert.equal(buildSku({ brand: 'PM', product: 'PCR', version: 1 }, reg).sku, 'PM-PCR'));
t('parse rejects V1', () => assert.ok(parseSku('PM-PCR-V1', reg).errors.length));
t('parse rejects unpadded capacity', () => assert.ok(parseSku('TC-3LURN', reg).errors.length));
t('parse flags P1', () => assert.ok(parseSku('TC-01LURN-P1-V11', reg).warnings.length));
t('spaces and en dashes are tidied', () => {
  const p = parseSku('TC - 01LURN – eu', reg);
  assert.deepEqual(p.errors, []); assert.equal(p.sku, 'TC-01LURN-EU'); assert.equal(p.region, 'EU'); assert.equal(p.warnings.length, 1);
});
t('clean input gives no tidy warning', () => assert.equal(parseSku('tc-01lurn', reg).warnings.length, 0));
t('parse rejects legacy junk', () => assert.ok(parseSku('TCORE12OZSBB-ASIN1-SKU3', reg).errors.length));

const log = seed.sku_log.map((r) => r.sku);
t('first SKU: no version', () => assert.equal(nextVersion('PM-PCR', log, reg).next, 1));
t('pet massager: V2 + V3 exist → V4', () => assert.equal(nextVersion('TC-PMS', log, reg).next, 4));
t('urinal single: P1-V11 counts as single → V12', () => assert.equal(nextVersion('TC-01LURN', log, reg).next, 12));
t('urinal 2-pack → V12', () => assert.equal(nextVersion('TC-01LURN-P2', log, reg).next, 12));
t('urinal 3 L is a different product → first', () => assert.equal(nextVersion('TC-03LURN', log, reg).next, 1));
t('marketplace suffix has its own counter', () => assert.equal(nextVersion('TC-PMS-EU', log, reg).next, 1));
t('unversioned first SKU counts as 1', () => assert.equal(nextVersion('PM-PCR', ['PM-PCR'], reg).next, 2));
t('versions with gaps use max + 1', () => assert.equal(nextVersion('PM-PCR', ['PM-PCR', 'PM-PCR-V5'], reg).next, 6));

t('new product code clashing with colour warns', () => assert.ok(checkNewCode('product', 'BR', reg).warnings.length));
t('product code starting with digit rejected', () => assert.ok(checkNewCode('product', '2X', reg).errors.length));
t('reused code rejected', () => assert.ok(checkNewCode('product', 'URN', reg, ['URN']).errors.length));

console.log(`All ${n} tests passed.`);
