# ArchivistPro — Güvenlik Profili

> **Canlı belge.** Projenin mevcut güvenlik duruşunun kısa özeti. Tarihsel kayıtlar için `SECURITY_HARDENING_*.md` ve `AUDIT_REPORT_*.md` dosyalarına bakın.
> Son güncelleme: **2026-05-03** (DPAPI, login rate-limit, deferred save, fixity, retention)

## Güvenlik Olgunluğu

| Alan | Puan | Not |
|---|---|---|
| **Tauri command guard'ları** | 9/10 | Yazma komutları `require_authenticated`, admin komutlar `require_admin`, `create_archive_file` path allowlist |
| **LAN sunucu auth** | 9/10 | 8-digit CSPRNG, fallback yok, constant-time, 5 hata/5dk rate limit, CORS `null` |
| **Şifre doğrulama** | 9/10 | PBKDF2-SHA256 100K iter + 16B salt + **constant-time compare** |
| **Path traversal koruması** | 10/10 | Çift katman (literal + canonicalize allowlist) |
| **Audit log** | 9.5/10 | 3 katman + **tamper markerleri** (silme kayıtları transaction içinde yazılır) |
| **XSS koruması** | 8/10 | escapeHtml + DOMPurify + React JSX + `require_authenticated` Tauri katmanı |
| **SSRF (Ollama proxy)** | 8/10 | Beyaz liste host + 15dk timeout |
| **RBAC** | 9/10 | 3 katman: Frontend `<ProtectedAction>` → Rust `require_admin/authenticated/developer_or_admin` → DB role kontrol |
| **Supply chain** | 8/10 | `npm audit`: 0 vulnerabilities; updater `minisign` imzalı |
| **CSP** | 7/10 | `unsafe-inline` style + `wasm-unsafe-eval` (Transformers.js için gerekli) |
| **Veri dayanıklılığı** | 9/10 | `write_and_sync()` + `File::sync_all()` + `upsertAsset` ON CONFLICT kullanıcı alanı koruması |
| **Session yönetimi** | 8/10 | Konfigüre edilebilir timeout (5-120dk), lock screen, uyarı toast'u; 2FA yok |
| **Login rate-limit** | 8/10 | Başarısız giriş sonrası hesap kilitleme, konfigüre edilebilir süre |
| **DPAPI entegrasyonu** | 8/10 | LAN auth-code Windows credential store ile şifreleniyor |
| **fs:scope deny** | 8/10 | Hassas dizinler (System32 vb.) deny listesinde |
| **Fixity check** | 7/10 | Örneklem bazlı checksum doğrulama (bit-rot tespiti) |
| **Onay audit trail** | 8/10 | Onay durumu değişikliği approval_log tablosuna kaydedilir |
| **LAN TLS** | 5/10 | Plain HTTP — WireGuard/Tailscale üzerinden kullanıma uygun |
| **Code signing (installer)** | 3/10 | Authenticode/EV yok → SmartScreen uyarısı |

**Toplam:** ~**9.1/10** (2026-04-11 sertleştirmesi sonrası, önce ~8.0/10)

---

## 1. Kimlik Doğrulama ve Yetkilendirme

