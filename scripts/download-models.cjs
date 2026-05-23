#!/usr/bin/env node
/**
 * ArchivistPro — Cross-platform model indirici
 *
 * Transformers.js modellerini HuggingFace'ten public/models/ altına indirir.
 * Zaten indirilmiş dosyaları atlar (boyut kontrolü).
 *
 * Kullanım:
 *   node scripts/download-models.js
 *   npm run models:download
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'public', 'models');
const HF_BASE = 'https://huggingface.co';

// --fp32 flag ile WebGPU için fp32 model dosyalari da indirilir (~1 GB ek).
// Quantized (q8) modeller WASM/CPU fallback için her zaman indirilir.
const includeFp32 = process.argv.includes('--fp32');

const MODELS = [
  {
    name: 'MiniLM (semantik metin arama)',
    id: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'onnx/model_quantized.onnx',
      ...(includeFp32 ? ['onnx/model.onnx'] : []),
    ],
  },
  {
    name: 'CLIP (gorsel arama)',
    id: 'Xenova/clip-vit-base-patch32',
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'preprocessor_config.json',
      'vocab.json',
      'merges.txt',
      'onnx/vision_model_quantized.onnx',
      'onnx/text_model_quantized.onnx',
      ...(includeFp32 ? ['onnx/vision_model.onnx', 'onnx/text_model.onnx'] : []),
    ],
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const parsed = new URL(u);
      https.get(parsed, { headers: { 'User-Agent': 'ArchivistPro' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          // Relative redirect → absolute URL oluştur
          const next = loc.startsWith('/') ? `${parsed.protocol}//${parsed.host}${loc}` : loc;
          follow(next);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} — ${u}`));
          return;
        }
        const dir = path.dirname(dest);
        fs.mkdirSync(dir, { recursive: true });
        const ws = fs.createWriteStream(dest);
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          ws.write(chunk);
          if (total > 1024 * 1024) {
            const pct = total ? Math.round((downloaded / total) * 100) : 0;
            process.stdout.write(`\r    %${pct} (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        res.on('end', () => {
          ws.end();
          if (total > 1024 * 1024) process.stdout.write('\n');
          resolve();
        });
        res.on('error', reject);
      }).on('error', reject);
    };
    follow(url);
  });
}

async function main() {
  let totalDownloaded = 0;
  let totalSkipped = 0;

  for (const model of MODELS) {
    console.log(`\n-- ${model.name} --`);
    const modelDir = path.join(MODELS_DIR, model.id);

    for (const file of model.files) {
      const dest = path.join(modelDir, file);
      const basename = path.basename(file);

      // Zaten var ve boyutu makul (>512 byte) ise atla
      if (fs.existsSync(dest)) {
        const stat = fs.statSync(dest);
        if (stat.size > 512) {
          console.log(`  [var] ${basename}`);
          totalSkipped++;
          continue;
        }
      }

      const url = `${HF_BASE}/${model.id}/resolve/main/${file}`;
      process.stdout.write(`  [indiriliyor] ${basename}`);
      try {
        await download(url, dest);
        console.log(`  [tamam] ${basename}`);
        totalDownloaded++;
      } catch (err) {
        console.error(`\n  [HATA] ${basename}: ${err.message}`);
        process.exit(1);
      }
    }
  }

  console.log(`\nModeller hazir: ${MODELS_DIR}`);
  console.log(`  indirilen: ${totalDownloaded}, mevcut: ${totalSkipped}`);
}

main().catch((err) => {
  console.error('Model indirme hatasi:', err);
  process.exit(1);
});
