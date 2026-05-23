# ArchivistPro — Yapılacaklar ve Bilinçli Olarak Ertelenenler

Bu dosya iki listeyi bir arada tutar:
1. **Aksiyon Listesi** — yapılmak üzere sıraya konmuş maddeler (öncelik etiketli)
2. **Ertelenenler** — kasten bekletilen teknik borçlar (ne / neden / risk / ne zaman)

---

## v2.4.9 — Dürüst Kapanış Release'i (AKTİF, 2026-05-15)

Kaynak: `docs/archive/2026-05-15_REALISTIC_AUDIT.md`. Amaç: v2.4.x'i temiz/dürüst bir baseline ile kapatmak. **Kapsam dar tutulacak — feature eklenmeyecek.**

> **Doğrulama notu:** Audit'teki "93 silent catch" maddesi kendi grep'imle denetlendi — gerçekte truly-empty catch ~0. Çoğu `database.ts` şema migration idempotency'si (`catch { /* sessizce devam et */ }`, bilinçli + yorumlu + doğru pattern). **v2.4.9 kapsamına ALINMADI** — düzeltmek churn olur ve "olmayacak senaryoya error handling ekleme" prensibine aykırı.

### V249-0. CLIP warmup CSP → WebGPU tarama stall (PARK — kullanıcı 2026-05-15 raporladı)
**Belirti:** Yeni tarama: ilk dosyada uzun bekleme → ~14 dosya 7-10s patlama → tekrar tıkanma. F12: `transformers.web...js Refused to connect data:image/png;base64,iVBOR... violates CSP` + `CLIP image model device = webgpu`. Flush `embeds=0/0`.
**Kök neden (derin analiz):** `tauri.conf.json:23` CSP `connect-src`'de `data:` yok (`img-src`'de var). `embeddings.ts:357 warmupClipModel` `clipPipeline(TINY_PNG)` `data:` URI → transformers.js `fetch(data:)` → CSP red → warmup non-fatal başarısız → **WebGPU CLIP startup'ta ön-ısıtılamıyor** → pahalı WebGPU pipeline+shader derlemesi ilk taranan görsele kayıyor (= ilk-dosya beklemesi), sonra burst, sonra yeni yol/derleme → tekrar stall. Tarama-yolu (`generateImageEmbeddingsMulti`→Blob→`blob:`) CSP'den ETKİLENMİYOR — sorun yalnız warmup.
**Önerilen fix (en sağlam):** `warmupClipModel`'i `data:` yerine **Blob** kullanacak şekilde değiştir (base64→Uint8Array→Blob; `generateImageEmbedding` zaten Blob→`blob:` çeviriyor, CSP'ye bağımsız). Opsiyonel savunma: `connect-src`'ye `data:` ekle. v2 hotfix dalı (main'den), v3 dalında DEĞİL.
**Durum:** Kanıt-topla adımı (kullanıcıdan 1 tarama+F12 logu) bekliyor — kullanıcı v3 odağını korumak istediği için PARK edildi; v3 sonrası veya kullanıcı isteyince ele alınır.
**Risk:** Düşük (warmup→Blob izole, tarama-yolu zaten Blob deseni).

