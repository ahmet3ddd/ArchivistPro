#!/usr/bin/env bash
# ArchivistPro — Transformers.js modellerini indir
#
# Modeller public/models/ altına yerleştirilir. Vite build sırasında bunları
# dist/ içine kopyalar ve Tauri installer'a gömer. Toplam ~218 MB.
#
# Kullanım:
#   bash scripts/download-models.sh
#   veya:  npm run models:download

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$ROOT_DIR/public/models"

HF_BASE="https://huggingface.co"

MINILM_ID="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
CLIP_ID="Xenova/clip-vit-base-patch32"

MINILM_DIR="$MODELS_DIR/$MINILM_ID"
CLIP_DIR="$MODELS_DIR/$CLIP_ID"

mkdir -p "$MINILM_DIR/onnx" "$CLIP_DIR/onnx"

fetch() {
    local url="$1"
    local out="$2"
    if [ -f "$out" ] && [ $(stat -c%s "$out" 2>/dev/null || stat -f%z "$out") -gt 512 ]; then
        echo "  ✓ $(basename "$out") (var)"
        return 0
    fi
    echo "  ↓ $(basename "$out")"
    curl -sSL --fail -o "$out" "$url"
}

echo "── MiniLM (semantik metin arama) ──"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
    fetch "$HF_BASE/$MINILM_ID/resolve/main/$f" "$MINILM_DIR/$f"
done
fetch "$HF_BASE/$MINILM_ID/resolve/main/onnx/model_quantized.onnx" \
      "$MINILM_DIR/onnx/model_quantized.onnx"

echo ""
echo "── CLIP (görsel arama) ──"
for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json preprocessor_config.json vocab.json merges.txt; do
    fetch "$HF_BASE/$CLIP_ID/resolve/main/$f" "$CLIP_DIR/$f"
done
fetch "$HF_BASE/$CLIP_ID/resolve/main/onnx/vision_model_quantized.onnx" \
      "$CLIP_DIR/onnx/vision_model_quantized.onnx"
fetch "$HF_BASE/$CLIP_ID/resolve/main/onnx/text_model_quantized.onnx" \
      "$CLIP_DIR/onnx/text_model_quantized.onnx"

echo ""
echo "✓ Modeller hazır: $MODELS_DIR"
du -sh "$MODELS_DIR" 2>/dev/null || true
