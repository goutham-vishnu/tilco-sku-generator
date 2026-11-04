// Seed data, transcribed from "SKU Naming Convention — Tilco (FINAL).xlsx" (23 Sep 2026).
// Used to seed Supabase (see supabase/seed.sql) and as the data for demo mode.

export const brands = [
  { code: 'TC',  name: 'Tilcare',           notes: 'Core consumer health / personal care' },
  { code: 'PM',  name: 'Pill Mill',         notes: 'Pill management' },
  { code: 'TCR', name: 'Tilcore',           notes: 'Never write as TCORE or TILCORE' },
  { code: 'TCC', name: 'Tilcare Chew Chew', notes: 'Sensory / chew products' },
  { code: 'GP',  name: 'GyraPress',         notes: 'Coffee devices' },
  { code: 'TV',  name: 'Tilvolt',           notes: 'Scope to confirm (open decision 5)' },
];

// cap_unit: null = product comes in one size (no capacity block).
//           'OZ' = ounces (bare number), otherwise L / M / G / C.
const P = (code, name, brand, cap_unit = null, notes = '') =>
  ({ code, name, brand, status: 'PROPOSED', cap_unit, notes });

export const products = [
  P('S',   'Protein shaker, plastic',      'TCR', 'OZ', 'Capacity in oz, e.g. 12S'),
  P('GS',  'Protein shaker, glass',        'TCR', 'OZ', 'e.g. 12GS'),
  P('URN', 'Urinal bottle',                'TC',  'L',  'Capacity in L, e.g. 01LURN / 03LURN'),
  P('BP',  'Bedpan',                       'TC'),
  P('SYR', 'Oral / medical syringe',       'TC',  'M',  'Capacity in mL: 01M 03M 05M 20M 30M'),
  P('SYP', 'Pet insulin syringe (U40)',    'TC'),
  P('EWM', 'Ear washer, manual',           'TC'),
  P('EWV', 'Ear washer, vacuum',           'TC',  null, 'See open decision 1'),
  P('EWK', 'Ear wax removal kit',          'TC'),
  P('EAD', 'Ear dryer',                    'TC'),
  P('EPB', 'Ear popper, balloon',          'TC'),
  P('EPU', 'Ear popper, electric',         'TC'),
  P('PCR', 'Pill crusher, manual',         'PM'),
  P('PCE', 'Pill crusher, electric',       'PM'),
  P('PCS', 'Pill crusher, electric small', 'PM'),
  P('PCT', 'Pill cutter',                  'PM',  null, 'Changed from PCS (was a duplicate)'),
  P('PB',  'Pill bags',                    'PM',  null, 'Pack size in the pack block: P100 / P500'),
  P('HB',  'Holder belt',                  'PM',  null, 'Size in the variant block: SM / XL. Brand: open decision 2'),
  P('CHW', 'Chew necklace / sensory aid',  'TCC'),
  P('ICL', 'Insulin cooler',               'TC'),
  P('SRK', 'Sinus rinse kit',              'TC'),
  P('DRM', 'Derma roller',                 'TC'),
  P('CLN', 'Clothesline',                  'TC'),
  P('TWB', 'Travel wash bag',              'TC'),
  P('VNT', 'HVAC vent deflector',          'TC'),
  P('LOF', 'Loofah',                       'TC'),
  P('HWB', 'Hair washing basin',           'TC'),
  P('BRT', 'Breather',                     'TC',  null, 'Changed from BR (clashed with colour Brown)'),
  P('PMS', 'Pet massager',                 'TC'),
  P('CP',  'Coffee press filter',          'GP'),
  P('TPC', 'Toothpaste caps',              'TC',  null, 'Added: used in SKU Log (TC-TPC-P6-V4) but missing from the registry'),
];

export const variants = [
  { code: 'BK', name: 'Black',  type: 'COLOUR' },
  { code: 'BL', name: 'Blue',   type: 'COLOUR' },
  { code: 'WH', name: 'White',  type: 'COLOUR' },
  { code: 'GY', name: 'Grey',   type: 'COLOUR', notes: 'Not to be confused with GR (Green)' },
  { code: 'GR', name: 'Green',  type: 'COLOUR' },
  { code: 'RD', name: 'Red',    type: 'COLOUR' },
  { code: 'PK', name: 'Pink',   type: 'COLOUR' },
  { code: 'PU', name: 'Purple', type: 'COLOUR' },
  { code: 'OR', name: 'Orange', type: 'COLOUR' },
  { code: 'YL', name: 'Yellow', type: 'COLOUR' },
  { code: 'CL', name: 'Clear',  type: 'COLOUR' },
  { code: 'BG', name: 'Beige',  type: 'COLOUR' },
  { code: 'BR', name: 'Brown',  type: 'COLOUR' },
  { code: 'S',  name: 'Small',       type: 'SIZE' },
  { code: 'M',  name: 'Medium',      type: 'SIZE' },
  { code: 'L',  name: 'Large',       type: 'SIZE' },
  { code: 'XL', name: 'Extra Large', type: 'SIZE' },
  { code: 'SM', name: 'Small/Medium, one combined size', type: 'SIZE', notes: 'Only for products sold as a single S/M size (Holder Belt)' },
];

export const units = [
  { code: 'OZ', letter: '',  name: 'Ounces',      short: 'oz' },
  { code: 'L',  letter: 'L', name: 'Litres',      short: 'L' },
  { code: 'M',  letter: 'M', name: 'Millilitres', short: 'mL' },
  { code: 'G',  letter: 'G', name: 'Grams',       short: 'g' },
  { code: 'C',  letter: 'C', name: 'Centimetres', short: 'cm' },
];

export const regions = [
  { code: 'EU', name: 'Europe' },
  { code: 'JP', name: 'Japan' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
];

export const sku_log = [
  { sku: 'TC-01LURN-P1-V11', product: 'Male Urinal 1 pack', asin: 'B07V2D9KY1', marketplace: 'USA', reason: 'New Supplier', supplier: 'Winona', status: 'ACTIVE', notes: 'Known exception: live with P1 (Amazon SKUs cannot be renamed). New singles never get P1.' },
  { sku: 'TC-01LURN-P2-V11', product: 'Male Urinal 2 pack', asin: 'B07Z88ZHR3', marketplace: 'USA', reason: 'New Supplier', supplier: 'Winona', status: 'ACTIVE' },
  { sku: 'TC-01LURN-P3-V11', product: 'Male Urinal 3 pack', asin: 'B07MBB6B6K', marketplace: 'USA', reason: 'New Supplier', supplier: 'Winona', status: 'ACTIVE' },
  { sku: 'TC-PMS-V3', product: 'Electric Pet Massager', asin: 'B09NQ6QW4Q', marketplace: 'USA', reason: 'New Supplier', supplier: 'Hangzhou Manqi Trading Co., Ltd.', status: 'ACTIVE' },
  { sku: 'TC-PMS-V2', product: 'Electric Pet Massager', asin: 'B09NQ6QW4Q', marketplace: 'JP', status: 'ACTIVE' },
  { sku: 'TC-TPC-P6-V4', product: 'Toothpaste Caps', asin: 'B09CYM5MFM', marketplace: 'JP', reason: 'will be pack in tin box', status: 'ACTIVE' },
  { sku: 'TC-BP-V2', product: 'Bedpan', asin: 'B09CV1HWBV', marketplace: 'All Markets except CA', status: 'ACTIVE' },
];

export const legacy_map = [];
