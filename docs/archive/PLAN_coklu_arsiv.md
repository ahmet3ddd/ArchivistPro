# Çoklu Arşiv & Kaynak Klasör Yönetimi — Uygulama Planı

## Bağlam

Mevcut sistemde sabit iki arşiv var: `'main'` (Ana Arşiv) ve `'local'` (Yerel Arşiv). Kullanıcı farklı projeler, ofis şubeleri veya bağlamlar için birden fazla isimli arşiv yönetmek istiyor. Buna ek olarak iki arşivi birleştirme (join/merge) ve bir arşivden filtrelenmiş subset çıkarma (extract) işlemleri talep ediliyor.

Ek olarak, taranan klasörlerin sol panelde görünür ve yönetilebilir olması isteniyor: hangi kök klasörler tarandı, kaç dosya geldi, seçici yeniden tarama, klasör bazlı filtreleme.

### Kavram Ayrımı (Terminoloji)

| Kavram | Tanım | Karşılık |
|--------|-------|----------|
| **Arşiv** | SQLite veritabanı konteyneri | Dolap |
| **Kaynak Klasör** | Disk üzerindeki taranan kök dizin | Dolaptaki çekmece |
| **Asset** | Tek bir dosya kaydı | Çekmecedeki dosya |

Bu iki boyut ortogonaldir: Arşiv = hangi veritabanı, Kaynak Klasör = o veritabanı içindeki fiziksel kaynaklar. UI'da asla aynı terimle anılmamalıdır.

## Mevcut Mimari (Özet)

- `ArchiveType = 'main' | 'local'` — `src/services/database.ts:60`
- `mainDb` + `localDb` — iki sabit SQLite instance
- `activeArchive: ArchiveType` — Zustand store + localStorage (`archivist_active_archive`)
- Disk dosyaları: `archivist.db` (main) + `archivist_local.db` (local) — `src-tauri/src/ollama_db.rs:94-95`
- Tauri komutları: `read_database`, `write_database`, `read_local_database`, `write_local_database`
- `lastScanInfoMap: Record<ArchiveType, LastScanInfo | null>` — `src/store/useStore.ts:206`
- `archive_share.rs` — mevcut `export_archive`, `import_archive`, `peek_archive_manifest` (ZIP tabanlı)
- Viewer rolü: ana arşiv salt-okunur, yerel tam erişim

---

## Hedef Mimari

### Arşiv Tanımı (ArchiveDef)

```typescript
// src/services/database.ts'e eklenecek
export interface ArchiveDef {
  id: string;          // UUID — benzersiz tanımlayıcı
  name: string;        // Kullanıcının verdiği isim ("Ofis Merkez", "Proje Kule")
  type: 'shared' | 'personal'; // shared = eski main, personal = eski local
  dbPath?: string;     // özel disk yolu (config'de saklanır)
  createdAt: string;   // ISO 8601
  color?: string;      // UI rengi (#hex) — görsel ayrım için
}
```

### Sabit ID'ler (Geriye Dönük Uyumluluk)

```
MAIN_ARCHIVE_ID  = 'main'   (mevcut arşiv korunur, yeni isim verilebilir)
LOCAL_ARCHIVE_ID = 'local'  (mevcut arşiv korunur, yeni isim verilebilir)
```

`ArchiveType` string'e genişler ama mevcut `'main'` ve `'local'` ID'leri geçerliliğini korur.

---

## Uygulama Fazları

### FAZ 1 — Temel Altyapı (Çoklu Arşiv)

#### 1A — Tip Sistemi Güncellemesi

