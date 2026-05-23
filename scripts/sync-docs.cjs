#!/usr/bin/env node
/**
 * ArchivistPro — Dokümantasyon senkronizasyonu
 *
 * Repo kökündeki tek-kaynak dokümanları (docs/) Vite'ın dev/build sırasında
 * serve ettiği public/docs/ klasörüne kopyalar. Bu sayede yardım paneli
 * (HelpPanel) bu dosyaları fetch ile okuyabilir.
 *
 * Drift'i önler: docs/ ana kaynak, public/docs/ build artefaktı.
 *
 * Çağrı yerleri:
 *   - package.json predev (npm run dev öncesi)
 *   - package.json prebuild (npm run build öncesi)
 *
 * Manuel çağrı:  npm run docs:sync
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SYNC_FILES = [
  // docs/SOURCE → public/docs/DEST
  ['docs/CHANGELOG.md', 'public/docs/CHANGELOG.md'],
];

let copied = 0;
let skipped = 0;

for (const [src, dst] of SYNC_FILES) {
  const srcPath = path.join(ROOT, src);
  const dstPath = path.join(ROOT, dst);

  if (!fs.existsSync(srcPath)) {
    console.warn(`[docs:sync] WARN — kaynak yok: ${src}`);
    continue;
  }

  fs.mkdirSync(path.dirname(dstPath), { recursive: true });

  // Aynı içerik varsa atla (CI/dev cache friendly)
  if (fs.existsSync(dstPath)) {
    const srcBytes = fs.readFileSync(srcPath);
    const dstBytes = fs.readFileSync(dstPath);
    if (srcBytes.equals(dstBytes)) {
      skipped++;
      continue;
    }
  }

  fs.copyFileSync(srcPath, dstPath);
  copied++;
  console.log(`[docs:sync] ${src} → ${dst}`);
}

if (copied === 0 && skipped > 0) {
  console.log(`[docs:sync] ${skipped} dosya zaten güncel.`);
} else if (copied > 0) {
  console.log(`[docs:sync] ${copied} kopyalandı, ${skipped} atlandı.`);
}
