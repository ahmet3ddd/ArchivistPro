# ArchivistPro v2.3.0 — Iyilestirme Plani

> **Hedef:** 20-50 Windows kullanicili mimarlik ofisinde production-ready surum
> **Baslangic:** v2.3.0 (2026-04-19) — P0/P1/P2 sprint'i tamamlandi
> **Guncelleme:** Bu dosya her sprint sonunda guncellenir

---

## Oncelik Seviye Tanimlari

| Seviye | Anlami | Zaman Cercevesi |
|--------|--------|-----------------|
| **P0 — Kritik** | Production blocker, kullanici kaybettirir | 1-2 hafta |
| **P1 — Yuksek** | Gunluk is akisini ciddi etkiler | 2-4 hafta |
| **P2 — Orta** | Verimlilik, cilalama, kalite | 1-2 ay |
| **P3 — Gelecek** | Stratejik, v3.0 adayi | 3+ ay |

---

## P0 — KRITIK (Production Blocker)

### P0-01. Lisanslama Sistemi
- **Sorun:** MIT lisansi yazilim lisansi, kullanim lisansi degil. License key, trial suresi, seat limiti yok. Ticari dagitimda gelir modeli eksik.
- **Cozum:** License key dogrulama (offline-first, hardware-bound hash), trial 30 gun, seat sayisi kontrolu.
- **Etkilenen:** Yeni `licenseService.ts` + `LicenseModal.tsx` + Rust tarafinda dogrulama
- **Risk:** Ticari surum icin zorunlu

### P0-02. Mac/Linux Build
- **Sorun:** Sadece Windows MSI uretiliyor. Tauri cross-platform ama Mac (.dmg) ve Linux (.AppImage/.deb) hic denenmemis.
- **Cozum:** CI/CD'de macOS + Linux build ekle, platform-specific path'leri test et.
- **Etkilenen:** `.github/workflows/release.yml`, `tauri.conf.json`, Rust path islemleri
- **Risk:** Potansiyel musteri havuzunun %30+'i kayip

---

## P1 — YUKSEK (Kullanici Deneyimi)

### P1-01. Cop Kutusu Otomatik Temizlik (Konfigurasyon)
- **Sorun:** `_purgeExpiredTrashInternal` 30 gun sabit. Admin konfigurasyonu yok. 50 kullanicida cop kutusu GB'larca buyuyebilir.
- **Cozum:** Ayarlar'dan 30/60/90 gun secimi, admin tarafindan merkezi ayarlanabilir.
- **Etkilenen:** trash.ts, SettingsModal.tsx, app_settings tablosu

### P1-02. DetailPanel Performans (Bilesen Bolme)
- **Sorun:** DetailPanel.tsx 1,512 satir — en buyuk bilesen. Tab degisiminde gereksiz render.
- **Cozum:** Tab-bazli lazy rendering: DetailMetadata, DetailAI, DetailRelations ayrı memo'lu alt bilesenlere.
- **Etkilenen:** DetailPanel.tsx → DetailTabs/
- **Risk:** Regresyon — kapsamli test gerekir

### P1-03. Sablon Bazli Rapor Uretimi
- **Sorun:** Export sadece CSV/JSON + basit yazdirma. Proje bazli, tarih aralikli, musteri bazli raporlar yok.
- **Cozum:** 3-5 sablon: "Proje Dosya Listesi", "Aylik Arsiv Ozeti", "Kullanici Aktivite". PDF cikti (html2canvas veya jsPDF).
- **Etkilenen:** exportService.ts, yeni ReportTemplateModal.tsx

### P1-04. Favori/Koleksiyon Paylasimi
- **Sorun:** Favoriler ve koleksiyonlar kisisel. Admin "Ruhsat Belgeleri" koleksiyonunu paylasma yok.
- **Cozum:** `shared` flag + admin paylasim yetkisi.
- **Etkilenen:** favorites.ts, database.ts (collections tablosu)

### P1-05. Windows Native Bildirim (Tarama/Embedding Tamamlandi)
- **Sorun:** Buyuk arsiv taramasi saatlerce surebilir. Uygulama arka plandayken tamamlanma bildirimi yok.
- **Cozum:** `tauri-plugin-notification` ile sistem bildirimi + sistem tepsisine kucultme.
- **Etkilenen:** taskRunner.ts, useScanWorkflow.ts, App.tsx

---

## P2 — ORTA (Kalite ve Olceklenebilirlik)

### P2-01. Vektor Veritabani (HNSW/FAISS)
- **Sorun:** 10K+ chunk'ta brute-force cosine similarity yavaslar. Buyuk ofislerde sorun olacak.
- **Cozum:** hnswlib-wasm veya usearch entegrasyonu. Mevcut Float32Array blob'larindan migration.
- **Etkilenen:** embeddings.ts, ragService.ts, database.ts
- **Ne zaman:** Arsiv 10K asset'i astiginda

### P2-02. Zustand Store Modullestirme
- **Sorun:** useStore.ts 270+ state property tek dosyada. Yeni ozellik eklendikce hata riski.
- **Cozum:** Slice pattern: uiSlice, assetSlice, searchSlice, archiveSlice, userSlice.
- **Etkilenen:** useStore.ts → store/slices/
- **Risk:** Yuksek regresyon — tum bilesenleri etkiler
- **Ne zaman:** v3.0

### P2-03. Coklu Kaynak Extract (Multi-Source)
- **Sorun:** Tek source → tek target. Iki+ kaynaktan extract yok.
- **Cozum:** ArchiveExtractModal'a coklu kaynak secimi + merge stratejisi.
- **Etkilenen:** ArchiveExtractModal.tsx, archiveOps.ts
- **Not:** Nadir kullanim — oncelik dusuk

