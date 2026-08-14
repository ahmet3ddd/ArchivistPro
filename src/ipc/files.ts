// IPC alan modulu: dosya islemleri — OS ile ac/goster, tasima/yeniden-adlandirma (refile),
// undo/redo, kural-bazli klasorleme (organize), kopya bulucu (dedup), cok-arsiv tasima
// (.archivistpro) ve DWG/DXF geometrik sekil arama. Tuketiciler `./client` facade'inden import eder.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { AssetRow, ListOpts } from "./assets";

/** `rename_asset` sonucu (sunucu-tarafi `RefileResult`; camelCase). Ayni klasorde yeniden
 *  adlandirma → disk + DB birlikte guncellenir, eski/yeni tam yol doner. */
export interface RefileResult {
  oldPath: string;
  newPath: string;
}

/** `refile_assets` canli ilerleme (Channel ile akar; reindex/ingest ile BIREBIR ayni desen,
 *  camelCase). `processed` tasinan, `total` toplam secili; `currentFile` su an tasinan dosya
 *  (LTR; son ozette bos olabilir). */
export interface RefileProgress {
  processed: number;
  total: number;
  currentFile: string;
}

/** `refile_assets` sonucu (toplu tasi raporu; camelCase). `moved` basariyla tasinan; `skipped`
 *  atlanan (or. zaten ayni klasorde) + neden; `failed` hata alan + hata. `skipped.reason`/
 *  `failed.error` backend hata kodudur (`same_dir`/`target_exists`/`io:<detay>`...) →
 *  `refileErrorMessage` ile i18n'e cevrilir. */
export interface RefileBatchReport {
  moved: number;
  skipped: Array<{ path: string; reason: string }>;
  failed: Array<{ path: string; error: string }>;
}

/** Undo gecmisi satiri (`list_undo_ops`; camelCase). `kind`: refile_move | rename |
 *  organize_move | project_meta_bulk → i18n `undo.kind.*`. `label` dil-NOTR veri (hedef
 *  klasor / yeni ad; meta'da bos). `undone` → geri alinmis (soluk; yeniden geri-alinamaz). */
export interface UndoOpRow {
  id: number;
  createdAt: number; // unix saniye
  kind: string;
  label: string;
  itemCount: number;
  undone: boolean;
}

/** `undo_op` sonucu. `undone=false` → kayit AKTIF birakildi (gecici hatalar — kilitli dosya
 *  vb. — cozulunce yeniden denenebilir; zaten geri-alinanlar ikinci turda zarifce atlanir). */
export interface UndoReport {
  reverted: number;
  skipped: Array<{ path: string; reason: string }>;
  failed: Array<{ path: string; reason: string }>;
  undone: boolean;
}

/** `plan_organize` sonucu (salt-okuma ONIZLEME; camelCase). Her asset icin hedef-koke GORELI klasor
 *  SEGMENTLERI (`segments`, sirali; `structures` ile ayni sayida — or. ["Musteri A","01-Cizimler"])
 *  + dosya adi. Ic-ice onizleme agaci bu segmentlerden kurulur; bos dizi → dosya dogrudan hedef-kok
 *  altina. Disk DEGISMEZ. Backend gecersiz `structures`/`mode` icin `invalid_structure`/`invalid_mode`
 *  (throw) doner → `organize.err.*`. */
export interface OrganizePlanItem {
  id: number;
  fileName: string;
  segments: string[];
}

// ── P3 Kopya bulucu (yinelenen/benzer dosya) — salt-okuma tarama (her rol); silme editor+ ──
/** Bir kopya-grubunun turu (sunucu `DupGroup.kind` ile birebir). `exact_hash` birebir icerik
 *  (content_hash) · `same_name` ayni dosya adi · `visual_similar` gorsel-benzer (pHash Hamming) ·
 *  `structural_similar` yapisal-benzer (DXF/DWG sekil geometrisi Jaccard). */
export type DupKind = "exact_hash" | "same_name" | "visual_similar" | "structural_similar";

