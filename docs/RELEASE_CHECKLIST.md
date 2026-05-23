# ArchivistPro — Sürüm Bump Kontrol Listesi (Release Checklist)

Bu doküman her yeni sürüm dağıtımı öncesinde **adım adım** yapılması gereken
işleri listeler. Sürüm sonrası drift (eksik tarihli docs, eski versiyon
metadata vs.) bu liste ile önlenir.

İlk oluşturma: 2026-05-23 (v3.0.0).

---

## 1. Genel Akış

```
1. Sürüm türünü belirle (major / minor / patch)
2. Sürüm numarasını 4 dosyada bump et (version metadata)
3. CHANGELOG.md'ye yeni sürüm bölümü ekle
4. 5 dil × 4 doküman tarih satırlarını güncelle (16 dosya)
5. (Major bump'sa) 2 install rehberi × 5 dil tarihleri güncelle (10 dosya)
6. (Major bump'sa) yardım docs'larında V3-spesifik bölümleri güncelle
7. Yerel doğrulama: tsc, npm test, cargo test
8. Commit + push + git tag
9. MSI build
10. GitHub Release oluştur, MSI yükle
11. Sürüm-sonrası kontrol
```

---

## 2. Sürüm Türü Belirleme (SemVer)

| Türü | Ne zaman | Örnek |
|---|---|---|
| **Major** (X.0.0) | Breaking change: şema değişimi, kaldırılan özellik, davranış değiştiren API/yetki | v2.4.10 → v3.0.0 (vec.db ayrı dosya) |
| **Minor** (3.X.0) | Yeni özellik, geriye uyumlu | v3.0.0 → v3.1.0 (yeni format desteği) |
| **Patch** (3.0.X) | Bug fix, performans, küçük UI değişikliği | v3.0.0 → v3.0.1 (detectListIntent fix) |

> Karar verirken sor: "Kullanıcının verisi/iş akışı bu sürümde değişiyor mu?"
> - Evet → major
> - Yeni bir şey eklendi → minor
> - Sadece düzeltme → patch

---

## 3. Sürüm Bump — 4 Dosya

Bu dosyalarda `version` alanını yeni sürüme güncelle:

| Dosya | Alan |
|---|---|
| `src/appVersion.ts` | `APP_VERSION` + `APP_BUILD_DATE` (bugünün tarihi `YYYY-MM-DD` formatında) |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.toml` | `[package] version` |
| `package.json` | `"version"` |

Sonra `cargo check --manifest-path src-tauri/Cargo.toml --features admin --lib`
çalıştır — `Cargo.lock` otomatik olarak güncellenir.

---

## 4. CHANGELOG.md

`docs/CHANGELOG.md` dosyasının en üstüne yeni sürüm bölümü ekle. Format
[Keep a Changelog](https://keepachangelog.com/) ve [SemVer](https://semver.org/)
standardlarına uyar.

Şablon:

```markdown
## [X.Y.Z] — YYYY-MM-DD — Kısa başlık

(Eğer major: bir paragraf bağlam — bu sürüm neyi getiriyor, neden major)

### ⚠️ Önemli — Geriye Uyumluluk
- (Sadece major'da: breaking change'lerin etkisi, migration akışı)

### Eklenenler
- Yeni özellik 1
- ...

### Değişenler
- Davranış değişiklikleri
- ...

### İyileştirilenler
- Performans / kalite
- ...

### Düzeltilenler
- Bug fix referansı (commit hash ile)
- ...