### P2-04. BGE Reranker Entegrasyonu
- **Sorun:** LLM-based reranking yavas ve bazen tutarsiz. BGE cross-encoder daha hizli/dogru.
- **Cozum:** ONNX ile BGE-reranker-v2-m3 yukle, ragService'te swap.
- **Etkilenen:** ragService.ts, embeddings.ts
- **Not:** ~80MB ekstra model boyutu

### P2-05. Asset Move/Rename Undo
- **Sorun:** Dosya tasima/yeniden adlandirma geri alinmiyor.
- **Cozum:** origPath kaydi + filesystem undo. Race condition riski var.
- **Etkilenen:** undoCommands.ts, RefileModal.tsx
- **Risk:** Dusuk — nadir islem

### P2-06. Erisilebilirlik (WCAG A)
- **Sorun:** Temel ARIA var ama WCAG A tam karsilanmiyor. Tab siralama, skip navigation eksik.
- **Cozum:** Axe/Lighthouse audit + tab order + skip-to-content + explicit form label.
- **Etkilenen:** Tum bilesenlerde kucuk degisiklikler

### P2-07. React Bilesen Testleri
- **Sorun:** Servis testleri %65 coverage, ama React bilesen testi sifir. Modal/panel regresyon riski.
- **Cozum:** En kritik 5-10 bilesen icin @testing-library/react testleri.
- **Etkilenen:** src/tests/ altinda yeni bilesen test dosyalari

### P2-08. CI/CD Guvenlik Taramasi
- **Sorun:** CI pipeline'da guvenlik taramasi yok (npm audit, cargo audit, SAST).
- **Cozum:** GitHub Actions'a `npm audit`, `cargo audit`, `eslint-plugin-security` ekle.
- **Etkilenen:** `.github/workflows/`

---

## P3 — GELECEK (Stratejik / v3.0)

### P3-01. Klavye Kisayollari Sayfasi
- Ctrl+/ ile acilan kisayol listesi / cheat sheet

### P3-02. Koyu/Acik Tema Otomatik Gecis
- `prefers-color-scheme` media query + "Sistemi takip et" secenegi

### P3-03. Sag Tik "Benzer Bul" Aksiyonu
- AssetContextMenu → DuplicateFinderModal kisa yolu

### P3-04. DWG R2004+ Katman Cikarimi
- LibreDWG veya ODA SDK ile gelismis katman bilgisi

### P3-05. Binary DXF Format Destegi
- Binary DXF parser veya ODA donusturme

### P3-06. 2FA ve Account Recovery
- TOTP veya email-based 2FA, sifre sifirlama akisi

### P3-07. LAN TLS
- LAN sunucusuna TLS ekle (sertifika yonetimi ile)

### P3-08. CSP `unsafe-inline` Kaldirma
- Style nonce veya hash-based CSP

### P3-09. Merkezi Telemetry (Sentry)
- Crash/error raporlama (opsiyonel, kullanici onayli)

---

## Onceki Plan Durumu (v2.2.3 → v2.3.0 Arasi Tamamlananlar)

Asagidaki maddeler **v2.3.0 release'inde tamamlandi** ve artik plan disindadir:

| Eski Madde | Durum |
|-----------|-------|
| P0-01 Concurrent DB | ✅ atomic write + fs2 file lock |
| P0-02 LAN Faz 2 | ✅ progress bar + SHA-256 |
| P0-03 Session Timeout | ✅ LockScreen + SessionWarningToast |
| P0-04 Authenticode | ⏸ Ertelendi (kullanici kararina bagli) |
| P1-01 TagManager | ✅ TagManagerModal.tsx |
| P1-02 Undo Toast | ✅ commit 616bd48 |
| P1-03 Admin Dashboard | ✅ AdminActivityPanel.tsx |
| P1-04 Toplu Kullanici | ✅ UserBatchImport.tsx |
| P1-05 Viewer Tooltip | ✅ ProtectedAction mode="disabled" |
| P1-06 Cop Kutusu | ✅ _purgeExpiredTrashInternal 30 gun |
| P1-07 Broadcast | ✅ sendBroadcast + BroadcastForm |
| P1-08 Yedekleme | ✅ useBackupScheduler.ts |
| P2-01 Onboarding | ✅ OnboardingTour.tsx |
| P2-02 Yazdir | ✅ PrintReportView.tsx |
| P2-04 Arama Gecmisi | ✅ searchHistory.ts |
| P2-05 Versiyon Timeline | ✅ VersionTimeline.tsx |
| P2-06 Filtre Preset | ✅ FilterPresetSelector.tsx |
| P2-10 Disk Uyari | ✅ useScanWorkflow pre-flight |
| P2-11 Embedding Progress | ✅ EmbeddingProgress.tsx |
| P2-12 Drag & Drop | ✅ DropZone.tsx |
| P3-03 i18n zh/ja/ar | ✅ 5/5 dil %100 (1536 anahtar) |

Arsivlenmis eski plan: `docs/archive/IYILESTIRME_PLANI_v2.2.3.md`

---

## Bu Dosyayi Guncelleme Kurallari

1. Bir is tamamlandiginda: `✅` isareti + tarih/commit notu ekle
2. Yeni eksiklik bulunursa: dogru P seviyesine ekle
3. Oncelik degisirse: maddeyi tasi + neden not et
4. Sprint sonunda: tamamlanan/ertelenen maddeleri guncelle
