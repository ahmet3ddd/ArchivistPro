# ArchivistPro — Veri Güvenliği Profili

> **Canlı belge.** Projenin mevcut veri güvenliği duruşu: orijinal dosya koruması, indeks/DB kalıcılığı, kayıp senaryoları ve kurtarma.
> Son güncelleme: **2026-05-03** (deferred save, fixity check, retention policy, watch folder)
> İlgili belgeler: `GUVENLIK.md` (auth/yetki) · `SECURITY_HARDENING_2026-04-11.md`

---

## Yönetici Özeti

**Orijinal dosyalarınız** çok güvende — tarama tamamen salt-okunur. **İndeks verileri** güvende — otomatik snapshot, bozulma tespiti, atomik yazma, explicit `sync_all()` ve orphaned asset temizleme mevcut. Snapshot sayısı hâlâ sınırlı (max 5, compression yok).

**Genel veri güvenliği puanı: ~8.5/10**

| Alan | Puan | Not |
|---|---|---|
| Orijinal dosya koruması (salt-okunur tarama) | **10/10** | Tauri fs capability write izni vermez |
| Soft delete + çöp kutusu + undo | **9/10** | 50-item stack, manifest restore |
| DB atomik yazma (serialized) | **9/10** | Promise chain, çakışma yok |
| Çoklu arşiv izolasyonu | **9/10** | `assertWriteAccess` + `withArchive` try/finally |
| Bozulma tespiti | **9/10** | Magic byte + `.corrupt.bak` auto-rename |
| Archive export/import atomik | **8/10** | `.db.bak` alınır, magic byte validate |
| Snapshot / backup | **8/10** | Konfigüre edilebilir retention süresi, otomatik yedekleme (1/4/8/24 saat) |
| Crash recovery | **8/10** | Transaction ROLLBACK + crash log + deferred save flush |
| Disk full handling | **5/10** | localStorage fallback sınırlı |
| Power loss resilience | **9/10** | `write_and_sync()` + `File::sync_all()` + rusqlite checkpoint |
| Orphaned asset cleanup | **8/10** | `findOrphanedAssets()` + `deleteOrphanedAssets()` (2026-04-11) |
| Deferred save | **9/10** | `saveDatabaseDeferred()` batching + `flushDeferredSave()` kapanışta (2026-04-29) |
| Rusqlite inkremental yazma | **9/10** | Tarama verisi checkpoint'lerle diske; çökme güvenli (2026-04-29) |
| Fixity check (bit-rot) | **7/10** | Örneklem bazlı checksum doğrulama (2026-05-01) |
| Watch folder izleme | **7/10** | Dosya değişikliği tespiti + opt-in auto-rescan (2026-05-01) |

---

## 1. Orijinal Dosyalar (Diskteki Kaynak)

### 1.1 Tarama tamamen salt-okunur

**Kanıt:**
- `src/services/fileScanner.ts` — yalnızca `readDir()` + `fsStat()` çağrıları
- `src-tauri/capabilities/default.json` — fs plugin için sadece:
  - `fs:allow-read-dir`
  - `fs:allow-stat`
  - `fs:allow-exists`
- **Yazma/silme/rename izni yok** → Tauri seviyesinde imkansız

### 1.2 Orijinali değiştirebilen tek yol: `refile_fs::refile_organize`

`src-tauri/src/refile_fs.rs`
- **Admin-only** (`#[cfg(feature = "admin")]` + `require_admin`)
- Çift katman path traversal koruması (`canonicalize()` + `starts_with(canonical_base)`)
- Varsayılan davranış **kopyalama**; move seçilirse `fs::rename` (aynı sürücüde atomik)
- Test: `test_refile_rejects_absolute_path`, `test_refile_rejects_path_traversal`

### 1.3 Silme senaryoları

`src/services/refile_fs.rs` ve `src/services/database.ts`:

| İşlem | Disk dosyası | DB kaydı | Geri alınır mı? |
|---|---|---|---|
| `softDeleteAsset` | **Dokunulmaz** | `is_deleted=1, deleted_at=NOW` | ✓ `restoreAsset()` |
| Çöp kutusuna taşıma | Uygulamanın trash klasörüne kopya + manifest | DB kayıt korunur | ✓ `restoreFromTrash()` |
| `permanentlyDeleteAsset` | **Dokunulmaz** | Asset + embedding + tag + favorite silinir | ✗ Kalıcı |
| `emptyTrash` | Trash klasöründen silinir | DB zaten boş | ✗ **Kalıcı (uyarı gösterilir)** |
| Explorer'dan manuel silme | Dosya gider | DB'de **orphaned kalır** | ⚠ Yeniden tarama gerekli |

### 1.4 Undo/Redo — `src/services/commandStack.ts`

