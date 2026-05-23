# Archivist Pro — Kurulum Rehberi

Bu rehber Archivist Pro'yu geliştirme ortamında kurmak ve çalıştırmak için gereken adımları açıklar.

## Sistem Gereksinimleri

| Gereksinim | Minimum |
|------------|---------|
| İşletim Sistemi | Windows 10 (64-bit) |
| Node.js | 20+ |
| Rust | 1.77.2+ |
| Tauri CLI | 2.x |
| RAM | 4 GB (AI özellikler için 8 GB+) |
| Disk | ~2 GB (bağımlılıklar dahil) |

## 1. Ön Gereksinim Kurulumu

### Node.js

[Node.js 20+](https://nodejs.org/) indirin ve kurun. Kurulumu doğrulayın:

```bash
node --version   # v20.x.x veya üzeri
npm --version    # 10.x.x veya üzeri
```

### Rust

[rustup](https://rustup.rs/) ile Rust kurun:

```bash
# rustup kurulumu (Windows installer veya shell)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Doğrulama
rustc --version   # 1.77.2 veya üzeri
cargo --version
```

### Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### Windows Build Gereksinimleri

Tauri, Windows'ta C++ build tools gerektirir. [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) kurulu değilse:

1. Visual Studio Build Tools'u indirin
2. "Desktop development with C++" iş yükünü seçin
3. Kurulumu tamamlayın

## 2. Proje Kurulumu

```bash
# Repoyu klonla
git clone <repo-url>
cd Arsiv-H2

# Bağımlılıkları kur
npm install
```

`npm install` çalıştığında `postinstall` scripti otomatik olarak `sql-wasm.wasm` dosyasını `public/` dizinine kopyalar. Bu dosya WASM SQLite veritabanı için gereklidir.

## 3. Geliştirme

### Web Modu (Yalnızca Frontend)

```bash
npm run dev
```

Tarayıcıda `http://localhost:5173` adresinde açılır. Rust backend'e erişim gerektiren özellikler (thumbnail, dosya tarama vb.) mock servisle çalışır.

### Tauri Native Modu

```bash
npm run tauri dev
```

Hem frontend hem Rust backend'i derleyip native pencerede açar. İlk çalıştırmada Rust derleme birkaç dakika sürebilir.

> **Not:** İlk çalıştırmada **iki** ön ekran görünür:
> 1. **Kurulum Sihirbazı** — Sistem kontrolü, donanım tespiti, AI yapılandırması ve dil seçimi (4 adım). Bir kez tamamlandıktan sonra tekrar gösterilmez.
> 2. **İlk Admin Kurulumu** — Hiç kullanıcı yoksa login ekranı yerine `FirstRunSetup` açılır; ilk admin hesabı burada oluşturulur. Hardcoded admin/admin parolası yoktur.
>
> Şifreni unutursan: `%APPDATA%\com.archivistpro.desktop\recovery.key` dosyasını giriş ekranındaki "Şifremi Unuttum" akışında kullan.

### Rol Modları

Uygulama iki rol modunda çalışabilir:

```bash
# Admin modu (varsayılan) — tüm özellikler aktif
npm run dev:admin

# Viewer modu — salt okunur, sınırlı erişim
npm run dev:viewer
```

Rol modu `VITE_APP_ROLE` ortam değişkeni ile belirlenir. Vite mode dosyaları (`.env.admin`, `.env.viewer`) bu değişkeni ayarlar.

## 4. Ortam Değişkenleri

| Değişken | Değerler | Açıklama |
|----------|----------|----------|
| `VITE_APP_ROLE` | `admin` \| `viewer` | Uygulama rolü (varsayılan: admin) |

Ortam değişkenleri `.env` dosyasında veya Vite mode dosyalarında (`.env.admin`, `.env.viewer`) tanımlanabilir.

## 5. Production Build

### Web Build

```bash
npm run build
```

Çıktı `dist/` dizinine yazılır.

### Tauri Installer

```bash
npm run tauri build
```

Windows installer (`.msi` ve `.exe`) `src-tauri/target/release/bundle/` altında oluşturulur.

## 6. Opsiyonel: Ollama Kurulumu (AI Özellikleri)

Archivist Pro, AI özellikleri (DWG doğal dil araması, query expansion) için yerel Ollama sunucusu kullanır.

1. [Ollama](https://ollama.ai/) indirin ve kurun
2. Bir model çekin:
   ```bash
   ollama pull llama3.2
   ```
3. Ollama sunucusunun çalıştığını doğrulayın:
   ```bash
   curl http://localhost:11434/api/tags
   ```
4. Uygulamada Ayarlar > AI Yapılandırma'dan Ollama bağlantısını yapın

> **İpucu:** İlk çalıştırma sihirbazı Ollama'yı otomatik tespit eder. Eğer Ollama kuruluysa ve çalışıyorsa, sihirbaz mevcut vision modelleri listeler ve "Yerel AI" seçeneğini önerir.

CLIP görsel arama ve embedding özellikleri tarayıcıda ONNX Runtime WASM ile çalışır, ek kurulum gerektirmez.

## 7. Testleri Çalıştırma

### Birim Testleri

```bash
# Tüm testleri çalıştır (617 test, 35 dosya)
npm run test

# İzleme modunda
npm run test -- --watch

# Tek dosya
npm run test -- src/tests/database.test.ts
```

### Rust Testleri

```bash
cd src-tauri
cargo test --features admin
```

### E2E Testleri

```bash
npm run test:e2e
```

## 8. Sorun Giderme

### `sql-wasm.wasm bulunamadı` hatası

`postinstall` scripti çalışmamış olabilir:

```bash
node -e "const fs=require('fs');fs.copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm','public/sql-wasm.wasm');"
```

### Rust derleme hatası: `linker not found`

Visual Studio Build Tools kurulu değil. Yukarıdaki "Windows Build Gereksinimleri" bölümüne bakın.

### `npm run tauri dev` bağlantı hatası

Vite dev sunucusu başlamadan Tauri penceresi açılıyor olabilir. Önce ayrı terminalde `npm run dev` çalıştırıp ardından `npm run tauri dev` deneyin.

### Ollama bağlantı hatası

Ollama sunucusunun çalıştığından emin olun:

```bash
ollama serve    # Sunucuyu başlat
ollama list     # Kurulu modelleri listele
```

Varsayılan port `11434`'tür. Farklı port kullanıyorsanız uygulamada AI ayarlarından güncelleyin.

### WASM bellek hatası (büyük veritabanları)

Çok sayıda dosya taratan büyük arşivlerde tarayıcı bellek sınırına ulaşılabilir. Tauri native modunda çalıştırmak bu sorunu hafifletir.
