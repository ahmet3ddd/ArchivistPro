# ArchivistPro v3.0.0 — Ekran Görüntüsü Çekim Listesi

Yardım dokümanları ve kurulum rehberleri için gerekli ekran görüntülerinin
**tek listesi**. SS'leri çekip belirtilen konumlara koy, sonra
**`npm run docs:sync`** çalıştır (CHANGELOG ile birlikte SS'ler de
senkronlanır — istersen sync-docs.cjs scriptine `public/docs/img/`
eklenebilir).

> **Genel kural:** Tüm SS'ler dilsiz/generic. UI metinleri minimum, ok
> ile işaret. Tek SS seti 5 dilde kullanılır.

> **Önerilen çözünürlük:** 1920×1080 ekran, %100 zoom. SS sonrası yarıya
> düşürülebilir (genişlik 960px) — dosya boyutu küçük kalsın.

---

## 1. In-App Yardım Dokümanları (`public/docs/img/`)

Bu klasörü oluştur (henüz yok):

```bash
mkdir public/docs/img
```

7 SS:

| Dosya adı | Ne göstermeli? | Hangi dokümanda? |
|---|---|---|
| `main-window.png` | Uygulama ana penceresi — sol panel + grid + sağ detay paneli görünür | user-guide ("Hoş Geldiniz") |
| `sidebar-source-folders.png` | Sol panelin "Kaynak Klasörler" bölümü — 2-3 örnek klasör + 3-nokta menü görünür | user-guide ("Kaynak Klasörler Paneli") |
| `ai-chat-empty.png` | AI Sohbet penceresi — boş hali, "Tüm Arşiv" scope seçiciyle | user-guide ("AI Sohbet (RAG)") |
| `ai-chat-settings.png` | AI Sohbet çark ikonu açık — Model/Ollama/İndeks/Rerank vb. listesi (önceki bug raporundaki SS gibi) | user-guide ("Sohbet Ayarları") |
| `multi-archive-tabs.png` | Sol panelin en üstündeki arşiv sekme seçici — 2-3 arşiv görünür | user-guide ("Çoklu Arşiv") |
| `duplicate-finder.png` | Kopya Bulucu modalı — birkaç eşleşmeli sonuç | user-guide ("Kopya Bulucu") |
| `settings-v3-migration.png` | Settings > Depolama > V3 Şema Migrasyonu paneli | admin-guide ("V3 Şema Mimari") |

---

## 2. Kurulum Rehberi SS'leri (`docs/img/install/` ve `public/docs/img/install/`)

Bu klasörleri oluştur:

```bash
mkdir -p docs/img/install
mkdir -p public/docs/img/install
```

> **Not:** Install rehberleri hem `docs/` (GitHub için) hem de uygulama
> içinden link veriyor. SS'leri **her iki konuma** koy (ya da symlink),
> ya da install rehberi sadece `docs/` tarafında kalır (kullanıcı
> GitHub'dan PDF olarak okur — bu durumda yalnız `docs/img/install/`
> yeterli).

8 SS:

| Dosya adı | Ne göstermeli? | Hangi rehberde? |
|---|---|---|
| `github-releases.png` | GitHub Releases sayfası — Assets bölümünde MSI/EXE dosyaları görünür | KULLANICI_KURULUM_ACEMI (tüm diller) |
| `installer-wizard.png` | MSI/NSIS kurulum sihirbazı — "Next/İleri" butonu görünür | aynı |
| `wizard-step-1.png` | İlk açılış sihirbazı — Adım 1 (dil + sistem kontrolü) | aynı |
| `wizard-step-2.png` | İlk açılış sihirbazı — Adım 2 (donanım tespiti, Düşük/Orta/Yüksek seçimi) | aynı |
| `wizard-step-5.png` | İlk açılış sihirbazı — son adım (özet + "Başla" butonu) | aynı |
| `admin-setup.png` | Yönetici hesabı oluşturma ekranı — kullanıcı adı + parola alanları | aynı |
| `scan-folder-button.png` | Sol panelde "Klasör Tara & İndeksle" butonu vurgulanmış | aynı |
| `scan-progress.png` | Tarama sırasında modal — ilerleme çubuğu + hız bilgisi | aynı |

---

## 3. Toplam Sayım

- In-app docs: **7 SS**
- Install rehberi: **8 SS**
- **Toplam: 15 SS**

---

## 4. SS Çekim Akışı (Önerilen)

1. **Temiz bir test arşivinde aç** — örneğin `D:\DENEME_arşiv` (5-10 örnek dosyalı).
2. **UI dilini varsayılan TR'de bırak** (generic SS — metin minimum
   tutulacak, dil önemli değil).
3. **Her SS'i ayrı pencere/state'te al:**
   - Modaller: önce modalı aç, sonra SS.
   - Çark menüleri: önce menüyü göster.
   - İlk açılış sihirbazı için: yeni bir kullanıcı profilinde test et ya
     da `localStorage` flag'lerini temizle.
4. **Dosya formatı:** PNG. JPEG yerine PNG tercih edilir (UI = sharp
   edges, çizgi sanatı).
5. **Yeniden boyutlandır:** 1920×1080'den 960×540'a (yarıya) düşür. PNG
   sıkıştırma seviyesi 9 ile dosya boyutunu küçült (örn. `oxipng` veya
   `tinypng.com`).
6. **Doğru klasöre koy** (yukarıdaki tablo).

---

## 5. Doğrulama

SS'ler yerleştikten sonra:

```bash
# Eksik SS'ler var mı? Tüm placeholder'ları grep'le:
grep -rn 'img/.*\.png' public/docs/ docs/ | sort -u

# Karşılığa fiziksel dosya var mı? Manuel kontrol:
ls -la public/docs/img/
ls -la docs/img/install/ public/docs/img/install/
```

Eksik dosya kalan placeholder'larda **broken image ikonu** görünür.
Sürüm bump öncesinde temizle.

---

## 6. Gelecek (v3.x+)

İleride dile özel SS klasörleri (`img/install/tr/`, `img/install/en/`,
vb.) eklenebilir. Bu durum SS bakım yükünü 5x'e çıkarır; v3.0.0 için
generic SS yaklaşımı daha pragmatik.

---

*Bu liste v3.0.0 için ilk kez oluşturuldu. Sürüm bump'larında SS'ler
güncellenmek zorunda KALMAZ (özel bir UI değişikliği olmadıkça).
v3.x.x patch'lerde SS'lere dokunulmaz.*

*Son güncelleme: 2026-05-23 (v3.0.0).*
