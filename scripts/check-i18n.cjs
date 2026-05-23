const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const languages = ['tr', 'en', 'zh', 'ja', 'ar'];
const reference = 'tr';

function extractKeys(obj, prefix = '') {
  let keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      keys = keys.concat(extractKeys(v, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

// Load all
const data = {};
for (const lang of languages) {
  const file = path.join(localesDir, `${lang}.json`);
  data[lang] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

const refKeys = new Set(extractKeys(data[reference]));
console.log(`Reference: ${reference}.json — ${refKeys.size} keys\n`);

let totalMissing = 0;
let totalOrphan = 0;

for (const lang of languages) {
  if (lang === reference) continue;
  const langKeys = new Set(extractKeys(data[lang]));

  const missing = [...refKeys].filter(k => !langKeys.has(k)).sort();
  const orphan = [...langKeys].filter(k => !refKeys.has(k)).sort();

  console.log(`=== ${lang.toUpperCase()}.json ===`);
  console.log(`  Total keys: ${langKeys.size}`);
  console.log(`  Missing (in tr but not ${lang}): ${missing.length}`);
  if (missing.length) {
    for (const k of missing) console.log(`    - ${k}`);
  }
  console.log(`  Orphan (in ${lang} but not tr): ${orphan.length}`);
  if (orphan.length) {
    for (const k of orphan) console.log(`    + ${k}`);
  }
  console.log();

  totalMissing += missing.length;
  totalOrphan += orphan.length;
}

console.log(`=== SUMMARY ===`);
console.log(`Reference (tr): ${refKeys.size} keys`);
console.log(`Total missing across all languages: ${totalMissing}`);
console.log(`Total orphan across all languages: ${totalOrphan}`);
