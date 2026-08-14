// IPC alan modulu: kurasyon — etiket/favori/koleksiyon/proje-durumu (+ toplu kurasyon),
// asset iliskileri, RAG-dislama ve cop kutusu (soft-delete).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.

import { invoke } from "@tauri-apps/api/core";
import type { AssetRow, CollectionRef, Facet, ProjectMeta } from "./assets";

/** TOPLU proje-durum yamasi — `bulk_set_project_meta` argumani (camelCase; sunucu `BulkProjectMetaArg`
 *  ile birebir). Her alan icin `apply*` bayragi: yalniz true olan YAZILIR (isaretlenmeyen korunur —
 *  tek-asset `ProjectMeta` full-replace'inden fark). Deger bos/whitespace → sunucuda null (temizlenir).
 *  `rejectionReason` yalniz onay uygulanip 'rejected' iken yazilir (aksi halde temizlenir). */
export interface BulkProjectPatch {
  applyClient: boolean;
  clientName: string | null;
  applyApproval: boolean;
  approvalStatus: string | null;
  rejectionReason: string | null;
  applyVersion: boolean;
  versionLabel: string | null;
  applyDeadline: boolean;
  deadline: string | null; // ISO YYYY-MM-DD
}

/** Bir onay durumu GECISI (asset-bazli gecmis; sunucu `ApprovalLogRow`, camelCase). En yeni once.
 *  `fromStatus`/`toStatus` null olabilir (durum atanmamis). `reason` yalniz reddedilmede dolu.
 *  `changedAt` unix SANIYE (JS Date icin ×1000). Detay panelindeki "Onay geçmişi" bunu gosterir. */
export interface ApprovalLogEntry {
  id: number;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  changedBy: string;
  changedAt: number;
}

/** Asset iliski turu (urun-kumesi; backend dogrular). `duplicate` kopya · `version` surum ·
 *  `xref` dis referans (XREF/link) · `derived` turetilmis (render/PDF ciktisi) · `backup` yedek/kilit
 *  sidecar (.bak/.dwl → kaynak). */
export type RelationKind = "duplicate" | "version" | "xref" | "derived" | "backup";

/** Bir asset iliskisi (detay "İlişkiler" sekmesi; sunucu `RelationDto`, camelCase). Yon iki
 *  taraflidir: `outgoing=true` → BU asset kaynak (→ karsi); `false` → karsi kaynak (← bu).
 *  `other*` alanlari bagli (karsi) AKTIF asset'i tanimlar (coptekiler backend'de haric). */
export interface Relation {
  id: number;
  kind: RelationKind;
  outgoing: boolean;
  otherId: number;
  otherPath: string;
  otherFileName: string;
}

/** Bir PROJE (entity) satiri — adli proje; asset'ler `assets.project_id` ile ona atanir.
 *  Sunucu `ProjectRow` ile birebir (camelCase). `assetCount`: bu projeye atanmis AKTIF
 *  (coptekiler haric) asset sayisi. Opsiyonel alanlar backend'de NULL → burada null. */
export interface ProjectRow {
  id: number;
  name: string;
  clientName: string | null;
  phase: string | null;
  status: string | null;
  description: string | null;
  deadline: string | null; // ISO YYYY-MM-DD
  createdAt: number; // unix saniye
  assetCount: number;
}

/** Proje olustur/guncelle girdisi (sunucu `ProjectInput` ile birebir; camelCase). `name`
 *  ZORUNLU (bos → backend Err). Opsiyonel alanlar bos ise **null** gonderilir ("" DEGIL) →
 *  backend NULL saklar. `update_project` full-replace'tir (verilmeyen alan null'lanir). */
export interface ProjectInput {
  name: string;
  clientName?: string | null;
  phase?: string | null;
  status?: string | null;
  description?: string | null;
  deadline?: string | null; // ISO YYYY-MM-DD
}

/** Aynı-kök OTO-tespit raporu (`detect_relations`; camelCase). */
export interface DetectRelationsReport {
  /** Aday grup sayısı (≥2 farklı uzantılı aynı-kök). */
  groups: number;
  /** Yeni oluşturulan `derived` iliski sayısı. */
  created: number;
}