/** Bir kopya-grubu uyesi (tek asset; sunucu `DupMember` ile birebir, camelCase). */
export interface DupMember {
  id: number;
  path: string;
  fileName: string;
  sizeBytes: number;
}

/** Bir kopya-grubu (ayni/benzer dosyalar; sunucu `DupGroup`). `score` 0-100 benzerlik
 *  (birebir icerik = 100). `members` en az 2 (grup tanimi). */
export interface DupGroup {
  kind: DupKind;
  score: number;
  members: DupMember[];
}

/** `find_duplicates` sonucu (sunucu `DuplicateReport`). `totalGroups`/`totalFiles` ozet sayaclar. */
export interface DuplicateReport {
  groups: DupGroup[];
  totalGroups: number;
  totalFiles: number;
  /** Tarama kullanici tarafindan IPTAL edildi mi. `true` iken `groups` DAIMA bostur.
   *  ⚠️ Bu bayrak olmadan iptal edilen tarama "kopya bulunamadi" gibi gorunurdu — sessiz
   *  yanlis cevap; UI dogru mesaji yalniz buna bakarak secebilir. */
  cancelled: boolean;
}

// ── Cok-arsiv tasima (portable .archivistpro export/import + YOL-REMAP) — Dilim 3 kontrati ──
// DTO'lar backend `archive_share.rs` ile birebir (camelCase). Import semantigi butun-DB REPLACE:
// mevcut arsivi TAMAMEN degistirir (backend once otomatik `pre-import` guvenlik yedegi alir; hata
// olursa güvenlik yedeginden rollback). Ad onekleri (`Archive*`) model-import DTO'lariyla
// (`ImportProgress`/`ImportReport`) cakismayi onler.

/** Export ilerlemesi (Channel; faz etiketi — determinate yuzde YOK). */
export interface ArchiveExportProgress {
  phase: "preparing" | "copying" | "writingManifest" | "done";
}

/** Export sonucu. `sizeBytes` = olusan `.archivistpro` dosyasinin boyutu (bayt). */
export interface ArchiveExportReport {
  assetCount: number;
  sizeBytes: number;
  path: string;
}

/** Bir kaynak-kok ozeti (remap oneri satiri) — backend `RootStat` ile birebir. */
export interface ArchiveRootStat {
  path: string;
  count: number;
}

/** `.archivistpro` manifest onizlemesi (peek; salt-okuma). `createdAt` ISO UTC
 *  ("2026-07-03T09:30:00Z"). `sourceHost` = arsivi indeksleyen makine; bu makineden
 *  farkliysa "baska makinede olusturulmus" (yollar bu makineye uymayabilir → remap). */
export interface ArchiveManifest {
  formatVersion: string;
  appVersion: string;
  createdAt: string;
  sourceHost: string;
  assetCount: number;
  sourceRoots: ArchiveRootStat[];
  samplePrefix: string;
  schemaVersion: number;
}

/** Tek YOL-REMAP kurali. `newRoot` bos → o kok remap edilmez (dosyalar oldugu yerde). */
export interface ArchiveRemap {
  oldRoot: string;
  newRoot: string;
}

/** Import ilerlemesi (Channel; faz etiketi). */
export interface ArchiveImportProgress {
  phase: "validating" | "backingUp" | "restoring" | "remapping" | "verifying" | "done";
}

/** Import sonucu. `rolledBack=true` → REPLACE basarisiz, güvenlik yedeginden geri alindi
 *  (arsiv import-oncesi haliyle KORUNDU). `filesMissing>0` → remap yanlis olabilir (ornek
 *  dosyalar bu makinede bulunamadi; kalanlari kontrol et). */
export interface ArchiveImportReport {
  assetCount: number;
  remappedRows: number;
  filesChecked: number;
  filesFound: number;
  filesMissing: number;
  rolledBack: boolean;
}

// ── Arsiv BIRLESTIRME (merge/join) — additive: ikinci bir `.archivistpro`'nun asset'lerini CANLI
// arsive EKLER (import'un butun-DB REPLACE'inin aksine kaynak degismez, hedef buyur). DTO'lar
// backend `archive_share.rs` merge yolu ile birebir (camelCase). Onizleme (`preview_merge_archive`)
// salt-okuma sayimdir (gate yok); merge (`merge_archive`) ADMIN + ilerlemeli.