**`src/services/database.ts`**
- `ArchiveType = 'main' | 'local'` → `type ArchiveType = string`
- `ArchiveDef` interface ekle
- `mainDb` / `localDb` → `const dbMap = new Map<string, SqlJsDatabase>()`
- `let activeArchive: ArchiveType = 'main'` → aynı isim, artık herhangi bir ID
- `setActiveArchive(id)`: dbMap'ten ilgili instance'ı alır
- `getAllAssetsFromArchive(id)`: `dbMap.get(id)` kullanır
- `saveDatabase()` → `saveArchive(id?: string)` (parametresiz = aktifi kaydeder)
- `initDatabase()`: mainDb yerine `dbMap.set('main', ...)` kullanır
- `initLocalDatabase()`: localDb yerine `dbMap.set('local', ...)` kullanır
- Yeni: `createArchive(def: ArchiveDef): Promise<void>` — yeni boş DB oluşturur
- Yeni: `unloadArchive(id: string): void` — DB'yi bellekten temizler
- `isLocalDbReady()` → `isArchiveReady(id: string): boolean`

**`src/store/useStore.ts`**
- `activeArchive: ArchiveType` — tip string olur, değer `'main'` default
- `lastScanInfoMap: Record<ArchiveType, ...>` → `Record<string, LastScanInfo | null>`
- Yeni state: `archives: ArchiveDef[]` — tüm tanımlı arşivler
- Yeni action: `setArchives`, `addArchive`, `removeArchive`, `renameArchive`
- `loadActiveArchive()`: artık herhangi bir string ID okuyabilir
- localStorage key: `archivist_archives` — arşiv listesi JSON

#### 1B — Tauri (Rust) Katmanı

**`src-tauri/src/ollama_db.rs`**
- `ArchivistConfig` genişletme:
  ```rust
  struct ArchivistConfig {
    db_path: String,
    local_db_path: Option<String>,
    extra_archives: Vec<ExtraArchiveConfig>,  // YENİ
  }

  struct ExtraArchiveConfig {
    id: String,
    name: String,
    db_path: String,
    archive_type: String, // "shared" | "personal"
  }
  ```
- Yeni komutlar:
  - `read_archive(app, archive_id)` — ID'ye göre DB byte'larını döner
  - `write_archive(app, archive_id, data)` — ID'ye göre yazar
  - `create_archive_file(app, archive_id, db_path)` — yeni boş dosya oluşturur
  - `delete_archive_file(app, archive_id)` — admin-only
- Mevcut `read_database`, `write_database` vb. korunur (geriye uyumluluk)

**`src-tauri/src/lib.rs`**
- Yeni komutlar `generate_handler!` makrosuna eklenir

#### 1C — UI Katmanı

**`src/components/Sidebar.tsx`**
- `ArchiveButton` bileşeni → dinamik liste render eder
- `archives` store state'inden döngüyle render:
  ```tsx
  {archives.map(arch => (
    <ArchiveButton key={arch.id} archive={arch} />
  ))}
  ```
- "Yeni Arşiv Ekle" butonu → küçük form (isim + tür)
- Arşiv üzerine sağ tık / 3-nokta menüsü: Yeniden Adlandır, Sil

**`src/components/SettingsModal.tsx`**
- Sabit iki `ArchiveCard` → `archives` üzerinden dinamik render
- Her kartda: isim, tür, disk yolu, son tarama, Sil butonu

**`src/components/DuplicateFinderModal.tsx`**
- `scope: ArchiveType` → string, arşiv ID
- Seçim dropdown'ı: tüm arşivleri listeler

---

### FAZ 1.5 — Kaynak Klasör Paneli

#### Neden Ayrı Faz?

Faz 1 (çoklu arşiv altyapısı) bitmeden klasör paneli yapılamaz — `scanned_roots` tablosu hangi arşive ait olduğunu bilmeli. Faz 2 (Join/Extract) başlamadan yapılmalı — Extract'ın `folderPaths` filtresi bu panelden doğal şekilde beslenir.

#### 1.5A — Veri Modeli

**`src/services/database.ts` → `_applySchema()` içine yeni tablo:**

