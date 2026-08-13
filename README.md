<div align="center">

# ArchivistPro

**Mimari ofisler için tamamen offline arşiv yönetimi**
Dosyalarınız bilgisayarınızdan çıkmaz. Bulut yok, abonelik yok, hesap yok.

[![Sürüm](https://img.shields.io/github/v/release/ahmet3ddd/ArchivistPro?label=s%C3%BCr%C3%BCm&color=2ea043)](https://github.com/ahmet3ddd/ArchivistPro/releases/latest)
[![Lisans: MIT](https://img.shields.io/badge/lisans-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey)
![Dil](https://img.shields.io/badge/dil-TR%20·%20EN%20·%20AR%20·%20JA%20·%20ZH-informational)

[English README](README_EN.md) · [İndir](https://github.com/ahmet3ddd/ArchivistPro/releases/latest) · [Kurulum rehberleri](docs/KULLANICI_KURULUM_REHBERI.md) · [Yol haritası](docs/ROADMAP.md)

</div>

![ArchivistPro — tarama, arama ve önizleme](assets/demo.gif)

> "Cumhuriyet dönemi cumbalı bina" yazın — arşiviniz size doğru dosyayı getirsin.

---

## Hızlı başla

1. **[Son sürümü indirin](https://github.com/ahmet3ddd/ArchivistPro/releases/latest)** (Windows; `..._x64-setup.exe` dosyasını seçin)
2. Kurun — internet yalnızca kurulum sırasında gerekir
3. Arşiv klasörünüzü gösterin, taramayı başlatın

Adım adım anlatım isterseniz: **[yeni başlayanlar için rehber](docs/KULLANICI_KURULUM_ACEMI.md)** · **[sistem yöneticileri için rehber](docs/KULLANICI_KURULUM_PRO.md)**
Diğer diller: [English](docs/KULLANICI_KURULUM_REHBERI_EN.md) · [العربية](docs/KULLANICI_KURULUM_REHBERI_AR.md) · [日本語](docs/KULLANICI_KURULUM_REHBERI_JA.md) · [中文](docs/KULLANICI_KURULUM_REHBERI_ZH.md)

---

## Neler yapar

| | |
|---|---|
| **Dosya tarama** | DWG, MAX, IFC, RVT, SKP, PDF dahil 95+ format; kopya dosyaları otomatik bulur |
| **Anlamsal arama** | Dosya adı değil, içerik ve görsel benzerlik üzerinden arama — tamamen yerel model |
| **Arşive soru sorma** | Arşivinizdeki belgelerin içeriğinden cevap üretir |
| **Önizleme** | DWG, 3D MAX, PSD, PDF ve videolar için otomatik küçük resim |
| **Harita görünümü** | Konum bilgisi taşıyan fotoğrafları harita üzerinde gösterir |
| **Çoklu arşiv** | Ana arşiv + yerel arşiv; `.archivistpro` dosyasıyla dışa/içe aktarım |
| **Tamamen offline** | Dosyalarınız da, aramalarınız da makineden çıkmaz |

**Sistem gereksinimi:** Windows 10/11 (64-bit) · 4 GB RAM (8 GB önerilir) · 2 GB disk
**AI özellikleri için (opsiyonel):** [Ollama](https://ollama.com/download) + sohbet/görü modelleri. Kurmasanız da tarama, arama ve kopya bulma çalışır.

---

## Ekran görüntüleri

**Ana pencere** — kaynak klasörler, dosya ızgarası ve detay paneli
![Ana pencere](assets/ana-pencere.png)

**Arşive soru sorma** — belgelerin içeriğinden cevap üretir
![Arşive soru sorma](assets/sohbet.png)

**Harita** — konum bilgisi taşıyan fotoğraflar harita üzerinde
![Harita görünümü](assets/harita.png)

**Çoklu arşiv** — arşivler arasında geçiş
![Çoklu arşiv](assets/coklu-arsiv.png)

---

## Neden yazdım

Mimari ofislerin arşivleri on binlerce dosyaya ulaşıyor ve "şu projedeki cephe detayı neredeydi" sorusunun cevabı çoğu zaman kimsenin hatırlamadığı bir klasörde kalıyor. Piyasadaki çözümler ya bulut aboneliği istiyor ya da proje dosyalarını dışarı taşımayı gerektiriyor — ikisi de mimari arşivler için kabul edilebilir değil.

Bu yüzden her şeyin yerelde kaldığı, hiçbir aboneliğe bağlanmayan bir araç yazdım. Tek kişilik bir proje; geliştirme günlüğü, teknik borç listesi ve iç denetim raporları dahil süreç açıkta duruyor.

- **[Yol haritası](docs/ROADMAP.md)** — sırada ne var, ne bilinçli olarak ertelendi
- **[Geliştirme arşivi](docs/archive/)** — denetim raporları, planlar, oturum notları
- **[CHANGELOG](CHANGELOG.md)** — sürüm sürüm ne değişti

---

## Nasıl çalışıyor

**Tauri v2 (Rust)** + **React 19 (TypeScript)** + **SQLite**. Arayüz web teknolojileriyle yazıldı ama Electron değil — kurulum küçük, bellek tüketimi düşük. Dosya tarama, küçük resim üretimi ve kriptografi Rust tarafında; arama modelleri (metin ve görsel embedding) uygulamayla birlikte paketlenip cihazda çalışıyor.

Detaylar: **[Geliştirici rehberi](docs/DEVELOPER_GUIDE.md)** · **[Güvenlik profili](docs/GUVENLIK.md)** · **[Veri güvenliği](docs/VERI_GUVENLIGI.md)**

---

## Katkı ve destek

- **Sorun bildirin / öneride bulunun:** [Issues](https://github.com/ahmet3ddd/ArchivistPro/issues)
- **Katkı rehberi:** [CONTRIBUTING.md](CONTRIBUTING.md)
- **Güvenlik açığı bildirimi:** [SECURITY.md](SECURITY.md)
- **Uygulama içi yardım:** F1 tuşu veya sol alttaki **?** simgesi

Geri bildirim her seviyede değerli — hata raporu kadar "şu ekranı anlamadım" da işe yarıyor.

> Günlük geliştirme özel bir depoda yürüyor; bu depo yayınlanan sürümlerin kaynağını ve indirmelerini barındırır. Soru ve hata bildirimleri için doğru yer buradaki Issues bölümü.

---

## Lisans

[MIT](LICENSE) © 2026 Ahmet — dilediğiniz gibi kullanın, değiştirin, dağıtın.