/** Birlestirme onizlemesi (YAZMA YOK; salt-okuma sayim). `duplicateCount` = kaynaktaki, hedefte
 *  ayni icerigi zaten bulunan asset sayisi; `pathCollisionCount` = ayni dosya-yolu cakismasi. */
export interface MergePreview {
  totalSource: number;
  duplicateCount: number;
  pathCollisionCount: number;
}

/** Birlestirme sonucu (additive rapor). `merged` eklenen · `skippedDuplicate` yinelenen icerik
 *  atlandi · `skippedPathConflict` ayni-yol cakismasi atlandi · `tagsReconciled`/`collectionsReconciled`
 *  uzlastirilan etiket/koleksiyon · `totalSource` kaynaktaki toplam asset. */
export interface MergeReport {
  merged: number;
  skippedDuplicate: number;
  skippedPathConflict: number;
  tagsReconciled: number;
  collectionsReconciled: number;
  totalSource: number;
}

/** Birlestirme ilerlemesi (Channel; faz etiketi — determinate yuzde YOK). */
export interface MergeProgress {
  phase: string; // "validating" | "backingUp" | "merging" | "done"
}

// ── Arsiv EXTRACT (filtreli cikarma) — mevcut arsivin bir ALT-KUMESINI (aktif facet filtresine
// uyan asset'ler) yeni bir `.archivistpro`'ya cikarir (import/merge/peek ile uyumlu; merge'in dogal
// tamamlayicisi/tersi). `opts` = ListOpts (liste filtresiyle AYNI tip; FTS `query` YOK sayilir —
// extract facet-tabanli). Onizleme (`previewExtractArchive`) salt-okuma sayimdir (gate yok);
// cikarma (`extractArchive`) ADMIN + ilerlemeli. DTO'lar backend `archive_extract.rs` ile birebir.

/** Extract ilerlemesi (Channel; faz etiketi — determinate yuzde YOK). */
export interface ExtractProgress {
  phase: string; // "preparing" | "copying" | "pruning" | "removing" | "done"
}

/** Extract sonucu. `extracted` cikan (yeni arsivdeki) aktif asset · `removed` move modunda kaynaktan
 *  cope tasinan (copy modunda 0) · `moved` move muydu · `sizeBytes` olusan `.archivistpro` boyutu
 *  (bayt; VACUUM sonrasi) · `path` yazilan dosya yolu. */
export interface ExtractReport {
  extracted: number;
  removed: number;
  moved: boolean;
  sizeBytes: number;
  path: string;
}

// ── DWG/DXF geometrik sekil arama (Dilim 4) — salt-okuma; brute-force tarama Rust'ta ──
// DTO'lar backend `shape_commands.rs` + `archivist-db::shape` ile birebir (camelCase). Renderer
// sekilleri bellege ALMAZ; yalniz `ShapeHit` (asset satiri + skor) gorur. Iki arama yolu:
//   • `searchShapesBySimilarity` : referans sekle (gorselden cikarilan) en benzeyen asset'ler.
//   • `searchShapesByFeatures`   : parametrik kriter on-filtre + sekil-KALITE skoru.
// NOT: benzerlik skoru (referans-yakinlik) ile kriter skoru (kalite) AYRI olceklerdir — yalniz
// kendi liste-ici siralamalari anlamlidir, aralarinda mutlak esik karsilastirmasi yapilmaz.

/** Referans/aday geometrik sekil (benzerlik aramasi; camelCase). `search_shapes_by_similarity`'ye
 *  gonderilir HEM `extract_shape_from_image_bytes`'tan alinir (roundtrip). Skorlamada yalniz
 *  `vertexCount`/`isClosed` + 7 ozellik + bbox kullanilir; `entityType`/`area`/`centroid*` simetri
 *  icin var (gorsel konturdan `bbox*`/`centroid*` = 0, `isClosed` = true). */
