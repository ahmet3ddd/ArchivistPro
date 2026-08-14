# ArchivistPro — Sistem Yöneticileri İçin Kurulum Rehberi

> **Sürüm:** 3.3.3 · **Güncelleme:** 2026-08-14 · **Platform:** Windows 10/11 (64-bit)
>
> Adım adım anlatım için: **[Yeni başlayanlar rehberi](KULLANICI_KURULUM_ACEMI.md)**

## 1. Özet

```powershell
# Kullanıcı düzeyi, etkileşimsiz (önerilen):
ArchivistPro_3.3.3_x64-setup.exe /S

# Makine düzeyi (bilinçli tercih — aşağıdaki tabloyu okuyun):
msiexec /i ArchivistPro_3.3.3_x64_en-US.msi /qn
```

Çekirdek kullanım (tarama, FTS arama, önizleme, kopya bulucu) **tek exe ile
tamamen çevrimdışı** çalışır; AI bileşenleri opsiyoneldir (§7).

## 2. Paket türleri — NSIS ve MSI aynı şey değildir

| | **NSIS `setup.exe` (önerilen)** | MSI |
|---|---|---|
| Kurulum düzeyi | Kullanıcı (admin yetkisi gerekmez) | Makine (`Program Files`) |
| Konum | `%LOCALAPPDATA%\ArchivistPro` | `C:\Program Files\ArchivistPro` |
| 3.3.x yükseltme | **Yerinde yükseltir** | Ayrı ürün olarak kurulur |
| Sessiz anahtar | `/S` | `/qn` |

> ⚠️ Aynı makineye hem setup.exe hem MSI kurarsanız **iki bağımsız kopya** yan
> yana kalır. Tek tür seçin ve onda kalın.

Kod imzası yoktur; ilk çalıştırmada SmartScreen uyarısı beklenen davranıştır
("Ek bilgi → Yine de çalıştır"). Kurumsal dağıtımda hash doğrulaması için release
sayfasındaki SHA-256 tablosunu kullanın.

## 3. Önkoşullar