- Command Pattern, 50-item FIFO stack
- Delete, move, rename, tag ekle/çıkar, batch işlemler kaydedilir
- Ctrl+Z / Ctrl+Shift+Z ile geri alınır
- Stack uygulama kapanınca sıfırlanır (persist yok — bilinçli)

**Sonuç:** Tarama sırasında **orijinal dosyalarınıza hiçbir şey olmaz**. Yazma işlemi sadece `refile_organize` (admin + onay + undo) ve çöp kutusu taşıma (restore edilebilir) yollarıyla olur.

---

## 2. İndeks ve Arşiv Verileri (DB)

### 2.1 Fiziksel yerler

| Veri | Yer | Format |
|---|---|---|
| Ana arşiv | `%APPDATA%\com.archivistpro.desktop\archivist.db` | SQLite (tek dosya) |
| Yerel arşiv | `%APPDATA%\com.archivistpro.desktop\archivist_local.db` | SQLite (tek dosya) |
| Ek arşivler | Kullanıcı tanımlı yol | SQLite |
| Snapshot'lar (ana) | `%APPDATA%\com.archivistpro.desktop\backups\` | SQLite kopya |
| Snapshot'lar (yerel) | `%APPDATA%\com.archivistpro.desktop\backups-local\` | SQLite kopya |
| Crash logları | `%APPDATA%\com.archivistpro.desktop\crash_logs\` | JSON (FIFO 20) |
| Fallback | `localStorage` | Base64 (~5-10 MB limit) |
| Tema/ayar | `localStorage` | JSON |

### 2.2 Yazma mimarisi

**Veri akışı:**
1. sql.js WASM SQLite tamamen **RAM'de** çalışır
2. İşlem yapıldığında `saveDatabase()` → `_serializedWrite()` → `write_database` Tauri komutu
3. Rust tarafı `std::fs::write(&path, &bytes)` ile tek seferde dosyaya yazar
4. Aynı anda iki yazma olamaz (Promise chain)

**Kanıt:**
```typescript
// database.ts
let _writeChain: Promise<void> = Promise.resolve();
function _serializedWrite(...) {
  _writeChain = _writeChain
    .then(() => tauriVoidInvoke(tauriCmd, invokeArgs)
      .then(ok => { if (!ok) _saveToLocalStorage(data, fallbackKey); })
    );
}
```

**Atomiklik seviyesi:**
- Promise chain → **uygulama içi** çakışma yok ✓
- `fs::write` → OS seviyesi atomik (POSIX `O_TRUNC` + tek yazma) ✓
- **`write_and_sync()` + `File::sync_all()`** → OS write-back cache riski kapatıldı ✓ (2026-04-11)

### 2.3 Snapshot sistemi — `src/services/dbSnapshot.ts`

```typescript
// archiveType: "main" (varsayılan) veya "local"
export async function createSnapshot(archiveType?: string): Promise<SnapshotInfo | null>
export async function listSnapshots(archiveType?: string): Promise<SnapshotInfo[]>
export async function restoreSnapshot(fileName: string, archiveType?: string): Promise<boolean>
export async function deleteSnapshot(fileName: string, archiveType?: string): Promise<boolean>
```

- **Arşiv desteği:** Ana arşiv (`backups/`) ve yerel arşiv (`backups-local/`) ayrı dizinlerde tutulur
- **Yetki:** Ana arşiv → yalnızca admin; yerel arşiv → tüm kullanıcılar (viewer dahil)
- **Otomatik tetikleyici:** Tarama öncesi
- **Manuel tetikleyici:** Ayarlar → Depolama → Yedekleme bölümü
- **Retention:** Her arşiv için maksimum **5 kopya**, FIFO pruning
- **Restore:** UI'dan snapshot seç → onay diyaloğu → `restoreSnapshot()` → mevcut DB üzerine yazar
- **Compression:** Yok (her snapshot tam DB boyutunda)

### 2.4 Bozulma tespiti — `src-tauri/src/ollama_db.rs`

```rust
const SQLITE_MAGIC: &[u8] = b"SQLite format 3\x00";
if bytes.len() < 16 || &bytes[..16] != SQLITE_MAGIC {
    let backup = path.with_extension("corrupt.bak");
    let _ = std::fs::rename(&path, &backup);
    return Ok(DbReadResult { bytes: vec![], corrupted: true });
}
```

- Uygulama açılışında magic byte kontrolü
- Bozuk dosya `.corrupt.bak` olarak otomatik yedeklenir
- Boş DB ile başlar, `wasDbRecovered()` flag'i UI'a "önceki DB bozuktu" uyarısı verir
- Kullanıcı snapshot'tan restore yapabilir

### 2.5 Çoklu arşiv izolasyonu — `src/services/database.ts`

```typescript
function assertWriteAccess(): void {
  const def = getArchiveDef(activeArchive);
  if (def?.type === 'shared' && getAppRole() === 'viewer') {
    throw new Error('Paylaşımlı arşive yazma yetkiniz yok (Viewer rolü)');
  }
}