export interface ShapeQuery {
  entityType: string;
  vertexCount: number;
  isClosed: boolean;
  area: number;
  perimeter: number;
  aspectRatio: number;
  regularity: number;
  compactness: number;
  solidity: number;
  rectangularity: number;
  bboxW: number;
  bboxH: number;
  centroidX: number;
  centroidY: number;
}

/** Parametrik (kriter) arama filtresi (camelCase; frontend yalniz GONDERIR). Nullable alanlar
 *  verilmezse (null) o filtre uygulanmaz. `layerCategory` bos/"TUMU" → uygulanmaz (frontend
 *  null gonderir). `vertexTolerance` = `vertexCount ± tol`. `includeOpen=false` → yalniz kapali
 *  sekiller. `topK` donen asset sayisi (backend 1..=200 kelepceler). */
export interface ShapeCriteria {
  vertexCount: number | null;
  vertexTolerance: number;
  minRegularity: number | null;
  layerCategory: string | null;
  aspectMin: number | null;
  aspectMax: number | null;
  minCompactness: number | null;
  minRectangularity: number | null;
  includeOpen: boolean;
  topK: number;
}

/** Yuklenen gorselden cikarilan baskin sekil (camelCase). `shape` dogrudan
 *  `searchShapesBySimilarity`'ye geri gonderilir (roundtrip; gorsel kontur → `isClosed=true`).
 *  Sayimlar/boyutlar yalniz UI teshis/gosterge (kontur/vertex/gorsel-en-boy). */
export interface DetectedShape {
  shape: ShapeQuery;
  contourPointCount: number;
  simplifiedPointCount: number;
  imageWidth: number;
  imageHeight: number;
}

/** Bir sekil-arama isabeti: asset satiri (mevcut `AssetRow` reuse) + skor `[0,1]`. Ayni asset'in
 *  birden cok sekli varsa backend EN IYI skorla TEK kez doner (asset-duzeyi). `score` benzerlik
 *  yolunda referans-yakinlik, kriter yolunda kalite skorudur (bkz yukaridaki NOT). */
export interface ShapeHit {
  asset: AssetRow;
  score: number;
}