### Güvenlik
- (Varsa güvenlik düzeltmeleri)
```

> CHANGELOG yazarken commit'lerden değil, **kullanıcı görünür değişim**
> perspektifinden yaz. "feat(rag): ..." commit'i CHANGELOG'da "AI sohbet
> X soru tipini doğru yanıtlıyor" olarak görünür.

---

## 5. Yardım Dokümanları — Tarih Güncellemesi (Her Sürüm Bump)

Her sürüm bump'ında **16 dosyada** tarih satırı güncellenmeli:

### Her dilde (`public/docs/<lang>/`)

5 dil × 3 dosya:

- `user-guide.md` — header `> Sürüm X.Y.Z | YYYY-MM-DD` + footer `Son güncelleme: YYYY-MM-DD (vX.Y.Z).`
- `admin-guide.md` — aynı pattern
- `scenarios.md` (TR'de `kullanim-senaryolari.md`) — aynı pattern

### Dilsiz tek dosya (`public/docs/`)

- `TECHNICAL_REFERENCE.md` — header `> Son güncelleme: YYYY-MM-DD (rev.N) | Sürüm: X.Y.Z` + footer

> **İpucu:** Tüm dosyalarda eski `v2.4.4` ya da `2026-05-05` aramak, hangi
> yerlerin güncel olmadığını gösterir. Grep'le bulup tek tek güncelle.

---

## 6. Yardım Dokümanları — İçerik Güncellemesi (Major/Minor Bump)

**Sadece major veya önemli minor bump'larda** içerik güncellemesi gerekir.
Patch'lerde tarih+CHANGELOG yeterli.

Major'da güncellenecek tipik yerler:

- **`user-guide.md`** — Yeni özellik bölümü, AI Sohbet yenilikleri,
  ekran görüntüsü placeholder'ları
- **`admin-guide.md`** — Yeni mimari/şema değişikliği, yedekleme prosedürü
  değişikliği, env variable eklenmesi
- **`scenarios.md`** — Yeni kullanım senaryosu (örn. migration sonrası)
- **`TECHNICAL_REFERENCE.md`** — Yeni Tauri komutları, şema değişikliği,
  AI/ML yenilikleri

Major'da install rehberlerini de güncelle:

- `docs/KULLANICI_KURULUM_ACEMI.md` + `INSTALL_BEGINNER_{EN,AR,JA,ZH}.md` (5)
- `docs/KULLANICI_KURULUM_PRO.md` + `INSTALL_PRO_{EN,AR,JA,ZH}.md` (5)

**Çeviri sırası:**

1. **TR** (ana kaynak — direkt yazılır)
2. **EN** (profesyonel çeviri — TR'den)
3. **AR / JA / ZH** (paralel — EN ana kaynak, terim sözlüğü
   `docs/i18n-glossary.md` ile tutarlılık)

> Yeni terim ortaya çıkarsa önce `docs/i18n-glossary.md`'ye ekle, sonra
> dokümana. Ad-hoc çeviri yapma.

---

## 7. Ekran Görüntüleri (Major Bump'da)

Yardım dokümanlarındaki SS placeholder'lar:

- `public/docs/img/main-window.png`
- `public/docs/img/sidebar-source-folders.png`
- `public/docs/img/ai-chat-empty.png`
- `public/docs/img/ai-chat-settings.png`
- `public/docs/img/multi-archive-tabs.png`
- `public/docs/img/duplicate-finder.png`
- `public/docs/img/settings-v3-migration.png`

Install rehberi SS'leri (`public/docs/img/install/` ya da
`docs/img/install/`):

- `github-releases.png`
- `installer-wizard.png`
- `wizard-step-1.png`, `wizard-step-2.png`, `wizard-step-5.png`
- `admin-setup.png`
- `scan-folder-button.png`
- `scan-progress.png`

**Genel kural (v3.0.0):** Tek SS seti tüm diller için kullanılır. Metni
minimum tutarak (UI ok ile işaret) dilsiz görünüm elde edilir.

> İlerleyen sürümlerde dil-spesifik SS'lere geçilebilir
> (`img/install/<lang>/`).

---

## 8. Yerel Doğrulama (Her Bump)

Commit etmeden önce **kesinlikle** çalıştır:

```bash
# TypeScript tip kontrolü
npx tsc --noEmit

# Vitest tam suite (2200+ test)
npm test -- --run

# Rust unit + entegrasyon
cargo test --manifest-path src-tauri/Cargo.toml --features admin --lib

# Clippy (uyarı yok ya da yalnız baseline)
cargo clippy --manifest-path src-tauri/Cargo.toml --features admin --lib

# Docs sync (Vite serve için)
npm run docs:sync
```

Beklenen sonuçlar (v3.0.0 baseline):
- tsc: 0 hata
- vitest: **2221/2221 passed**
- cargo: **246/246 + 6 ignored**
- clippy: 0 yeni uyarı (39 baseline pre-existing)

> Major bump'da test sayıları artmış olabilir — `STATUS.md`'den son
> baseline'ı oku.

---

## 9. Commit + Tag

Tek bir final commit ile sürüm bump'ı işle:

```bash
git add -A   # ya da explicit dosya listesi
git commit -m "chore(release): vX.Y.Z

