# ArchivistPro — Yapılacaklar ve Bilinçli Olarak Ertelenenler

Bu dosya iki listeyi bir arada tutar:
1. **Aksiyon Listesi** — yapılmak üzere sıraya konmuş maddeler (öncelik etiketli)
2. **Ertelenenler** — kasten bekletilen teknik borçlar (ne / neden / risk / ne zaman)

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