```sql
CREATE TABLE IF NOT EXISTS scanned_roots (
  id        TEXT PRIMARY KEY,           -- UUID
  path      TEXT NOT NULL UNIQUE,       -- "D:\Projeler\Proje_A"
  label     TEXT NOT NULL,              -- "Proje A" (kullanıcı düzenleyebilir)
  added_at  TEXT DEFAULT (datetime('now')),
  last_scan TEXT,                       -- son tarama tarihi
  file_count INTEGER DEFAULT 0,        -- bu kökten gelen asset sayısı (cache)
  status    TEXT DEFAULT 'active'       -- 'active' | 'removed'
);
CREATE INDEX IF NOT EXISTS idx_scanned_roots_path ON scanned_roots(path);
```

**Yeni servis fonksiyonları (`src/services/database.ts`):**

```typescript
// Kaynak klasör CRUD
function addScannedRoot(path: string, label?: string): string       // → root id
function removeScannedRoot(rootId: string): void                    // status = 'removed', asset'ler silinmez
function deleteScannedRootWithAssets(rootId: string): number        // asset'leri de siler, sayı döner
function renameScannedRoot(rootId: string, newLabel: string): void
function getScannedRoots(): ScannedRoot[]                           // aktif olanlar
function updateRootScanInfo(rootId: string, fileCount: number): void
function getScannedRootForPath(filePath: string): ScannedRoot | null // path prefix match

// İlişkili sorgular
function getAssetCountByRoot(rootId: string): number                // file_path LIKE root.path + '%'
function getAssetsByRoot(rootId: string): Asset[]                   // klasör filtresi
```

```typescript
export interface ScannedRoot {
  id: string;
  path: string;
  label: string;
  addedAt: string;
  lastScan: string | null;
  fileCount: number;
  status: 'active' | 'removed';
}
```

**Tarama entegrasyonu (`src/hooks/useScanWorkflow.ts`):**

Mevcut `handleStartScan` akışına ekleme:

```
1. Kullanıcı klasör seçer (mevcut open() dialog)
2. YENİ: scanned_roots tablosunda bu path var mı kontrol et
   - Yoksa → addScannedRoot(selectedFolder, folderBaseName)
   - Varsa → mevcut kaydı kullan
3. Tarama çalışır (mevcut akış)
4. YENİ: updateRootScanInfo(rootId, assets.length)
```

#### 1.5B — Mevcut Verilerin Migrasyonu

İlk açılışta `scanned_roots` tablosu boş olacak ama `assets` tablosunda zaten dosyalar var. Otomatik migrasyon:

```typescript
function _migrateExistingAssetsToRoots(target: SqlJsDatabase): void {
  // assets.file_path'lerden benzersiz kök dizinleri çıkar
  // Strateji: her file_path için en uzun ortak prefix → kök dizin
  // Örnek: D:\Proje_A\Plan\dosya1.dwg, D:\Proje_A\Model\dosya2.max → D:\Proje_A
  // Her benzersiz kök için scanned_roots'a kayıt ekle
}
```

Bu migrasyon `_applyMigrations()` içinde, tablo oluşturulduktan sonra bir kez çalışır.

#### 1.5C — UI: Kaynak Klasör Paneli

**Konum:** Sidebar'da, arşiv seçici ile tarama butonu arasına yerleşir.

**Hiyerarşi (yukarıdan aşağı):**
```
[Arşiv Seçici]          ← hangi veritabanı? (Faz 1)
[Kaynak Klasörler]      ← o DB'deki taranan kök dizinler (Faz 1.5) ← YENİ
[Tara & İndeksle]       ← mevcut
[Arama]                 ← mevcut
[Faceted Filtreler]     ← mevcut
```

**Bileşen tasarımı:**

```
┌─────────────────────────────┐
│ KAYNAK KLASÖRLER         ⚙  │  ← başlık + yönet butonu
│                              │
│ 📁 Proje A          124 ✓   │  ← tıkla → filtrele
│ 📁 Merkez Ofis       89 ✓   │  ← checkbox = filtre aktif
│ 📁 Şantiye Fotoğraf  45     │  ← sayı = asset count
│                              │
│ [+ Klasör Tara]              │  ← yeni tarama başlatır
└─────────────────────────────┘
```

