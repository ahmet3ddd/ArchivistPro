# ArchivistPro: Gomulu Web Sunucu ile Kullanici Paneli

## Baglam

ArchivistPro su an tek kullanicili masaustu uygulamasi (Tauri v2 + React). Hedef: ofis/yerel agdaki kullanicilarin kurulum yapmadan, tarayicidan arsive erisebilmesi. Yonetici Tauri'yi calistirir, kullanicilar `http://192.168.x.x:PORT` adresinden baglanir. Ileride dis erisim (TLS, JWT) eklenebilecek sekilde tasarlanacak.

---

## Mimari Karar: SQLite Paylasimi

**Sorun:** sql.js (admin frontend) tum DB dosyasini bellege yukleyip atomik olarak diske yaziyor. Web sunucu da ayni dosyayi okumali.

**Cozum:** Rusqlite **salt okunur** baglanti + nesil sayaci (generation counter):
- `ollama_db.rs`'deki `write_database` her cagrilininca `AtomicU64` sayaci artirir
- Web sunucu her istekte sayaci kontrol eder, degistiyse baglentiyi yeniden acar
- Kullanici yonetimi yazma islemleri mevcut `DB_WRITE_LOCK` mutex'i ile korunur

---

## Yeni Dosya Yapisi

```
src-tauri/src/
  web_server/
    mod.rs              <- Sunucu yasam dongusu (start/stop), AppState
    routes.rs           <- Axum router + tum handler'lar
    auth.rs             <- Login, session, bcrypt, middleware
    db.rs               <- Rusqlite salt okunur baglanti, sorgu fonksiyonlari
    models.rs           <- API response Serde struct'lari
    admin_commands.rs   <- Tauri command'ler (sunucu kontrol, kullanici CRUD)

user-panel/             <- Ayri Vite+React projesi (Tauri bagimliligi YOK)
  src/
    App.tsx
    api.ts              <- fetch wrapper (/api/* endpoint'ler)
    components/
      LoginPage.tsx
      AssetGrid.tsx
      AssetCard.tsx     <- Admin AssetCard'in sadelestirilmisi
      AssetDetail.tsx
      SearchBar.tsx
      FacetSidebar.tsx
    hooks/
      useAssets.ts
      useAuth.ts
    types.ts
```

---

## Yeni Cargo Bagimliliklari

```toml
# src-tauri/Cargo.toml
axum = "0.8"
tokio = { version = "1", features = ["full"] }
tower-http = { version = "0.6", features = ["cors", "fs"] }
rusqlite = { version = "0.33", features = ["bundled"] }
bcrypt = "0.17"
uuid = { version = "1", features = ["v4"] }
rand = "0.8"
include_dir = "0.7"
qrcode = "0.14"
```

---

## Yeni Veritabani Tablolari

```sql
CREATE TABLE IF NOT EXISTS web_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
);

CREATE TABLE IF NOT EXISTS web_sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    FOREIGN KEY (user_id) REFERENCES web_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

---

## API Endpoint'leri

```
POST   /api/auth/login           -> { username, password } -> Set-Cookie
POST   /api/auth/logout          -> session temizle
GET    /api/auth/me              -> mevcut kullanici bilgisi