export async function withArchive<T>(archiveId: string, op: () => Promise<T> | T): Promise<T> {
  const originalActive = activeArchive;
  try {
    setActiveArchive(archiveId);
    return await op();
  } finally {
    setActiveArchive(originalActive); // Crash'te bile geri döner
  }
}
```

- **Viewer ana arşive kesinlikle yazamaz** (kod seviyesinde throw)
- `withArchive()` try/finally — geçici arşiv değişimi her koşulda geri döner
- Ek olarak Rust tarafında `require_authenticated` guard (2026-04-11 sertleştirmesi)

### 2.6 Archive export/import — `src-tauri/src/archive_share.rs`

**Export:**
- `.archivistpro` formatı = ZIP (manifest.json + archive.db + local.db?)
- **Read-only** — kaynak DB'ye dokunulmaz
- Manifest'te versiyon, asset count, hash, timestamp, creator

**Import:**
- **Admin-only** (`require_admin`)
- `replace_existing=true` ise hedef DB `.db.bak` olarak otomatik yedeklenir
- Magic byte validation (read_database sırasında)
- **Uyarı:** Import ortasında hata olursa `.db.bak` elle restore edilmeli (otomatik rollback yok)

---

## 3. Kayıp Senaryoları — Komple Matriks

| # | Senaryo | Olasılık | Etki | Koruma | Risk |
|---|---|---|---|---|---|
| 1 | Kullanıcı yanlış asset siler | Orta | Düşük | Soft delete + 50 undo + çöp kutusu | ✓ **Düşük** |
| 2 | Kullanıcı çöp kutusunu boşaltır | Düşük | Orta | Uyarı, ama **undo yok** | ⚠ **Orta** |
| 3 | Import replace ile üzerine yazma | Düşük | Yüksek | `.db.bak` otomatik + admin-only | ⚠ **Orta** (manuel rollback) |
| 4 | DB dosyası corrupt olur | Düşük | Yüksek | Magic byte + `.corrupt.bak` + snapshot | ⚠ **Orta** (max 5 snapshot) |
| 5 | Uygulama crash — kısmi yazma | Orta | Orta | Promise chain serializer + transaction | ✓ **Düşük-Orta** |
| 6 | **Power loss — write-back cache kaybı** | Düşük | Yüksek | `write_and_sync()` + `File::sync_all()` | ✓ **Düşük** (kapatıldı) |
| 7 | Disk dolu — yazma fail | Düşük | Orta | localStorage fallback (5-10 MB) | ⚠ **Orta-Yüksek** |
| 8 | Orijinal dosya dışardan silinir | Orta | Düşük | `findOrphanedAssets()` + admin cleanup | ✓ **Düşük** (kapatıldı) |
| 9 | Orijinal dosya dışardan taşınır | Orta | Düşük | Path hardcoded → orphaned | ⚠ **Orta** |
| 10 | LAN üzerinden kötü niyetli import | Çok düşük | Yüksek | Admin-only + 8-digit + rate limit + magic byte + `.db.bak` | ✓ **Düşük** |
| 11 | Çoklu arşivde yanlış arşive yazma | Çok düşük | Orta | `withArchive` try/finally + `assertWriteAccess` | ✓ **Çok Düşük** |
| 12 | Viewer admin arşivine yazma denemesi | Çok düşük | Yüksek | Frontend `assertWriteAccess` + Rust `require_authenticated` | ✓ **Çok Düşük** |

---

## 4. Bilinen Zayıf Noktalar ve Önerilen Çözümler

### 4.1 Kritik (Gelecek sprint)

1. ~~**Explicit `fsync()` yok**~~ **KAPATILDI (2026-04-11)**
   - `write_and_sync()` fonksiyonu `File::sync_all()` kullanıyor
   - `write_database`, `write_local_database`, `write_archive` komutlarında aktif

2. **Orphaned asset cleanup workflow yok**
   - **Risk:** Dışarıdan silinen/taşınan dosyalar DB'de kalır, arama sonuçlarını kirletir
   - **Çözüm:** "Sağlık kontrolü" butonu — tüm asset path'lerini `stat()` et, eksikleri işaretle/sil
   - **Çalışma maliyeti:** Orta (yeni komut + UI)

### 4.2 Önemli

3. **Snapshot 5 ile sınırlı**
   - **Risk:** 1 haftadan eski state'e dönülemez
   - **Çözüm:** Time-based retention (örn. son 7 günlük + haftalık + aylık)
   - **Ek çözüm:** gzip compression (disk tasarrufu)

4. **Disk dolu uyarısı yok**
   - **Risk:** Kullanıcı sessizce localStorage'a düşer, eventually tüm veriyi kaybeder
   - **Çözüm:** Yazma öncesi disk alanı kontrolü, kritik seviyede pop-up

5. **Archive import otomatik rollback yok**
   - **Risk:** Import ortasında hata → kullanıcı manuel `.db.bak` restore yapmalı
   - **Çözüm:** Transaction wrap — hata olursa otomatik `fs::rename(bak, db)`

### 4.3 İyi-Var Ama İyileştirilebilir

6. **Çöp kutusu auto-cleanup yok** — 30/90 gün sonrası otomatik boşaltma
7. **Undo stack persist değil** — uygulama kapanınca 50 item gider
8. **DB recovery wizard yok** — corrupt DB tespitinde snapshot seçimini UI üzerinden yapabilmeli
9. **Dosya diff/versiyon takibi yok** — aynı dosyanın farklı versiyonlarını izleme

---

## 5. Kullanıcıya Pratik Öneriler

**Günlük kullanım:**
- ✓ Viewer rolüyle günlük arama/önizleme yap, admin rolünü sadece yazma/yönetim için aç
- ✓ Refile/move işlemlerini küçük partilerde yap (50-item undo stack'in dolmaması için)
- ✓ Çöp kutusunu 30 gün bekletmeden boşaltma

**Yedekleme:**
- ✓ **Haftada bir manuel export** — `Ayarlar → Arşivi Dışa Aktar` → `.archivistpro` ZIP → harici disk/bulut
- ✓ Bu, 5-snapshot limitinin üstüne **dış yedek** ekler
- ✓ Çoklu bilgisayar kullanıyorsanız export/import ile sync

**Kaynak klasör seçimi:**
- ✓ Windows sistem klasörlerini (`C:\Windows`, `C:\Program Files`) tarama; scoping güvenli ama fiziksel izolasyon daha iyi
- ✓ Ağ sürücülerinde tarama yavaş — yerel sürücüleri tercih et
- ✓ SSD'de DB, HDD'de orijinal dosyalar — hız + bütçe dengesi

**Acil durum:**
- Uygulama açılmıyor + "DB corrupt" → `%APPDATA%\com.archivistpro.desktop\snapshots\` dizininden bir snapshot'ı `archivist.db` olarak kopyala
- Yanlış import → `%APPDATA%\com.archivistpro.desktop\archivist.db.bak` dosyasını `archivist.db` olarak restore et
- Çöp kutusunu yanlışlıkla boşalttın → son export ZIP'ten restore et (yoksa kayıp)

---

## 6. Referanslar (Kod Kanıtları)

| Dosya | Satır | Konu |
|---|---|---|
| `src-tauri/src/ollama_db.rs` | ~160 | Magic byte bozulma tespiti |
| `src-tauri/src/ollama_db.rs` | ~172 | `std::fs::write` atomik yazma |
| `src-tauri/src/refile_fs.rs` | ~16 | Admin-only refile_organize |
| `src-tauri/src/refile_fs.rs` | ~50 | Path traversal çift katman |
| `src-tauri/src/archive_share.rs` | 135 | Import admin gate |
| `src-tauri/src/archive_share.rs` | 166 | `.db.bak` otomatik backup |
| `src-tauri/capabilities/default.json` | — | fs read-only capability |
| `src/services/database.ts` | 163 | `withArchive` try/finally |
| `src/services/database.ts` | 175 | `assertWriteAccess` viewer guard |
| `src/services/database.ts` | 755 | `_serializedWrite` Promise chain |
| `src/services/database.ts` | 1772 | `softDeleteAsset` (is_deleted flag) |
| `src/services/dbSnapshot.ts` | 29 | Max 5 snapshot + FIFO prune |
| `src/services/commandStack.ts` | — | 50-item undo stack |
| `src/services/fileScanner.ts` | — | Yalnızca readDir + stat (yazma yok) |

---

## Özet Cümle

**Tarama ve önizleme orijinal dosyalara dokunmaz.** Silme/taşıma admin-only, onay diyalogu, undo stack ve çöp kutusu ile korunur. DB otomatik snapshot ve bozulma tespiti ile yedeklenir. Power loss explicit `sync_all()` ile korunuyor, orphaned asset cleanup workflow mevcut. Kullanıcı tanımlı alanlar (müşteri, onay durumu vb.) `upsertAsset` ON CONFLICT korumasıyla yeniden taramada korunuyor. **Kalan zayıflık:** snapshot sayısı sınırlı (max 5, compression yok). Haftalık manuel export yapılırsa enterprise seviyeye yaklaşır.