| Bileşen | Not |
|---|---|
| **WebView2 Runtime** | Tek gerçek zorunluluk. Güncel Win10/11'de genellikle kurulu; yoksa setup.exe internetten indirir. İnternetsiz makineler için [standalone kurucu](https://go.microsoft.com/fwlink/?linkid=2124701) indirip önceden kurun. |
| **VC++ Redistributable x64** | Çoğu makinede vardır. "VCRUNTIME140.dll bulunamadı" hatasında [vc_redist.x64.exe](https://aka.ms/vs/17/release/vc_redist.x64.exe) kurun. |

## 4. Konumlar

| Ne | Nerede |
|---|---|
| Uygulama (NSIS) | `%LOCALAPPDATA%\ArchivistPro` |
| **Arşiv veritabanı** | `%APPDATA%\com.archivistpro.h3\` |
| AI modelleri (ONNX) | `%LOCALAPPDATA%\com.archivistpro.h3\models` |

- Kaldırma veriyi **silmez**: arşiv `%APPDATA%` altında kalır; yeniden kurulum
  kaldığı yerden devam eder.
- Yedekleme: uygulama içinden **Ayarlar → Yedekler** (kritik işlemler öncesi
  otomatik yedek de alınır). Dosya düzeyinde yedek için `%APPDATA%\com.archivistpro.h3\`
  dizinini kopyalamak yeterlidir (uygulama kapalıyken).

## 5. Çok kullanıcı ve roller

- İlk açılışta **ilk yönetici (admin) hesabı** oluşturulur (parola ≥ 6 karakter,
  tamamen yerelde saklanır — kurtarma e-postası yoktur; tek admin parolası
  kaybolursa kurtarma yolu yoktur).
- **Ayarlar → Kullanıcılar**'dan ek hesaplar açılır; roller gerçek yetki
  denetimiyle uygulanır (salt-görüntüleyici rolü dahil). Yazma yetkisi
  arayüzde değil, komut düzeyinde denetlenir.
- Hareketsizlikte oturum **kilitlenir**; kilit ekranından kullanıcı değiştirme
  mümkündür.

## 6. Eski nesilden (3.2.2 ve öncesi) geçiş

3.3.x **farklı bir uygulama kimliği** kullanır: 3.2.2'nin yerinde yükseltmesi
DEĞİLDİR, yan yana kurulur; veri klasörleri ayrıdır.

1. Eski sürümü ve verisini **kaldırmayın** (aktarım doğrulanana kadar).
2. Yeni sürümde **Ayarlar → Genel → "Önceki sürüm bulundu"** kartı →
   **"Önceki sürümden veri aktar"**.
3. Sihirbaz bulunan arşivleri listeler ('ana' etiketli en büyük olan genellikle
   gerçek arşivdir). **"Önce dene"** kuru koşusu hiçbir şey yazmaz; sonuç
   dökümünü gösterir.
4. **Aktar**: öncesinde otomatik yedek alınır; işlem **idempotenttir** — yarıda
   kesilirse ya da ikinci kez koşulursa mevcut kayıtlara dokunmaz ("zaten vardı"
   sayılır).
   - Taşınan: dosya kayıtları, AI analizleri, etiketler, favoriler, koleksiyonlar,
     klasör kökleri (+ istenirse çöp kayıtları ve geçici önizlemeler).
   - Taşınmayan: kullanıcı parolaları (farklı şifreleme) ve sohbet geçmişi.
5. Aktarım sonrası kökleri **yeniden taratın** (içerik metni/parmak izi/önizleme
   taramayla oluşur; taşınan AI analizleri ve etiketler korunur).

## 7. AI bileşenleri (opsiyonel) ve çevrimdışı dağıtım

AI'sız kurulumda arama/tarama/önizleme tam çalışır. AI istenen makinelerde:

1. **Arama modelleri (ONNX, tamamen offline):** **Ayarlar → AI → AI Kurulum
   Sihirbazı → Arama modelleri** ile bir klasörden içe aktarılır. Beklenen üç
   model dizini:
   `paraphrase-multilingual-MiniLM-L12-v2` (metin) ·
   `clip-vit-base-patch32` · `clip-ViT-B-32-multilingual-v1` (görsel).
   Mevcut bir kurulumdan kopyalanabilir: `%LOCALAPPDATA%\com.archivistpro.h3\models`.
2. **Sohbet + görsel analiz:** [Ollama](https://ollama.com) kurulur.
   - Vision modeli internetli makinede: `ollama pull qwen2.5vl:3b`
   - İnternetsiz: başka makinedeki `%USERPROFILE%\.ollama\models` içeriği hedef
     makineye **birleştirilerek** kopyalanır.
3. **Doğrulama:** **Ayarlar → AI → Kurulum kontrolü** — GPU, Ollama, görsel analiz
   modeli ve arama modeli durumunu makine başına ölçer; ardından gerçek deneme
   koşusu yapın.
4. GPU notu: NVIDIA GPU görsel analizi ciddi hızlandırır; CPU ile de çalışır
   (yavaş). **Eski NVIDIA sürücüsü** Ollama'da GPU hatasına yol açabilir —
   çözümü sürücü güncellemektir (kart değişimi değil).

## 8. DWG derin metadata (opsiyonel, önerilir)

**ODA File Converter** kuruluysa uygulama otomatik bulur (ayar gerekmez) ve DWG
katman/blok çıkarımı zenginleşir. Kurulmazsa dahili saf-Rust DWG çözümleyici
devrede kalır (temel bilgiler yine çıkar). İndirme: ODA sitesinden (ücretsiz,
kayıt ister).

## 9. Sorun giderme

| Belirti | Çözüm |
|---|---|
| SmartScreen engeli | "Ek bilgi → Yine de çalıştır"; kurumsal ortamda SHA-256 doğrulayın |
| `VCRUNTIME140.dll bulunamadı` | vc_redist.x64.exe kurun (§3) |
| Boş/beyaz pencere | WebView2 Runtime eksik — standalone kurucuyu kurun (§3) |
| Ollama GPU hatası (`unsupported PTX toolchain` vb.) | NVIDIA sürücüsünü güncelleyin |
| İki ArchivistPro kopyası görünüyor | Hem MSI hem setup.exe kurulmuş — birini kaldırın (veri `%APPDATA%`'da, silinmez) |

## 10. Yükseltme ve kaldırma

- **3.3.x → 3.3.y:** yeni `setup.exe` yerinde yükseltir (uygulama kapalıyken kurun).
- **Kaldırma:** Ayarlar → Uygulamalar listesinden; arşiv verisi `%APPDATA%`'da
  korunur. Veriyi de silmek istiyorsanız `%APPDATA%\com.archivistpro.h3\`
  dizinini elle silin.

---

- Sürüm notları: [CHANGELOG](../CHANGELOG.md) · Sorun bildirme:
  [GitHub Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- Kaynak kod: https://github.com/ahmet3ddd/ArchivistPro

*Son güncelleme: 2026-08-14 (v3.3.3).*