GET    /api/assets?page=&per_page=&q=&category=&type=&project=
GET    /api/assets/:id           -> tekil asset detayi (file_path HARIC!)
GET    /api/assets/:id/thumbnail -> image/jpeg (base64'ten decode)
GET    /api/facets               -> { categories, types, projects, phases... }
GET    /api/search?q=&page=      -> keyword arama

GET    /                         -> Kullanici paneli SPA (index.html)
```

**Guvenlik:** `file_path` API yanitlarinda ASLA yer almaz. Sadece DB'deki thumbnail'lar sunulur, dosya sistemi erisimi yok.

---

## Admin UI Eklentileri (Mevcut Tauri Frontend'e)

```
src/components/
  WebServerPanel.tsx    <- Sunucu ac/kapat, port, QR kod, bagli kullanicilar
  WebUserManager.tsx    <- Kullanici olustur/sil/devre disi birak
  AuditLogViewer.tsx    <- Log tablosu (kim ne aradi/goruntuledi)
```

Yeni Tauri command'ler:
- `web_server_start`, `web_server_stop`, `web_server_status`, `web_server_set_port`
- `web_user_create`, `web_user_list`, `web_user_delete`, `web_user_toggle_active`
- `web_audit_log`, `web_server_qr_code`

---

## Uygulama Sirasi

### Adim 1: Rust Iskeleti
- `web_server/` modul dizini ve `mod.rs` olustur
- Cargo bagimliliklari ekle
- `lib.rs`'de modul tanimi
- Derleme dogrula

### Adim 2: Veritabani Okuma Katmani
- `web_server/db.rs` -- `DbReader` (rusqlite salt okunur)
- `ollama_db.rs`'e nesil sayaci ekle
- Sorgu fonksiyonlari: `list_assets`, `get_asset`, `search_assets`, `get_facets`, `get_thumbnail`

### Adim 3: Auth Sistemi
- `web_server/auth.rs` -- bcrypt hash, session token (256-bit random hex, 24h expiry)
- Tablo migration'lari (web_users, web_sessions, audit_log)
- Axum auth middleware

### Adim 4: Axum Sunucu & Route'lar
- `web_server/routes.rs` -- tum API endpoint'leri
- `web_server/mod.rs` -- sunucu start/stop lifecycle
- `tauri::async_runtime::spawn` ile Tauri runtime'inda calistir
- Login rate limiting (5 deneme/dakika/IP)

### Adim 5: Admin Tauri Command'leri
- `web_server/admin_commands.rs` -- sunucu kontrol + kullanici CRUD
- `lib.rs` invoke_handler'a kayit

### Adim 6: Kullanici Paneli Frontend
- `user-panel/` Vite+React projesi
- Login, asset grid, arama, detay gorunumu
- `include_dir` ile Rust binary'ye gom
- Axum'da SPA serving (fallback -> index.html)

### Adim 7: Admin UI Entegrasyonu
- `WebServerPanel.tsx`, `WebUserManager.tsx`, `AuditLogViewer.tsx`
- Mevcut Sidebar veya ayarlar bolumune entegre

### Adim 8: QR Kod & Son Dokunuslar
- Yerel IP algilama + QR kod uretimi
- LAN'da uctan uca test

---

## Ileride Dis Erisim Icin Hazirlik

Simdiden tasarima dahil:
- `ServerConfig`'de `tls_cert_path`, `tls_key_path` alanlari (Phase 1'de kullanilmaz)
- Auth middleware tower layer olarak -> JWT'ye kolay gecis
- CORS `tower_http::cors` ile bastan yapilandirilmis
- `DbReader` soyutlamasi -> connection pooling (r2d2) eklenebilir

---

## Kritik Dosyalar

| Dosya | Degisiklik |
|-------|-----------|
| `src-tauri/Cargo.toml` | Yeni bagimliliklar |
| `src-tauri/src/lib.rs` | mod web_server, .manage(), .setup(), invoke_handler |
| `src-tauri/src/ollama_db.rs` | Generation counter, public path resolver |
| `src-tauri/src/web_server/*` | Tamamen yeni modul (6 dosya) |
| `user-panel/*` | Tamamen yeni proje |
| `src/components/WebServerPanel.tsx` | Yeni admin bileseni |
| `src/components/WebUserManager.tsx` | Yeni admin bileseni |

---

## Dogrulama

1. `cargo build` -- Rust derleme basarili
2. Admin'den "Sunucu Baslat" -> port dinleniyor
3. Tarayicidan `http://localhost:PORT` -> login sayfasi
4. Kullanici giris -> asset grid gorunur
5. Arama -> sonuclar doner
6. Baska cihazdan `http://192.168.x.x:PORT` -> erisim basarili
7. Admin'den kullanici sil -> oturum kapanir
8. Audit log'da tum islemler kayitli
