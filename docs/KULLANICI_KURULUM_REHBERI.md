# ArchivistPro — Son Kullanıcı Kurulum Rehberi

**Sürüm:** 2.2.1 | **Platform:** Windows 10/11 (64-bit)

---

## 1. Sistem Gereksinimleri

| Gereksinim | Minimum | Önerilen |
|---|---|---|
| İşletim Sistemi | Windows 10 (64-bit) | Windows 11 (64-bit) |
| RAM | 4 GB | 8 GB+ |
| Disk Alanı | 2 GB boş alan | 5 GB+ |
| İşlemci | x64 uyumlu herhangi bir CPU | 4+ çekirdek |

> Node.js, Rust veya başka bir geliştirici aracı **gerekmez** — yalnızca Windows kurulumu yeterlidir.

---

## 2. Kurulum Dosyasını İndirin

- GitHub Releases sayfasına gidin: `https://github.com/ahmet3ddd/Arsiv-H2/releases/latest`
- **`ArchivistPro_*_x64_en-US.msi`** (MSI, önerilen) veya **`ArchivistPro_*_x64-setup.exe`** (EXE) dosyasını indirin.

> `.sig` uzantılı dosyaları indirmenize gerek yoktur; bunlar otomatik güncelleme doğrulaması içindir.

---

## 3. Kurulumu Çalıştırın

1. İndirilen `.msi` veya `.exe` dosyasına çift tıklayın.
2. Windows'un "Bu uygulamanın PC'nizde değişiklik yapmasına izin vermek istiyor musunuz?" sorusuna **Evet** deyin.
3. Sihirbazı takip ederek **İleri → Yükle → Son** adımlarını tamamlayın.
4. Kurulum tamamlandığında ArchivistPro masaüstü kısayolundan veya Başlat menüsünden açılır.

> **SmartScreen uyarısı alırsanız:** "Daha fazla bilgi" → "Yine de çalıştır" seçeneğine tıklayın. Bu uyarı kod imzalama sertifikası henüz aktif olmadığı için görünmektedir; uygulama güvenlidir.

---

## 4. İlk Çalıştırma — Kurulum Sihirbazı (5 Adım)

Uygulama ilk kez açıldığında **tek seferlik** bir kurulum sihirbazı çalışır (~5 dakika).

### Adım 1 — Dil & Sistem Kontrolü
- Arayüz dilini seçin: **Türkçe** veya **English**.
- Uygulama donanımınızı ve Windows sürümünüzü otomatik olarak kontrol eder.

### Adım 2 — Donanım Tespiti
- CPU, RAM ve performans ölçümü yapılarak AI için uygun donanım seviyesi belirlenir.
- Belirlenen seviyeyi (Düşük / Orta / Yüksek) kendiniz de değiştirebilirsiniz.

### Adım 3 — AI Kurulumu *(isteğe bağlı)*
- Bilgisayarınızda **Ollama** çalışıyorsa otomatik tespit edilir ve yerel AI etkinleştirilir.
- Ollama yüklü değilse bu adımı atlayabilirsiniz; AI özellikleri olmadan uygulama tam çalışır.

### Adım 4 — DWG Desteği *(isteğe bağlı)*
- **ODA FileConverter** kuruluysa otomatik tespit edilir ve gelişmiş DWG önizlemesi etkinleştirilir.
- Kurulu değilse sihirbaz üzerinden tek tıkla kurabilir ya da bu adımı atlayabilirsiniz.

### Adım 5 — Özet & Hazır
- Seçilen ayarların özeti gösterilir; her şey doğruysa **Başla** düğmesine tıklayın.

---

## 5. İlk Giriş — Yönetici Hesabı Oluşturma

Sihirbazdan sonra, kullanıcı veritabanı boş olduğu için **ilk yönetici hesabı** oluşturma ekranı açılır.

1. Bir **kullanıcı adı** girin.
2. Bir **şifre** belirleyin (en az 6 karakter).
3. Şifreyi onaylayın ve **Hesabı Oluştur** düğmesine tıklayın.
4. Oluşturulan kimlik bilgileriyle giriş yapın.

> Şifrenizi unutmanız durumunda kurtarma anahtarı otomatik olarak şu konuma kaydedilir:
> `C:\Users\<KullanıcıAdı>\AppData\Roaming\com.archivistpro.desktop\recovery.key`

---

## 6. İlk Kullanım — Klasör Tarama

Giriş yaptıktan sonra uygulamayı kullanmaya hazırsınız:

1. Sol paneldeki **Tara** düğmesine tıklayın.
2. Arşivlemek istediğiniz klasörü seçin (DWG, RVT, MAX, IFC, PDF vb. içeren).
3. Tarama tamamlandığında dosyalar otomatik olarak dizine eklenir ve önizlemeler oluşturulur.

---

## 7. İsteğe Bağlı: Ollama Kurulumu (AI Özellikleri)

AI destekli arama ve OCR özelliklerini kullanmak istiyorsanız:

1. `https://ollama.com` adresinden Ollama'yı indirin ve kurun.
2. Komut satırını açın ve bir görüntü modeli yükleyin:
   ```
   ollama pull llava
   ```
3. Ollama arka planda çalışırken ArchivistPro'yu yeniden başlatın; AI özellikleri otomatik aktif olur.

> Ollama kurulu olmadan uygulama **tam işlevsel** çalışmaya devam eder; yalnızca LLM tabanlı arama ve OCR devre dışı kalır.

> **Not:** Görsel benzerlik araması (CLIP) ek kurulum gerektirmez. İlk taramada AI modeli (~87 MB) otomatik indirilir ve sonraki kullanımlarda önbellekten yüklenir. Bu özellik Ollama'dan bağımsız çalışır.

---

## 8. İsteğe Bağlı: ODA FileConverter Kurulumu (Gelişmiş DWG)

DWG dosyalarından daha kaliteli önizleme ve metadata almak istiyorsanız:

1. `https://dl.opendesign.com` adresinden ODA FileConverter'ı indirin.
2. İndirilen kurulum dosyasını çalıştırın ve tamamlayın.
3. ArchivistPro'yu yeniden başlatın; DWG desteği otomatik tespit edilir.

> Bu adım tamamen isteğe bağlıdır; ArchivistPro yerleşik DWG okuyucusuyla da çalışır.

---

## 9. Otomatik Güncellemeler

- Yeni bir sürüm yayınlandığında uygulama sizi bildirim ile uyarır.
- **Ayarlar → Güncellemeler** bölümünden güncel sürümü manuel olarak da kontrol edebilirsiniz.
- Güncelleme indirildikten sonra uygulamayı yeniden başlatmanız yeterlidir.

---

## 10. Sorun Giderme

| Sorun | Çözüm |
|---|---|
| Uygulama açılmıyor | Antivirüs yazılımının ArchivistPro'yu engellediğini kontrol edin; gerekirse istisna ekleyin. |
| SmartScreen uyarısı | "Daha fazla bilgi" → "Yine de çalıştır" seçeneğini kullanın. |
| DWG önizlemesi yok | ODA FileConverter kurulumunu kontrol edin (Adım 8). |
| AI özellikleri çalışmıyor | Ollama'nın arka planda çalıştığından emin olun (`ollama serve`). |
| Şifremi unuttum | `%APPDATA%\com.archivistpro.desktop\recovery.key` dosyasını kullanın. |
| Tarama çok yavaş | Tarama sırasında diğer ağır programları kapatın; RAM artırımı performansı iyileştirir. |

---

*Geliştirici belgelerine ulaşmak için `docs/DEVELOPER_GUIDE.md` dosyasına bakın.*
