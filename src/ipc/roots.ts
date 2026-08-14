// IPC alan modulu: Kaynak Klasorler (scanned_roots) yonetimi — H2 Faz-4 pariti.
// Izlenen/taranan kok klasorler artik GERCEK DB entity'si (eskiden localStorage'daydi).
// Kok gruplari (root_groups) + kok etiketleri (root_tags) + klasor-copu (soft-delete) dahil.
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.
//
// Tauri v2: ust-seviye invoke arg'lari camelCase (JS) → snake_case (Rust) cevrilir.
// Tum DTO alanlari serde camelCase ile birebir (backend bu kontrata uyar).

import { invoke } from "@tauri-apps/api/core";

/** Bir kaynak klasorun disk durumu (`folder_source_state`; backend enum'u lowercase serilestirir).
 *  `missing` = yol yok (silinmis/tasinmis/ag surucusu kopuk) · `unreadable` = var ama okunamiyor
 *  (izin/IO) · `ok` = var ve okunabiliyor. `missing`/`unreadable` ALARM, `ok` iyi-huylu. */
export type FolderSourceState = "missing" | "unreadable" | "ok";

/** Bir kok etiketi — id (kaldirma icin) + gorunen ad. */
export interface RootTag {
  id: number;
  name: string;
}

/** Kok grubu (root_groups) — renkli, siralanabilir; `rootCount` gruba atanmis kok sayisi. */
export interface RootGroup {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: number; // unix saniye
  rootCount: number;
}

/** Taranmis/izlenen kok klasor (scanned_roots). `lastScan` NULL → hic taranmadi (elle eklendi).
 *  `status` = "active" | "removed" (listeden cikarilmis; dosyalar KALIR). `isDeleted` → klasor
 *  copunde (soft-delete; dosyalar da gizli). `tags` etiket listesi (id+ad). */
export interface ScannedRoot {
  id: number;
  path: string;
  label: string;
  addedAt: number; // unix saniye
  lastScan: number | null; // unix saniye | NULL (hic taranmadi)
  status: string; // "active" | "removed"
  isFavorite: boolean;
  groupId: number | null;
  isDeleted: boolean; // klasor copunde mi (soft-delete)
  deletedAt: number | null; // unix saniye | NULL
  fileCount: number;
  /** Kok altinda TARAMA BEKLEYEN (aktif + `indexed_at IS NULL`) kayit sayisi.
   *  H2 aktarimi kayitlari bilerek indekssiz birakir → kullanicinin "hangi koku taratayim"
   *  sorusunun cevabi budur. `lastScan` bunun yerine GECMEZ: taranmis bir koke sonradan
   *  aktarim/yeni dosya girebilir. Cop listesinde daima 0. */
  pendingCount: number;
  /** Kok yolu su an diskte ERISILEBILIR mi (`list_scanned_roots` doldurur).
   *  `false` = takili olmayan surucu ya da silinmis klasor — ayirt edilemez, UI "erisilemiyor" der.
   *  Diger liste komutlari (`listTrashedRoots`) bu alani gondermez → `undefined` = bilinmiyor. */
  pathExists?: boolean;
  tags: RootTag[];
}

/** `add_scanned_root` sonucu — `newlyAdded` false ise kok zaten vardi
 *  (UNIQUE(path); idempotent). `id` her iki halde de kaydin id'sidir. */
export interface AddRootResult {
  id: number;
  newlyAdded: boolean;
}

/** Kaynak-klasor / grup / etiket / klasor-copu komut sarmalayicilari — facade `ipc`'ye yayilir.
 *  Yazma islemleri backend'de editor+/admin gate'li (UI yalnizca gorunum). */