/** Kurasyon (etiket/favori/koleksiyon/proje-durum/iliski/cop) komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const curationIpc = {
  // ── Toplu kurasyon (P2.5): undo-kayitli, tek komut (per-asset dongu yerine) ──
  /** Favori durumunu TOPLU ayarla (delta; yalniz degisen id kaydedilir → undo hassas). Editor+.
   *  Doner: degisen sayi. */
  bulkSetFavorite: (ids: number[], on: boolean): Promise<number> =>
    invoke<number>("bulk_set_favorite", { ids, on }),

  /** Etiketi TOPLU ekle (delta; undo-kayitli). Editor+. Doner: degisen sayi. */
  bulkAddTag: (ids: number[], name: string): Promise<number> =>
    invoke<number>("bulk_add_tag", { ids, name }),

  /** Etiketi TOPLU kaldir (delta; undo-kayitli). Editor+. Doner: degisen sayi. */
  bulkRemoveTag: (ids: number[], name: string): Promise<number> =>
    invoke<number>("bulk_remove_tag", { ids, name }),

  /** Ada gore (find-or-create) koleksiyona TOPLU ekle (undo-kayitli; koleksiyon bu islemle
   *  olustuysa geri-al onu bos kalinca siler). Editor+. Doner: koleksiyon id. */
  bulkAddToCollection: (ids: number[], name: string): Promise<number> =>
    invoke<number>("bulk_add_to_collection", { ids, name }),

  /** Koleksiyondan TOPLU cikar (undo-kayitli). Editor+. `name` yalniz undo panel etiketi. */
  bulkRemoveFromCollection: (collectionId: number, ids: number[], name: string): Promise<number> =>
    invoke<number>("bulk_remove_from_collection", { collectionId, ids, name }),

  // ── Kurasyon (Faz 4.3): etiket + favori (write = editor/admin) ──
  addTag: (assetId: number, name: string): Promise<void> =>
    invoke<void>("add_tag", { assetId, name }),

  removeTag: (assetId: number, name: string): Promise<void> =>
    invoke<void>("remove_tag", { assetId, name }),

  setTagColor: (name: string, color: string | null): Promise<void> =>
    invoke<void>("set_tag_color", { name, color }),

  /** Etiketi VARLIK duzeyinde yeniden adlandir (tum asset'lerde birden). Editor+.
   *  Hedef ad kullanimdaysa backend REDDEDER (sessiz birlestirme yok). Geri-alinabilir. */
  renameTag: (oldName: string, newName: string): Promise<void> =>
    invoke<void>("rename_tag", { oldName, newName }),

  /** Etiketi VARLIK duzeyinde sil → doner: etkilenen dosya sayisi. Editor+.
   *  Yikici ama geri-alinabilir (renk + tum baglar undo kaydinda anlik-goruntulenir). */
  deleteTag: (name: string): Promise<number> => invoke<number>("delete_tag", { name }),

  setFavorite: (assetId: number, on: boolean): Promise<void> =>
    invoke<void>("set_favorite", { assetId, on }),

  tagFacets: (limit: number): Promise<Facet[]> =>
    invoke<Facet[]>("tag_facets", { limit }),

  favoriteCount: (): Promise<number> => invoke<number>("favorite_count"),

  // ── Proje-durum (H2 pariti): musteri/onay/versiyon/teslim (write = editor/admin) ──
  /** Bir asset'in proje-durum alanlarini ayarla. Editor+ gerekir. Bos/whitespace
   *  string sunucuda null'a temizlenir; `approval_status` whitelist disi → hata.
   *  `ProjectMeta` (snake_case okuma DTO'su) → sunucu `ProjectMetaArg` (camelCase)
   *  alan adlarina cevrilir; boylece okuma/yazma tek tipi paylasir. */
  setProjectMeta: (assetId: number, meta: ProjectMeta): Promise<void> =>
    invoke<void>("set_project_meta", {
      assetId,
      meta: {
        clientName: meta.client_name,
        approvalStatus: meta.approval_status,
        rejectionReason: meta.rejection_reason,
        versionLabel: meta.version_label,
        deadline: meta.deadline,
      },
    }),

  /** Bir asset KUMESININ proje-durum alanlarini TOPLU ayarla. Editor+ gerekir. Yalniz
   *  `apply*=true` alanlar yazilir (isaretlenmeyen korunur); bos/whitespace sunucuda null'a
   *  temizlenir; `approvalStatus` whitelist disi → hata. `patch` zaten camelCase (sunucu
   *  `BulkProjectMetaArg` ile birebir). Doner: guncellenen satir sayisi. */
  bulkSetProjectMeta: (ids: number[], patch: BulkProjectPatch): Promise<number> =>
    invoke<number>("bulk_set_project_meta", { ids, patch }),

  /** Bir asset'in ONAY GECIS gecmisi (en yeni once; en cok 100). Salt-okuma (her rol).
   *  Onay durumu her degistiginde bir satir (eski→yeni + sebep + kim + ne zaman). */
  listApprovalLog: (assetId: number): Promise<ApprovalLogEntry[]> =>
    invoke<ApprovalLogEntry[]>("list_approval_log", { assetId }),

  /** Onay durumuna gore asset sayilari (proje-durum faceti). `extFacets`/`tagFacets`
   *  ile ayni `Facet` sekli. Salt-okuma (her rol). */
  approvalFacets: (): Promise<Facet[]> => invoke<Facet[]>("approval_facets"),

  /** Musteri adina gore asset sayilari (proje-durum faceti). Salt-okuma (her rol). */
  clientFacets: (limit: number): Promise<Facet[]> =>
    invoke<Facet[]>("client_facets", { limit }),

  /** Versiyon etiketine gore asset sayilari (proje-durum faceti). Salt-okuma (her rol). */
  versionFacets: (limit: number): Promise<Facet[]> =>
    invoke<Facet[]>("version_facets", { limit }),

  /** Termin yilina gore asset sayilari (proje-durum faceti). Salt-okuma (her rol). */
  deadlineYearFacets: (): Promise<Facet[]> => invoke<Facet[]>("deadline_year_facets"),

  // ── Koleksiyonlar (Faz 4.3b): adli asset gruplari (write = editor/admin) ──
  listCollections: (): Promise<CollectionRef[]> =>
    invoke<CollectionRef[]>("list_collections"),

  createCollection: (name: string): Promise<number> =>
    invoke<number>("create_collection", { name }),

  deleteCollection: (id: number): Promise<void> =>
    invoke<void>("delete_collection", { id }),

  renameCollection: (id: number, name: string): Promise<void> =>
    invoke<void>("rename_collection", { id, name }),

  setCollectionColor: (id: number, color: string | null): Promise<void> =>
    invoke<void>("set_collection_color", { id, color }),

  addToCollection: (collectionId: number, assetId: number): Promise<void> =>
    invoke<void>("add_to_collection", { collectionId, assetId }),

  removeFromCollection: (collectionId: number, assetId: number): Promise<void> =>
    invoke<void>("remove_from_collection", { collectionId, assetId }),

  // ── Projeler (entity): adli proje + asset↔proje atama (write = editor+; list = her rol) ──
  /** Yeni proje olustur (find-or-create DEGIL — her cagri yeni kayit). **Editor+** gerekir.
   *  Bos ad → backend Err. Doner: yeni proje id. */
  createProject: (input: ProjectInput): Promise<number> =>
    invoke<number>("create_project", { input }),

  /** Tum projeler + atanmis AKTIF asset sayilari (`assetCount`). Salt-okuma (her rol). */
  listProjects: (): Promise<ProjectRow[]> => invoke<ProjectRow[]>("list_projects"),

  /** Projeyi guncelle (ad + meta FULL-REPLACE; verilmeyen opsiyonel alan null'lanir).
   *  **Editor+** gerekir. Bos ad → backend Err. */
  updateProject: (id: number, input: ProjectInput): Promise<void> =>
    invoke<void>("update_project", { id, input }),

  /** Projeyi sil. **Editor+** gerekir. FK SET NULL: atanmis asset'ler SILINMEZ — yalniz
   *  proje atamalari kalkar (project_id → NULL). */
  deleteProject: (id: number): Promise<void> => invoke<void>("delete_project", { id }),

  /** Asset KUMESINI bir projeye ata (`assets.project_id`). **Editor+** gerekir.
   *  `projectId=null` → atamayi KALDIR. Olmayan projeye atama → backend Err.
   *  Doner: etkilenen asset sayisi. */
  assignAssetsToProject: (ids: number[], projectId: number | null): Promise<number> =>
    invoke<number>("assign_assets_to_project", { ids, projectId }),

  // ── Cop kutusu / soft-delete (§O): sil→cop, listele, geri-yukle, kalici-sil ──
  /** Asset'leri cop kutusuna at (soft-delete; GERI-ALINABILIR). Editor+ gerekir.
   *  Etkilenen (cop'e atilan) sayisi doner. */
  trashAssets: (ids: number[]): Promise<number> =>
    invoke<number>("trash_assets", { ids }),

  /** Asset'leri cop kutusundan geri yukle (restore; yeniden aktif). Editor+ gerekir.
   *  Etkilenen (geri donen) sayisi doner. */
  restoreAssets: (ids: number[]): Promise<number> =>
    invoke<number>("restore_assets", { ids }),

  /** Asset'leri KALICI sil (purge; GERI-ALINAMAZ — tum iliskili veri silinir).
   *  **Admin** gerekir. Etkilenen sayisi doner. */
  purgeAssets: (ids: number[]): Promise<number> =>
    invoke<number>("purge_assets", { ids }),

  /** Cop kutusundaki asset'ler (en son atilan ilk). `list_assets` ile ayni `AssetRow`
   *  sekli. Salt-okuma (her rol). */
  listTrash: (): Promise<AssetRow[]> => invoke<AssetRow[]>("list_trash"),

  /** Cop kutusundaki asset sayisi (TopBar rozeti). Salt-okuma (her rol). */
  trashCount: (): Promise<number> => invoke<number>("trash_count"),

  // ── §G Asset iliskileri (detay "İlişkiler" sekmesi): oku her rol; ekle/kaldir editor+ ──
  /** Bir asset'in iliskileri (her iki yon; karsi AKTIF asset'e cozulmus). Salt-okuma (her rol).
   *  Copteki karsi-uclar backend'de haric. */
  assetRelations: (assetId: number): Promise<Relation[]> =>
    invoke<Relation[]>("asset_relations", { assetId }),

  /** İki asset arasi iliski kur (`srcId` → `dstId`, `kind`). **Editor+** gerekir. `kind` urun-kumesi
   *  disi → backend hata; `src==dst` reddedilir; tekrar → no-op (backend UNIQUE). */
  addRelation: (srcId: number, dstId: number, kind: RelationKind): Promise<void> =>
    invoke<void>("add_relation", { srcId, dstId, kind }),

  /** Bir iliskiyi id ile kaldir. **Editor+** gerekir. */
  removeRelation: (id: number): Promise<void> =>
    invoke<void>("remove_relation", { id }),

  /** Aynı-kök (plan.dwg ↔ plan.pdf) iliskilerini OTO-tespit et (`detect_relations`; **admin**).
   *  Farkli-uzantili ayni-kok gruplarini `derived` bagler; mevcut/manuel baglari EZMEZ. Rapor doner. */
  detectRelations: (): Promise<DetectRelationsReport> =>
    invoke<DetectRelationsReport>("detect_relations"),

  /** Asset'leri RAG'den manuel disla / dahil et (A1 hassasiyet manuel istisnasi). Editor+ gerekir.
   *  `excluded=true` → sohbet retrieve'i artik bu asset'leri getirmez (kalici; re-index korur).
   *  Etkilenen asset sayisi doner. */
  setRagExcluded: (ids: number[], excluded: boolean): Promise<number> =>
    invoke<number>("set_rag_excluded", { ids, excluded }),
};
