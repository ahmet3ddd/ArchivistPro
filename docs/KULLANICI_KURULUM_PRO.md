# ArchivistPro — Kurulum Rehberi (Profesyonel / Sistem Yöneticisi)

> **Sürüm:** 3.0.0 | **Tarih:** 2026-05-23 | **Platform:** Windows 10/11 (64-bit)
>
> Bu rehber sistem yöneticileri, BT profesyonelleri ve çoklu istasyon
> dağıtımı yapanlar içindir. Sessiz kurulum, ağ üzerinden dağıtım, ortam
> değişkenleri ve dosya konumları kapsanır.
>
> Yeni başlayan kullanıcı rehberi için:
> **[Acemi Kurulum Rehberi](https://github.com/ahmet3ddd/ArchivistPro/releases/download/v3.0.0/KULLANICI_KURULUM_ACEMI.md)**

---

## 1. Sistem Gereksinimleri

| Gereksinim | Minimum | Önerilen | Sınırlama |
|---|---|---|---|
| OS | Windows 10 1809+ (64-bit) | Windows 11 22H2+ | x86/ARM desteklenmez |
| CPU | x64 (SSE4.2) | 4+ core, AVX2 | — |
| RAM | 4 GB | 8 GB+ (AI için 16 GB) | sql.js DB tamamen RAM'e yüklenir |
| Disk | 2 GB | 5 GB+ SSD | NVMe önerilir (paralel tarama) |
| WebView2 | Edge runtime gömülü | — | MSI'da `offlineInstaller` modu |
| GPU (opsiyonel) | — | WebGPU destekleyen | Embedding hızı 5-10× artar |

### Bağımlılıklar

- **WebView2 Runtime** — MSI içinde `offlineInstaller` modu ile gömülüdür,
  ayrı kurulum gerekmez (`tauri.conf.json` → `windows.webviewInstallMode`).
- **VC++ Redistributable** — Tauri runtime'ın gerektirdiği DLL'ler MSI
  ile bundle edilir.
- **Ollama** (opsiyonel) — AI Sohbet için gerekli; `https://ollama.com`'dan
  veya silent: `winget install Ollama.Ollama --silent`.
- **ODA File Converter** (opsiyonel) — DWG ileri seviye metadata için;
  uygulama içinden tek tıkla kurulabilir.

---

## 2. Sessiz Kurulum (Silent Install)

### MSI ile

```cmd
:: Default kurulum, log dosyasına yaz
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet /norestart /log install.log

:: Özel hedef konumla
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi INSTALLDIR="D:\Apps\ArchivistPro" /quiet

:: Tüm kullanıcılar için kur (per-machine)
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi ALLUSERS=1 /quiet

:: Geri yükleme (rollback) test için
msiexec /i ArchivistPro_3.0.0_x64_en-US.msi /quiet REBOOT=ReallySuppress
```

### NSIS (.exe) ile

```cmd
:: Sessiz kurulum
ArchivistPro_3.0.0_x64-setup.exe /S

:: Özel hedef
ArchivistPro_3.0.0_x64-setup.exe /S /D=C:\Apps\ArchivistPro
```

> **Not:** NSIS sürüm `/D=` parametresi argüman listesinin **en sonunda**
> ve **tırnak içinde olmadan** verilmelidir (NSIS gereği).

### MSI Parametreleri

| Parametre | Anlamı | Default |
|---|---|---|
| `/quiet` veya `/qn` | Tamamen sessiz, UI yok | — |
| `/passive` veya `/qb` | İlerleme çubuğu göster, etkileşim yok | — |
| `/norestart` | Reboot tetikleme | — |
| `/log <path>` | Detaylı log yaz | — |
| `INSTALLDIR=<path>` | Kurulum hedef klasör | `C:\Program Files\ArchivistPro` |
| `ALLUSERS=1` | Per-machine kurulum | per-user |

---

## 3. Dağıtım Yöntemleri

### 3.1. Group Policy (GPO)

Active Directory ortamında çoklu makineye dağıtım için:

1. MSI dosyasını ağ paylaşım klasörüne kopyalayın
   (`\\fileserver\deploy\ArchivistPro\`).
2. **Group Policy Management** → ilgili OU → **Computer Configuration →
   Policies → Software Settings → Software Installation** → Yeni paket.
3. Paket türü: **Assigned** seçin (otomatik kurulum).
4. UNC yolu girin: `\\fileserver\deploy\ArchivistPro\ArchivistPro_3.0.0_x64_en-US.msi`.
5. Hedef OU'daki bilgisayarlar restart sonrası otomatik kurulum yapar.

### 3.2. Intune / MEM (Microsoft Endpoint Manager)

1. Intune Console → **Apps → Windows → Add** → **Line-of-business app**.
2. MSI dosyasını yükleyin.
3. Atama: gerekli kullanıcı grubu / cihaz grubu seçin.

### 3.3. PSExec / RemoteSigning

```powershell
# Tek satır, ağ üzerinden
$cred = Get-Credential
Invoke-Command -ComputerName PC01,PC02,PC03 -Credential $cred -ScriptBlock {
    Start-Process msiexec.exe -ArgumentList '/i \\fileserver\deploy\ArchivistPro_3.0.0.msi /quiet' -Wait
}
```

### 3.4. Chocolatey / Winget (Gelecek)

> Şu an Chocolatey ve Winget paketleri yayında değildir. v3.x sürecinde
> eklenmesi planlanıyor.

---

## 4. Dosya Konumları

### Kurulum (read-only)

| Konum | İçerik |
|---|---|
| `%ProgramFiles%\ArchivistPro\` | Uygulama binary + WebView2 + locales |
| `%ProgramFiles%\ArchivistPro\ArchivistPro.exe` | Ana yürütülebilir |
| `%ProgramFiles%\ArchivistPro\resources\` | Bundled AI modelleri, ikonlar |

### Kullanıcı Verisi (read/write — kullanıcı başına)

| Konum | İçerik |
|---|---|
| `%APPDATA%\com.archivistpro.desktop\` | Ana veri klasörü |
| `%APPDATA%\com.archivistpro.desktop\archivist.db` | Ana DB (metadata, etiketler) |
| `%APPDATA%\com.archivistpro.desktop\archivist_vec.db` | Vektör DB (v3.0.0+) |
| `%APPDATA%\com.archivistpro.desktop\archivist_local.db` | Yerel arşiv |
| `%APPDATA%\com.archivistpro.desktop\recovery.key` | Şifre kurtarma anahtarı |
| `%APPDATA%\com.archivistpro.desktop\backups\` | Otomatik DB snapshot'lar (son 5) |
| `%APPDATA%\com.archivistpro.desktop\backups-local\` | Yerel DB snapshot'lar |
| `%APPDATA%\com.archivistpro.desktop\logs\` | System log dosyaları (7 gün rotasyon) |
| `%LOCALAPPDATA%\com.archivistpro.desktop\` | Cache, oturum verisi (WebView2) |

### Kayıt Defteri (Registry)

| Yol | İçerik |
|---|---|
| `HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\com.archivistpro.desktop` | Uninstall bilgileri (MSI) |
| `HKCU\Software\ArchivistPro\` | (kullanılmıyor — tüm config DB'de) |

---

## 5. Ortam Değişkenleri (Environment Variables)

ArchivistPro davranışı şu ortam değişkenleri ile değiştirilebilir
(çoğu opsiyonel, default'lar üretim için optimal):

| Değişken | Değerler | Default | Açıklama |
|---|---|---|---|
| `ARCHIVIST_DB_JOURNAL` | `wal` / `delete` | `wal` | SQLite journal modu. UNC ağ paylaşımı tespit edilirse otomatik DELETE'e düşer. |
| `ARCHIVIST_V3_EPOCH` | `on` / `off` | `on` | V3 mimari aktif/pasif. localStorage flag — yalnız uygulama içi setIte ile değiştirilir. |
| `RUST_LOG` | `info` / `debug` / `trace` | (yok) | Rust tarafı log seviyesi. `debug` ileri analiz için. |
| `ARCHIVIST_DATA_DIR` | Tam yol | `%APPDATA%\com.archivistpro.desktop` | Veri klasörünü taşıma (test/portable mod). |

### Örnekler

```cmd
:: Ağ paylaşımında çalışırken WAL'i kapatmak için
setx ARCHIVIST_DB_JOURNAL delete

:: Detaylı log için
setx RUST_LOG debug

:: Veri klasörünü D: sürücüsüne taşımak için
setx ARCHIVIST_DATA_DIR "D:\ArchivistData"
```

---

## 6. Ağ ve Güvenlik

### 6.1. Açık Portlar

| Port | Yön | Kullanım | Default |
|---|---|---|---|
| 9471 | Inbound (admin) / Outbound (viewer) | LAN mini HTTP sunucu (arşiv paylaşımı) | Kapalı (admin başlatınca açılır) |
| 11434 | Outbound (localhost) | Ollama API (AI Sohbet için) | Yalnız localhost |

Firewall kuralı (yalnız LAN sunucu kullanılacaksa):

```cmd
netsh advfirewall firewall add rule name="ArchivistPro LAN" ^
  dir=in action=allow protocol=TCP localport=9471 remoteip=LocalSubnet
```

### 6.2. Antivirüs Whitelist

Bazı kurumsal antivirüsler ArchivistPro'nun dosya tarama davranışını
şüpheli görebilir (kısa sürede çok dosya açar). Önerilen istisna:

- **Klasör:** `C:\Program Files\ArchivistPro\`
- **İşlem:** `ArchivistPro.exe`
- **Klasör (veri):** `%APPDATA%\com.archivistpro.desktop\`

### 6.3. CSP (Content Security Policy)

Uygulama içi CSP `default-src 'self'` esaslı, sıkı yapılandırılmış. Ağ
çağrıları yalnız şu hedeflere izinli:

- `http://localhost:11434` (Ollama API)
- `http://localhost:9471` (LAN sunucu)
- `https://asset.localhost` (Tauri asset protocol)

External CDN'lere, tracking sunucularına, telemetriye çağrı yoktur.

### 6.4. Tauri Capabilities

`src-tauri/capabilities/*.json` dosyaları izin verilen Rust komutlarını
tanımlar:

- `desktop.json` — masaüstü-özel komutlar
- `viewer.json` — viewer rolünün erişebileceği komut subset'i
- `admin.json` — admin rolüne özel komutlar

Build-time'da rol bazlı izole exe üretimi yapılır (`--mode admin` /
`--mode viewer`) — admin komutları viewer binary'sinde fiziksel olarak
bulunmaz.

---

## 7. V3 Migration (3.0.0 Yeni)

v2.4.x'ten v3.0.0'a geçerken arşiv otomatik olarak V3 şemasına taşınır.

### 7.1. Akış

1. Uygulama açılır.
2. `PRAGMA user_version` okunur; `< 3` ise migration tetiklenir.
3. `archivist_premigrate_v3.db.bak` adıyla yedek oluşturulur.
4. Aşamalı migration: epoch 0 → 1 (embeddings) → 2 (text_chunks + FTS) →
   3 (asset_relations).
5. Her aşama verify ile doğrulanır (round-trip).
6. Finalize: Rust tarafında `DROP × 3 + VACUUM + user_version = 3`
   atomik.
7. `reloadDatabase` ile uygulama frontend yeni state'e geçer.

### 7.2. Manuel Tetik (Admin)

**Ayarlar → Depolama → V3 Şema Migrasyonu** paneli ile manuel
tetiklenebilir. Otomatik migration kullanıcıya zincirde bırakılmaz —
admin kontrolü tercih edilirse `ARCHIVIST_V3_EPOCH=off` ile otomatik
tetik kapatılabilir, sonra panel üzerinden manuel başlatılır.

### 7.3. Toplu Dağıtım — Migration Stratejisi

Eski sürümleri merkezi olarak yöneten yönetici için:

1. **Test grubu:** İlk 1-2 makinede manuel migration test edin.
2. **Yaygınlaştırma:** Test başarılıysa otomatik migration default'a
   bırakılabilir (kullanıcı için fark yok, ilk açılışta çalışır).
3. **Yedekleme:** Migration öncesi tüm `%APPDATA%\com.archivistpro.desktop\`
   klasörlerini ağ paylaşımına kopyalayan PowerShell script önerilir:

```powershell
$users = Get-ChildItem "C:\Users" -Directory
foreach ($u in $users) {
    $src = "C:\Users\$($u.Name)\AppData\Roaming\com.archivistpro.desktop"
    if (Test-Path $src) {
        $dst = "\\backupserver\archivistpro-pre-v3\$($u.Name)\$(Get-Date -Format 'yyyyMMdd')"
        New-Item -ItemType Directory -Path $dst -Force | Out-Null
        Copy-Item $src $dst -Recurse -Force
    }
}
```

### 7.4. Rollback

Migration sonrası bir sorun fark edilirse:

```cmd
:: Uygulamayı kapatın, sonra
cd %APPDATA%\com.archivistpro.desktop
ren archivist.db archivist_v3_attempt.db
ren archivist_vec.db archivist_vec_attempt.db
ren archivist_premigrate_v3.db.bak archivist.db
:: Uygulamayı açın — eski (epoch=0) sürümünde geri açılır
```

---

## 8. Performans Tuning

### 8.1. Tarama (Scan) Çalışan Sayısı

`Ayarlar → Depolama → Çoklu Çekirdek Tarama` ile ayarlanır.

| Depolama | Önerilen Çalışan |
|---|---|
| HDD | 1-2 |
| SATA SSD | 3-4 |
| NVMe (≤8 cores) | 6-8 |
| NVMe (≥16 cores) | 10-16 |

Default değer ilk açılışta donanım otomatik algılanarak belirlenir.

### 8.2. AI (Embedding) — WebGPU vs WASM

WebGPU destekleyen GPU'larda embedding 5-10× hızlanır. Tarayıcı otomatik
seçer; manuel zorlama için `Ayarlar → AI → Backend`.

### 8.3. Disk I/O

- Ana DB ve vec.db **aynı SSD'de** olmalı — farklı disklere bölmek
  ortak yazma kilidini bozar.
- Antivirüs anlık tarama `archivist.db` ve `archivist_vec.db` üzerinde
  performansı düşürür — istisna listesine eklemek önerilir.

---

## 9. Monitoring ve Sorun Giderme

### 9.1. Log Konumları

```
%APPDATA%\com.archivistpro.desktop\logs\
├── system.log          (current — Rust tracing)
├── system.log.1        (önceki gün)
├── ...
└── system.log.6        (7 gün önce — sonra rotasyon)
```

Uygulama içi audit log:
**Ayarlar → Loglar → Audit Log Görüntüleyici**

### 9.2. Crash Reports

```
%APPDATA%\com.archivistpro.desktop\crashes\
└── crash_<timestamp>.txt
```

Yalnızca admin kullanıcı erişebilir
(**Ayarlar → Geliştirici → Crash Raporları**).

### 9.3. Sık Görülen Sorunlar

| Belirti | Olası Sebep | Çözüm |
|---|---|---|
| MSI kurulumda "1603" hatası | WebView2 runtime eksik veya bozuk | Microsoft'tan WebView2 manuel kur, sonra MSI'ı tekrar dene |
| İlk açılışta "DB error" | Eski sürümden bozuk DB | `recovery.key` ile yedek geri yükle ya da DB'yi yeniden oluştur |
| AI Sohbet "Ollama bulunamadı" | Ollama servisi kapalı | `ollama serve` çalıştır veya AI Ayarları'ndan **Başlat** |
| Tarama çok yavaş | HDD + yüksek çalışan sayısı | Çalışanları 1-2'ye düşür |
| `disk-write-failed` | Disk dolu veya yetki yok | `%APPDATA%`'a yazma yetkisi + boş alan kontrolü |
| UNC arşivde DB kilit hatası | WAL ağda güvensiz | `ARCHIVIST_DB_JOURNAL=delete` zorla |

---

## 10. Kaldırma (Uninstall)

### Tek Makine

```cmd
:: MSI ile kuruldu ise
wmic product where name="ArchivistPro" call uninstall /nointeractive

:: Veya GUID ile (msiexec)
msiexec /x {ARCHIVISTPRO-PRODUCT-GUID} /quiet /norestart
```

### Kullanıcı Verisinin Silinmesi

Uninstall **kullanıcı verisini silmez** — kasıtlı olarak veri kaybı
önlenir. Tam temizlik için:

```cmd
rmdir /s /q "%APPDATA%\com.archivistpro.desktop"
rmdir /s /q "%LOCALAPPDATA%\com.archivistpro.desktop"
```

### Toplu Kaldırma (GPO ile)

1. Group Policy → Software Installation paketini **Remove** olarak
   atayın.
2. Hedef makineler restart sonrası otomatik kaldırır.

---

## 11. Sürüm Yönetimi ve Güncelleme

### Otomatik Güncelleme

> v3.0.0 ile birlikte uygulama içi otomatik güncelleyici **planlama
> aşamasındadır**. Şu an manuel güncelleme yapılır.

### Manuel Güncelleme

1. Yeni MSI dosyasını GitHub Release'den indirin.
2. Mevcut MSI'ı kaldırmadan üzerine kurun — MSI in-place upgrade
   destekler, kullanıcı verisi korunur.
3. İlk açılışta varsa yeni migration otomatik çalışır.

---

## 12. Lisans ve Yasal

- **Lisans:** MIT (bkz. repo kökündeki `LICENSE`)
- **Kaynak kod:** https://github.com/ahmet3ddd/Arsiv-H2
- **Sorumluluk:** Yazılım "olduğu gibi" sağlanır, herhangi bir garanti
  yoktur. Üretim ortamında dağıtmadan önce test grubuyla doğrulayın.
- **Telemetri:** Yok. Kullanım verisi toplamaz, herhangi bir sunucuya
  veri göndermez.

---

## 13. Destek ve Geri Bildirim

- **GitHub Issues:** https://github.com/ahmet3ddd/Arsiv-H2/issues
- **Uygulama içi:** **Ayarlar → Geliştirici → "Geliştiriciye Bildir"**
  (crash dump otomatik eklenir, isteğe bağlı).

---

*Bu rehber program geliştikçe güncellenir. Son güncelleme: 2026-05-23 (v3.0.0).*
