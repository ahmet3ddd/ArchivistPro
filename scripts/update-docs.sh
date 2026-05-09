#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# ArchivistPro — DEVELOPER_GUIDE.md otomatik guncelleme scripti
#
# Her commit oncesi calistirilir (pre-commit hook).
# Dokumandaki AUTO-UPDATE blogunun icindeki istatistikleri
# mevcut kod tabanina gore yeniden hesaplar.
# ──────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/.." && pwd)")"
DOC="$REPO_ROOT/docs/DEVELOPER_GUIDE.md"

if [ ! -f "$DOC" ]; then
  echo "[update-docs] DEVELOPER_GUIDE.md bulunamadi, atlaniyor."
  exit 0
fi

# ── Istatistik toplama ──────────────────────────────────────

# Versiyon
VERSION=$(grep '"version"' "$REPO_ROOT/package.json" | head -1 | sed 's/.*: *"//;s/".*//')

# Tarih
TODAY=$(date +%Y-%m-%d)

# Son commit (kisa hash)
LAST_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Frontend satir sayisi (TS + TSX)
TS_LINES=$(find "$REPO_ROOT/src" -name "*.ts" -o -name "*.tsx" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
TS_LINES=${TS_LINES:-0}
# Binlik ayiraci ekle
TS_FORMATTED=$(printf "%'d" "$TS_LINES" 2>/dev/null || echo "$TS_LINES")

# Rust satir sayisi
RS_LINES=$(find "$REPO_ROOT/src-tauri/src" -name "*.rs" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
RS_LINES=${RS_LINES:-0}
RS_FORMATTED=$(printf "%'d" "$RS_LINES" 2>/dev/null || echo "$RS_LINES")

# Bilesen sayisi
COMPONENTS=$(find "$REPO_ROOT/src/components" -name "*.tsx" 2>/dev/null | wc -l | tr -d ' ')

# Servis sayisi
SERVICES=$(find "$REPO_ROOT/src/services" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')

# Hook sayisi
HOOKS=$(find "$REPO_ROOT/src/hooks" -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')

# Rust modul sayisi
RUST_MODULES=$(find "$REPO_ROOT/src-tauri/src" -name "*.rs" 2>/dev/null | wc -l | tr -d ' ')

# Dil sayisi
LANGUAGES=$(find "$REPO_ROOT/src/i18n/locales" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')

# Tablo sayisi (CREATE TABLE)
TABLES=$(grep -c "CREATE TABLE" "$REPO_ROOT/src/services/database.ts" 2>/dev/null || echo "0")

# Tauri komut sayisi (tauri::command fonksiyonlari)
TAURI_CMDS=$(grep -r "#\[tauri::command\]" "$REPO_ROOT/src-tauri/src/" 2>/dev/null | wc -l | tr -d ' ')

# ── Dokumani guncelle ──────────────────────────────────────

# AUTO-UPDATE blok icerigi
NEW_BLOCK="<!-- AUTO-UPDATE-START — Bu bölüm scripts/update-docs.sh tarafından otomatik güncellenir -->
| Bilgi | Deger |
|-------|-------|
| **Versiyon** | $VERSION |
| **Son Guncelleme** | $TODAY |
| **Son Commit** | $LAST_COMMIT |
| **Frontend** | $TS_FORMATTED satir TypeScript/TSX |
| **Backend** | $RS_FORMATTED satir Rust |
| **Bilesenler** | $COMPONENTS React component |
| **Servisler** | $SERVICES TypeScript servisi |
| **Hook'lar** | $HOOKS React hook |
| **Rust Modulleri** | $RUST_MODULES modül |
| **Tauri Komutlari** | ${TAURI_CMDS}+ komut |
| **Diller** | $LANGUAGES (tr, en, zh, ja, ar) |
| **Veritabani Tablolari** | $TABLES tablo |
<!-- AUTO-UPDATE-END -->"

# sed ile blok degistirme (START ve END arasi)
# Gecici dosya kullan (Windows uyumluluk)
TMPFILE=$(mktemp)
awk -v new_block="$NEW_BLOCK" '
  /<!-- AUTO-UPDATE-START/ { print new_block; skip=1; next }
  /<!-- AUTO-UPDATE-END/ { skip=0; next }
  !skip { print }
' "$DOC" > "$TMPFILE"

mv "$TMPFILE" "$DOC"

# Son elle guncelleme satirini da guncelle
sed -i "s/^\*Son elle guncelleme:.*/*Son elle guncelleme: $TODAY · Surum: $VERSION*/" "$DOC" 2>/dev/null || true

# Degisiklik varsa stage'e ekle
if git diff --quiet "$DOC" 2>/dev/null; then
  echo "[update-docs] Degisiklik yok."
else
  git add "$DOC"
  echo "[update-docs] DEVELOPER_GUIDE.md guncellendi ve stage'e eklendi."
fi

# ── CLAUDE.md — bilesen ve i18n anahtar sayisi ──────────────
CLAUDE_MD="$REPO_ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ] && command -v node &>/dev/null; then
  # i18n anahtar sayisi (tr.json leaf sayisi)
  I18N_COUNT=$(node -e "
    const obj = require('$REPO_ROOT/src/i18n/locales/tr.json');
    function count(o){return Object.values(o).reduce((n,v)=>typeof v==='object'?n+count(v):n+1,0);}
    console.log(count(obj));
  " 2>/dev/null || echo "0")

  # Bilesenler zaten hesaplandi: $COMPONENTS
  # Guncelleme tarihi zaten: $TODAY

  # CLAUDE.md icindeki "son olcum" tarihini, bilesen sayisini ve i18n anahtar sayisini guncelle
  sed -i \
    -e "s/son olcum [0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}/son olcum $TODAY/" \
    -e "s/— [0-9]\+ bilesen,/— $COMPONENTS bilesen,/" \
    -e "s/%100 ([0-9]\+ anahtar)/%100 ($I18N_COUNT anahtar)/" \
    "$CLAUDE_MD" 2>/dev/null || true

  if ! git diff --quiet "$CLAUDE_MD" 2>/dev/null; then
    git add "$CLAUDE_MD"
    echo "[update-docs] CLAUDE.md guncellendi ve stage'e eklendi."
  fi
fi