/** Dosya islemleri (ac/tasi/undo/organize/kopya/arsiv/sekil) komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const filesIpc = {
  // ── OS entegrasyonu (dosyayi ac / dosya yoneticisinde goster) — Rust komutu (`opener` crate =
  //    ShellExecuteW). tauri-plugin-opener Windows'ta Unicode/bosluk yollarda basarisiz oldugu icin
  //    frontend eklentisi YERINE bu kullanilir. Her rol. Reddederse String kodu: "not_found" | ham. ──
  /** Dosyayi OS varsayilan uygulamasiyla ac (`open_path_os`). Reddederse "not_found" = yol yok / ham hata. */
  openPathOs: (path: string): Promise<void> => invoke<void>("open_path_os", { path }),
  /** Dosyayi dosya yoneticisinde goster/sec (`reveal_path_os`). */
  revealPathOs: (path: string): Promise<void> => invoke<void>("reveal_path_os", { path }),

  // ── Refile (dosya tasi / yeniden-adlandir; hepsi ADMIN — backend rbac zorlar) ──
  /** Bir asset'i AYNI klasorde yeniden adlandir (`rename_asset`; basit invoke, Channel yok).
   *  **Admin** — viewer/editor'da backend Err atar. Disk + DB birlikte guncellenir; eski/yeni tam
   *  yol doner. Hata String kodu doner (`invalid_name`/`source_missing`/`target_exists`/`db_conflict`/
   *  `not_found`/`io:<detay>`) → `refileErrorMessage` ile i18n mesajina cevrilir. */
  renameAsset: (id: number, newName: string): Promise<RefileResult> =>
    invoke<RefileResult>("rename_asset", { id, newName }),

  /** Asset'leri hedef klasore TASI (ad korunur; `refile_assets`). **Admin** — viewer/editor'da backend
   *  Err atar. Canli ilerleme Channel ile akar (reindex/ingest ile BIREBIR ayni desen); onProgress
   *  yoksa kanal yine gecer (backend daima yollar) ama dinlenmez — zararsiz. Bitince `RefileBatchReport`
   *  doner (tasinan/atlanan/hata; per-dosya nedenler rapor icinde). Tekil "tasi" da bu komutla ([id])
   *  yapilir — ayri komut yok. */
  refileAssets: (
    ids: number[],
    destDir: string,
    onProgress?: (p: RefileProgress) => void,
  ): Promise<RefileBatchReport> => {
    const channel = new Channel<RefileProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<RefileBatchReport>("refile_assets", { ids, destDir, onProgress: channel });
  },

  // ── Undo gecmisi (P2.5 stabilite): geri-alinabilir islemler ──
  /** Geri-al gecmisi (en yeni once). **Editor+** — viewer'da backend Err atar. */
  listUndoOps: (limit: number): Promise<UndoOpRow[]> =>
    invoke<UndoOpRow[]>("list_undo_ops", { limit }),

  /** Bir kaydi geri al (`undo_op`). Yetki kind-bazli (tasima=admin · proje-durumu=editor;
   *  islemin kendisiyle AYNI kademe). Ilerleme Channel ile akar (refile deseni). Hata
   *  kodlari: `not_found` · `already_undone` · `unknown_kind` · `corrupt_payload`. */
  undoOp: (id: number, onProgress?: (p: RefileProgress) => void): Promise<UndoReport> => {
    const channel = new Channel<RefileProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<UndoReport>("undo_op", { id, onProgress: channel });
  },

  /** Bir kaydi ILERI AL (redo; undo'nun tersi — islemi yeniden uygular). Yalniz `undone` kayit.
   *  Yetki kind-bazli (undo ile ayni). Hata: `not_found` · `not_undone` · `corrupt_payload`. */
  redoOp: (id: number, onProgress?: (p: RefileProgress) => void): Promise<UndoReport> => {
    const channel = new Channel<RefileProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<UndoReport>("redo_op", { id, onProgress: channel });
  },

  /** Kural-bazli oto-klasorleme ONIZLEMESI (salt-okuma; `plan_organize`, basit invoke, Channel yok).
   *  **Admin**. `structures`: sirali boyut listesi — her biri bir klasor katmani
   *  (`"byExt","byClient","byTag","byApproval","byVersion","byYear"`). Her asset icin hedef-koke goreli
   *  klasor SEGMENTLERI doner (segments.length === structures.length); disk DEGISMEZ. Bos `structures`
   *  → segments bos (hepsi kok altinda). Gecersiz deger → `invalid_structure` (throw) → i18n. */
  planOrganize: (ids: number[], structures: string[]): Promise<OrganizePlanItem[]> =>
    invoke<OrganizePlanItem[]>("plan_organize", { ids, structures }),

  /** Asset'leri kurala gore hedef-kok altina TASI/KOPYALA/duzenle (`organize_assets`; refile ile BIREBIR
   *  ayni Channel deseni). **Admin**. `structures`: sirali cok-seviyeli boyut listesi (bkz `planOrganize`).
   *  `mode`: `"move"` (tasi) veya `"copy"` (kopyala). Canli ilerleme Channel ile akar; onProgress yoksa
   *  kanal yine gecer (backend daima yollar) ama dinlenmez — zararsiz. Bitince `RefileBatchReport` doner
   *  (refile ile ayni tip → `refileErrorMessage` ile hata cevrilir). Gecersiz structures/mode/dest →
   *  `invalid_structure`/`invalid_mode`/`invalid_dest`/`dest_create_failed:..` (throw) → i18n. */
  organizeAssets: (
    ids: number[],
    destRoot: string,
    structures: string[],
    mode: string,
    onProgress?: (p: RefileProgress) => void,
  ): Promise<RefileBatchReport> => {
    const channel = new Channel<RefileProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<RefileBatchReport>("organize_assets", {
      ids,
      destRoot,
      structures,
      mode,
      onProgress: channel,
    });
  },

  /** Bir KLASOR altindaki (alt klasorler dahil) indeksli tum asset id'lerini doner
   *  (`asset_ids_under_folder`, basit invoke). **Admin**. OrganizeModal'in "Klasor sec…"
   *  kaynaginda kullanilir: kullanici tek tek dosya secmek yerine bir klasor secer, altindaki
   *  indeksli dosyalar id listesine cozulur. Bos dizi → klasorde indeksli dosya yok. */
  assetIdsUnderFolder: (folder: string): Promise<number[]> =>
    invoke<number[]>("asset_ids_under_folder", { folder }),

  // ── P3 Kopya bulucu (yinelenen/benzer dosya bulucu) — salt-okuma tarama (her rol) ──
  /** Yinelenen/benzer dosyalari bul. `exact` birebir icerik (content_hash) · `sameName` ayni
   *  dosya adi · `visual` gorsel-benzer (`visualMaxDistance` = pHash Hamming esigi 0..64; kucuk =
   *  daha kati). Salt-okuma (her rol). Gorsel modu birkac sn surebilir (async). Bos rapor = yok. */
  findDuplicates: (
    exact: boolean,
    sameName: boolean,
    visual: boolean,
    visualMaxDistance: number,
    structural: boolean,
    structuralMinScore: number,
  ): Promise<DuplicateReport> =>
    invoke<DuplicateReport>("find_duplicates", {
      exact,
      sameName,
      visual,
      visualMaxDistance,
      structural,
      structuralMinScore,
    }),

  /** Devam eden kopya taramasini durdur (gorsel/yapisal O(n²) uzun surer). Tarama yoksa
   *  zararsiz. Panel kapanisinda da cagrilir — arka planda "hayalet" tarama kalmasin. */
  cancelFindDuplicates: (): Promise<void> => invoke<void>("cancel_find_duplicates"),

  // ── Cok-arsiv tasima (portable .archivistpro export/import + YOL-REMAP; export/import ADMIN) ──
  /** Arsivi bir `.archivistpro` (ham SQLite) dosyasina disa aktar (**admin**). Canli ilerleme
   *  Channel ile akar (importModels/ingestFolder deseni). onProgress yoksa kanal yine gecer
   *  (backend daima yollar) ama dinlenmez — zararsiz. Bitince `ArchiveExportReport` doner. */
  exportArchive: (
    dest: string,
    onProgress?: (p: ArchiveExportProgress) => void,
  ): Promise<ArchiveExportReport> => {
    const channel = new Channel<ArchiveExportProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ArchiveExportReport>("export_archive", { dest, onProgress: channel });
  },

  /** Bir `.archivistpro` dosyasinin manifestini onizle (gate YOK — salt-okuma). Gecersiz/bozuk
   *  dosya → backend Err (dostca gosterilir). Import diyalogu bunu onizler. */
  peekArchiveManifest: (path: string): Promise<ArchiveManifest> =>
    invoke<ArchiveManifest>("peek_archive_manifest", { path }),

  /** Bir `.archivistpro` arsivini ice aktar (**admin**; butun-DB REPLACE + YOL-REMAP). Backend once
   *  otomatik güvenlik yedegi alir; hata → rollback (`rolledBack=true`). Canli ilerleme Channel ile.
   *  `remaps` bos → yollar oldugu gibi; bir kuralda `newRoot` bos → o kok atlanir. */
  importArchive: (
    src: string,
    remaps: ArchiveRemap[],
    onProgress?: (p: ArchiveImportProgress) => void,
  ): Promise<ArchiveImportReport> => {
    const channel = new Channel<ArchiveImportProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ArchiveImportReport>("import_archive", { src, remaps, onProgress: channel });
  },

  /** Bir `.archivistpro`'nun birlestirme onizlemesi (sayimlar; YAZMA YOK; salt-okuma). */
  previewMergeArchive: (src: string): Promise<MergePreview> =>
    invoke<MergePreview>("preview_merge_archive", { src }),

  /** Bir `.archivistpro` arsivini CANLI arsive BIRLESTIR (**admin**; additive; ilerlemeli).
   *  `disposition`: "skipDuplicates" | "importAll". `remaps` bos → yollar aynen. */
  mergeArchive: (
    src: string,
    disposition: string,
    remaps: ArchiveRemap[],
    onProgress?: (p: MergeProgress) => void,
  ): Promise<MergeReport> => {
    const channel = new Channel<MergeProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<MergeReport>("merge_archive", { src, disposition, remaps, onProgress: channel });
  },

  // ── Arsiv EXTRACT (filtreli cikarma; onizleme salt-okuma, cikarma ADMIN + ilerlemeli) ──
  /** Facet filtresine uyan asset SAYISI (extract onizleme; salt-okuma). FTS `query` yok sayilir. */
  previewExtractArchive: (opts: ListOpts): Promise<number> =>
    invoke<number>("preview_extract_archive", { opts }),

  /** Filtreli arsiv CIKAR (**admin**; yeni `.archivistpro` alt-kume; ilerlemeli). `opts` = aktif
   *  liste filtresi (FTS `query` yok sayilir). `moveMode=true` → kopyalama BASARILI olduktan sonra
   *  kaynaktan cope tasi (soft-delete; geri-alinabilir). Canli ilerleme Channel ile akar. */
  extractArchive: (
    dest: string,
    opts: ListOpts,
    moveMode: boolean,
    onProgress?: (p: ExtractProgress) => void,
  ): Promise<ExtractReport> => {
    const channel = new Channel<ExtractProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ExtractReport>("extract_archive", { dest, opts, moveMode, onProgress: channel });
  },

  // ── DWG/DXF geometrik sekil arama (Dilim 4) — salt-okuma (rol gate yok); async brute-force ──
  /** Referans sekle (`query`) en benzeyen asset'ler (benzerlik skoru sirali). `topK` donen asset
   *  sayisi (varsayilan cagriyla 40). `includeOpen=false` → yalniz kapali sekiller. Referans sekil
   *  once `extractShapeFromImageBytes` ile gorselden cikarilir (roundtrip). Salt-okuma (her rol). */
  searchShapesBySimilarity: (
    query: ShapeQuery,
    topK: number,
    includeOpen: boolean,
  ): Promise<ShapeHit[]> =>
    invoke<ShapeHit[]>("search_shapes_by_similarity", { query, topK, includeOpen }),

  /** Parametrik kriter aramasi: SQL on-filtre + sekil-KALITE skoru sirali. `criteria.topK` backend'de
   *  1..=200 kelepcelenir; `layerCategory` null → kategori filtresi yok. Salt-okuma (her rol). */
  searchShapesByFeatures: (criteria: ShapeCriteria): Promise<ShapeHit[]> =>
    invoke<ShapeHit[]>("search_shapes_by_features", { criteria }),

  /** Yuklenen gorsel baytlarindan (PNG/JPG/BMP/TIFF) baskin kapali konturu cikar → `DetectedShape`.
   *  `bytes` = `Array.from(new Uint8Array(arrayBuffer))`. Donen `shape` onizlenir sonra aynen
   *  `searchShapesBySimilarity`'ye gonderilir. Decode/kontur hatasi → reddedilir (UI gosterir). */
  extractShapeFromImageBytes: (bytes: number[]): Promise<DetectedShape> =>
    invoke<DetectedShape>("extract_shape_from_image_bytes", { bytes }),

  /** Kompozit (cizim-cizim) arama: referans asset'in (`refAssetId`) sekil kumesine en cok
   *  ortusen diger DXF/DWG asset'ler (ortusme skoru sirali). `topK` 1..=200, `minScore` 0..=100
   *  backend'de kelepcelenir. Referansin sekli yoksa bos doner. Salt-okuma (her rol). */
  searchShapesComposite: (
    refAssetId: number,
    topK: number,
    minScore: number,
  ): Promise<ShapeHit[]> =>
    invoke<ShapeHit[]>("search_shapes_composite", { refAssetId, topK, minScore }),
};
