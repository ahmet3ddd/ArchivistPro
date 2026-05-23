# ArchivistPro — Kurulum Rehberi (Yeni Başlayanlar İçin)

> **Sürüm:** 3.0.0 | **Tarih:** 2026-05-23 | **Platform:** Windows 10/11 (64-bit)
>
> Bu rehber bilgisayarınıza ilk kez bir program kuruyorsanız ya da kurulum
> deneyiminiz az ise sizin içindir. Her adım ekran görüntüsüyle anlatılır;
> teknik terim yok, çok şey bilmenize gerek yok.
>
> Daha hızlı/teknik bir özet istiyorsanız:
> **[Profesyonel Kurulum Rehberi](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/KULLANICI_KURULUM_PRO.md)** dosyasına bakın.

---

## 1. Hazırlık

### 1.1. Bilgisayarınız uygun mu?

ArchivistPro'yu kurmadan önce bilgisayarınızın şu özelliklere sahip olup
olmadığını kontrol edin. Çoğu modern bilgisayar bu gereksinimleri rahatça
karşılar.

| Özellik | Olması gereken minimum | Önerilen |
|---|---|---|
| İşletim Sistemi | Windows 10 (64-bit) | Windows 11 (64-bit) |
| RAM (bellek) | 4 GB | 8 GB ve üzeri |
| Boş disk alanı | 2 GB | 5 GB ve üzeri |
| İşlemci (CPU) | x64 mimari (çoğu Intel / AMD) | 4 çekirdek ve üzeri |
| Ekran | 1366×768 piksel | 1920×1080 ve üzeri |

> **Bilgisayarımın özelliklerini nereden öğrenirim?**
>
> 1. Klavyeden `Windows tuşu + R` aynı anda basın.
> 2. Açılan küçük pencereye `msinfo32` yazın ve **Tamam** tıklayın.
> 3. "Sistem Özeti" altında işletim sistemi, işlemci ve RAM bilgileri görünür.

### 1.2. Yönetici hakkı

Programı kurmak için Windows'a **yönetici hesabıyla** giriş yapmış olmanız
gerekir. Şirket bilgisayarı kullanıyorsanız ve "yönetici izni gerekiyor"
uyarısı görüyorsanız, bilgi işlem birimine başvurun.

### 1.3. İnternet bağlantısı

Sadece **kurulum dosyasını indirmek için** internete ihtiyaç vardır.
Kurulum tamamlandıktan sonra ArchivistPro **internetsiz çalışır** —
dosyalarınız bilgisayarınızdan dışarı gönderilmez.

---

## 2. Kurulum Dosyasını İndirin

![GitHub Releases sayfası](img/install/github-releases.png)

1. İnternet tarayıcınızı (Chrome, Edge, Firefox) açın.
2. Şu adrese gidin:
   **https://github.com/ahmet3ddd/Arsiv-H2/releases/latest**
3. "**Assets**" başlığı altında dosyaları görürsünüz. Şu iki dosyadan
   **birini** seçip indirin:
   - **`ArchivistPro_3.0.0_x64_en-US.msi`** ← Önerilen
   - `ArchivistPro_3.0.0_x64-setup.exe` ← Alternatif

> **MSI ile EXE arasındaki fark:** İkisi de aynı programı kurar. MSI
> daha yaygın kullanılır ve şirket bilgisayarlarında daha kolay yönetilir.
> Hangisini indirdiğiniz fark etmez.

> **Tarayıcıdan uyarı gelirse:** "Bu dosya nadiren indirilir; emin misiniz?"
> tarzı bir uyarı görebilirsiniz. **Sakla** veya **İzin Ver** tıklayarak
> indirmeye devam edin.

---

## 3. Kurulumu Çalıştırın

![Kurulum sihirbazı](img/install/installer-wizard.png)

1. İndirdiğiniz dosyaya (`ArchivistPro_3.0.0_x64_en-US.msi`) **çift
   tıklayın**. Genelde **İndirilenler** klasöründe bulunur.
2. Windows size sorabilir: "*Bu uygulamanın PC'nizde değişiklik yapmasına
   izin vermek istiyor musunuz?*" → **Evet** seçin.