### V249-1. CLIP fp32 modelleri prod paketleme kararı
**Ne:** `package.json` `models:check` + `build` sadece q8 (`*_quantized.onnx`) paketliyor. fp32 modelleri (`models:download:fp32`, ~580MB) ayrı manuel script — prod MSI'de yok. Sonuç: prod kullanıcı WebGPU avantajını kutudan çıkar çıkmaz alamıyor; CLAUDE.md'deki "tam offline paketli" iddiası kısmen yanlıştı (v2.4.8'de düzeltildi).
**Doğrulama:** `package.json:12,22` — `models:check` yalnız `model_quantized.onnx` + `vision_model_quantized.onnx` kontrol ediyor. ✓ teyit edildi.
**Karar bekliyor:** (A) fp32'yi prod MSI'ye göm (+~580MB) (B) ilk açılışta WebGPU varsa opsiyonel indir ("tam offline"ı kırar) (C) q8-only kalsın, sadece doküman dürüst (yapıldı).
**Risk:** Düşük (C) / Orta (A — MSI boyutu, build script).

### V249-2. Production `console.log` → `debugLog`
**Ne:** ~23 gerçek üretim `console.*` çağrısı (logger.ts'in kendi 6 çağrısı + test dosyaları hariç). DevTools'da gürültü, profesyonellik lekesi.
**Doğrulama:** Grep — 34 toplam / 11 dosya; logger.ts (6, meşru), i18nCompleteness.test.ts (3) ve tauriMock.ts (2) çıkınca ~23 gerçek. Dosyalar: useAppInitialization, dbSnapshot, useFolderWatcher, dwgShapeIndex, embeddings, ChatPanel, fileScanner, ragIndexStatus.
**Nasıl:** Mevcut `debugLog()` (`services/logger.ts`) kullan. Mekanik, düşük risk.

### V249-3. Coverage gerçek ölçüm
**Ne:** `@vitest/coverage-v8` kurulu (`package.json:63`) ama `test:coverage` script'i yok, rapor üretilmiyor. CLAUDE.md eski iddia (%64/53/79) doğrulanamadı, "çıkarılmadı" notu düşüldü.
**Nasıl:** `package.json`'a `"test:coverage": "vitest run --coverage"` ekle, çalıştır, gerçek sayıyı CLAUDE.md'ye yaz.
**Risk:** Yok.

### V249-4 (opsiyonel). DWG R2004+ layer extraction uyarısı
**Ne:** `dwg_parse.rs:1754` TODO — R2004+ (AC1018+) layer extraction LibreDWG gerektiriyor. Bu bir **feature gap**, bug değil. v2.4.9'da en fazla UI'da "bu DWG sürümünde sınırlı destek" mesajı; LibreDWG entegrasyonu v3'e ait.

---

## v3-architecture — Sonraki Büyük Girişim (100K–1M+ dosya ölçeği)

**Konum:** Ayrı umbrella dal `v3-architecture`, focused alt-PR'lar. **main'de DENENMEZ** (sql.js çıkışı backwards-incompatible). v2 ve v3 paralel yaşar; v3 ayrı ürün konumu ("Pro/Enterprise"), lisanslama (A14) burada anlam kazanır. Backend-first: vektör store + batch pipeline 100K asset ile test edilip çalışınca UI gelir.

### V3-1. Vektör index (ANN) — linear scan'i değiştir
**Ne:** `semanticSearch()` (`embeddings.ts`) O(n) cosine; tüm vektörler RAM'e (`ragService.ts` getRagCachedEmbeddings). 1M asset = ~3GB+ RAM, sorgu başına tam tarama.
**Nasıl:** `hnswlib-rs` veya gömülü `qdrant` benzeri ANN index. Index file format yeni → migration.
**Risk:** Yüksek (geri dönüşsüz format kararı — yanlış seçim 2 ay sonra pahalı).

### V3-2. sql.js → OPFS SQLite / rusqlite-only
**Ne:** sql.js tüm DB'yi V8 heap'e yüklüyor; 4GB limit aşılıyor (TODO A-DWG-OFFLOAD, kullanıcı 1.13M satırla yaşadı). `shapes_db.rs` kısmi geçiş başladı.
**Nasıl:** SQLite WASM OPFS (lazy disk okuma) veya tam rusqlite-only; `database.ts` komple yeniden.
**Risk:** Yüksek, backwards-incompatible.

### V3-3. Per-archive write lock + connection pool
**Ne:** Global `DB_WRITE_LOCK` (`ollama_db.rs`) tüm yazmaları serileştiriyor; 5+ arşivde tıkar.
**Nasıl:** SQLite WAL + per-archive connection pool + finegrain lock.
**Risk:** Orta.

### V3-4. Batch pipeline — embedding + LLM tag + kuyruk
**Ne:** AI tag önerisi asset başına 1 Ollama hit (`tagService.ts`); 1M dosya fizik dışı. Embedding batch (32) var ama tag yok.
**Nasıl:** Batch prompt (tek çağrıda 10-20 asset) + queue + retry + backpressure.
**Risk:** Orta.

### V3-5. 10K+ asset render virtualization
**Ne:** Büyük listede DetailPanel/Sidebar/grid virtualization olmadan ölür. `react-virtuoso` zaten dependency — kısmi.
**Nasıl:** Tüm büyük list/grid sanallaştır; mega-component bölme (A9) ile birlikte.
**Risk:** Orta.

### V3-6 (kesişen). Rust test suite
**Ne:** 17.4K satır Rust, ~146 komut, **0 `#[test]`**. v3 refaktörü test güvenliği olmadan tehlikeli.
**Nasıl:** Önce `scan_db` + `ollama_db` için 50-100 test; v3 değişiklikleri test-first.
**Risk:** Yok (sadece zaman).

---

## Aksiyon Listesi (2026-04-21 audit sonrası)

### P0 — Kullanıcı-görür hatalar (hemen)

#### A1. i18n eksik anahtarlar: zh / ja / ar
**Yapıldı:** 2026-04-21 — zh/ja/ar 1526→1633 anahtar, 0 eksik. 5/5 dil eşit.

#### A2. Kod içi Türkçe fallback temizliği
**Yapıldı:** 2026-04-21 — 205 fallback kaldırıldı (214 toplam, 7 eksik anahtar eklendi). Üretim kodunda 0 `t('key', 'fallback')` kaldı.

#### A3. `window.prompt` / `window.confirm` kullanımı → ConfirmDialog
**Yapıldı:** 2026-04-21 — InputDialog bileşeni + store slice eklendi; Sidebar.tsx (3×prompt), TagManagerModal.tsx (2×confirm), DuplicateFinderModal.tsx (2×confirm) temizlendi.

#### A4. Dokümantasyon drift
**Yapıldı:** 2026-04-21 — CLAUDE.md sayıları düzeltildi (1633 anahtar, 68 bileşen, 1371 test). update-docs.sh artık her commit'te CLAUDE.md'deki bileşen ve i18n sayılarını da otomatik günceller.

### P1 — Görünür UX tutarsızlıkları (yakında)

#### A5. TopBar ikon tutarsızlığı
**Yapıldı:** 2026-04-21 — 💬/🖼️/⬡ emojileri MessageSquare/Image/Hexagon Lucide ikonlarıyla değiştirildi.

#### A6. Setup/onboarding akışı konsolidasyonu
**Büyük ölçüde tamamlandı:** SetupWizard 5→3 adım (2a83875), OnboardingTour otomatik açılış kaldırıldı, AISetupWizard birleştirildi (a9c7880), PerformanceSetupModal → sessiz otomatik algılama. Kalan: `markSetupWizardSeen()` / `markPerformanceSeen()` / `onboarding_completed` → tek bayrak (düşük öncelik).

#### A7. AssetCard checkbox keşfedilebilirliği
**Yapıldı:** 2026-04-21 — Checkbox opacity 0.22 (daima görünür) + sağ-tık menüye "Seçime Ekle/Çıkar" eklendi.

#### A8. Inline-style hex fallback'leri
**Yapıldı:** 2026-04-21 — 114 `var(--color-xxx, #hex)` fallback kaldırıldı. CSS custom properties root'ta her zaman tanımlı.

### P1 — Performans / UX (donmaya sebep olan teknik borçlar)

#### A-SAVE-FREEZE. Collections / root_groups / tags için tablo-özel rusqlite invoke
**Yapıldı:** 2026-05-12 — 4 yeni Rust komutu (`favorite_apply_changes`, `collection_apply_changes`, `tag_apply_changes`, `root_group_apply_changes`) + frontend mirror helper'ları. 20 `saveDatabaseDeferred()` çağrısı `favorites.ts` / `tagService.ts` / `rootTagService.ts` / `database.ts` içinde kaldırıldı. Pattern: `audit_log_apply_changes` ve `write_chat_mirror` ile aynı (spawn_blocking + DB lock + transaction). Test: 2103/2103 pass.

#### A-DWG-OFFLOAD. dwg_shapes tablosunu sql.js dışına çıkar
**Ne:** Şu an `dwg_shapes` sql.js içinde (frontend) — milyonlarca satır şişebilir (12.05.2026'da bir kullanıcının yerel arşivinde 1.13M satır, ana arşivde benzer durum). DB swap sırasında V8 renderer OOM ("Aw Snap" beyaz ekran).
**Etki:** Büyük arşivlerde yerel↔ana arşiv geçişi tek seferlik 7-9 GB RAM piki yaratıyor (V8 default 4 GB heap limit aşılıyor). Renderer çöküyor.
**Nasıl:** dwg_shapes'i rusqlite-only tutmak — frontend hiç touch etmesin. UI shape sorgu yapmak istediğinde `dwg_shapes_query` gibi invoke komutu üzerinden alsın. Veya sql.js-WASM yerine [SQLite WASM OPFS](https://sqlite.org/wasm/doc/trunk/persistence.md) — diskten lazy okuma ile tam DB'yi heap'e yüklemekten kurtarır.
**Workaround (geçici):** `DELETE FROM dwg_shapes; VACUUM;` — DB %70-80 küçülür. Kaybolan: DWG shape preview / geometric search. Yeniden tarama ile regenerate olur.
**Risk:** Orta — sql.js → rusqlite migration ile shape arama özelliği API değişikliği gerek.

### P1 — Stratejik / Büyüme (önemli, belirli karar gerektirir)

#### A14. Lisanslama Sistemi
**Ne:** MIT lisansı yazılım lisansı, kullanım lisansı değil. License key, trial süresi, seat limiti yok. Ticari dağıtımda gelir modeli eksik.
**Nasıl:** License key doğrulama (offline-first, hardware-bound hash), trial 30 gün, seat sayısı kontrolü. Yeni `licenseService.ts` + `LicenseModal.tsx` + Rust tarafında doğrulama.
**Ne zaman:** Ticari dağıtım kararı alındığında.

#### A15. Mac / Linux Build
**Ne:** Sadece Windows MSI üretiliyor. Tauri cross-platform ama macOS (.dmg) ve Linux (.AppImage/.deb) hiç denenmemiş.
**Nasıl:** CI/CD'de macOS + Linux runner ekle; platform-specific path'leri test et (`~` vs `C:\`, `\` vs `/`).
**Ne zaman:** Ofis dışı dağıtım veya macOS kullanan mimarlık ofisleri hedeflendiğinde.

### P2 — Bakım ve ölçeklenebilirlik (orta vade)

#### A9. Mega-component'leri böl
**Ne:** Tek dosyada toplanmış büyük bileşenler refactor bekliyor:
- `DetailPanel.tsx` — 1565 satır
- `SettingsModal.tsx` — 1393 satır (5 tab zaten var, her tab ayrı dosya olmalı)
- `DuplicateFinderModal.tsx` — 1292 satır
- `ArchiveExtractModal.tsx` — 1188 satır
- `Sidebar.tsx` — 1087 satır (tarama kökleri, gruplar, faset filtreler, arama, embedding durumu… çok görev)
**Etki:** Okunabilirlik, test yazımı, merge çatışması, hot-reload süresi.
**Nasıl:** `ChatPanel` bölümlendirmesi referans (1196 → 543 satır, 8 alt bileşen).

#### A10. ModalPortal lazy mount
**Yapıldı:** 2026-04-21 — AISetupWizard, ChatPanel, VisualSearchModal, ShapeSearchModal `isOpen &&` ile sarmalandı. Kapalıyken mount edilmiyor.

#### A11. Zustand store slice'lama
**Ne:** `useStore.ts` — 593 satırda 50+ flag + 20+ setter tek bag'de.
**Etki:** Domain karışıyor (UI state, kullanıcı, arşiv, modal bayrakları, task runner, filtre presetleri, toasts…). Gelecekte context bölünmesi veya middleware eklemesi zor.
**Nasıl:** Zustand slice pattern: `authSlice`, `archiveSlice`, `modalSlice`, `filterSlice`, `taskSlice`. İlk aşamada sadece modal flag'leri tek `modalSlice`'a taşımak bile +%30 okunabilirlik verir.

### P3 — İnce ayar (fırsat bulunca)

#### A12. `onContextMenu={e => e.preventDefault()}` global hook
**Yapıldı:** 2026-04-21 — INPUT/TEXTAREA/SELECT/contenteditable hedeflerinde native menüye izin verildi.

#### A13. Scan ETA hesabı ilk saniyelerde dalgalı
**Yapıldı:** 2026-04-21 — İlk 50 dosyada ETA null döner; sadece spinner + işlenen dosya sayısı gösterilir.

---

## Tamamlanan Ozellikler (v2.3.0 — v2.4.1, 2026-04-29 — 2026-05-03)

- ✅ **Rusqlite inkremental yazma** — tarama verisi checkpoint ile diske (v2.3.0)
- ✅ **Pipeline tarama** — p-limit concurrency, 6-8x throughput (v2.4.0)
- ✅ **Boolean arama** — AND/OR/NOT + tırnak frase (v2.4.1)
- ✅ **Fuzzy arama** — Levenshtein, %30 hata toleransı (v2.4.1)
- ✅ **Tarih aralığı filtresi** — modifiedAt bazlı (v2.4.1)
- ✅ **DWG yapısal benzerlik** — 5 boyutlu composite scoring (v2.4.1)
- ✅ **Şekil arama backend** — Rust convex hull + Gaussian similarity (v2.4.1)
- ✅ **Onay kuyruğu** — Dashboard, toplu onay/red, red sebebi, audit trail (v2.4.0)
- ✅ **XMP sidecar export** — standart metadata dışa aktarma (v2.4.0)
- ✅ **Otomatik versiyon kümeleme** — 10 pattern (v2.4.0)
- ✅ **Watch folders Faz 2** — Settings toggle + auto-rescan (v2.4.0)
- ✅ **Fixity check** — bit-rot tespiti (v2.4.0)
- ✅ **DPAPI LAN auth** — credential store (v2.4.0)
- ✅ **Kopya bulucu optimizasyonu** — O(n²) bucket filter (v2.4.1)
- ✅ **Ayarlar UI** — kart tabanlı yeniden tasarım (v2.4.1)
- ✅ **Kısa kod arama fix** — A1-c3 gibi tire içeren kodlar (v2.4.1)

---

## Ertelenenler

### Asset Move/Rename için Undo
**Ne:** Asset'i farklı klasöre taşıma veya yeniden adlandırma şu an undo'lanmıyor.
**Neden ertelendi:** Filesystem operasyonu — undo sırasında dosya başka biri tarafından taşınmış/silinmiş olabilir, race conditions. Snapshot da yetmez.
**Risk:** Düşük — bu işlemler nadir + kullanıcı zaten dialog'la onaylıyor.

### BGE Reranker v2-m3
**Ne:** Şu an Ollama LLM-based reranking; harici rapor BGE'yi öneriyor (cross-encoder, daha doğru). ONNX yükü ~80MB, kur biraz çetrefilli.
**Neden ertelendi:** Mevcut LLM-based çalışıyor, ekstra ONNX bağımlılığı + model boyutu.
**Ne zaman:** RAG kalitesi yetersiz bulunursa.

### 2FA (TOTP / Authenticator)
**Ne:** Giriş sırasında şifre + TOTP kodu (RFC 6238, Google Authenticator vb.).
**Neden ertelendi:** Tamamen offline ofis masaüstü uygulaması. Mevcut koruma — PBKDF2-SHA256 100k iter şifre + recovery.key — bu tehdit modeli için yeterli. Şifre + telefon kombinasyonu ofis içi local-only senaryo için overengineering. Uygulama ağ üzerinden erişilmediğinden 2FA'nın eklediği güvenlik katmanı sınırlı.
**Risk:** Yok — recovery.key akışı zaten hesap kurtarma sağlıyor.
**Ne zaman:** Uygulama web veya ağ tabanlı erişime açılırsa, veya kurumsal güvenlik politikası gerektirirse.
**Kararın tarihçesi:** 2026-04-23'te değerlendirildi, account recovery (ForgotPassword.tsx + recoveryService.ts) zaten tamamlanmış; TOTP'un offline desktop için faydası kısıtlı bulundu.

### LAN payload encryption / TLS
**Ne:** LAN sunucusunda HTTP → HTTPS veya AES-GCM payload encryption.
**Neden ertelendi:** Kullanım tamamen ofis içi, kapalı offline ağ. Tehdit modeli: pasif sniffing (aynı Wi-Fi'daki meslektaş). Mevcut koruma yeterli — 8-hane auth kodu (10⁸ kombinasyon), 5/5dk IP lockout, constant-time compare, CSPRNG-only, tight CORS. Encryption eklemek ofis LAN tehdit modeli için overengineering; 2 yeni crate, ~150 satır kod, PBKDF2 cache, versiyon uyumluluk kompleksitesi. Dış tehdide açıklık olmadığı için maliyet/fayda oranı düşük.
**Risk:** Yok — payload en değerli şey DB snapshot; onu isteyen zaten meşru yolla auth kodu alabilir.
**Ne zaman:** Uygulama ofis dışı (çoklu lokasyon, WAN, misafir ağ) senaryoya genişlerse — o zaman Tailscale/WireGuard katmanı da gündeme girer.
**Kararın tarihçesi:** 2026-04-11 sertleştirme raporunda ilk kez ertelendi; 2026-04-23'te aynı gerekçeyle bir kez daha onaylandı.

### Çoklu Kaynak Extract
**Ne:** Şu an tek source → tek target. İki veya daha fazla kaynaktan aynı anda extract yapmak yok.
**Neden ertelendi:** Kullanım case'i nadir, karmaşıklık yüksek, rollback iki snapshot gerektirir.
**Risk:** Yok — kullanıcı teker teker yapabilir.
**Ne zaman:** Büyük mimarlık ofisi tipi use case'ler için.

---

## Paketleme ve Dağıtım — Durum Notu

### MSI/EXE'ye Gömülü Olan (sorun yok)
- Tüm React + TypeScript kodu (Vite build → dist/ → bundle)
- SQL.js WASM (`public/sql-wasm.wasm`) — postinstall ile kopyalanır
- ONNX Runtime WASM (`public/ort/*.wasm`) — postinstall ile kopyalanır
- Rust backend (134 Tauri komutu) — native binary
- i18n (5 dil), tüm UI bileşenleri
- MiniLM (~46 MB) + CLIP (~300 MB) ONNX modelleri `public/models/` — tam offline embedding

### Ollama (LLM) — Harici Bağımlılık (tasarım gereği)
- RAG sohbet Ollama'ya bağımlı (localhost:11434)
- Ollama ayrı uygulama, kendi GPU/CPU yönetimi var — gömülemez
- Ollama yoksa: semantik arama + görsel arama + duplicate finder **çalışır**, sadece RAG sohbet çalışmaz

```
Özellik                    Ollama OLMADAN    Ollama İLE
─────────────────────────────────────────────────────
Dosya tarama               ✓                ✓
Semantik arama (metin)     ✓ (MiniLM)       ✓
Görsel arama (CLIP)        ✓ (CLIP)         ✓
Duplicate finder           ✓                ✓
RAG sohbet (Q&A)           ✗                ✓
AI tag önerisi             ✗                ✓
Asset özeti                ✗                ✓
```

---

## Nasıl Güncellenir

- **Aksiyon bitince:** başlığının altına `**Yapıldı:** YYYY-MM-DD (commit <hash>)` notu düş veya maddeyi komple sil.
- **Yeni aksiyon:** uygun P0/P1/P2/P3 bölümüne ekle, format: Ne / Etki / Nerede / Nasıl.
- **Yeni erteleme:** "Ertelenenler" altına ekle, format: Ne / Neden ertelendi / Risk / Ne zaman.