**Davranışlar:**

- **Tıklama:** Klasöre tıklamak o klasörü filtre olarak aktif/pasif yapar (facet filtre gibi). Birden fazla klasör seçilebilir.
- **Sağ tık / 3-nokta menüsü:**
  - Yeniden Adlandır — label değiştirir, path değişmez
  - Yeniden Tara — sadece bu klasörü tekrar tarar
  - Klasördeki dosyaları göster — filtre uygulayıp grid'e odaklanır
  - Arşivden Çıkar — `removeScannedRoot` (asset'ler kalır, kök kayıt pasif olur)
  - Sil (asset'lerle birlikte) — onay dialog'u sonrası `deleteScannedRootWithAssets`
- **Collapsible:** Çok fazla kök varsa bölüm katlanabilir (varsayılan açık, 5+ kökle kapalı başlar)
- **Boş durum:** Hiç kök yoksa *"Henüz klasör taranmadı"* mesajı + tara butonu

**Dosyalar:**

| Dosya | Değişim |
|-------|---------|
| `src/components/Sidebar.tsx` | `<SourceFoldersPanel>` bileşeni eklenir |
| `src/components/SourceFoldersPanel.tsx` | YENİ — kaynak klasör listesi + context menü |
| `src/services/database.ts` | `scanned_roots` tablosu + CRUD fonksiyonları |
| `src/store/useStore.ts` | `scannedRoots: ScannedRoot[]`, `activeRootFilters: string[]` |
| `src/hooks/useScanWorkflow.ts` | Tarama sonrası root kaydı güncelleme |

#### 1.5D — Filtreleme Entegrasyonu

Klasör filtresi mevcut faceted filtre sistemiyle paralel çalışır:

```
Nihai asset listesi = 
  assets
  |> arşiv filtresi (Faz 1: hangi DB)
  |> klasör filtresi (Faz 1.5: activeRootFilters boş değilse, file_path prefix match)
  |> faceted filtreler (mevcut: proje, tip, faz, malzeme, stil, renk)
  |> metin/semantik arama (mevcut)
```

`useHybridFilteredAssets` hook'una `activeRootFilters` eklenir:

```typescript
// file_path'in seçili kök dizinlerden biriyle başlayıp başlamadığını kontrol et
if (activeRootFilters.length > 0) {
  filtered = filtered.filter(a =>
    activeRootFilters.some(rootPath => a.filePath.startsWith(rootPath))
  );
}
```

#### 1.5E — Faz 3 (Extract) ile Sinerji

Plandaki `ExtractOptions.folderPaths` filtresi doğrudan `scanned_roots` verisini kullanır:

```typescript
// ArchiveExtractModal.tsx'de klasör seçimi:
// Kullanıcı scanned_roots listesinden checkbox ile seçer
// → ExtractOptions.filter.folderPaths = seçili root path'leri
```

Bu sayede Extract modal'ında klasör seçimi için ayrı bir UI gerekmez — Kaynak Klasör Paneli'ndeki veri yeniden kullanılır.

---

### FAZ 2 — Join (Arşiv Birleştirme)

**Konsept:** İki arşivdeki asset'leri tek bir hedef arşivde toplar.

**Çakışma Stratejisi** (asset ID eşleşirse):
- `keep_newer` — değiştirme tarihi yeniyse üzerine yaz (önerilen varsayılan)
- `keep_both` — ID çakışırsa UUID suffix ekle
- `skip_existing` — hedefte varsa atla

**`src/services/archiveOps.ts`** (yeni dosya)
```typescript
export interface JoinOptions {
  sourceId: string;
  targetId: string;
  conflictStrategy: 'keep_newer' | 'keep_both' | 'skip_existing';
  includeEmbeddings: boolean;
  includeTags: boolean;
}

export async function joinArchives(opts: JoinOptions): Promise<{ merged: number; skipped: number; conflicts: number }>
```

**İç işleyiş:**
1. `getAllAssetsFromArchive(sourceId)` → tüm source asset'leri
2. Her asset için hedef arşivde ID kontrolü
3. Çakışma stratejisine göre `upsertAsset()` veya skip
4. Tags: `getTagsForAssets` → hedef arşivde `upsertTag`
5. Embeddings: isteğe bağlı, `embeddings` tablosundan kopyalama
6. `saveArchive(targetId)` — sonucu kaydet

**UI:** `ArchiveMergeModal.tsx` (yeni bileşen)
- Kaynak arşiv seç → Hedef arşiv seç
- Çakışma stratejisi radio
- Önizleme: kaç asset taşınacak, kaç çakışma var
- Onayla → Join başlat + progress göstergesi

---

### FAZ 3 — Extract (Filtrelenmiş Çıkarma)

**Konsept:** Mevcut arşivden belirli kriterlere uyan asset'leri yeni (veya var olan) bir arşive taşı/kopyala.

**`src/services/archiveOps.ts`'e eklenir:**
```typescript
export interface ExtractOptions {
  sourceId: string;
  newArchiveName: string;  // veya var olan targetId
  filter: {
    folderPaths?: string[];   // belirli tarama klasörleri
    fileTypes?: AssetType[];
    dateRange?: { from: string; to: string };
    tags?: string[];
    projectPhase?: ProjectPhase;
  };
  mode: 'copy' | 'move';  // copy = kaynak kalır, move = kaynaktan silinir
}

export async function extractToNewArchive(opts: ExtractOptions): Promise<{ extracted: number; archiveId: string }>
```

**UI:** `ArchiveExtractModal.tsx` (yeni bileşen)
- Kaynak arşiv + filtre kriterleri
- Hedef: "Yeni Arşiv Oluştur" veya mevcut arşiv seç
- Kopyala / Taşı seçimi
- Önizleme sayımı

---

## Kritik Dosyalar

| Dosya | Değişim Türü | Faz |
|-------|-------------|-----|
| `src/services/database.ts` | Büyük refaktör: dbMap, ArchiveDef, scanned_roots, yeni fonksiyonlar | 1 + 1.5 |
| `src/store/useStore.ts` | archives state, string ID, scannedRoots, activeRootFilters | 1 + 1.5 |
| `src-tauri/src/ollama_db.rs` | ExtraArchiveConfig, read/write_archive komutları | 1 |
| `src-tauri/src/lib.rs` | Yeni komut kayıtları | 1 |
| `src/components/Sidebar.tsx` | Dinamik arşiv listesi + SourceFoldersPanel entegrasyonu | 1 + 1.5 |
| `src/components/SourceFoldersPanel.tsx` | YENİ — kaynak klasör listesi, context menü, filtre | 1.5 |
| `src/hooks/useScanWorkflow.ts` | Tarama sonrası scanned_roots kaydı güncelleme | 1.5 |
| `src/hooks/useHybridFilteredAssets.ts` | activeRootFilters entegrasyonu | 1.5 |
| `src/components/SettingsModal.tsx` | Dinamik ArchiveCard render | 1 |
| `src/services/archiveOps.ts` | YENİ — join + extract mantığı | 2 + 3 |
| `src/components/ArchiveMergeModal.tsx` | YENİ — Join UI | 2 |
| `src/components/ArchiveExtractModal.tsx` | YENİ — Extract UI (scanned_roots verisini kullanır) | 3 |
| `src/components/DuplicateFinderModal.tsx` | scope tipi string'e güncellenir | 1 |

---

## Geriye Dönük Uyumluluk

- Mevcut `'main'` ve `'local'` ID'leri sabit kalır — disk dosyaları değişmez
- İlk çalıştırmada mevcut iki arşiv otomatik olarak `ArchiveDef` listesine dönüştürülür:
  ```
  { id: 'main', name: 'Ana Arşiv', type: 'shared', createdAt: ... }
  { id: 'local', name: 'Yerel Arşiv', type: 'personal', createdAt: ... }
  ```
- localStorage `archivist_active_archive` `'main'`/`'local'` değerleri geçerliliğini korur
- Viewer rolü: `shared` tipli arşivler salt-okunur, `personal` tipli arşivler tam erişim

---

## Viewer Rol Uyumu

- `assertWriteAccess()`: `activeArchive === 'main'` kontrolü → `getArchiveDef(activeArchiveId)?.type === 'shared'` olarak güncellenir
- Yeni arşiv oluştururken viewer yalnızca `personal` tipli oluşturabilir
- `shared` tipli arşivlere sadece admin yazabilir

---

## Doğrulama (Test Planı)

### Faz 1 — Çoklu Arşiv
1. **Temel**: Uygulama açıldığında mevcut `main` ve `local` arşivler listede görünür, geçiş çalışır
2. **Yeni arşiv**: Sidebar'dan "+" ile yeni arşiv oluşturulur, tarama yapılır, kaydedilir, restart sonrası korunur
3. **Yeniden adlandırma**: Arşiv adı değiştirilir, UI güncellenir, ID değişmez

### Faz 1.5 — Kaynak Klasör Paneli
4. **Migrasyon**: Mevcut asset'lerden otomatik kök dizin tespiti yapılır, scanned_roots tablosu dolar
5. **Tarama → kayıt**: Yeni klasör tarandığında scanned_roots'a otomatik eklenir, panel güncellenir
6. **Klasör filtresi**: Panelden klasör seçince grid sadece o klasördeki asset'leri gösterir
7. **Çoklu filtre**: Klasör filtresi + faceted filtreler birlikte çalışır (AND mantığı)
8. **Yeniden adlandırma**: Klasör label'ı değiştirilir, path değişmez, filtre bozulmaz
9. **Kaldırma vs silme**: "Arşivden çıkar" sadece root kaydını pasifleştirir; "Sil" onay sonrası asset'leri de siler
10. **Boş durum**: Hiç kök yoksa bilgilendirme mesajı ve tara butonu görünür

### Faz 2–3 — Join/Extract
11. **Join**: İki arşiv birleştirilir, asset sayısı doğrulanır, çakışma stratejisi test edilir
12. **Extract klasör entegrasyonu**: Extract modal'ında scanned_roots listesi seçim kaynağı olarak çalışır
13. **Extract**: Filtreli subset çıkarılır, kaynak arşiv `move` modunda azalır

### Genel
14. **Viewer kısıtı**: Viewer ile `shared` arşive yazma denemesi hata verir
15. **TypeScript**: `npx tsc --noEmit` hatasız geçer

---

## Uygulama Sırası

### Faz 1 — Çoklu Arşiv Altyapısı
1. `src/services/database.ts` — dbMap refaktörü (en kritik)
2. `src/store/useStore.ts` — archives state + string ID
3. `src-tauri/src/ollama_db.rs` + `lib.rs` — yeni komutlar
4. UI bileşenleri — Sidebar arşiv listesi, SettingsModal

### Faz 1.5 — Kaynak Klasör Paneli
5. `src/services/database.ts` — `scanned_roots` tablosu + CRUD + migrasyon
6. `src/store/useStore.ts` — `scannedRoots`, `activeRootFilters` state
7. `src/components/SourceFoldersPanel.tsx` — YENİ bileşen
8. `src/components/Sidebar.tsx` — panel entegrasyonu
9. `src/hooks/useScanWorkflow.ts` — tarama → root kayıt bağlantısı
10. `src/hooks/useHybridFilteredAssets.ts` — klasör filtre entegrasyonu
11. i18n anahtarları — `tr.json`, `en.json` güncellemesi

### Faz 2 — Join
12. `src/services/archiveOps.ts` — join mantığı
13. `src/components/ArchiveMergeModal.tsx` — Join UI

### Faz 3 — Extract
14. `src/services/archiveOps.ts` — extract mantığı (scanned_roots verisini kullanır)
15. `src/components/ArchiveExtractModal.tsx` — Extract UI
