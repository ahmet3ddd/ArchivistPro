# ArchivistPro — Çok Perspektifli Değerlendirme Raporu

**Tarih:** 2026-04-10 | **Sürüm:** 2.2.1 | **Branş:** main

## 0) Proje Anlık Görüntüsü (Ölçülen)

| Metrik | Değer |
|---|---|
| Toplam kaynak satırı | ~44.955 (TS/TSX/Rust) |
| Rust modülleri | 19 dosya, **81** `#[tauri::command]` |
| Frontend bileşenleri | 40 React bileşen, 13 custom hook, 35 servis |
| Veritabanı tabloları | 16 (main+local ikiz şema) |
| Test | 35 birim + 6 Playwright e2e; ~613 test case |
| i18n | 5 dil (tr, en, zh, ja, ar) |
| Kritik dosya boyutu | `database.ts` 2.110, `fileScanner.ts` 1.811 satır |
| Denetim skoru | 9.3/10 (2026-04-07 iç rapor) |

---

## 1) 📚 Arşivci Uzman Gözüyle

Bir arşiv uzmanı için kritik olan: **bütünlük (integrity), bulunabilirlik (findability), geri alınabilirlik (recoverability), kalıcılık (preservation), kanıtlanabilirlik (provenance)**.

### Güçlü Yönler
- **Format genişliği sınıfının üstünde.** CAD/BIM (DWG, DXF, IFC, RVT, NWD), 3D (MAX, SKP, FBX, BLEND), belge, video, PSD/AI/EPS — mimarlık ofisi gerçek iş akışını karşılıyor.
- **ODA FileConverter entegrasyonu** DWG'de binary scan tahmininden gerçek layer/block/xref çıkarımına geçmiş — bu, arşiv uzmanı gözüyle "sahte metadata yerine kanıtlanabilir metadata" anlamına gelir (önemli).
- **SHA-256 dedup + `dbSnapshot` rollback + `archive_share` ZIP export** → preservation zinciri sağlam.
- **Çoklu arşiv (Faz 1–3)**: Join/Extract + kaynak klasör takibi (`scanned_roots`) → gerçek arşivcilik için "dolap–çekmece–dosya" ayrımı doğru modellenmiş (`PLAN_coklu_arsiv.md`'de terminoloji net).
- **Audit log + trash + undo/redo** servisleri mevcut → "kim ne yaptı, geri alabilir miyim" cevaplanabiliyor.
- **Offline + yerel embedding (CLIP/transformers.js) + Ollama proxy** → KVKK/gizlilik hassasiyetli ofisler için doğru mimari tercih.

### Zayıf Yönler (Arşivci gözüyle)
- **Kanıtlanabilir kopya (fixity) rutini yok.** SHA-256 ilk tarama anında hesaplanıyor ama periyodik "bit rot" kontrolü (fixity check) ve rapor akışı yok. Bir arşiv uzmanı için bu eksik.
- **Retention policy / saklama süresi metadata'sı yok.** "Bu belge 10 yıl saklanacak, sonra imha" gibi arşiv temel kavramı modellenmemiş.
- **Controlled vocabulary / taksonomi desteği zayıf.** Serbest tag var ama hiyerarşik sınıflandırma (ISAD(G), DACS) veya zorunlu metadata alanı yok.
- **Provenance/chain-of-custody minimalist.** Asset'in nereden geldiği (`scanned_roots`) var ama "hangi kullanıcı import etti, hangi arşivden taşındı, önceki hash" tam bağlanmamış.
- **Uzun süreli koruma (LOCKSS/replikasyon) yok.** LAN paylaşımı var ama aktif çoklu kopya senkronizasyonu yok — tek disk bozulursa tek nokta hata.

### 🧮 Arşivci Skoru

| Kriter | Skor /10 |
|---|---|
| Format kapsamı | 9.5 |
| Bütünlük (ingest hash) | 8.5 |
| Periyodik fixity | 4.0 |
| Metadata zenginliği | 8.0 |
| Retention/yaşam döngüsü | 3.5 |
| Provenance/audit | 7.5 |
| Geri alma/rollback | 9.0 |
| Standartlara uyum (ISAD/DC) | 4.0 |
| **Ortalama** | **6.75/10** |

---

## 2) 👤 Son Kullanıcı Gözüyle (mimarlık ofisi çalışanı)

### Güçlü Yönler
- **Kurulum sihirbazı** (`SetupWizard`, `FirstRunSetup`, `PerformanceSetupModal`) → "teknik olmayan" mimarlık ofisi çalışanı için giriş eşiği düşük.
- **Semantik arama + görsel (CLIP) arama + sorgu genişletme** → "rüzgar güllü cephe" gibi belirsiz aramalar çalışıyor.
- **DetailPanel'de DWG layer/block/text gösterimi** → kullanıcı dosyayı açmadan içerik görebiliyor (büyük UX kazancı).
- **Thumbnail üreticisi 9+ format** → görsel tarama kolaylığı.
- **5 dil desteği** (tr/en/zh/ja/ar) — uluslararası ofisler için.
- **Feedback + Crash reporter** UI seviyesinde entegre.

### Zayıf Yönler
- **i18n eksik:** `tr.json` ve `en.json` 1.501 satır, `zh/ja/ar` sadece **1.277 satır** — %15 çeviri eksiği. README "TR+EN" diyor ama repoda 5 dil var, doc ile gerçek arasında tutarsızlık.
- **5 hardcoded Türkçe string** hâlâ açık (`AUDIT_REPORT_2026-04-07.md`): "Sil", "Kaydet", "Dashboard", `toLocaleDateString('tr-TR')` — İngilizce kullanıcı bunları Türkçe görüyor.
- **README versiyon drift:** README "v2.0.0-beta" diyor, `package.json` 2.1.1. Yeni kullanıcı yanlış bilgi alıyor. CLAUDE.md'nin uyardığı "4 dosyada sürüm senkronu" sorunu aktif.
- **Dev rehberi kullanıcıya yönelik değil.** `KULLANICI_KURULUM_REHBERI.md` var ama yeni kullanıcı için "hızlı başlangıç" akışı README'de yok.
- **28 bileşen test kapsaması dışında** (`AUDIT_REPORT`) — UI regresyonu riski.
- **Büyük arşivlerde "join/extract detaylı dry-run" yok** (TODO.md Faz 2–3): Kullanıcı merge öncesi tam liste göremiyor, "umarım doğru gider" güveniyle işlem yapıyor. Rollback var ama psikolojik güven eksik.

### 🧮 Kullanıcı Skoru

| Kriter | Skor /10 |
|---|---|
| Kurulum kolaylığı | 8.5 |
| Arama/bulma akıcılığı | 9.0 |
| Görsel önizleme | 9.0 |
| Yerelleştirme bütünlüğü | 6.5 |
| Hata/feedback kanalı | 8.5 |
| Dokümantasyon (son kullanıcı) | 6.0 |
| UI tutarlılığı (hardcoded) | 7.0 |
| Güven hissi (dry-run vb.) | 7.0 |
| **Ortalama** | **7.69/10** |

---

## 3) 🛠 Yönetici (Sistem Yöneticisi / BT) Gözüyle

### Güçlü Yönler
- **RBAC (admin/viewer) çift katmanlı** — Rust `require_admin()` + frontend `<ProtectedAction>` → **savunma derinliği doğru**.
- **Güvenlik denetim geçmişi çok güçlü:** 44 bulgu / 7 tur / 0 açık kritik. PBKDF2-SHA256 100k iter, path traversal çift katman, CSP, SSRF allowlist, DOMPurify — denetim raporu olgun.
- **İmzalama + Updater pipeline** (`tauri.conf.json`, GitHub Secrets, `.msi.sig`) → tag-tabanlı release akışı ve imzalı güncellemeler mevcut.
- **CI/CD** (`ci.yml` + `release.yml`) + lint + test + build → otomasyon seviyesi iyi.
- **Feature flag (admin/viewer build)** → kısıtlı cihazlara viewer-only dağıtım mümkün.
- **LAN sunucu** (tiny_http, port 9471) → küçük ofis çok kullanıcı senaryosu destekli.
- **Crash report yerel dosyaya yazıyor** (offline-first) → BT telemetry olmadan da sorun izlenebilir.

### Zayıf Yönler
- **`database.ts` 2.110 satır, `fileScanner.ts` 1.811 satır** → tek dosyada birikmiş sorumluluk (yönetilebilirlik riski). Yeni geliştirici onboarding zorlaşır.
- **71→81 komut büyümesi CLAUDE.md'ye yansımamış** → docs drift riski (CLAUDE.md "71+ komut" diyor, gerçek 81).
- **Erişim kontrolü 1 açık bulgu** (`AUDIT_REPORT`) — detayı raporda geçmiyor, yönetici gözüyle belirsizlik.
- **Merkezi telemetry/log toplama yok** — 10 iş istasyonunda kimin crash aldığı BT tarafında toplanmıyor.
- **Disk kota/alan uyarısı `StorageWarningBanner` var** ama yönetici tarafında arşiv büyüklüğü raporu yok.
- **Yedekleme stratejisi belgesiz.** `archive_share` export var ama zamanlanmış yedek/otomasyon yok — yönetici elle planlamak zorunda.
- **Cross-platform sadece Windows** (README) — Mac/Linux ofisler dışarıda.

### 🧮 Yönetici Skoru

| Kriter | Skor /10 |
|---|---|
| Güvenlik (denetimli) | 9.3 |
| RBAC/yetkilendirme | 8.5 |
| CI/CD + release | 9.0 |
| İzlenebilirlik/telemetry | 5.5 |
| Bakım/kod modülerliği | 7.0 |
| Docs drift (CLAUDE.md, README) | 6.0 |
| Yedekleme/DR | 6.5 |
| Çoklu platform | 4.0 |
| **Ortalama** | **6.98/10** |

---

## 4) Genel Skor Tablosu

| Perspektif | Skor | Durum |
|---|---|---|
| Arşivci Uzman | **6.75 / 10** | İşlevsel ama arşivcilik standardı eksik |
| Son Kullanıcı | **7.69 / 10** | Güçlü UX, yerelleştirme borcu var |
| Yönetici/BT | **6.98 / 10** | Güvenlik güçlü, bakım+platform zayıf |
| **Toplam ağırlıklı** | **7.14 / 10** | Erken olgunluk (beta→v2.x geçişinde) |

---

## 5) 🎯 Uzman Gözüyle Fikirler ve Öneriler

**Genel teşhis:** ArchivistPro, "mimarlık ofisi için offline AI-destekli dosya tarayıcı" olarak **sınıfının üstünde** bir teknik iş yapıyor. Gerçek arşivci olma yolunda kritik kavramsal adımların (retention, fixity, taksonomi) eksik olduğunu görüyorum — ürün "akıllı dosya keşif aracı" ile "kurumsal arşiv sistemi" arasında duruyor ve **bu duruşu netleştirmek** kritik.

### Öncelikli Öneriler (etki × maliyet sırasıyla)

**🔥 Hızlı kazanımlar (1–3 gün)**
1. **Doc drift'i kapat.** README (v2.0.0-beta→2.1.1, "TR+EN"→5 dil), CLAUDE.md ("71+ komut"→81) senkronize edilsin. Yeni kullanıcı ilk izlenimi buradan bozuluyor.
2. **5 hardcoded Türkçe string'i bitir** (`AUDIT_REPORT` açık bulguları). 2 saatlik iş, kullanıcı skorunu 0.5 puan yukarı çeker.
3. **zh/ja/ar locale tamamlama** (225 anahtar eksik). Otomatize edilebilir: tr→hedef dil için LLM ile ilk geçiş + insan onayı.

**🎯 Orta vadeli (1–3 hafta)**
4. **`database.ts`'i böl.** 2.110 satır tek dosya → `schema.ts`, `assetRepo.ts`, `archiveRepo.ts`, `auditRepo.ts` gibi sorumluluk bölmeleri. Yeni geliştirici onboarding süresi yarıya iner, hata izolasyonu kolaylaşır.
5. **Periyodik fixity check** arka plan görevi: haftalık SHA-256 yeniden doğrulama + `fixity_log` tablosu + "son doğrulama tarihi" DetailPanel'de gösterimi. Arşivci skorunu 4→8'e çıkarır.
6. **Retention metadata alanı** (`retention_until`, `retention_policy`) + otomatik "süresi dolanlar" filtresi. Arşiv yönetimi olgunluğuna gerçek sıçrama.

**🏗 Stratejik (1–3 ay)**
7. **Controlled vocabulary / taksonomi ağacı.** Tag'ler düz — bunların üstüne hiyerarşik kategori ağacı (örn. "Proje → Mimari → Plan → Kat Planı") eklenirse ürün "dosya arayıcı"dan "gerçek arşiv"e terfi eder. Mimarlık ofisi için öldürücü özellik.
8. **Dry-run detaylı liste** (TODO.md Faz 2–3). Kullanıcı güveni için altın vuruş; "umarım doğru" hissini kapatır.
9. **Yönetici paneli / telemetry aggregator** (opsiyonel, offline uyumlu): LAN sunucusu zaten var, BT bir dashboard'dan tüm istemcilerin disk/hash/hata durumunu görebilsin.
10. **Mac/Linux build.** Tauri zaten destekliyor — Windows-only kısıtı daraltıcı, özellikle bazı mimarlık ofislerinin tasarım ekipleri Mac kullanıyor.

### Bir Mimari Öneri
Kod güvenlik denetimi (9.3/10) olgunluk olarak çok ileride, ama **veri modeli olgunluğu** bundan geride. **Bir sonraki majör sürümün teması "güvenlikten arşivciliğe" olmalı**: fixity, retention, taksonomi, provenance — bu dört kavram ürününüzü "akıllı arama yapan klasör" algısından "ofisin gerçek kurumsal hafızası" konumuna taşır. Teknik altyapı bunu taşıyacak durumda; eksik olan kavramsal katman.

### Son Söz
Projenin en etkileyici yanı: **disiplin.** TODO.md'nin "Ne / Neden / Risk / Ne zaman / Dosya" formatı, audit raporunun tur-tur izi, PLAN_coklu_arsiv.md'nin terminoloji netliği — bunlar solo/küçük ekip projelerinde nadiren görülür. Bu disiplin devam ettiği sürece yukarıdaki eksikler takvim meselesi; mimari bir problem yok.