export const rootsIpc = {
  // ── Kokler (okuma) ──
  /** Aktif + listeden-cikarilmis (removed) kokler (klasor-copundekiler HARIC). Sunucu siralar. */
  listScannedRoots: (): Promise<ScannedRoot[]> => invoke<ScannedRoot[]>("list_scanned_roots"),

  /** Klasor copundeki (soft-delete) kokler. */
  listTrashedRoots: (): Promise<ScannedRoot[]> => invoke<ScannedRoot[]>("list_trashed_roots"),

  // ── Kokler (yazma) ──
  /** Bir koku ELLE ekle (last_scan NULL — henuz taranmadi). Zaten varsa newlyAdded=false.
   *  Tarama SONRASI kayit (last_scan=now) buradan YAPILMAZ: backend, ingest bitiminde yalniz
   *  EKSIKSIZ tamamlanan kokleri kendi kaydeder (`completed_roots`). Renderer'in kaydi iptal/red
   *  edilen bir kosuyu "basarili tarama" diye tohumlamasina yol aciyordu (2026-08-05, 186eb33). */
  addScannedRoot: (path: string, label: string): Promise<AddRootResult> =>
    invoke<AddRootResult>("add_scanned_root", { path, label }),

  /** Kok etiketini (gorunen ad) yeniden adlandir. */
  renameScannedRoot: (id: number, label: string): Promise<void> =>
    invoke<void>("rename_scanned_root", { id, label }),

  /** Favori isaretle/kaldir. */
  setRootFavorite: (id: number, isFavorite: boolean): Promise<void> =>
    invoke<void>("set_root_favorite", { id, isFavorite }),

  /** Koku bir gruba ata (groupId=null → gruptan cikar). */
  assignRootGroup: (id: number, groupId: number | null): Promise<void> =>
    invoke<void>("assign_root_group", { id, groupId }),

  /** LISTEDEN CIKAR (status=removed) — asset'ler KALIR, yalniz kaynak listesinden dusuler. */
  removeScannedRoot: (id: number): Promise<void> =>
    invoke<void>("remove_scanned_root", { id }),

  /** Listeden-cikarilmis koku yeniden aktifle (status=active). */
  reactivateScannedRoot: (id: number): Promise<void> =>
    invoke<void>("reactivate_scanned_root", { id }),

  /** COPE AT (soft-delete) — altindaki asset'ler de cope tasinip gizlenir. Doner: etkilenen asset. */
  trashScannedRoot: (id: number): Promise<number> => invoke<number>("trash_scanned_root", { id }),

  /** Klasor copundeki koku geri yukle — asset'ler de geri gelir. Doner: geri yuklenen asset. */
  restoreScannedRoot: (id: number): Promise<number> =>
    invoke<number>("restore_scanned_root", { id }),

  /** KALICI sil (geri alinamaz) — klasor + asset'leri tamamen silinir. Doner: silinen asset. */
  purgeScannedRoot: (id: number): Promise<number> => invoke<number>("purge_scanned_root", { id }),

  // ── Gruplar ──
  /** Yeni kok grubu olustur (ad + renk). Doner: yeni grup id. */
  createRootGroup: (name: string, color: string): Promise<number> =>
    invoke<number>("create_root_group", { name, color }),

  /** Tum kok gruplari (rootCount ile). Sunucu siralar (sortOrder). */
  listRootGroups: (): Promise<RootGroup[]> => invoke<RootGroup[]>("list_root_groups"),

  /** Grubu yeniden adlandir. */
  renameRootGroup: (id: number, name: string): Promise<void> =>
    invoke<void>("rename_root_group", { id, name }),

  /** Grup rengini degistir. */
  recolorRootGroup: (id: number, color: string): Promise<void> =>
    invoke<void>("recolor_root_group", { id, color }),

  /** Grubu sil (kokler KALIR, yalniz grup atamasi kalkar). */
  deleteRootGroup: (id: number): Promise<void> => invoke<void>("delete_root_group", { id }),

  // ── Kok etiketleri ──
  /** Koke etiket ekle (ad; find-or-create backend'de). */
  addRootTag: (rootId: number, tagName: string): Promise<void> =>
    invoke<void>("add_root_tag", { rootId, tagName }),

  /** Kokten etiket kaldir (tag id ile). */
  removeRootTag: (rootId: number, tagId: number): Promise<void> =>
    invoke<void>("remove_root_tag", { rootId, tagId }),

  // ── Kaynak-klasor disk sondasi ──
  /** Klasorun DISKTEKI durumu (salt-okuma teshis; icerik DONDURMEZ).
   *
   *  Cagri yeri: bir tarama "hicbir dosya islenmedi" ile donunce — o sonuc tek basina
   *  *"klasor bos"* mu *"klasor kayip"* mi ayirt ETMEZ, ve ikisi kullanici icin bambaska
   *  (biri onemsiz, digeri arsivin diskle bagini kopardigi ALARM). Yalniz o belirsiz dalda
   *  cagrilir → normal taramalara ek IPC maliyeti YOK. */
  folderSourceState: (path: string): Promise<FolderSourceState> =>
    invoke<FolderSourceState>("folder_source_state", { path }),
};
