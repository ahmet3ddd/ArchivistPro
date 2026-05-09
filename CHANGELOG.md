# Changelog

Tum onemli degisiklikler bu dosyada belgelenir.
Format [Keep a Changelog](https://keepachangelog.com/tr/1.0.0/) tabanlıdır.

## [2.4.5] — 2026-05-08

### Eklenen (Added)
- **DWG/MAX preview eksiklik sebebi** — onizleme alinamayan dosyalarin DetailPanel'inde sebep gosterilir (`file_too_big`, `no_preview_in_file`, `parse_failed`). Kullanici "neden bos?" sorusuna cevap gorur, bos yere "Yeniden Tara" denemez. Bonus: `parse_failed` cikan dosyalar genelde gercekten bozuk (AutoCAD'in de acamadigi DWG'lerde teyit edildi).
- **Otomatik process priority dusurme** — tarama/embedding sirasinda Windows scheduler uygulamayi Below Normal'a alir; kullanici diger uygulamalari rahat kullanir, tarama yine devam eder. Yeni `process_priority` Rust modulu + reentrant-safe `scanPriority` frontend helper'i.

### Iyilestirilen (Changed)
- **DWG thumbnail boyut limiti** — 100 MB → **500 MB** (mimari ofislerinde 100+ MB DWG rutin)
- **MAX thumbnail boyut limitleri** — 200 MB → **2 GB** dosya, 10 MB → **50 MB** stream (cogu Max sahnesi 200 MB'i asar; CFB seek-based oldugu icin RAM tasmasi yok)

### Duzeltilen (Fixed)
- **SetupWizard Ollama tespiti** — sihirbaz Ollama calisiyor ve modeller kurulu olsa bile "yok" gosteriyordu. `tauriFetch` HTTP plugin scope tanimli olmadigi icin sessizce reddediliyordu. Diger her yerin kullandigi `pingOllama()` (Rust uzerinden) ile degistirildi.

## [2.4.4] — 2026-05-05

### Eklenen (Added)
- **5 dilde tam yardım kapsamı** — admin-guide, user-guide ve scenarios üç dile daha çevrildi (ZH/JA/AR + EN admin-guide & scenarios). 5/5 dil %100 help kapsamı.
- **Test coverage Phase 1 (audit #7)** — `scan_write_batch` saf fonksiyona (`write_scan_batch_to_db`) ayrıldı; 7 yeni birim testi (5 routing + 2 entegrasyon — main/local/custom DB izolasyonu)

### Iyilestirilen (Changed)
- **Help locale fallback chain** — aktif dil → en → tr; `helpSystem` artık `i18n.language`'a dinamik bağlı (önceden modül scope sabit 'tr'di → ZH/JA/AR/EN dilinde TR yükleniyordu)
- **EN admin-guide UI string'leri** — 5 mismatch en.json ile uyumlu hale getirildi (Scan Folder & Index, Watch folders for changes, Download & Install, Create Backup, Regenerate Code)

### Duzeltilen (Fixed)
- **userService donması** — createUser/updateUser/deleteUser ve legacy hash migration'da `saveUserDatabase()` çağrıları kaldırıldı; rusqlite tek-satır persist (`_persistUserRow`/`_deleteUserRow`) zaten kalıcılığı sağlıyordu, full DB export gereksizdi (DbSavingIndicator → 100-500ms ana thread blok ortadan kalktı)

### Kaldırılan (Removed)
- Atıl `syncTechRefPlugin` (kaynak `docs/TECHNICAL_REFERENCE.md` yok, sessizce skip ediyordu)

## [2.4.3] — 2026-05-04

### Eklenen (Added)
- **AI Hassasiyet Filtresi (RAG sensitivity)** — hassas verileri AI sohbetten hariç tutma; admin-only kart
- **Chat citation → DetailPanel** — sohbet içinde citation tıklayınca DetailPanel sidebar açılır
- **Settings: Yardım & Rehber kartı zenginleştirildi** — 4 buton (kullanıcı/admin kılavuzu, senaryolar, klavye kısayolları)
- **Scan ETA klasör-spesifik EMA tohumu** — yeniden taramada klasöre özgü geçmiş süre kullanılıyor

### Iyilestirilen (Changed)
- **Chat targeted persistence** — sohbet yazma/silme `db.export()` donmasını köklü çözen rusqlite mirror; aktif sohbet başlığı okunabilirlik fix'i + dark mode CSS değişkenlerine geçiş
- **Frontend tasarım polish** — 10 maddelik görsel iyileştirme paketi
- **Render/Doku/Fotoğraf sınıflandırması** — köklü düzeltme

### Duzeltilen (Fixed)
- **Folders-view sağ-tık menüsü** — klasör kartı sağ tıkında detaylı menü korunuyor + doğru klasör rescan ediliyor
- **TechnicalView fallback** — bağlam yoksa FoldersView'a yönlendir
- **Settings zaman aşımı açıklaması** — kart içine taşındı
- **AI gizle menü öğeleri** — runtime rol kontrolüne bağlandı (admin-only)
- **Klavye kısayolları listesi boş** — useMemo dependency düzeltmesi
- **TypeScript build hataları (3 adet) + @fontsource-variable/sora ambient module declaration**

## [2.4.2] — 2026-05-03

### Eklenen (Added)
- **"Ne Yapabilirim?" senaryo kılavuzu** — gerçek ofis senaryolarıyla 1 dakikalık örnekler; uygulama içi sekme + dosya
- **Boolean arama operatörleri** — AND/OR/NOT + tırnak frase desteği
- **DWG yapısal benzerlik araması** — CLIP alternatifi composite scoring
- **Şekil arama Faz 4.4** — backend scoring + tarih filtresi + fuzzy arama + preset genişletme
- **DAM: otomatik versiyon kümeleme + onay kuyruğu dashboard paneli**
- **XMP sidecar metadata export** — dosya yanına veya fallback APP_DATA'ya
- **Onay geçmişi audit trail** + red sebebi textarea + persistent bildirimler
- **"Geliştiriciye Bildir" butonu** — hata bildirimlerinde

### Iyilestirilen (Changed)
- **Settings UI redesign** — kart tabanlı; güncelleme sunucusu About'a taşındı
- **TopBar arama** — 4 buton tek "Gelişmiş Arama" dropdown'a toplandı
- **modifiedAt sıralama** + secondary sort + klasör boost artırımı
- **saveDatabase → saveDatabaseDeferred** + cascade delete DRY refactor
- **Duplicate tarama** — O(n²) optimizasyonu (bucket filter + fingerprint + early termination); anında iptal + UI donma fix; varsayılan modlar minimuma + büyük arşiv uyarısı

### Duzeltilen (Fixed)
- **Tire içeren kısa kod arama** — substring pre-check + min 2 karakter (örn. "A1-c3")
- **Tarama sırasında sql.js dump'ının rusqlite verisini ezmesi** — DB race koşulu kapatıldı
- **Shutdown deferred save kaybı** — kapanışta `flushDeferredSave`
- **CI signing key opsiyonel** — key yoksa imzasız MSI release oluşturuluyor
- **CI build hatası** — kullanılmayan import/declaration temizliği

### Kaldırılan (Removed)
- **Ölü kod temizliği** — PrintReportView + TopBar export butonu
- **14 eskimiş doküman `docs/archive/` klasörüne taşındı**

## [2.4.1] — 2026-05-01

### Eklenen (Added)
- **Watch Folders Phase 2** — Settings → Genel → Tarama altında "Klasör değişikliklerini izle" toggle (varsayılan açık) ve opt-in "Otomatik yeniden tara" (60 sn sessizlik debounce); mevcut `handleRescanFolder` yeniden kullanıldı
- **Yapılandırılabilir güvenlik eşikleri** — Settings → Güvenlik:
  - Audit log saklama süresi (0/30/60/90/180/365 gün, 0=kapalı)
  - Login maksimum başarısız deneme (3-20)
  - Login kilit süresi (1-120 dk)
- **Yapılandırılabilir snapshot havuzu** — Settings → Depolama'da "Maksimum yedek sayısı" (3-30, varsayılan 5)
- **Fixity Check (bit-rot tespit)** — Health Modal'da örneklem bazlı (5/10/25/50/100%) dosya bütünlüğü kontrolü; mevcut `compute_file_hash` Rust komutu + `content_hash` baseline kolonu yeniden kullanıldı; iptal edilebilir, in-memory rapor

### Duzeltilen (Fixed)
- **F5/Ctrl+R reload guard** — Tauri webview varsayılan reload davranışı oturum kaybına sebep oluyordu; `useExitConfirmation` capture-mode keydown listener ile engelliyor (login ekranı hariç) + bilgilendirici toast

### Test & Dokumantasyon
- Sıfır regresyon: 2059/2063 test (4 fail = pre-existing UpdateNotification i18n baseline)
- 5 dilde 30+ yeni i18n key (tr/en/zh/ja/ar)
- DAM skoru: 7.6 → ~8.4/10

## [2.3.0] — 2026-04-19

### Eklenen (Added)
- **Unified AI Setup Wizard** — 3 adımlı rehberli AI kurulumu, AIStatusBadge durum göstergesi
- **Ollama başlat/durdur** — AI Ayarları'ndan doğrudan Ollama kontrolü
- **OnboardingTour** — ilk kullanıcı için 7 adımlı spotlight rehber
- **FilterPresetSelector** — filtre kombinasyonlarını kaydet/yükle/sil
- **EmbeddingProgress** — asset-level AI indeksleme ilerleme çubuğu
- **Shape Search** — görsel şekil eşleştirme (kontur → DWG shape arama)
- **Chat Markdown Export** — sohbet oturumlarını .md olarak dışa aktarma
- **TagManagerModal** — etiket silme/düzenleme/birleştirme/renk değiştirme UI
- **AdminActivityPanel** — son 7 gün admin aktivite özet paneli
- **UserBatchImport** — CSV toplu kullanıcı import
- **SessionWarningToast** — oturum zaman aşımı görsel uyarı bildirimi
- **LockScreen** — oturum zaman aşımında ekran kilidi
- **PrintReportView** — arşiv raporu yazdırma görünümü + @media print CSS
- **VersionTimeline** — dosya versiyon zaman çizelgesi
- **DropZone** — sürükle-bırak dosya ekleme
- **Broadcast sistemi** — tüm kullanıcılara duyuru gönderme
- **BackupScheduler** — otomatik yedekleme (1/4/8/24 saat periyot)
- **Streaming backpressure** — AI yanıt streaming optimizasyonu
- **Dinamik vision detection** — model görsel yeteneği otomatik tespiti
- **i18n zh/ja/ar** — Çince, Japonca, Arapça çevirileri tamamlandı (5/5 dil %100, 1536 anahtar)

### Iyilestirilen (Changed)
- **ChatPanel refactor** — 1196 satırdan 543 satıra, 8 alt bileşene bölündü
- **Concurrent DB safety** (P0) — atomic write (temp+rename) + fs2 inter-process file lock
- **LAN Sharing Phase 2** (P0) — download progress bar (ReadableStream) + SHA-256 integrity check
- **Session Timeout** (P0) — konfigüre edilebilir (5-120dk) + "beni hatırla" seçeneği
- **ProtectedAction mode="disabled"** — viewer butonları gizlemek yerine tooltip ile devre dışı
- **Vektör BLOB migration** — embedding depolama optimizasyonu

### Duzeltilen (Fixed)
- Shape search dosya seçim hatası + vertex sayım düzeltmesi
- ConfirmDialog z-index sorunu (panellerin altında kalma)
- AI Ayarları modal taşma + provider kompakt layout
- AISettingsModal hook sıra hatası (useEffect early return'den önce)
- StatusBar'dan gereksiz AI göstergesi kaldırıldı (TopBar'da duplikasyon)
- 5 hardcoded Türkçe string i18n'e taşındı (TopBar, RefileModal, data.ts)

### Test & Dokumantasyon
- Test sayısı: 808 → **1298** (+490 yeni test)
- Coverage: stmt %46 → **%65** / branch %54 / func %79
- tagService coverage: %59 → %92
- RAG pipeline testleri: 57 test
- undoCommands, chatExport, visualSearch servisleri test kapsamına alındı
- Eski audit/review raporları `docs/archive/` altına arşivlendi
- DEVELOPER_GUIDE.md otomatik güncelleme (pre-commit hook)

## [2.2.3] — 2026-04-16

### Eklenen
- RAG Faz 3 başlangıç: LLM-based reranker + query rewriting
- CLIP text→image arama + /görsel slash komutu
- Metadata chunk (filename/proje/tag/DWG katmanları aranabilir)
- Sağ-tık context menü (AssetContextMenu + BlankContextMenu)
- Undo/Redo destructive ops (klasör sil, asset sil, grup sil, sohbet sil)
- DWG OLE tespiti (Excel/Word/PDF gömülü objeler)
- DWG/DXF IMAGE referans çıkarımı
- TechnicalView virtualization + searchText cache
- Sidebar tag filtresi paneli
- Offline MSI build script (build-offline-msi.ps1)
- Ollama otomatik model pull + CORS

### Duzeltilen
- Path prefix veri kaybı (Proje1 silince Proje1_Backup de gidiyordu)
- ODA kurulum sonrası path cache güncellenmiyordu
- BlankContextMenu dışına tıklayınca kapansın
- JPG/PNG önizlemeleri görsel arama sonuçlarında

## [2.2.2] — 2026-04-12

Önceki sürüm — ayrıntılar mevcut git geçmişinde.