Yeni özellikler / değişikliklerin kısa özeti.

CHANGELOG.md güncellendi.
5 dil docs tarihi güncellendi.
appVersion v$X.Y.Z, build date YYYY-MM-DD.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Tag oluştur (annotated, mesajlı)
git tag -a vX.Y.Z -m "Release vX.Y.Z"

# Push commit + tag
git push origin <branch>
git push origin vX.Y.Z
```

---

## 10. MSI Build

```bash
# Sadece MSI
npm run offline:build:msi

# Sadece NSIS (.exe)
npm run offline:build:nsis

# İkisi birlikte
npm run offline:build
```

Çıktı: `src-tauri/target/release/bundle/msi/` altında:
- `ArchivistPro_X.Y.Z_x64_en-US.msi`
- `ArchivistPro_X.Y.Z_x64-setup.exe`

Beklenen MSI boyutu: ~200-400 MB (modeller dahil).

> **Bilinen blokaj (v3.0.0):** `app` crate rlib 6.23 GB > rustc 4 GB
> metadata sınırı (`STATUS.md` Section "MSI için kalan seçenekler"
> referansına bak). v3.0.0 için Seçenek A (profile override) ya da
> Seçenek B (crate split) gerekebilir.

---

## 11. GitHub Release

`gh` CLI ile (önerilen) ya da web UI:

```bash
gh release create vX.Y.Z \
  src-tauri/target/release/bundle/msi/ArchivistPro_X.Y.Z_x64_en-US.msi \
  src-tauri/target/release/bundle/nsis/ArchivistPro_X.Y.Z_x64-setup.exe \
  --title "ArchivistPro vX.Y.Z" \
  --notes-file docs/CHANGELOG.md
```

Release açıklamasında CHANGELOG'un ilgili sürüm bölümünü kopyala.

---

## 12. Sürüm-Sonrası Kontrol

İlk açılış testi:

- [ ] Yeni MSI'ı temiz bir VM/test makinede kur
- [ ] İlk açılış sihirbazı düzgün gösteriliyor mu
- [ ] Admin hesabı oluşturma çalışıyor mu
- [ ] Tarama + indeksleme akışı sorunsuz mu
- [ ] AI Sohbet (Ollama bağlıysa) yanıt veriyor mu
- [ ] Yardım panelinin 4 sekmesi açılıyor mu (User Guide, Admin Guide,
      Ne Yapabilirim?, Sürüm Notları)
- [ ] (Major bump'sa) v2.4.x DB'sinden migration test edildi mi

Upgrade testi:

- [ ] Önceki sürümden gelen kullanıcıda DB migration sorunsuz mu
- [ ] `.bak` yedek dosyası oluşmuş mu
- [ ] Veri kaybı yok mu (asset sayısı, etiketler, koleksiyonlar)

---

## 13. STATUS.md Güncellemesi

`docs/v3/STATUS.md` (v3 dalı için) ya da ana branch dökümana sürüm bilgisi
ekle. Yeni "Sürüm X.Y.Z dağıtıldı" notu, yapılan ana işlerin özeti, sürüm
sonrası ortaya çıkan açık konular.

---

## 14. Sürüm Bump Geçmişi (Bu Listenin Kullanım Tarihçesi)

| Sürüm | Tarih | Tür | Notlar |
|---|---|---|---|
| v3.0.0 | 2026-05-23 | Major | V3 mimari (vec.db ayrı dosya); bu listenin ilk kullanım anı |

Yeni sürüm bump'larında bu tabloya satır ekle.

---

## Notlar

- Bu liste yaşayan bir dokümandır. Yeni sorun keşfedilirse buraya kontrol
  noktası ekle.
- Liste her sürüm bump'ında **adım adım** takip edilir — atlama yapma.
- Acil patch sürümlerde (hotfix) Section 8 (doğrulama) atlanmaz; ancak
  Section 6 (içerik güncellemesi) genelde gerekmez.