3. Açılan kurulum penceresinde:
   - **İleri** tıklayın
   - Lisans sözleşmesini okuyup **Kabul Ediyorum**, sonra **İleri**
   - Kurulum konumunu varsayılan bırakın (`C:\Program Files\ArchivistPro\`)
     ve **İleri**
   - **Yükle** tıklayın
4. Birkaç saniye bekleyin. "Kurulum tamamlandı" mesajı geldiğinde **Son**
   tıklayın.

> **SmartScreen uyarısı gelirse:** "Windows PC'nizi korudu" başlıklı mavi
> bir ekran çıkabilir. Bu uygulama dijital imza sürecinde olduğu için bu
> uyarı görülebilir. Şu adımı izleyin:
>
> 1. "**Daha fazla bilgi**" bağlantısına tıklayın.
> 2. "**Yine de çalıştır**" düğmesine tıklayın.

Kurulum bittikten sonra masaüstünde **ArchivistPro** simgesi belirir. Aynı
zamanda Başlat menüsünden de açabilirsiniz.

---

## 4. İlk Açılış — Kurulum Sihirbazı

![Kurulum sihirbazı 1. adım](img/install/wizard-step-1.png)

Programı ilk kez açtığınızda **5 adımlık bir kurulum sihirbazı** sizi
karşılar. Bu sadece bir kez gösterilir. Yaklaşık 3-5 dakika sürer.

### Adım 1 — Dil & Sistem Kontrolü

- Arayüz dilini seçin: **Türkçe** seçin (sonra **Ayarlar** üzerinden
  istediğiniz zaman değiştirebilirsiniz).
- Program donanımınızı otomatik olarak kontrol eder. Hata yoksa **İleri**
  tıklayın.

### Adım 2 — Donanım Tespiti

![Donanım tespiti](img/install/wizard-step-2.png)

- Program işlemcinizi ve belleğinizi inceler, performans düzeyinizi
  belirler:
  - **Düşük** — yavaş bilgisayarlar için, sınırlı AI özellikleri
  - **Orta** — günlük kullanım için iyi denge (önerilen)
  - **Yüksek** — hızlı bilgisayarlar için, tüm AI özellikleri aktif
- Programın önerisini bırakmanız genelde doğrudur. **İleri** tıklayın.

### Adım 3 — AI Kurulumu (İsteğe Bağlı)

ArchivistPro'nun **AI Sohbet** özelliği için yapay zekâ desteği gerekir.
Bu adımda 3 seçeneğiniz var:

| Seçenek | Avantajı | Dezavantajı |
|---|---|---|
| **Yerel AI (Ollama)** | Tamamen offline, gizli; bilgileriniz dışarı çıkmaz | Ollama programını ayrı kurmanız gerek |
| **Bulut AI** | Hızlı, kurulum gerekmez | İnternet gerekir, API anahtarı satın almak gerek |
| **Atla** | En kolay | AI özellikleri çalışmaz |

Tavsiye: **Yerel AI** seçin. Kurulum sihirbazı sizi
[ollama.com](https://ollama.com/download) adresine yönlendirir; Ollama'yı
indirip kurun. Sonra ArchivistPro'ya geri dönüp **"Tekrar Kontrol Et"**
tıklayın.

AI'yi şimdi atlamak isterseniz **Atla** seçin. Daha sonra **Ayarlar > AI**
menüsünden açabilirsiniz.

### Adım 4 — DWG Desteği (İsteğe Bağlı)

Eğer arşivinizde DWG (AutoCAD çizim) dosyaları varsa, **ODA File Converter**
adlı küçük bir yardımcı program kurmanız önerilir. Bu DWG dosyalarının
içeriğini (katmanlar, bloklar, metin) ArchivistPro'nun anlamasını sağlar.

- ODA kuruluysa otomatik tespit edilir → **İleri**
- Kurulu değilse "**İndir ve Kur**" tıklayın, ya da bu adımı atlayın

### Adım 5 — Özet & Hazır

![Sihirbaz son adım](img/install/wizard-step-5.png)

Seçtiğiniz ayarların özeti gösterilir. Hepsi doğruysa **Başla** tıklayın.

---

## 5. Yönetici Hesabı Oluşturma

![Yönetici hesabı oluşturma](img/install/admin-setup.png)

Sihirbazdan sonra **yönetici hesabı** oluşturma ekranı çıkar. Bu hesabı
**siz oluşturursunuz** — programda hazır bir kullanıcı adı/şifre **yoktur**.

1. **Kullanıcı adı** — Kendinize bir kullanıcı adı verin (örn. "ahmet"
   ya da "patron"). 3-32 karakter arası olmalı.
2. **Şifre** — Güçlü bir şifre belirleyin. Bunu unutmamanız önemli.
   - En az 6 karakter (12+ önerilir)
   - Harf + sayı karışık iyi olur
3. **Şifreyi onayla** — Aynı şifreyi tekrar yazın.
4. **Hesabı Oluştur** tıklayın.

> **Şifrenizi unutursanız ne olur?** Program otomatik olarak bir
> "kurtarma anahtarı" oluşturup şu konuma kaydeder:
> `C:\Users\<KullanıcıAdı>\AppData\Roaming\com.archivistpro.desktop\recovery.key`
>
> Bu dosyayı güvenli bir yerde **yedekleyin** (USB belleğe kopyalayın ya
> da kişisel e-postanıza ekleyin). Şifrenizi unutursanız bu dosyadan
> sıfırlayabilirsiniz.

---

## 6. İlk Dosyalarınızı Ekleyin

Program açılınca boş bir ekran görürsünüz. Arşivinize dosya eklemek için:

![Klasör tarama butonu](img/install/scan-folder-button.png)

1. Sol panelde **"Klasör Tara ve İndeksle"** butonuna tıklayın.
2. Mimari dosyalarınızın bulunduğu klasörü seçin (örn. `D:\Projeler`).
3. **"Taramayı Başlat"** tıklayın.
4. Tarama otomatik başlar — ekranda ilerleme çubuğu görünür. Süre
   klasördeki dosya sayısına göre değişir (1000 dosya ~5 dakika).

![Tarama ilerleme](img/install/scan-progress.png)

Tarama bittiğinde dosyalarınız ana ekrandaki listede görünür. Şimdi
aramaya, etiketlemeye, sıralamaya başlayabilirsiniz.

---

## 7. Sık Sorulanlar (SSS)

### Eski bir sürümden v3.0.0'a geçtim, dosyalarıma ne olacak?

Programı ilk açtığınızda eski arşiviniz **otomatik olarak yeni V3
mimarisine taşınır**. Bu birkaç saniye sürer. Verileriniz güvende —
geriye dönüş için yedek dosya (`archivist_premigrate_v3.db.bak`)
otomatik tutulur.

### Programı internetsiz kullanabilir miyim?

Evet. Kurulum dışında internet **gerekmez**. AI özellikleri için Yerel AI
(Ollama) seçtiyseniz tamamen offline çalışır. Bulut AI seçtiyseniz
sadece o özellik için internet gerekir.

### Dosyalarımı başka bir bilgisayara taşıyabilir miyim?

Evet. Programın **Ayarlar > Ağ > Dışa Aktar / Rapor** menüsünden
arşivinizi `.archivistpro` formatında dışa aktarabilirsiniz. Bu dosyayı
yeni bilgisayara taşıyıp **"Import (.archivistpro)"** ile içe
aktarabilirsiniz.

### Yedekleme nasıl çalışır?

Program her tarama öncesi otomatik yedek alır (son 5 yedek tutulur).
**Ayarlar > Depolama** menüsünden elle yedek almak ve geri yüklemek
mümkündür. v3.0.0 sonrası yedekler hem `archivist.db` hem
`archivist_vec.db` dosyalarını **birlikte** yedekler.

### Kurulum hata verdi, ne yapayım?

1. İndirdiğiniz dosyayı sağ tıklayın → **Özellikler** → "**Engellemeyi
   Kaldır**" işaretini bulup işaretleyin → **Tamam**.
2. Tekrar çift tıklayıp kurmayı deneyin.
3. Hâlâ çalışmıyorsa antivirüs programınız engellemiş olabilir; antivirüse
   ArchivistPro'yu istisna olarak ekleyin.
4. Sorun devam ederse GitHub Issues sayfasına yazın:
   https://github.com/ahmet3ddd/Arsiv-H2/issues

### Programı kaldırmak istiyorum, nasıl?

Windows **Ayarlar > Uygulamalar > Yüklü uygulamalar** menüsünden
"**ArchivistPro**"yu bulun → **Kaldır**. Veriler şu klasörde kalır
(silmek için elle silebilirsiniz):
`C:\Users\<KullanıcıAdı>\AppData\Roaming\com.archivistpro.desktop\`

---

## 8. Daha Fazla Bilgi

- **Uygulama içinde:** **F1** tuşuna basın veya sol alttaki **? Yardım**
  ikonuna tıklayın. 4 sekme bulacaksınız: Kullanım Kılavuzu, Yönetici
  Kılavuzu (yetkiniz varsa), Ne Yapabilirim?, Sürüm Notları.
- **Profesyonel kurulum:** Sessiz kurulum, ağ deployment, ortam
  değişkenleri vb. için [Profesyonel Kurulum Rehberi](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/KULLANICI_KURULUM_PRO.md)
- **Sürüm değişiklikleri:** [CHANGELOG.md](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/CHANGELOG.md) · [Tüm dağıtım dosyaları](https://github.com/ahmet3ddd/ArchivistPro/releases/tag/v3.0.0)

İyi çalışmalar! 🎯

---

*Bu rehber program geliştikçe güncellenir. Son güncelleme: 2026-05-23 (v3.0.0).*