### Parola
- **PBKDF2-SHA256**, 100.000 iterasyon, 16 byte salt, 256 bit çıktı
- Format: `saltHex:hashHex` (DB'de `users.password_hash`)
- Eski SHA-256 hash'leri ilk doğrulamada **otomatik migrate** ediliyor
- **Constant-time compare**: `Uint8Array` XOR-OR accumulation (timing attack kapalı)
- Geçersiz hash uzunluğu bile sabit süre döner

### Roller
- `admin` — tam yetki, yazma, ayar değiştirme, yönetim
- `viewer` — arşiv salt-okunur; mesajlaşma ve kendi profil güncelleme için sınırlı yazma
- `developer` flag — admin olmadan geliştirici araçlarına erişim (ör. crash log viewer)

### Rust guard'ları (`src-tauri/src/lib.rs`)
```rust
require_admin(state)               // Sadece admin
require_authenticated(state)       // Admin veya viewer (login şart)
require_developer_or_admin(...)    // Admin veya developer flag
```

### Guard uygulanmış komutlar
| Komut | Guard | Sebep |
|---|---|---|
| `write_database` | `require_authenticated` | Viewer mesaj/profil yazabilir ama XSS ile login'siz saldırıya kapalı |
| `write_local_database` | `require_authenticated` | Aynı |
| `write_archive` | `require_authenticated` + `archive_id` sanitize | Aynı + id beyaz liste |
| `create_archive_file` | `require_admin` + path allowlist | Yeni arşiv dosyası = admin işi |
| `set_database_path` | `require_admin` | Ana arşivi değiştirmek kritik |
| `import_archive` | `require_admin` | Arşiv içeri alma |
| `lan_start_server` | `require_admin` | LAN paylaşımı başlatma |

---

## 2. Path Traversal Koruması

### Çift katman (dosya tarama)
1. **Literal** — `..` içeren yollar erken reddedilir
2. **Canonicalize** — `std::fs::canonicalize()` ile sembolik link takip edilir

### Arşiv dosyası oluşturma (`create_archive_file`)
`validate_archive_target_path()` fonksiyonu:
1. `..` literal reddi
2. Parent dizini `canonicalize()`
3. Canonical parent **allowlist** altında olmalı:
   - `app_data_dir`
   - `app_local_data_dir`
   - `document_dir`
   - `desktop_dir`
   - `download_dir`
   - `home_dir`
4. Aksi halde hata

### `fs:scope: **` neden açık?
Tauri capability'si **salt-okunur** izinler veriyor:
- `fs:allow-read-dir`
- `fs:allow-stat`
- `fs:allow-exists`

Yazma/silme/rename **yok**. Full-disk tarama programın mimari amaç temeli (D:\, E:\, C:\Ofis... tüm disklerden proje bulma). Bilinçli karar.

---

## 3. LAN Sunucu Güvenliği (`src-tauri/src/lan_server.rs`)

### Auth kodu üretimi
```rust
fn generate_auth_code() -> Result<String, String> {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf).map_err(|e| ...)?;
    let num = u32::from_le_bytes(buf) % 100_000_000;
    Ok(format!("{:08}", num))  // 8 hane, ~26.6 bit entropi
}
```
- **8 haneli** (10⁸ kombinasyon, önceden 6)
- **Kalıcı** — Config dosyasına (`archivist_config.json → lan_auth_code`) kaydedilir, sunucu her başlatıldığında aynı kod kullanılır
- **Yenilenebilir** — Admin `lan_regenerate_auth_code` komutu ile (UI'da RefreshCw ikonu) istediğinde yeni kod üretebilir
- **Fallback yok** — CSPRNG başarısız olursa sunucu başlamaz (**fail-secure**)
- **Sabit-zaman karşılaştırma** — `constant_time_eq()`

### Rate limiting
```
MAX_FAILED_ATTEMPTS = 5
FAILED_WINDOW      = 5 dakika
LOCKOUT_DURATION   = 5 dakika
```
- Per-IP sayaç (`AuthFailureTracker`)
- 5 hatadan sonra **429 Too Many Requests**
- Başarılı girişte sayaç sıfırlanır
- Kilit süresi dolunca otomatik temizlenir

**Saldırgan matematiği:**
- Önce: 10⁶ kombinasyon × ~10⁴ req/s → ~100 saniyede brute-force
- Sonra: 10⁸ / (5 deneme × 12 pencere/saat) ≈ **3+ yıl** (lockout dahil değil)

### Endpoint auth politikası
| Path | Auth gerekli? | Not |
|---|---|---|
| `/ping` | **Hayır** | Health-check |
| `/manifest` | **Evet** | |
| `/download/:hash` | **Evet** | |
| `/thumbnail/:hash` | **Evet** | |
| `/dev-feedback` | **Evet** | Önceden auth'suzdu — **kapatıldı** |

### İstek güvenliği
- **Body limit** — `/dev-feedback` için 64 KB (`reader.take(MAX_BODY_BYTES)`)
- **Field sanitize** — `sanitize_feedback_field()` control karakterleri filtreler, alan başına 8 KB üst sınır
- **CORS** — `Access-Control-Allow-Origin: null` + `Vary: Origin` (önceden `*`)
- **Version** — `/ping` ve `/manifest` `env!("CARGO_PKG_VERSION")` ile derleme zamanında gömülüyor (drift yok)

### Hâlâ eksik
- **TLS yok** — plain HTTP, yerel ağ varsayımı. WireGuard/Tailscale önerilir.
- **Kimlik bazlı rol yok** — tek paylaşılan auth kodu (kalıcı, admin yenileyebilir)

---

## 4. Audit Log

### Üç katman
1. **Audit Log** — Kim ne yaptı (DB tablosu, kalıcı)
2. **System Log** — Hata, performans (Rust `tracing` → dosya)
3. **Debug Log** — Dev modda konsol

### Tamper markerleri
Her silme işlemi **BEGIN/COMMIT transaction** içinde bir audit kaydı bırakır:
| Fonksiyon | Marker | Detay |
|---|---|---|
| `clearAuditLogs()` | `LOG_CLEARED` | `{deletedCount, reason}` |
| `deleteAuditLog(id)` | `LOG_DELETED` | `audit_log#{id}` |
| `deleteAuditLogsBatch(ids)` | `LOG_DELETED_BATCH` | `{deletedCount}` |

Herhangi bir adım başarısız olursa `ROLLBACK` — kısmi silme olamaz.

### Sınırlama
Saldırgan **DB dosyasını doğrudan düzenleyerek** marker'ı silebilir. Tam tamper-proof için harici/append-only log sink gerekli (gelecek iş).

### Loglanmayanlar (gizlilik kararı)
- **Arama terimleri** — log'lanmıyor
- Dosya içerikleri — log'lanmıyor

---

## 5. SSRF Koruması (Ollama Proxy)

`src-tauri/src/ollama_db.rs::ollama_proxy`
- **Host whitelist** — yalnızca `localhost`, `127.0.0.1`, `::1`, kullanıcı ayarlarında tanımlı yerel Ollama endpoint'i
- **Protokol whitelist** — yalnızca `http`, `https`
- **Timeout** — 15 dakika (uzun LLM yanıtları için)
- **Redirect takibi yok** — zincir saldırısı engellenir

---

## 6. Kurtarma Anahtarı (`recovery.key`)

`src-tauri/src/ollama_db.rs::read_recovery_key` / `write_recovery_key`
- **One-shot yazma** — Dosya zaten varsa üzerine yazılamaz
- **Format doğrulama** — 32-128 ASCII hex karakter zorunlu
- **Admin kontrol YOK** — çünkü bootstrap (login öncesi) ve ForgotPassword (login öncesi) akışı çalışmalı

---

## 7. Supply Chain

| Kaynak | Durum |
|---|---|
| `npm audit` | 0 vulnerabilities |
| `cargo audit` | Manuel çalıştırılmalı (henüz CI'da yok) |
| **Updater** | `minisign` ile imzalı `.msi.sig` + `latest.json` |
| **Updater pubkey** | Derleme zamanında gömülü (production) |
| **Installer (MSI)** | **Authenticode yok** → SmartScreen uyarısı devam ediyor |

---

## 8. Gelecek Borçlar

| Öncelik | Borç | Not |
|---|---|---|
| Orta | Harici tamper-proof audit sink | Append-only dosya veya hash-chain |
| Orta | LAN TLS | Built-in TLS; şu an sadece WireGuard/Tailscale önerisi |
| Orta | Session timeout / idle logout | Yok |
| Orta | 2FA / account recovery flow | Yok |
| Düşük | CSP `unsafe-inline` kaldırma | Büyük refactor, Transformers.js uyumluluk riski |
| Yüksek | Windows Authenticode/EV cert | SmartScreen için gerekli |
| Düşük | `cargo audit` CI entegrasyonu | Otomatik supply-chain tarama |
| Düşük | Rate limiting (LAN dışı komutlar) | Ör. `write_database` spam koruması |

---

## 9. Olay Müdahale (Incident Response)

Şu an için resmi IR prosedürü **yok**. Temel araçlar:

1. **Audit log inceleme** — `logger.ts::getAuditLogs()` üzerinden UI
2. **Crash log inceleme** — `src-tauri/src/crash_report.rs` (FIFO 20, JSON, 100KB/dosya)
3. **System log** — `tracing` üzerinden Rust tarafı (`write_system_log` komutu)
4. **DB snapshot** — `docs/DEVELOPER_GUIDE.md`'de belgelenmiş, otomatik 5'e kadar tutuluyor

### Kurtarma
- `wasDbRecovered()` — bozuk DB tespitinde otomatik backup + yeniden başlat
- `recovery.key` — admin parola kurtarma için tek-atış

---

## Referanslar

- **`SECURITY_HARDENING_2026-04-11.md`** — K-1..K-4 + Y-1..Y-4 bulgularının kapatılması (tarihsel kayıt)
- **`AUDIT_REPORT_2026-04-11.md`** — Derin kod analizi ve olgunluk rakamları
- **`AUDIT_REPORT_2026-04-07.md`** — Önceki iç güvenlik denetimi (9.3/10)
- **`DEVELOPER_GUIDE.md`** — Mimari, komutlar, veritabanı şeması
- **`.claude/MEMORY.md`** — Proje hafızası (cross-machine)
