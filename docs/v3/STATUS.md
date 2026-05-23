# v3-architecture — DURUM & DEVAM (git-tracked, makineler arası senkron)

> Bu dosya **lokal oto-hafızanın yerine geçer** (oto-hafıza makineler arası senkron DEĞİL, yalnız git).
> Başka lokasyonda/yeni oturumda: önce BU dosyayı oku, sonra `docs/v3/` diğer 3 dokümanı.
>
> Son güncelleme: **2026-05-23 — V3.0.0 DAĞITILDI ✅ (MSI build başarılı + GitHub Release canlı).**
> PRE-5 + PRE-6 TAM; A6 YERLEŞTİ; **MSI build başarılı** (Seçenek A profile
> override + downloadBootstrapper); v3.0.0 her iki repo'da dağıtıldı
> (Arsiv-H2 + ArchivistPro). main dalı v3'le merge edildi (`1d25dd1`).
>
> **MSI:** `ArchivistPro_3.0.0_x64_en-US.msi` · 206 MB ·
> SHA-256 `1c2bfe1ca7ee0d18a140617c7cf760a888c8e483e63793d825f8b19d8193f68b`.
> Release sayfalarına 10 install rehberi (TR/EN/AR/JA/ZH × Acemi/Pro) da yüklendi.
>
> **Kalan opsiyonel iş:**
> 1. 15 ekran görüntüsü (placeholder listeli — `docs/SCREENSHOT_LIST.md`)
> 2. GitHub Actions billing (mirror-release workflow Mayıs 12'den beri pasif)
> 3. Network sorunu çözünce `webviewInstallMode` "offlineInstaller"a alınabilir
> 4. `purge_orphans` UI tetik (vec.db yetim chunk temizliği)
> 5. RAG "yok" halüsinasyonu (list-intent eşleşmeyen sorular için)
>
> Tüm commit'ler `origin/main` + `origin/feat/v3-2-vec-db`'de push'lu.
>
> ### ✅ 2026-05-23 GÜNCELLEME — V3.0.0 DAĞITILDI
> v3.0.0 release dağıtıldı + canlıya çıktı. Uzun gün boyunca yapılanlar:
>
> **A) Dokümantasyon (8 commit, ~35 dosya, 5 dil):**
> - Faz 0 (`a59180c`): i18n-glossary.md (5 dil terim sözlüğü) + CHANGELOG.md +
>   v3.0.0 bump (appVersion, tauri.conf, Cargo.toml, package.json + Cargo.lock)
> - Faz 1 (`339b136`): TR ana içerik — user/admin/scenarios + TECHNICAL_REFERENCE
>   + 2 yeni install rehberi (KULLANICI_KURULUM_ACEMI/PRO)
> - Faz 2 (`9cc7e5e`): Help panel'e 4. sekme "Sürüm Notları" (5 dil i18n) +
>   `scripts/sync-docs.cjs` (docs/ → public/docs/ predev/prebuild sync)
> - Faz 3-6 (`58bf2cb` → `dfd3b7d` → `b2bf836`): EN/AR/JA/ZH çevirileri
>   (her dil ~5 dosya — user/admin/scenarios + 2 install rehberi)
> - Faz 8 (`dadfc15`): docs/RELEASE_CHECKLIST.md (gelecek bump'lar için 14
>   bölüm) + docs/SCREENSHOT_LIST.md (15 SS envanteri)
>
> **B) MSI Build (`74f95ed`):**
> - **Seçenek A profile override** çalıştı — `Cargo.toml`'a
>   `[profile.release.package.app] opt-level=0 + codegen-units=256` eklendi,
>   dış crate'ler opt-level=2'de. 2026-05-20'de 7 build denemesinin
>   tamamı fail (rlib 6.23 GB > 4 GB metadata sınırı, LLVM crash, OOM) idi.
>   Bu sefer **12dk 20sn'de Rust release build başarılı**, rlib metadata
>   sorunu yok. `src-tauri/target/release/app.exe` üretildi.
> - **MSI bundling** ilk denemede fail — Tauri bundler WebView2 Runtime'ı
>   go.microsoft.com'dan indirirken bu makinenin ağ ortamında TLS handshake
>   failure ("cannot decrypt peer's message"). Çözüm: `tauri.conf.json`'da
>   `webviewInstallMode` "offlineInstaller" → "downloadBootstrapper".
>   Trade-off: MSI 206 MB (önceki offlineInstaller 410 MB ile yarıya
>   düştü); son kullanıcı ilk kurulumda WebView2 Runtime'ı internetten
>   indirir (~150 MB), sonrasında offline. Yeniden build 1dk 45sn'de bitti
>   (Rust cache).
>
> **C) Release Dağıtımı:**
> - Git tag `v3.0.0` push'lu, annotated.
> - GitHub Release **Arsiv-H2**:
>   https://github.com/ahmet3ddd/Arsiv-H2/releases/tag/v3.0.0
> - GitHub Release **ArchivistPro** (manuel mirror — workflow billing
>   nedeniyle pasif): https://github.com/ahmet3ddd/ArchivistPro/releases/tag/v3.0.0
> - Her iki release'de **11 asset**: MSI + 10 install rehberi (TR/EN/AR/JA/ZH ×
>   Acemi/Pro). Aynı SHA-256 hash — birebir aynı dosyalar.
>
> **D) Main Merge:**
> - feat/v3-2-vec-db (`74f95ed`) → main (`1d25dd1`). 98 commit fast-forward
>   ile değil `--no-ff` merge commit'i ile. ArchivistPro main bilinçli
>   olarak dokunulmadı (dağıtım deposu = sadece release host eder, kod
>   tarihçesi tutmaz; mevcut tek-commit yapısı korundu).
>
> **GitHub Actions billing problemi:** Mirror-release workflow Mayıs 12'den
> beri "recent account payments have failed or your spending limit needs
> to be increased" hatasıyla pasif. Bu sürümde manuel mirror yapıldı.
> Çözüm: GitHub Settings → Billing & plans → spending limit. Çözülünce
> sonraki release'ler otomatik mirror edilir.
>
> ### ✅ 2026-05-23 ÖNCEKİ GÜNCELLEME — A6 YERLEŞTİ
> Kullanıcı `5cc6417` migration sonrası gerçek arşivde fonksiyonel testleri
> koştu — hepsi BAŞARILI. Tek bulgu AI sohbet `"hüvellezi var mı"` → `"Hayır,
> hüvellezi yok"` (sol arama doğru cevap veriyordu). Kök sebep:
> `detectListIntent` Türkçe soru-eki "mı/mi/mu/mü"yü önceki kelimeden ayrı
> tokenize ediyor, marker listesi yalnız birleşik `'varmi'` tutuyordu →
> list-intent tetiklemiyor → normal RAG akışına düşüyor → LLM 8 chunk'ı
> görüp "yok" diyor. Fix `92681e9`: hem ham hem soru-eki birleştirilmiş
> tokenları markerlara karşı kontrol et. "var mı" → "varmi" yakalanır,
> "geçer mi" `'gecer'` bare marker'ı korunur (regresyon yok). +8 birim test
> (`ragKeywordGate.test.ts`: detectListIntent describe bloğu). detectListIntent
> export edildi (test erişimi). tsc 0, npm **2219/2219**. **⇒ A6 YERLEŞTİ.**
> Sıradaki iş: MSI build V3.0.0.
>
> **Yan bulgular (bu fix kapsamı DIŞI, gelecek iş):**
> 1. **197/163 metadata orphan chunks:** Settings çark'ında "Meta indeks:
>    197/163" — vec.db'de 34 yetim metadata chunk (silinmiş/soft-delete
>    asset'lere ait). PRE-6 SONRASI listesinde `purge_orphans` bu kapsamda.
> 2. **Normal RAG akışı "yok" halüsinasyonu:** list-intent eşleşmeyen
>    sorularda LLM-rerank FTS hit'lerini demote edebilir → "yok" cevabı.
>    Prompt template sıkılaştırma ya da FTS hit'lerine rerank-immunite
>    gerekebilir. Ayrı bir iş.
>
> ### 🟢 2026-05-22 GÜNCELLEME — PRE-5 OKUMA YOLU CUTOVER BAŞLADI
> Karar: MSI değil **PRE-5** (gerekçe: MSI rlib 4GB sınırı ayrı/acelesiz +
> release build gözetimsiz çalıştırılmaz; PRE-5 V3'ün gerçek blokajı —
> STATUS önerisi de bu). 6 faz (5a-5f), her biri ayrı commit + doğrulama.
> - ✅ **PRE-5a TAMAM — commit `f0244f2`:** vec.db FTS5 keyword index
>   altyapısı (`fts_chunks` virtual table + fts_normalize + apply/delete
>   FTS senkronu + `vec_db_fts_search` komutu + rebuild_fts + 11 test).
>   Saf additive — epoch=0 değişmez. cargo **230/230**, clippy **0**.
> - ✅ **PRE-5b TAMAM — commit `df0176c`:** embeddings okuma routing
>   (epoch>=1) — 3 Rust komutu + 5 frontend async kardeş + 4 tüketici.
>   cargo **233/233**, clippy 0, tsc 0, npm **2158/2158**.
> - ✅ **PRE-5c TAMAM — commit `ec981ef`:** text_chunks okuma routing
>   (epoch>=2) — 3 Rust komutu + 4 async kardeş + 6 tüketici (AssetTagsPanel
>   render-time + DetailPanel useMemo→state refactor dahil).
>   cargo **236/236**, clippy 0, tsc 0, npm **2167/2167**.
> - ✅ **PRE-5d TAMAM — commit `e8999c9`:** keyword/FTS okuma routing
>   (epoch>=2) — 2 frontend async kardeş (PRE-5a `vec_db_fts_search`'e),
>   yeni Rust komutu yok. cargo **236/236**, clippy 0, npm **2172/2172**.
> - ✅ **PRE-5e TAMAM — commit `9577ded`:** asset_relations okuma routing
>   (epoch>=3) — `vec_db_asset_relations` + `getRelationsForAssetAsync`.
>   cargo **237/237**, clippy 0, npm **2176/2176**.
> - ✅ **PRE-5f TAMAM — commit `9d76b43`:** index durum/sayım okuma routing
>   (analyzeRagIndex + ChatPanel rozeti + buildNoResultDiagnostic).
>   cargo **239/239**, clippy 0, npm **2181/2181**.
>
> ### 🎯 PRE-5 OKUMA YOLU CUTOVER **TAMAMLANDI** (6/6 faz, 2026-05-22)
> Tüm okuma yolları epoch-aware: migration sonrası embeddings/text_chunks/
> asset_relations/FTS okumaları vec.db'ye yönleniyor. 2026-05-21 kısmi-
> bozulma kök sebebi (yazma vec.db ↔ okuma sql.js uyumsuzluğu) **kapandı**.
> **A6 default-on flip yeniden denenebilir** — ama önce aşağıdaki "YAZMA-YOLU
> FOLLOW-UP" değerlendirilmeli. 11 commit (6 faz + 5 STATUS), hepsi lokal.
> Aşağıdaki 2026-05-21 handoff'u tarihsel referans olarak korundu.
>
> Bugün üç ana iş: (1) A6-PRE-2 + 3a + 3b push, (2) A6 default-on flip
> CANLI DENEME → kısmi bozulma → askıya alma (PRE-5 eksiği keşfedildi),
> (3) MSI build 7 deneme — hepsi fail (asıl sebep rlib 6 GB > 4 GB rustc
> sınırı, app crate'i çok büyük). Detaylar aşağıda "BUGÜNÜN KAPANIŞ ÖZETİ"
> bölümünde. **Rust tarafı A6 ön-koşulları TAMAM** ama frontend OKUMA YOLU
> CUTOVER (PRE-5) eksik:
> - **A4** asset DELETE → vec_db_cascade_delete (`1044c99`)
> - **A5** manifest schemaEpoch + reloadDatabase epoch refresh (`9c4adfe`)
> - **Auto-upgrade tetiği** importArchive post-reload (`ac96237`)
> - **recall_gate flaky FIX** → mesafe-tabanlı recall (`27feb13`)
> - **WAL default-on** (`89d1dd8`) + UNC kapsam testi (`530e31c`)
> - **A6 default-on** + save guard (`c33ac77`) → **A6 ASKIYA ALINDI** (`0820925`)
> - **Settings V3 paneli** + ilk gerçek migrasyon BAŞARILI (`1e23235`)
> - **A6-PRE-1** sql.js `_applySchema` epoch-aware + init order fix + direct-save guards (`596e377`)
> - **A6-PRE-2** Rust ENSURE_SCHEMA split (`a7404fd`)
> - **A6-PRE-3a** write_scan_batch_to_db epoch routing (`d52b794`) — scan-time INSERT yolu vec.db'ye yönelir
> - **A6-PRE-3b** scan_clear_assets epoch routing (`ff686bf`) — temizlik yolu vec.db'ye yönelir; **push bekliyor** (bu turun son 4 commit'i ile birlikte)
>
> **Şu an çalışan davranış: v2.4.10 (epoch=0 monolit)** — WAL aktif (UNC'de
> DELETE), recall_gate stabilize. V3 vec.db kodu duruyor ama dark (bayrak
> default-off). **Rust tarafı A6 default-on flip için HAZIR**; kalan iş
> A6-PRE-4 (opsiyonel): scan_clear_assets sync-core extraction (entegrasyon
> testleri için, üretim semantiği değil) + diğer az kullanılan write path'leri
> (audit/chat — V3-eligible değil ama denetim için göz at).
>
> ### 🌙 BUGÜNÜN KAPANIŞ ÖZETİ (2026-05-21, başka lokasyon için)
>
> **1. Sabah — A6-PRE-2/3a/3b push'lu (5 commit):**
> - `a7404fd` PRE-2 Rust ENSURE_SCHEMA split
> - `d7c86fa` STATUS PRE-2
> - `d52b794` PRE-3a write_scan_batch_to_db epoch routing (6 test)
> - `ff686bf` PRE-3b scan_clear_assets epoch routing (3 test)
> - `06aa5f1` STATUS PRE-3 a+b
> Test durumu: cargo **219/219** + 6 ignored, tsc 0, npm **2149/2149**.
>
> **2. Öğleden sonra — A6 default-on CANLI DENEME:**
> - `eca34b8` A6 default-on flip (4 dosya: isV3EpochEnabled/v3EpochEnabled
>   default-on, SettingsStorageTab V3 paneli geri, test güncellemesi).
> - Kullanıcı `D:\Archivist\archivist.db` (14.59 MB) + `archivist_local.db`
>   (281.5 MB) ile manuel migrasyon tetikledi → **BAŞARILI**:
>   * `archivist.db` epoch 0→3, tablo sayısı 23→20.
>   * `archivist_vec.db` 6.67 MB, embeddings=1687/text_chunks=502/
>     asset_relations=0, migration_progress=3 satır.
>   * `archivist_premigrate_v3.db.bak` 14.58 MB (rollback yedek).
> - **CANLI TEST sonucu — KISMİ BOZULMA (PRE-5 eksik kanıtı):**
>   * ✅ Embedding lookup vec.db'den çalışıyor — "şebeke nerede var" →
>     3 DWG, skor 0.887/0.887/0.556 (PRE-3a/vec_db_chunk_embeddings).
>   * ❌ FTS metin araması — "hesap özeti var mı" → "arşivde bilgi
>     bulamadım". Log: "193 aday · FTS 0 · embedding 193 · rerank 0 → LLM".
>   * ❌ Sidebar "AI index kapsamı **0/445**" (önceki açılışta 1687/445);
>     "Dosyalar içerik araması için indexlenmemiş — Yeniden Tara" uyarısı.
>   * Kök sebep: PRE-1/2/3 yalnız YAZMA yollarını kapsadı; OKUMA yolları
>     (FTS, embedding count, RAG context çekimi) hâlâ sql.js'in DROP'lu
>     V3-eligible tablolarına yöneliyor.
> - **GERİ ALMA (`92ce74d`, push'lu):** eca34b8 revert + DB rollback
>   (premigrate yedek → archivist.db, vec.db sil). Şu an epoch=0 sağlam.
>
> **3. Akşam — MSI build 7 deneme HEPSI FAIL:**
> - Cargo.toml [profile.release] denemeleri: opt-level=2/1/0,
>   codegen-units=16/256, staticlib kaldırma — hiçbiri çalışmadı.
> - Kök sebep tespiti: `app` crate'inin rlib'i **6.23 GB**, rustc
>   metadata reader'ın 4 GB i32 offset sınırını aşıyor → "corrupt
>   metadata in libapp_lib.rlib". Bu rustc'nin bilinen sınır davranışı.
>   28 modül + 146 Tauri komutu + V3 ek kodu app crate'ini şişirdi.
> - opt-level=3/2 → STATUS_STACK_BUFFER_OVERRUN (LLVM optimizer crash).
> - opt-level=1 → "rustc-LLVM ERROR: out of memory".
> - opt-level=0 → rlib 6 GB → corrupt metadata.
> - Cargo.toml SONRADAN REVERT EDİLDİ (broken konfigleri commit'lemedik).
> - **Yan kazanç:** D:\cargo-target\ArchivistPro klasörü kuruldu
>   (cargo target D:'ye yönlendirildi → C: 17 GB boş). Yarın da geçerli
>   ama BU MAKİNEYE özgü, başka lokasyonda yok.
>
> **4. MSI için kalan seçenekler (yarın seç):**
> - **Seçenek A — Profile override (denenmemiş):** dış crate'ler
>   opt-level=2, `[profile.release.package.app]` opt-level=0+codegen-
>   units=256. Belki rlib boyutu kontrol altına alınır. Hızlı (15-25 dk).
> - **Seçenek B — app crate'i böl (büyük refactor):** vec_db +
>   vector_index + scan_db ayrı crate'lere taşı. 1-3 saat refactor +
>   test. Garantili çözüm, parçacık rlib'leri küçük.
> - **Seçenek C — Dev profile MSI:** `cargo build` (release değil) +
>   tauri MSI bundling. Binary ~300 MB, runtime ~%30 yavaş — Tauri için
>   kabul edilebilir (asıl iş frontend V8 JIT'de).
> - **Seçenek D — MSI'yi PRE-5 sonrasına ertele:** V3 default-off MSI
>   üretmenin acelesi yok; PRE-5 yapılınca MSI'yı tek seferde temiz üret.
>   En düşük risk.
>
> ### ⚠️ BAŞKA LOKASYON — ÖNLEM/HANDOFF (2026-05-21 akşam kapanış)
> 1. `git checkout feat/v3-2-vec-db && git pull` (son push'lu: bu commit).
> 2. **Bu dosyayı oku** → yukarıdaki "🌙 BUGÜNÜN KAPANIŞ ÖZETİ" + aşağıdaki
>    "Faz 3 İLERLEME" + "A6 askı" bölümleri.
> 2.5. **YARIN ÖNCELİK:** önce PRE-5 mi yoksa MSI mı? Tavsiye:
>    - **PRE-5 önce (önerilen)**: OKUMA YOLU TOPLU CUTOVER. Frontend
>      grep envanteri (`embeddings`/`text_chunks`/`asset_relations`
>      sorgu eden TÜM yerler), vec.db'de FTS5 virtual table tasarımı,
>      ragService text-search routing. PRE-5 tamam olunca MSI da
>      temiz üretilir.
>    - **MSI Seçenek A önce**: PRE-5 ile uğraşmadan profile override
>      dene (15-25 dk). Çalışırsa V3 default-off MSI dağıtıma hazır,
>      PRE-5'i sonra ekleyip yeni MSI üretirsin.
> 3. **Doğrulama beklentisi:**
>    - `cargo test --manifest-path src-tauri/Cargo.toml --features admin --lib`
>      → **219/219 + 6 ignored** (2026-05-21 A6-PRE-3 sonrası; +9 test:
>      PRE-2 4 + PRE-3a 6 + PRE-3b 3 - PRE-3 testlerinin bir kısmı
>      vec_db::tests'e gitti).
>    - `npx tsc --noEmit` 0 + `npm test` → **2149/2149** (A6-PRE-3 frontend'i
>      ETKİLEMEZ → npm sayısı PRE-1 sonrası ile aynı).
>    - Önceki lokasyonda **`test-data/` git'te YOK** (gerçek arşiv PII koruması). Gate#1 manuel harness'leri (`gate1_*`, GATE1_DB env) farklı lokasyonda KOŞMAZ. Normal suite bunlardan BAĞIMSIZ.
>    - Bilinen flaky: `recall_gate_meets_design_lock_thresholds`
>      (vector_index, HNSW nondeterminizmi sentetik dim=48) tam suite'de
>      seyrek FAIL; izole 1/1 GEÇER. Otoriter recall = `gate1_real_recall`.
> 4. **Kullanıcının gerçek test arşivi BU MAKİNEDE** (`C:\test_arşiv_DB\`).
>    Başka lokasyonda canlı migrate denemesi yapılamaz, sadece kod doğrulaması.
> 5. **A6 ÖN-KOŞUL — DURUM (Rust tarafı TAMAM, A6 default-on flip için HAZIR):**
>    - ✅ **(a) A6-PRE-1 (`596e377`, push'lu):** sql.js `_applySchema`
>      epoch-aware + init order fix + direct-save guards.
>    - ✅ **(b1) A6-PRE-2 (`a7404fd`, push'lu):** Rust `ENSURE_SCHEMA` →
>      `CORE_SCHEMA` + `V3_ELIGIBLE_SCHEMA` epoch-aware. 4 main-DB yazıcı
>      migrate.
>    - ✅ **(b2) A6-PRE-3a (`d52b794`, push'lu):** `write_scan_batch_to_db`
>      epoch>=N'de embeddings/text_chunks/asset_relations INSERT'lerini
>      vec.db'ye yönlendirir (apply_embeddings/apply_text_chunks/
>      apply_asset_relations). delete_chunks_for de epoch-aware. Atomiklik:
>      vec.db ops main TX commit'ten ÖNCE; vec hata → main rollback.
>    - ✅ **(b3) A6-PRE-3b (`ff686bf`, push BEKLİYOR):** `scan_clear_assets`
>      4 mod (ALL/UnderPath/TrashOnly/SingleAsset) epoch>=N'de vec.db
>      DELETE'lerine yönelir (`clear_all_v3_data` ALL için, `delete_assets`
>      diğer modlar için — main conn'dan SELECT asset_ids ile cross-DB
>      subquery iki adımda).
>    - ⏭️ **A6-PRE-4 (opsiyonel, bekliyor):** scan_clear_assets sync-core
>      extraction → entegrasyon testleri (4 mod × epoch matrix). Üretim
>      semantiği için ZORUNLU DEĞİL (mevcut suite epoch=0 davranışı +
>      vec_db helper'larının izole semantiği ile yeterli güvence verir).
>      Diğer az kullanılan write path denetimleri (audit/chat — V3-eligible
>      değil, sadece sanity check) de bu kapsama dahil edilebilir.
> 6. **Kalan v3 işleri (öncelik dışı):** WAL default-on senin kontrolünde
>    (Gate #1 ✅ + 2-process ✅; ağ/UNC tespit testleri kapsamlı), Settings
>    V3 paneli kodu `SettingsStorageTab.tsx`'te gizli (`{isAdmin && (` bloğuyla
>    geri aktive — fix sonrası).
> 7. PowerShell cwd kayması olursa cargo'ya MUTLAK `--manifest-path` ver.

## Nerede çalışılıyor
- **Aktif dal:** `feat/v3-2-vec-db` (umbrella `v3-architecture`'dan, o da `main` d2709c0'dan).
- **2026-05-17: `main` v3'e MERGE edildi** (`f01fef7`) — v3 artık main'i **v2.4.10**'a
  kadar içerir: retrieval fix `76da9dc` + 2026-05-16'nın 7 fix'i + sürüm 2.4.10.
  Eski "v3 tamamen izole" modeli BİTTİ → strateji **merge-forward**. Iraksama analizi:
  çakışma ~0 (v3=Rust backend `*.rs`, main fix'leri=TS frontend `src/`; sadece
  Cargo.toml/lock auto-merge). Bundan sonra periyodik `git merge main` güvenli.
- Devam için: `git checkout feat/v3-2-vec-db && git pull`.

## Tamamlanan (commit'li + push'lu)
| Commit | İçerik |
|---|---|
| `e9fa01e` | **Sprint 0 (V3-6)**: tempfile dev-dep, sync-core extraction (ollama_db/scan_db/shapes_db), +18 test |
| `79ed01e` | Sprint 1 hazırlık: `docs/v3/` DE-RISK + DESIGN-LOCK + PREP-KIT |
| `ca1d966` | vec_db iskeleti (path/şema/open, apply_embeddings, progress, fixtures) |
| `510e71a` | Orkestratör: migrate_embeddings (batch+resume) + verify_embeddings (§5) |
| `05dc424` | 6 Tauri komutu başlangıcı + lib.rs kaydı; `#![allow(dead_code)]` kalktı |
| `62ba913` | Okuma servisi: query_chunk_embeddings + vec_db_chunk_embeddings (çift-yol kontratı) |
| `ff5554b` | Cascade-delete: delete_assets + vec_db_cascade_delete (T9) |
| `f01fef7` | **2026-05-17 main→v3 merge** (çakışmasız): v2.4.10 + retrieval fix `76da9dc` + 7 fix |
| — | **2026-05-18 OTURUMU (8 commit, hepsi push'lu) ↓** |
| `cd54608` | baseline-heap **S1-PREP-C KAPANDI** (kanıt-temelli): 100K JS heap 155→~710MB; **1.13M monolit app'i açılışta ÇÖKERTİYOR** (`0xe0000008`, izolasyonla) → DE-RISK 7-9GB tezi total-çökme doğrulandı. + fixture v2.4.9-birebir + `emit_baseline_dbs` üreteci |
| `2181034` | 39 baseline clippy tech-debt temizlendi (CI `-D warnings` yeşil) |
| `dd1baff` | `vec_db.rs` (1778 satır) → `vec_db/{mod,fixtures,tests}.rs` bölündü (saf refactor) |
| `7ee261a` | **epoch 2/3 backend**: text_chunks + asset_relations migrate/verify (+4 Tauri komutu) |
| `c1d53e7` | **§6/§7 güvenlik ağı**: `vec_db/safety.rs` — rollback + purge_orphans (+2 komut) |
| `087fc50` | **archive_share** .archivistpro vec.db export/import + stale-koruma (reconcile) |
| `305f938` | **Sprint2/V3-1 ANN Faz 1**: `vector_index.rs` — VectorIndex trait + index_meta + HNSW build/search + rebuild-tetik + atomik + `vector_index_rebuild` komutu (hnsw_rs 0.3 dep) |
| `4c6c041` | **Sprint2/V3-1 ANN Faz 2**: CI recall gate (recall@10≥0.98), `ann_bench` #[ignore] harness + datamap mmap reload, SEARCH_EF=200 tuning |
| `0e0335d` | **Sprint2/V3-1 1M bench kapanışı** (vector_index.rs + 2 doc) — reload defekti + build-perf çözümü push'lu |
| — | **2026-05-19 OTURUMU — Sprint-3/V3-3 Aşama 1 (push'lu) + Aşama 2 (commit'siz) ↓** |
| `fe92297` | **Sprint-3/V3-3 Aşama 1**: per-arşiv in-process yazma kilidi. `ollama_db.rs` global `DB_WRITE_LOCK` → kanonik-yol anahtarlı `HashMap<PathBuf, Arc<Mutex<()>>>` registry + `get_db_lock_for(path)` + `canonical_lock_key` (var-olmayan dosyada parent+filename, `set_database_path` deseni). 26 call site migrate (ollama_db 7, scan_db 11, vec_db/mod 4, vec_db/safety 2, vector_index 1, archive_share 1). Anahtar = **yazılan dosya** (vec_db ops→`vdb`, index→`vec_db`, rollback→`main`, import→`db_path`). +4 test (same-arc, kanonik-collation, iki-arşiv ayrımı, var-olmayan dosya). WAL'siz/geri-alınabilir. |
| `2494406` | **Sprint-3/V3-3 Aşama 2**: ortak yazma-bağlantısı + journal modu. `ollama_db.rs`: `prepare_write_conn(path)` (journal/synchronous/foreign_keys/busy_timeout tek kaynak — eski 14 tekrar buraya indi: scan_db 11 + ollama_db 3), `JournalMode`, `wal_requested()` (`ARCHIVIST_DB_JOURNAL` OnceLock, **default delete**), `is_network_path` (UNC + `GetDriveTypeW` DRIVE_REMOTE; cfg-windows), `resolve_journal_mode`. **GATE 0 ağı**: `remove_wal_sidecars` (write_and_sync rename SONRASI stale `-wal`/`-shm` sil) + `checkpoint_wal_truncate` (create_db_snapshot / export_archive / import-`.db.bak` ÖNCESİ). +6 test (helper birim + `test_gate0_stale_wal_vector_is_real` [naif-WAL korupsiyonu GERÇEK] + `test_gate0_blob_overwrite_removes_stale_wal_1000_iter` [fix PASS]). Davranış DELETE'te birebir korunur. |

**Test durumu (2026-05-20, Sprint-3 Aşama 1+2 + Gate#1 + Faz3 A1/A2/A3 push'lu):** `cargo test --features admin --lib` → **205/205, 0 fail** (192→+4 kilit →+6 journal/Gate0→+1 mixed-dim verify→+2 premigrate), **6 ignored** (`wal_smoke_2proc`, `emit_baseline_dbs`, `gate1_real_db_migration`, `ann_bench`, `gate1_real_recall`, `reload_recall_parity_diagnostic`). `clippy --features admin --lib` → **0 yeni uyarı** (yalnız önceden-var `SEARCH_EF`). Frontend: tsc 0 / npm **2117/2117**.

## vec_db backend — Sprint 1 için büyük ölçüde TAMAM
6 kayıtlı Tauri komutu: `vec_db_migrate_embeddings`, `vec_db_verify_embeddings`, `vec_db_progress`, `vec_db_count`, `vec_db_chunk_embeddings`, `vec_db_cascade_delete`. Hepsi sync-core + spawn_blocking deseni; sentetik test edilebilir (`fixtures::make_v249_db`).

## SIRADAKİ İŞ — yarın buradan devam

### Backend gate'siz hat ESASEN TÜKENDİ (bu oturumda bitirildi)
✅ Sprint-1 backend TAM: epoch 1/2/3 migrate-verify, cascade, **§6/§7 safety**
(`vec_db/safety.rs` rollback+purge_orphans), **archive_share vec.db** export/import.
✅ baseline-heap **S1-PREP-C KAPANDI** (kanıt-temelli; bkz Tamamlanan tablosu).
✅ **Sprint2/V3-1 ANN Faz 1+2**: `vector_index.rs` — trait+meta+build/search+
rebuild+atomik (`305f938`), CI recall gate + `ann_bench` harness + datamap mmap
reload (`4c6c041`).

### 2026-05-18 ANN 1M bench KOŞULDU — defekt çözüldü, gate yeniden tanımlandı ✅
Seçenek 1 koşuldu (release, N=1M dim=384), 2 tur + tanı. Sonuç:
- ✅ **Reload paniği KULLANIM HATASIYDI, çözüldü:** `load_hnsw_with_dist` (datamap
  doldurmaz) → `load_hnsw` (`&mut self`, use_mmap'te datamap'i doldurur). 1M
  reload artık PANİKSİZ (21.3 sn). Reload doğruluğu KANITLANDI (tani:
  in-RAM≈reload(false)≈reload(true) 4-ondalık birebir → datamap mmap kusursuz).
- ✅ **Yan bulgu çözüldü:** `build_hnsw_from_vectors` chunked `parallel_insert`
  (cancel granülaritesi korundu) → 114 dk → **21 dk (~5.4×)**. PROD değişiklik;
  192/192 yeşil (recall_gate dahil), clippy 0.
- ✅ **Latency 1M:** p50≈9.3 / p99≈10.4 ms.
- 📊 **RAM 1M:** in-RAM build pik ~10.5 GB (parallel) / ~5.7 GB (sequential).
- ⏭️ **Mutlak recall@10 synthetic'te GEÇERSİZ** (LCG/384-dim → in-RAM index'in
  KENDİSİ düşük, reload değil; tani kanıtladı). `ann_bench` yeniden tasarlandı:
  artık reload-sadakati + latency assert eder, mutlak recall'ı Gate #1'e
  (gerçek anonim db) bırakır — STATUS zaten böyle diyordu, kapsam değişimi YOK.

Tam kanıt zinciri: `baseline-heap.md` §7. **v3 backend'de açık defekt yok.**
DE-RISK §2 gate'inin latency+RAM+reload-sadakati ayakları VALIDATED; recall
ayağı Gate #1'e devredildi. **Kod henüz COMMIT'siz** (vector_index.rs + 2 doc).

### Kalan iş — seçenekler (öncelik sırası senin kararın)
1. ✅ **YAPILDI (2026-05-18):** oturum çıktısı commit `0e0335d`, **push'lu**.
   1M re-run zorunlu DEĞİL (parity 20k'da birebir kanıtlı + 1M no-crash/latency
   v2'de ölçüldü; bench gelecek regresyon harness'ı olarak hazır — bkz §7).
   → **Yarın buradan: doğrudan seçenek 2.**
2. **Sprint-3 / V3-3 (gate'siz):** per-archive kilit + WAL. DE-RISK §3 kademeli.
   - ✅ **Aşama 1 TAM (2026-05-19, commit `fe92297` push'lu):** per-arşiv
     in-process kilit (`DB_WRITE_LOCK` → canonical-path registry, 26 call
     site, +4 test). WAL'siz, geri-alınabilir, throughput kazancı.
   - ✅ **Aşama 2 TAM (2026-05-19, commit'siz):** `prepare_write_conn(path)`
     (14 tekrar→tek kaynak; `ARCHIVIST_DB_JOURNAL` flag **default `delete`**;
     ağ/UNC tespiti; `synchronous=FULL`; `busy_timeout=5000`). **GATE 0 ağı:**
     blob-overwrite sonrası stale `-wal`/`-shm` silme + backup/export öncesi
     `wal_checkpoint(TRUNCATE)`. **Gate 0 Test 4 KANITLI** — naif-WAL vektörü
     gerçek (`test_gate0_stale_wal_vector_is_real`) ↔ fix 1000-iter PASS
     (`..._removes_stale_wal_1000_iter`): integrity=ok + yetim yok.
   - ✅ **2-process duman testi GEÇTİ (2026-05-19):** `wal_smoke_2proc`
     (#[ignore], manuel) — test binary'sini yeniden çağırıp İKİ GERÇEK süreç
     spawn eder; app'in gerçek primitifleriyle (fs2 `acquire_db_write_lock`
     + `prepare_write_conn` WAL + `write_db_at`) 300 iter ×2 eşzamanlı
     targeted↔blob-overwrite → `integrity_check`=ok, yetim `-wal`/`-shm` yok.
     Koşum: `$env:ARCHIVIST_DB_JOURNAL="wal"; cargo test ... wal_smoke_2proc
     -- --ignored --nocapture`.
   - ✅ **WAL default'a ALINDI (2026-05-20, commit `89d1dd8`):** Gate #1 ✅ +
     2-process ✅ sonrası kullanıcı onayıyla `wal_requested()` default-true
     yapıldı. **Opt-out**: `ARCHIVIST_DB_JOURNAL=delete` → v2.4.10 öncesi
     davranış (DELETE). Ağ/UNC yolu `is_network_path` → her durumda DELETE
     (paylaşımlı dosya sisteminde WAL güvensiz).
   - ✅ **Ağ tespit kapsam testi (2026-05-20, commit pending):** `is_network_
     path` literal UNC + loopback UNC (`\\localhost\...`) + IP literal UNC
     (`\\192.168.x.y\...`) + extended UNC (`\\?\UNC\...`) için kapsam
     testi eklendi (7 yeni assert). `resolve_journal_mode` UNC yollarda
     **WAL bayrağı default-true bile olsa DELETE'e düşürüyor** ayrı testle
     kanıtlandı. Edge case (NTFS junction/symlink) doc-comment ile
     uyarıldı — kullanıcı ağ DB'sini doğrudan UNC ya da eşlenmiş sürücüyle
     açmalı. Cargo **206/206 +6 ignored**.
   - 🟡 **Açık kalan kapsam:** gerçek SMB üzerinde fs2 lock davranışı
     (timeout, stale lock) cross-host test yok — `wal_smoke_2proc` local
     disk. Mevcut HTTP API (LAN paylaşım modeli a) bu kapsamı GEREKTİRMEZ;
     UNC direct mod (b) için ileride manuel/CI gate konabilir.
   - ⏭️ **Aşama 3 (kapsam dışı):** read pool — ertelendi.
3. **Gate #1 — §5+§6 GERÇEK db'de GEÇTİ (2026-05-19) ✅:** kullanıcı gerçek
   `archivist.db` (516 asset) + `archivist_local.db` (4731 asset/34385 emb,
   295MB) kopyalarını sağladı (`test-data/`, gitignore).
   - §5 anonimleştirme: `scripts/anonymize-db.py` → satır sayıları=eşit,
     user_version 0→0, integrity ok, FK temiz, PII grep 0, audit zinciri
     geçerli, embedding blob birebir. **Bulgu→fix:** `scanned_roots.label`
     PII sızıntısı (commit `e71b59b`).
   - §6 migrasyon: `gate1_real_db_migration` (#[ignore]) → epoch 1/2/3
     migrate+verify + idempotent, **iki db'de de verified=true**.
     **Bulgu→fix:** `verify_embeddings` hard-coded `384*4` blob sağlaması,
     karışık-boyut üretim verisini (512-dim CLIP, satırların ~%64'ü)
     sahte-FAIL ediyordu → boyuttan bağımsız ROUND-TRIP (vec blob==kaynak
     blob) + `verify_passes_with_mixed_dim_embeddings` regresyon testi.
   - ✅ **Gate #1 recall ayağı GEÇTİ (2026-05-19):** `gate1_real_recall`
     (#[ignore], GATE1_DB env). Gerçek anonim local db, source='chunk_text'
     7658×384-dim. **2 ölçüm-artefaktı teşhis+düzeltildi (eşik 0.98 KORUNDU,
     metrik sadıklaştırıldı):** (1) gerçek embedding'lerin %39.6'sı birebir
     yinelenmiş → index-küme recall eşitlik-bağıyla yapay düşük → mesafe-
     tabanlı recall (ANN-benchmark standardı); (2) f32 384-terim toplama
     ~1e-5 hata → f64 truth + görece tolerans. Sonuç: **mesafe-recall@10
     =0.9810 ≥ 0.98**, recall@1=0.99 (ef=200; ef-sweep 200..1600 plato →
     bottleneck precision'dı, ANN değil). **⇒ GATE #1 TAMAMEN GEÇTİ.**
   - **Faz 3 (frontend cutover) — Gate #1 ✅; KULLANICI ONAYI bekler
     (canlı arşive dokunur):** `database.ts` epoch oku/uygula (0→1→2→3, `_applyMigrations` öncesi);
   çift-yol `getAllChunkEmbeddings`/`getRagCachedEmbeddings` (`epoch>=N` ?
   invoke : sql.js); migrasyon akışı premigrate-yedek→migrate→verify→atomik
   `DROP+user_version` (`write_db_at`); `_migrationInProgress` guard; asset
   DELETE→`vec_db_cascade_delete`; manifest `schemaEpoch`+T4 auto-upgrade;
   ragService Stage 3 (`:743-758`) ANN⇄brute-force çift-yol (V3-1 Faz 3).

### Faz 3 cutover — İLERLEME (2026-05-19/2026-05-20, push'lu)
- ✅ **A1** (`f2380ae`): salt-okunur şema-epoch tespiti (`getSchemaEpoch`).
- ✅ **A2** (`4fd83ed`): çift-yol RAG embedding okuma (bayrak-kapalı=birebir).
- ✅ **A3** (`6af811c`): migrasyon akışı `runV3EpochMigration` (persist→
  premigrate-yedek→migrate→verify→**verified ise** atomik DROP+user_version
  →FAIL'de rollback) + `vec_db_premigrate_backup` Rust komutu (rollback'in
  eşi) + 2 safety testi. `_migrationInProgress` guard. ASLA otomatik
  çağrılmaz; bayrak default-kapalı.
- ✅ **A4** (2026-05-20, commit `1044c99`): asset DELETE → `vec_db_cascade_delete`.
  `database.ts`:
  - `_cascadeDeleteAssetRows` `_schemaEpoch >= N` ise sql.js'ten DROP'lu
    tabloya DELETE yollamaz (`embeddings` epoch>=1, `text_chunks` >=2,
    `asset_relations` >=3; aksi halde "no such table" atardı).
  - `_fireMainVecDbCascade(ids)` (fire-and-forget; bayrak gerekmez —
    epoch ancak A3 verify+DROP yaptıysa ilerler, default 0=NOOP).
  - 6 main-arşiv cascade noktası (`deleteAsset`, `deleteOrphanedAssets`,
    `permanentlyDeleteAsset`, `emptyTrashDb`, `deleteScannedRootWithAssets`,
    `purgeExpiredTrash` + `_purgeExpiredTrashInternal` main-only).
  - Yan iyileştirme: `tauriInvoke` artık `loadTauriCore()` ile dinamik
    import'u cache'liyor (eşzamanlı çağrılarda vitest race'ini ortadan
    kaldırır + cüzi prod perf).
  - +8 birim test (`phase3CutoverA4.test.ts`): epoch=0 davranış birebir,
    epoch=1/2/3 DROP-skip + tek invoke fire, toplu/bulk wrapper'lar tek
    invoke, softDelete cascade-dışı, boş ID NOOP.
- ✅ **A5** (2026-05-20, commit'siz): manifest `schemaEpoch` + reload epoch refresh.
  - `ArchiveManifest.schemaEpoch?: number` (opsiyonel, geri-uyumlu: eski
    arşivlerde yok → tüketici 0 varsayar). Bkz `archiveShare.ts`.
  - `exportArchive` artık ihraç anındaki `getSchemaEpoch()`'u manifest'e
    yazar; `peekArchive` parse edip döndürür.
  - **Kritik düzeltme (`reloadDatabase`)**: snapshot restore / arşiv
    import sonrası sql.js handle yenilenirken `_schemaEpoch` PRAGMA
    user_version'dan **yeniden okunur** (initDatabase ile aynı sıra —
    `_applyMigrations` öncesi). Bu fix olmadan A4 cascade gating stale
    epoch'la çalışıp yanlış skip/cascade üretirdi (örn. epoch=2'de
    import edilen monolit DB'de embeddings DELETE atlanırdı).
  - T4 auto-upgrade tetiği: `applyV3PostImportUpgrade()` (database.ts) +
    `SettingsStorageTab` import akışına ekli. Bayrak kapalı → NOOP;
    açık + epoch<3 → `runV3EpochMigration` tetiklenir; hata fatal değil
    (raporlanır). Bkz aşağıdaki test akışı.
  - +11 birim test (`phase3CutoverA5.test.ts`): export schemaEpoch=0/2,
    peek geri-uyumlu + yeni manifest, tip opsiyonelliği; reloadDatabase
    PRAGMA user_version=0/2/yok için doğru epoch refresh; auto-upgrade
    bayrak kapalı NOOP / bayrak açık+epoch=3 NOOP / bayrak açık+epoch=0
    runV3EpochMigration zinciri (verify-fail→rollback).
- ⚠️ **A6 ASKIYA ALINDI (2026-05-20 saat 16:50 — plan eksikliği keşfi).**
  Kullanıcının test arşivinde manuel migrasyon başarılı oldu (epoch=0→3,
  vec.db 1010+296+0 satır, integrity=ok), ANCAK app **bir sonraki açılışta**
  `_applySchema(db)` `CREATE TABLE IF NOT EXISTS embeddings/text_chunks/
  asset_relations` ile DROP'lu tabloları **boş olarak yeniden oluşturdu**.
  Sonraki tarama/sohbet işlemleri sql.js'in boş tablolarına yazdı → **çift
  kaynaklı veri**: archivist.db.text_chunks=163 (kısmi) + archivist_vec.db.
  text_chunks=296 (gerçek). FTS sql.js'in kısmi tablosundan okuduğu için
  kişi adı araması "FTS 0 · embedding 249 · rerank 0" döndü (kullanıcı
  rapor `ee.png`).
  - **Acil aksiyon:** premigrate yedeği geri yüklendi
    (`archivist_premigrate_v3.db.bak` → `archivist.db`); bozuk durum
    saklı (`archivist.db.broken_v3_*`, `archivist_vec.db.broken_*`).
    arşiv epoch=0'a döndü, FTS sağlam.
  - **A6 default OFF'a geri alındı** (`isV3EpochEnabled` v2.4.10 öncesi
    semantiğine). ragService aynı. SettingsStorageTab V3 paneli gizlendi.
    Otomatik trigger pratikte NOOP. Açık opt-in (`localStorage.setItem(
    'ARCHIVIST_V3_EPOCH','on')`) mümkün ama A6 ön-koşulu tamam değil.
  - **Plan eksiklikleri — A6 öncesi ZORUNLU (Rust tarafı TAMAM):**
    1. ✅ **A6-PRE-1 (commit `596e377`, 2026-05-20, push'lu):** sql.js
       `_applySchema` epoch-aware (CREATE TABLE IF NOT EXISTS skip için
       epoch>=N kontrolü) + init order fix + direct-save guards.
    2. ✅ **A6-PRE-2 (commit `a7404fd`, 2026-05-21, push'lu):**
       Rust `ENSURE_SCHEMA` → `CORE_SCHEMA` (epoch-bağımsız) +
       `V3_ELIGIBLE_SCHEMA` (yalnız epoch=0). `apply_main_schema(conn)`
       helper, 4 main-DB yazıcı migrate. Rust kasıtlı all-or-nothing
       (epoch>=1 → hiçbir V3-eligible yaratılmaz). +4 test.
    3. ✅ **A6-PRE-3a (commit `d52b794`, 2026-05-21, push'lu):**
       `write_scan_batch_to_db` epoch-aware INSERT/DELETE routing.
       - vec_db: `resolve_vec_db_path_from_main(path)` (AppHandle'sız) +
         `delete_chunks_for_assets(vdb, ids)` (chunk + chunk-emb tam,
         asset-level emb korunur).
       - scan_db: `apply_main_schema_get_epoch` (epoch'u dışarı al).
         epoch>=1/2/3 → embeddings/text_chunks/asset_relations vec.db'ye
         (apply_*); main TX'te SKIP. delete_chunks_for de epoch'a göre.
         Atomiklik: vec.db ops main TX commit'ten ÖNCE.
       - +6 test (epoch=0/1/2/3 routing + rescan idempotency +
         delete_chunks_for routing).
    4. ✅ **A6-PRE-3b (commit `ff686bf`, 2026-05-21, push BEKLİYOR):**
       `scan_clear_assets` 4 mod (ALL/UnderPath/TrashOnly/SingleAsset)
       epoch-aware DELETE routing.
       - vec_db: `clear_all_v3_data(vdb)` (ALL modu için tüm V3-eligible
         tablo boşaltma). Var olmayan vec.db'de NOOP.
       - scan_db: epoch'a göre dallan; UnderPath/TrashOnly için main
         conn'dan SELECT asset_ids (TX dışı) → `delete_assets(vdb, ids)`
         (cross-DB subquery iki adımda). Main TX'teki V3-eligible
         DELETE'leri `epoch < N` koşulu ile sarıldı.
       - +3 test (vec_db helper'ları izole: `delete_chunks_for_assets`,
         `clear_all_v3_data` x2). scan_clear_assets entegrasyon testleri
         A6-PRE-4'e ertelendi (async + AppHandle → sync-core extraction
         gerek; üretim semantiği için ZORUNLU DEĞİL).
    5. ⏭️ **A6-PRE-4 (opsiyonel):** scan_clear_assets sync-core extraction
       + 4 mod × epoch matrix entegrasyon testleri. Diğer write path
       denetimleri (audit/chat — V3-eligible değil ama kapsam sanity için).
  - Test: phase3CutoverA5.test.ts "A6 ASKIDA" testi default-off semantiği
    kanıtlar. **2026-05-21 A6-PRE-3 sonrası:** cargo **219/219**
    (206 → +13: PRE-2 4 + PRE-3a 6 + PRE-3b 3) + 6 ignored, tsc 0,
    npm **2149/2149** (PRE-3 frontend etkilemez).

### Faz 3 / PRE-5 — OKUMA YOLU CUTOVER (2026-05-22, AKTİF)

A6-PRE-1/2/3 YALNIZ **yazma** yollarını epoch-aware yaptı. 2026-05-21 canlı
denemesi kanıtladı: migration sonrası **okuma** yolları (FTS, embedding
sayacı, RAG context çekimi) hâlâ sql.js'in DROP'lu `embeddings`/`text_chunks`
/`asset_relations` tablolarına gidiyor → kısmi bozulma. PRE-5 tüm okuma
yollarını epoch-aware yapar. Envanter: ~30 okuma noktası, 4 dosya
(`database.ts`, `ragService.ts`, `ragIndexStatus.ts`, `ChatPanel.tsx`).
6 faz, her biri ayrı commit + cargo/tsc/npm doğrulama:

- ✅ **PRE-5a (commit `f0244f2`, 2026-05-22):** vec.db FTS5 keyword index
  altyapısı. `VEC_DB_SCHEMA`'ya `fts_chunks` FTS5 virtual table
  (tokenize='ascii'); `fts_normalize` (Türkçe→ASCII, sql.js `insertFtsChunk`
  ile birebir); `apply_text_chunks` n==1'de FTS besler (idempotent);
  `delete_chunks_for_assets`/`delete_assets`/`clear_all_v3_data` FTS senkron
  temizlik (sayıma dahil DEĞİL — türev index); `fts_search_chunks` çekirdek
  + `vec_db_fts_search` Tauri komutu (lib.rs); `rebuild_fts` güvenlik ağı
  (`migrate_text_chunks` sonunda sayım tutmuyorsa). +11 test. **Saf
  additive — epoch=0 davranışı değişmez.** cargo **230/230**, clippy **0**.
- ✅ **PRE-5b (commit `df0176c`, 2026-05-22):** embeddings okuma routing
  (epoch>=1). Rust: `vec_db_embedding_stats`, `vec_db_embeddings_by_source`
  (tam/prefix), `vec_db_chunk_embeddings_by_assets` (400'lük batch).
  Frontend 5 async kardeş (`getEmbeddingStatsAsync`, `hasAnyEmbeddingsAsync`,
  `getAllEmbeddingsAsync`, `getEmbeddingsBySourcePrefixAsync`,
  `getChunkEmbeddingsByAssetIdsAsync`) — Tauri null → sync fallback.
  Tüketiciler async'e: `Sidebar` (AI index sayacı), `useDatabaseAssets`,
  `useImageSearch`, `ragService:1495` + 4 test mock'u. +9 test.
  cargo **233/233**, clippy 0, npm **2158/2158**.
  **Kapsam dışı (bilinçli):** `getChunkEmbeddingsByIds` (prod tüketici yok);
  `getAllEmbeddingsFromArchive`/`getAllTextChunksFromArchive` →
  `archiveOps.ts` arşivler-arası kopya, epoch>=1'de boş döner → PRE-5f
  (vec.db cross-archive kopya gerektirir).
- ✅ **PRE-5c (commit `ec981ef`, 2026-05-22):** text_chunks okuma routing
  (epoch>=2). Rust: `ChunkRecord` + `vec_db_chunks_by_ids` (400'lük batch),
  `vec_db_chunks_by_asset` (chunk_index sıralı), `vec_db_chunk_count`.
  Frontend 4 async kardeş: `getChunksByIdsAsync` (vec.db + sql.js assets
  join), `getChunksByAssetIdAsync`, `getChunkByIdAsync`,
  `getChunkCountByAssetIdAsync` — Tauri null → sync fallback. Tüketiciler:
  ragService 5 çağrı async (satır 611 FTS-content bloğu PRE-5d'ye),
  fileScanner + tagService async; `AssetTagsPanel` render-time +
  `DetailPanel` 2 useMemo → useState+useEffect refactor. 7 test mock'u +
  9 yeni test. cargo **236/236**, clippy 0, npm **2167/2167**.
- ✅ **PRE-5d (commit `e8999c9`, 2026-05-22):** keyword/FTS okuma routing
  (epoch>=2). Yeni Rust komutu YOK — PRE-5a'nın `vec_db_fts_search`'ü
  kullanılır. Frontend 2 async kardeş: `ftsSearchChunksAsync` (Map, skor
  `1/(idx+1)` bm25), `searchTextChunksByKeywordAsync` (distinct assetId +
  soft-delete süzme). `ragService.directFileListAnswer` sync→async (607
  ftsSearchChunks + 611 getChunksByIds); `retrieve:854` + sentez:1518 FTS
  çağrıları async; `useEmbeddingSearch` keyword fallback async. 4 test
  mock'u + 6 directFileListAnswer testi async + 5 yeni test.
  cargo **236/236**, clippy 0, npm **2172/2172**. NOT: epoch>=2'de
  substring-LIKE → FTS5 token-prefix (vec.db'de ayrı LIKE index'i yok).
- ✅ **PRE-5e (commit `9577ded`, 2026-05-22):** asset_relations okuma
  routing (epoch>=3). Rust `RelationRecord` + `query_asset_relations`
  (asset'li/asset'siz) + `vec_db_asset_relations`. Frontend
  `getRelationsForAssetAsync` — Tüketici: `AssetRelationsPanel`. +4 test.
  cargo **237/237**, clippy 0, npm **2176/2176**.
- ✅ **PRE-5f (commit `9d76b43`, 2026-05-22):** index durum/sayım okuma
  routing. Rust `rag_index_counts` + `chunk_stats` + 2 komut. Frontend
  `getRagIndexCountMapsAsync` (epoch>=1) + `getChunkStatsAsync` (epoch>=2).
  Tüketiciler: `analyzeRagIndex` sync→async (alt-sorgu → sayım-map merge;
  `AssetPickerModal` + `RagIndexModal` async), `ChatPanel.refreshIndexBadge`
  async, `buildNoResultDiagnostic` sync→async (per-token LIKE teşhisi
  epoch<2'de). +5 test. cargo **239/239**, clippy 0, npm **2181/2181**.

### ✅ PRE-5 TAMAMLANDI — okuma yolu cutover (6/6 faz, 2026-05-22)

Migration sonrası **tüm okuma yolları epoch-aware**: embeddings/text_chunks/
asset_relations/FTS okumaları vec.db'ye yönleniyor. 2026-05-21 kısmi-bozulma
kök sebebi (yazma vec.db ↔ okuma sql.js uyumsuzluğu) **kapandı**. Doğrulama:
cargo **239/239** · clippy **0** · tsc **0** · npm **2181/2181**. epoch=0
davranışı hiç değişmedi (saf additive). 11 commit (6 faz + 5 STATUS), lokal.

**⚠️ YAZMA-YOLU FOLLOW-UP (PRE-5 okuma kapsamı DIŞI — A6 öncesi değerlendir):**
PRE-5 yalnız OKUMA yollarını kapsadı. Aşağıdaki fonksiyonlar epoch>=N'de
sql.js'in DROP'lu tablolarına YAZMA/restore/kopya yapar — try/catch ile
sessiz no-op / degrade eder (**crash YOK**), ama işlevsel kayıp olur:
- ✅ `detectAndSaveSameStemRelations` — **PRE-6a ile ÇÖZÜLDÜ** (commit
  `3248770`, 2026-05-22). Aşağıdaki PRE-6 listesine bakın.
- ✅ `snapshotScannedRootWithAssets` / `restoreScannedRootWithAssets` —
  **PRE-6d ile ÇÖZÜLDÜ** (commit `e923c69`, 2026-05-22). Aşağıdaki PRE-6
  listesine bakın.
- ✅ `archiveOps` cross-archive kopya — **PRE-6e ile ÇÖZÜLDÜ** (commit
  `823a9be`, 2026-05-22). Aşağıdaki PRE-6 listesine bakın.
- ✅ `ChatPanel` B2 auto-metadata-sync — **PRE-6c ile ÇÖZÜLDÜ** (commit
  `ffe0f8d`, 2026-05-22). Aşağıdaki PRE-6 listesine bakın.
- ✅ `purgeNonIndexableChunks` — **PRE-6b ile ÇÖZÜLDÜ** (commit `755bcc7`,
  2026-05-22). Aşağıdaki PRE-6 listesine bakın.
Bunlar bir **"PRE-6 / yazma-yolu epoch routing"** işine aitti — **5/5 faz
TAMAMLANDI** (aşağıda). A6 default-on flip artık yazma-yolu açısından engelsiz.

### ✅ PRE-6 — YAZMA-YOLU EPOCH ROUTING TAMAMLANDI (5/5 faz, 2026-05-22)

PRE-5 ile aynı disiplin: faz faz, her biri ayrı commit + cargo/tsc/npm
doğrulama, epoch=0 davranışı korunur. **Yazma yolu en riskli kategori**
(2026-05-21 bozulması yazma↔okuma uyumsuzluğuydu) → her faz dikkatli.

- ✅ **6a TAMAM (commit `3248770`, 2026-05-22):** `detectAndSaveSameStemRelations`
  oto-ilişki yazma routing. `_detectSameStemRelationsCore` saf-refactor ile
  ortak çekirdeğe çıktı; `skipSqlInsert` (epoch>=3) inline sql.js
  `INSERT asset_relations`'ı atlar — eski SYNC sürüm epoch>=3'te "no such
  table" atıp try/catch içinde `onCreate` mirror'ını da keserdi → oto-ilişki
  HİÇ üretilmezdi (ne sql.js ne vec.db). `detectAndSaveSameStemRelationsAsync`
  (yeni) — epoch<3 BİREBİR sync'e düşer; epoch>=3 duplicate-guard
  `_getAllRelationIdsAsync` (`vec_db_asset_relations` assetId=null) +
  kalıcılık vec.db'ye: `onCreate` varsa caller persist eder (fileScanner
  writeBuffer→Rust `write_scan_batch_to_db` PRE-3a), yoksa
  `_persistRelationsToVecDb` → `scan_write_batch` relations-only self-persist.
  Tüketiciler: `fileScanner` (scan-time) + `SourceFoldersPanel` (manuel buton)
  async. **Rust değişikliği YOK** (`scan_write_batch`/`vec_db_asset_relations`
  zaten epoch-aware). +7 test (`phase3Pre6aRelationWrite.test.ts`).
  cargo **239/239**, clippy 0, tsc 0, npm **2188/2188**.
- ✅ **6b TAMAM (commit `755bcc7`, 2026-05-22):** `purgeNonIndexableChunks`
  (legacy çöp body-chunk temizliği) async + epoch-aware. epoch>=2'de
  `text_chunks` vec.db'de → victim sorgusu (`assets JOIN text_chunks`) boş
  dönüyordu (çöp temizlenmiyordu); epoch=1'de `embeddings` DELETE "no such
  table" atıp fonksiyonu çökertebiliyordu. Rust: `body_chunk_counts` —
  body-only (`chunk_index >= 0`) asset-başına chunk + chunk-emb sayımları
  (metadata chunk'ları HARİÇ → metadata-only non-indexable asset'ler
  yanlışlıkla purge edilmez) + `vec_db_body_chunk_counts` komutu +
  `collect_asset_counts` saf-refactor (`rag_index_counts` ile ortak). +1 test.
  Frontend: `getBodyChunkCountsAsync`; `purgeNonIndexableChunks` epoch<2 eski
  sql.js yolu (epoch=1 embeddings DELETE atlanır), epoch>=2 victim =
  non-indexable file_type ∩ body-chunk sayımları. Silme her durumda
  `mirrorRagWriteToDisk` → `scan_write_batch` `delete_chunks_for` (PRE-3a
  epoch-aware). `RagIndexModal.handlePurge` async. +5 test.
  cargo **240/240**, clippy 0, tsc 0, npm **2193/2193**.
- ✅ **6c TAMAM (commit `ffe0f8d`, 2026-05-22):** `ChatPanel` B2 auto-metadata-
  sync yazma routing. epoch>=2'de `text_chunks` vec.db'de → "metadata chunk
  eksik asset" sorgusu (`NOT EXISTS text_chunks`) boş dönüyordu (oto-üretim
  hiç çalışmıyordu); `indexAssetMetadata` re-index'teki sql.js DELETE'leri
  epoch>=1/2'de "no such table" atıp fonksiyonu çökertebiliyordu. Rust:
  `metadata_chunk_asset_ids` (chunk_index=-1 olan asset id'leri) +
  `delete_metadata_chunks` (bir asset'in meta chunk'larını vec.db'den sil —
  text_chunks + ref_id'li embeddings + FTS; body chunk'lara dokunmaz) +
  `vec_db_metadata_chunk_asset_ids`/`vec_db_delete_metadata_chunks` komutları.
  +2 test. Frontend: `getAssetsMissingMetadataChunkAsync` (epoch>=2 tüm asset
  − vec.db meta sahipleri), `deleteMetadataChunksFromVecDb`; `indexAssetMetadata`
  re-index silme epoch-aware (epoch>=2 vec.db, epoch=1 embeddings DELETE
  atlanır); `ChatPanel.startLater` async, `runIndexing` `string[]` alır.
  +6 test. cargo **242/242**, clippy 0, tsc 0, npm **2199/2199**.
- ✅ **6d TAMAM (commit `e923c69`, 2026-05-22):** snapshot/restore (klasör-sil
  undo) yazma routing. epoch>=N'de `snapshotScannedRootWithAssets` sql.js
  `SELECT *` ile "no such table" atıp ÇÖKÜYORDU; `restoreScannedRootWithAssets`
  sql.js `INSERT` ile çöküyordu → undo V3 verisini kaybediyordu. Rust:
  `export_assets` (asset'lerin embeddings/text_chunks/asset_relations satırları
  vec.db'den TAM — `IN` 400 batch, ilişki id dedup, `notes` dahil) +
  `import_assets` (`apply_*` ile idempotent geri-yaz, FTS dahil) +
  `EmbeddingRow`/`TextChunkRow`/`AssetRelationRow` serde + `AssetVecExport` +
  `vec_db_export_assets`/`vec_db_import_assets` komutları. +1 test. Frontend:
  her iki fn async + epoch-aware (epoch>=N → vec.db export/import; epoch<N →
  sql.js); `tauriVoidInvoke` artık `loadTauriCore()` kullanıyor (doğrudan
  dinamik import test mock'unu atlatabiliyordu). +4 test; databaseAdvanced
  snapshot/restore testleri async. cargo **243/243**, clippy 0, tsc 0,
  npm **2203/2203**.
- ✅ **6e TAMAM (commit `823a9be`, 2026-05-22):** `archiveOps` cross-archive
  merge (Join/Extract) yazma routing. `joinArchives`/`extractAssets` epoch>=N'de
  embedding/text_chunk'u sessizce kaybediyordu: kaynak okuma (`getAll*FromArchive`)
  sql.js'ten boş, hedef yazma (`saveEmbedding`/`upsertTextChunk`) global
  `_schemaEpoch` guard'lı NOOP. **Anahtar bulgu:** yalnız `main` arşivi epoch>0
  olabilir (`runV3EpochMigration` `getMainDb()`'ye hardcoded) → cross-archive
  op'ta en fazla bir taraf epoch>0. database.ts: `getArchiveSchemaEpoch`
  (per-arşiv `PRAGMA user_version` — global `_schemaEpoch` yalnız main'i
  yansıtır), `archiveIdToArchiveAt`, `_registerArchiveForTesting`;
  `tauriInvoke`/`tauriVoidInvoke` export. archiveOps.ts: `copyV3Data` modülü —
  kaynağı VE hedefi ayrı epoch-aware: epoch>=1 emb / >=2 chunk → vec.db
  (`vec_db_export_assets` + tek birleşik `vec_db_import_assets`), aksi sql.js
  (`getAll*FromArchive` / raw INSERT). Kanonik şekil + f32-değer↔ham-bayt
  normalizasyonu; `skippedIds` süzme + `idMap` remap (keep_both: yalnız
  asset_id — epoch=0 davranışı mirror). joinArchives+extractAssets Phase 3/4
  tek `copyV3Data` çağrısına indi (summaries+favorites SONRASI / save ÖNCESİ —
  vec.db rollback boşluğu azaltma). **Rust değişikliği YOK** (PRE-6d
  `vec_db_export/import_assets` yeterli). +7 test (`phase3Pre6eArchiveMerge`
  — joinArchives/extractAssets için ilk kapsam). cargo **243/243**, clippy 0,
  tsc 0, npm **2210/2210**.

**Kapsam dışı (PRE-6 SONRASI gelecek iş):** `asset_relations` cross-archive
kopyası (epoch=0'da da kopyalanmıyor — yeni özellik); move-mode kaynak vec.db
temizliği (`deleteAssetFromArchive` vec.db'ye cascade etmiyor — pre-existing);
vec.db snapshot/rollback (yetimler `purge_orphans` ile temizlenir); global
`_schemaEpoch`'un per-arşiv yapılması (A6 + non-main aktif arşiv senaryosu).

**Aciliyet:** PRE-6 (5/5) TAMAM → A6 yapıldı (aşağıya bak).

### 🔼 A6 — V3 EPOCH DEFAULT-ON FLIP (commit `ee7b907`, 2026-05-22)

`ARCHIVIST_V3_EPOCH` bayrağı **default-ON** yapıldı (`isV3EpochEnabled` /
`v3EpochEnabled` `!== 'off'`). Flag set etmemiş arşivler V3 yolunda; `initDatabase`
sonu epoch<3 ise migrasyon otomatik tetiklenir. `SettingsStorageTab` "V3 Şema
Migrasyonu" paneli geri açıldı (admin-only manuel tetik butonu — deterministik).
A6 2026-05-20'de denenip kısmi-bozulma ile askıya alınmıştı; bu kez ön-koşullar
TAM (PRE-5 okuma + PRE-6 yazma cutover). Doğrulama: cargo 243/243 (Rust
değişmedi), tsc 0, npm 2210/2210. Opt-out: `localStorage ARCHIVIST_V3_EPOCH='off'`.

**🔁 1. CANLI DENEME (2026-05-22) — DISK DOLU; BUG BULUNDU + DÜZELTİLDİ.**
Kullanıcı gerçek test arşivinde (`D:\…\DENEME_arşiv`) migration tetikledi.
Panel "epoch=3 başarılı" gösterdi AMA disk kanıtı aksini söyledi:
- `archivist.db` 180 MB, **tarih 18.05 (değişmemiş!)** — DROP'lu hali diske
  yazılamamış. `archivist_vec.db` (151 MB) + `.bak` (180 MB) oluştu.
- Açılışta "⚠️ Depolama alanı yetersiz" uyarısı → **disk dolu**.
- **BUG (`fix` commit `76d2acf`):** `runV3EpochMigration` `ownedSave()` dönüşünü
  yok sayıyordu → disk yazımı başarısız olsa bile epoch ilerletip `ok:true`
  döndürüyordu (in-memory epoch=3 / disk epoch=0 sahte-başarı). Düzeltildi:
  save başarısız → `reloadDatabase` ile hizala + `ok:false` + DUR.
- **Veri GÜVENDE:** disk `archivist.db` eski epoch=0 monolit olarak sağlam;
  restart'ta app epoch=0 açılır (yarım vec.db yok sayılır). Veri kaybı YOK.

**🔁 2. CANLI DENEME (2026-05-22) — GERÇEK KÖK SEBEP; BÜYÜK FIX.**
Panel düzeltmeleri (`showConfirmDialog` — `window.confirm` Tauri'de yasaktı;
gerçek-hata yakalama — commit `42ae798`) gerçek hatayı gösterdi:
**`disk-write-failed (persist) — RangeError: Invalid array length`**.
- Disk dolu DEĞİL (D:'de 12 GB boş). Asıl sorun: test arşivi **~185 MB monolit**;
  `runV3EpochMigration` sql.js'i `db.export()` (~185 MB `Uint8Array`) +
  `invoke('write_database')` ile yazıyordu — **Tauri IPC bu boyutu taşıyamıyor**.
  "disk yetersiz" uyarısı = semptom (yazım fail → localStorage fallback → kota).
  Ayrıca DROP sonrası VACUUM yoktu → dosya küçülmezdi.
- **FIX (commit `5cc6417`):** migration'ın "DROP + küçült + epoch" adımı Rust'a
  taşındı. Yeni `vec_db_finalize_main_migration` komutu — diskteki `archivist.db`
  tmp kopyasında rusqlite ile `DROP TABLE` ×3 + `VACUUM` + `user_version=3`,
  atomik `write_db_at` ile yerine koyar. `db.export()` GEREKMEZ → büyük monolit
  darboğazı atlanır; `VACUUM` dosyayı gerçekten küçültür (~185 MB → ~30 MB).
  `runV3EpochMigration` yeniden yazıldı: premigrate → 3 migrate+verify → Rust
  finalize → `reloadDatabase`. Doğrulama: cargo **246/246**, clippy 0, tsc 0,
  npm **2211/2211**.

**✅ 3. CANLI DENEME (2026-05-22 17:13) — MIGRATION BAŞARILI.** Kullanıcı
`5cc6417` fix'iyle paneldan tetikledi; disk kanıtı (`D:\DENEME_arşiv`):
- `archivist.db` **180.956 KB → 51.628 KB** — gerçekten küçüldü (DROP + VACUUM
  çalıştı), tarih 17:13 (taze yazım).
- `archivist_vec.db` 151.460 KB oluştu; `archivist_premigrate_v3.db.bak`
  180.956 KB (rollback yedeği).
- Panel: **epoch=3**, "✅ Tamamlandı. Şema epoch=3."
Rust-side finalize fix doğrulandı — büyük monolit migration MEKANİK olarak
ÇALIŞIYOR. **✅ Fonksiyonel test (2026-05-23) GEÇTİ:** FTS arama, tarama,
kalıcı-sil, AI sohbet, ilişki paneli, klasör-undo — hepsi sorunsuz. Tek
bulgu: AI sohbet "var mı" sorularında "yok" diyordu → detectListIntent fix
commit `92681e9` (yukarıdaki ✅ 2026-05-23 GÜNCELLEME bloğuna bak).
**⇒ A6 YERLEŞTİ.** Rollback hâlâ mümkün: `*.bak` ya da bayrak `'off'`.

**Follow-up (kapsam dışı):** `write_database`'in genel büyük-payload limiti —
migration olmadan 185 MB+ arşiv `db.export()`+`write_database` ile kaydedilemiyor.
Migration sonrası ana db ~30 MB → sorun yok; ama büyük local/ek arşivler için
ayrı raw-IPC fix gerekebilir.

### 🎯 SIRADAKİ — YAPILACAKLAR (2026-05-23 v3.0.0 SONRASI)

1. ✅ **A6 fonksiyonel testi GEÇTİ (2026-05-23):** FTS arama, tarama,
   kalıcı-sil, AI sohbet, ilişki paneli, klasör-undo — hepsi sorunsuz. Tek
   bulgu (detectListIntent "var mı" yakalama) commit `92681e9` ile çözüldü.
   **⇒ A6 YERLEŞTİ.**
2. ✅ **MSI build (V3.0.0) BAŞARILI (2026-05-23):** Seçenek A profile override
   çalıştı. `Cargo.toml`'a `[profile.release.package.app] opt-level=0 +
   codegen-units=256` eklendi, dış crate'ler opt-level=2. Rust release build
   12dk 20sn'de tamamlandı, rlib metadata sorunu YOK. MSI bundling için
   `webviewInstallMode` "offlineInstaller" → "downloadBootstrapper" (bu
   makinenin ağ ortamında TLS handshake fail). Sonuç: 206 MB MSI, SHA-256
   `1c2bfe1ca7ee0d18a140617c7cf760a888c8e483e63793d825f8b19d8193f68b`.
   Commit `74f95ed`. **⇒ MSI DAĞITILDI.**
3. ✅ **Release dağıtımı (2026-05-23):** Tag `v3.0.0` push'lu;
   GitHub Release Arsiv-H2 + ArchivistPro repo'larında manuel mirror ile
   canlı (her ikisinde 11 asset: MSI + 10 install rehberi). main dalı
   v3'le merge edildi (`1d25dd1`). ArchivistPro main bilinçli olarak
   eski (dağıtım deposu yapısı).
4. **Kalan opsiyonel iş — düşük öncelik:**
   - **15 ekran görüntüsü** — `docs/SCREENSHOT_LIST.md`'de envanter (7 in-app
     + 8 install). Kullanıcı çekecek, klasöre koyacak. Mevcut placeholder'lar
     broken image gösterse de doküman içeriği tam.
   - **GitHub Actions billing** — mirror-release workflow Mayıs 12'den beri
     pasif. Settings → Billing & plans → spending limit artırılınca sonraki
     release'lerde otomatik mirror çalışır.
   - **Network sorunu** çözünce `tauri.conf.json`'da `webviewInstallMode`
     geri "offlineInstaller"a alınabilir (gerçek offline MSI için).
   - **`purge_orphans` UI tetik** — vec.db'de 34 yetim metadata chunk
     (197/163 görünümü). Settings → Depolama'ya buton eklenebilir.
   - **RAG "yok" halüsinasyonu** — list-intent eşleşmeyen sorularda LLM-
     rerank FTS hit'lerini demote edebilir. Prompt template sıkılaştırma
     ya da FTS-hit rerank-immunite. Polish iş.
   - **Seçenek B (gelecek):** `app` crate'in modüler bölünmesi — opt-level=2
     ile gerçek release optimizasyonu. v3.x cycle'ında düşünülebilir.

  **2026-05-20 saat 15:38 (TARİHSEL — askıya alma öncesi başarılı manuel
  migrasyon kanıtı, gelecekteki re-A6 referansı için):**
  - Settings → Depolama'ya eklenen "V3 Şema Migrasyonu" paneli kullanıcı
    tarafından tetiklendi (manuel buton).
  - **archivist.db**: 7,904 KB → 7,908 KB (DROP TABLE embeddings/text_chunks
    /asset_relations + PRAGMA user_version=3 atomik). Tablo sayısı 23 → 20.
  - **archivist_vec.db** OLUŞTU: 3,604 KB. İçerik (birebir korundu):
    embeddings=1010 / text_chunks=296 / asset_relations=0 + migration_progress=3.
    `PRAGMA integrity_check = ok`.
  - **archivist_premigrate_v3.db.bak** OLUŞTU: 7,908 KB (rollback yedeği duruyor).
  - **Otomatik tetik çalışmadı** ama manuel buton çalıştı. Sebep: app açılışında
    kullanıcı giriş ekranını geçerken initDatabase tamamlanıyor ama auto-trigger
    fire-and-forget bloğu app'in erken kapanmasıyla kesilebiliyordu. Manuel
    buton kontrolü → kullanıcının deterministik adımı. Otomatik tetik kodda
    duruyor; sonraki açılışlarda fırsat bulunca çalışır (ama artık epoch=3 → NOOP).
  - Doğrulama (gerçek dosya sistemi):
  Kullanıcı test arşivinde A6'yı tetikleme onayı verdi (zarar gelse sorun
  değil bağlamı). Değişiklikler:
  - `isV3EpochEnabled()` (database.ts) + `v3EpochEnabled()` (ragService.ts)
    **default AÇIK**: yalnız açık opt-out (`localStorage.setItem(
    'ARCHIVIST_V3_EPOCH','off')`) v2.4.10 öncesine döndürür.
  - `initDatabase` sonunda otomatik tetik: bayrak AÇIK + epoch<3 ise
    `runV3EpochMigration` fire-and-forget. Banner ile bildir (info →
    success/error).
  - **Save guard**: migrasyon süresince harici `saveDatabase`/`saveDatabaseAsync`
    çağrıları `_saveDeferredDuringMigration` flag'ine işaret eder; migrasyon
    biter bitmez tek bir flush yapılır. `_migrationOwnsSave` bypass'ı
    migrasyonun kendi atomik DROP+user_version yazısını etkilemez. Bu
    olmadan harici save (tag, favori) migrasyonun yarı-yazdığı şemayı eski
    monolite ezerdi (sessiz veri kaybı).
  - `ragService.getSchemaEpoch()` çağrısı **test-mock güvenli** try/catch
    ile sarıldı (mock incomplete'lerde safe-fallback eski yola).
  - +1 yeni A5 testi (`A6: bayrak SET EDİLMEMİŞ → default AÇIK → triggered=true`).
    Mevcut "bayrak kapalı" testi explicit `setItem('off')`'a güncellendi.
  - Doğrulama: cargo **206/206 +6 ignored**, tsc 0, npm **2137/2137**.

### Yan: `recall_gate_meets_design_lock_thresholds` flaky DÜZELTİLDİ (2026-05-20)
- Önceki metrik: set-intersection (ANN top-k ∩ brute-top-k / k). `parallel_
  insert` build-nondeterminizmi + eşitlik-bağı (10. ile 11. komşu pratikte
  eş-mesafe) → tam-suite koşumunda seyrek FAIL; izole 3/3 GEÇERdi.
- Yeni metrik: **mesafe-tabanlı recall** (Gate #1 ile AYNI — ANN-benchmark
  standardı). Dönen komşunun gerçek mesafesi `dk + tol(dk)` içindeyse
  tutuldu sayılır. f64 truth + görece tolerans (`d*1e-4 + 1e-6`) f32 hesap
  artefaktını absorbe eder. **DE-RISK §2 eşiği 0.98/0.97 KORUNUR**, yalnız
  metrik sadıklaştırıldı (gevşetilmedi).
- Doğrulama: 5 ardışık tam-suite koşumu **205/205 + 6 ignored**, FAIL yok.
  vector_index.rs clippy 0 (geri kalan 4 uyarı pre-existing tech-debt).

**Test durumu (2026-05-20, A4+A5+auto-upgrade+recall-fix sonrası):** cargo
**205/205 +6 ignored** (5/5 stabil, eskiden flaky), tsc 0, npm **2136/2136**
(2117 → +8 A4 → +11 A5).
- ⚠️ **Bilinen pre-existing flaky** (A3 değil): `recall_gate_meets_design_
  lock_thresholds` (vector_index, sentetik dim=48, HNSW nondeterminizmi
  eşik~0.98 sınırında) tam-suite'te seyrek FAIL; izole 3/3 GEÇER. Otoriter
  recall = `gate1_real_recall`=0.981 (gerçek veri, sağlam). Ayrı küçük iş.

**Öneri (revize, 2026-05-19 Sprint-3 Aşama 1+2 sonrası):** Aşama 1 (`fe92297`)
ve Aşama 2 (`2494406`) **push'lu**. Diğer tüm oturum commit'leri lokal —
kullanıcı isteyene dek push EDİLMEYECEK (tek geliştirici, push politikası).
**Yarın farklı lokasyonda: `git checkout feat/v3-2-vec-db && git pull` → bu
dosyayı oku → doğrulama komutları (202/202 beklenir) → seçenekler: WAL
default'a alma GATE'li (Gate #1 + 2-process duman testi) ya da Sprint-3
kapsamı bitti sayılıp Gate #1 beklenir.** Mutlak-recall + WAL-default Gate
#1'e bağlı (gerçek anonim db) — frontend cutover'a o gelene dek BAŞLAMA.

## Park edilmiş (v3 DIŞI — dağıtmasın diye)
- ~~**V249-0 CLIP warmup**~~ → **KAPANDI: çözüldü ve artık v3'te** (main `999d319`,
  merge `f01fef7` ile geldi). Park notu geçersiz. (2026-05-16 ayrıca 6 fix daha +
  2026-05-17 retrieval fix de merge ile v3'e indi — hepsi v3'te mevcut.)

## Doğrulama komutları (her devam başında çalıştır)
```
git checkout feat/v3-2-vec-db && git pull
cargo test --manifest-path src-tauri/Cargo.toml --features admin --lib   # 243/243, 6 ignored beklenir (PRE-6e Rust'ı değiştirmedi)
cargo clippy --manifest-path src-tauri/Cargo.toml --features admin --lib   # 0 uyarı (PRE-5/6 sonrası; 39 baseline tech-debt ayrı -D warnings gate'inde)
npx tsc --noEmit && npm test                                       # 2210/2210 (PRE-6a +7, 6b +5, 6c +6, 6d +4, 6e +7)
```
NOT: `cargo clippy -- -D warnings` CI gate'inde 39 ÖNCEDEN-VAR baseline uyarı var (vec_db'den DEĞİL) — bu Sprint-sonu ayrı iş, v3 değişikliği değil.
