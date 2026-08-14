// IPC alan modulu: klasor tarama (ingest) + secilenleri yeniden-indeksleme + klasor
// watcher (canli izleme) + tarama raporlari gecmisi. Canli ilerleme Channel ile akar.
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.

import { Channel, invoke } from "@tauri-apps/api/core";

export interface IngestWarning {
  path: string;
  message: string;
}

/** Bir uzanti kovasi — `ext` (kucuk-harf; "" = uzantisiz) + o uzantili dosya sayisi.
 *  Sunucu count azalan SIRALI doner (renderer siralamaz). */
export interface IngestTypeCount {
  ext: string;
  count: number;
}

/** `ingest_folder` sonucu (sunucu-tarafi rapor). Alan adlari Tauri kontrati geregi
 *  camelCase (`elapsedMs`, `typeCounts`). `warnings`/`errors` yapilandirilmis {path,message}
 *  (#7: errors = olumcul/indekslenemedi, AYRI alan). Renderer TOPLAMAZ — yalniz Rapor adiminda cizilir. */
export interface IngestReport {
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  /** Yikici modda etkilenen: Replace → cope atilan; Reset → bastan silinen. Merge → 0. */
  removed: number;
  /** Klasorden OTOMATIK projeye atanan asset sayisi (`autoProject` acikken; kapali → 0). Canli
   *  ingest'te DAIMA gelir; gecmis tarama raporlarinda (bu ozellik oncesi) YOK → opsiyonel. */
  autoAssigned?: number;
  elapsedMs: number;
  typeCounts: IngestTypeCount[];
  /** Olumcul-olmayan uyarilar (dosya indekslendi ama cikarim dustu / parser uyardi). */
  warnings: IngestWarning[];
  /** Dosya-bazli OLUMCUL hatalar (indekslenemedi) — `warnings`'ten AYRI; UI danger gosterir (#7). */
  errors: IngestWarning[];
  /** Walker seviyesinde ATLANAN girdiler (④-C): `{path, message}` — `message` = sebep-KODU
   *  (`hidden`/`unreadable`/`symlink`), UI'da `ingest.skipReason.<code>` ile yerellestirilir.
   *  `skipped` (degismemis) SAYISINDAN ayri: bunlar indekslenmedi + eskiden tamamen gorunmezdi. */
  skippedReasons: IngestWarning[];
  /** Tavan (10.000 girdi) yuzunden LISTEYE ALINMAYAN rapor kaydi sayisi. 0/undefined = liste tam.
   *  >0 ise rapor "…ve N kayit daha" demeli — kesilmis listeyi tam gibi gostermek yanlis-guven
   *  uretir. Sayimlar (`failed`/`skipped`) tavandan ETKILENMEZ. Eski raporlarda YOK → opsiyonel. */
  droppedEntries?: number;
  /** Kullanici durdurmasiyla kismi bittiyse true. Eski kalici raporlarda bulunmayabilir. */
  cancelled?: boolean;
  /** Eksiksiz biten kaynak kokler; backend yalniz bunlari last_scan olarak kaydeder. */
  completedRoots?: string[];
  /** Tamamlanan koklerden biri watcher listesine yeni eklendiyse true. */
  watchConfigChanged?: boolean;
}

/** `reindex_assets` canli ilerleme (Channel ile akar; INGEST/embed ile ayni desen, camelCase).
 *  `processed` yeniden-islenen, `total` toplam secili asset. Son ozette processed===total. */
export interface ReindexProgress {
  processed: number;
  total: number;
}

/** `reindex_assets` sonucu (sunucu-tarafi rapor; camelCase). Secili asset'ler ZORLA yeniden
 *  cikarilir (thumbnail/phash/renk/metadata tazelenir; asset id KORUNUR — silme yok). `reindexed`
 *  basariyla yeniden cikarilan; `missing` kaynak dosyasi bu makinede olmayan (cok-lokasyon; graceful);
 *  `failed` cikarim dusen. `warnings`/`errors` yapilandirilmis {path,message} (IngestWarning ile ayni
 *  sekil): warnings = olumcul-olmayan uyari, errors = dosya-bazli olumcul hata. */
export interface ReindexReport {
  reindexed: number;
  missing: number;
  failed: number;
  warnings: IngestWarning[];
  errors: IngestWarning[];
}

/** İngest tarama modu — backend `IngestMode` ile birebir (snake yok; string birebir). */
/** `startWatchingRoot` reject payload'i (sunucu `WatchError`). Klasor izlenemedigi zaman NEDENI
 *  tasir — bu bilgi olmadan kullanici ne yapacagini bilemez ve degisiklikler sessizce kacirilir.
 *  `kind`: `folder_missing` (silinmis VEYA cevrimdisi ag/harici surucu) · `permission` ·
 *  `watch_limit` (isletim sistemi izleme siniri) · `forbidden` (yetki) · `other` (ham metne bak).
 *  `path`: TAM yol — kisa ad hangi surucude oldugunu gizler. */
export interface WatchFailure {
  kind: "folder_missing" | "permission" | "watch_limit" | "forbidden" | "other";
  message: string;
  path: string;
}

export type IngestMode = "merge" | "replace" | "reset";

/** `ingest_folder` canli ilerleme (Channel ile akar; src-tauri IngestProgressDto ile
 *  birebir, camelCase). `total===0` → henuz tarama suruyor. `processed` tamamlanan,
 *  `currentPath` son tamamlanan dosya, `activePaths` o anda hazirlanan dosyalar
 *  (son ozette ikisi de bos). */
export interface IngestProgress {
  processed: number;
  total: number;
  folders: number;
  currentPath: string;
  activePaths: string[];
  rootIndex: number;
  rootTotal: number;
  currentRoot: string;
  cancelled: boolean;
}

/** Aktif taramanin backend'de tutulan son durumu. Channel gecikse bile arayuz bunu
 *  yoklayarak gercek sayaci tazeler; SQLite tarama kilidine dokunmaz. */
export interface IngestStatus {
  active: boolean;
  cancellable: boolean;
  progress: IngestProgress | null;
}

// ── P2.5 ④ Tarama raporlari gecmisi (kalici scan history; admin salt-okuma + temizle/disa-aktar) ──
// DTO'lar backend `ScanReportSummaryDto`/`ScanReportDetailDto` ile birebir (camelCase). `ts` unix
// SANIYE (×1000 → JS Date; `formatDate`). Detay, mevcut `IngestReport` ile AYNI sekilde
// typeCounts/warnings/errors tasir → `IngestReportView` DOGRUDAN yeniden kullanilir (adapter yok).

/** Bir tarama kosusunun HAFIF ozeti (`list_scan_reports`; en yeni once, ts DESC). `mode` tarama
 *  modu (`IngestMode` reuse). `warningCount`/`errorCount` = detaydaki listelerin uzunlugu (rozet;
 *  detay cekilmeden gosterilir). Tam detay AYRI cekilir (`getScanReport`). **Admin**. */
export interface ScanReportSummary {
  id: number;
  ts: number; // unix saniye (×1000 → JS Date)
  rootPath: string;
  mode: IngestMode;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  removed: number;
  elapsedMs: number;
  warningCount: number;
  errorCount: number;
  /** Walker seviyesinde atlanan girdi sayisi (④-C; rozet — detay cekilmeden). */
  skippedReasonCount: number;
}

/** Tam tarama raporu detayi (`get_scan_report`; DUZ). Tum `ScanReportSummary` alanlari +
 *  `typeCounts`/`warnings`/`errors`/`skippedReasons` — mevcut `IngestReport` ile AYNI sekil
 *  (→ `IngestReportView` dogrudan reuse; ScanReportDetail structural olarak IngestReport'u
 *  karsilar; `skippedReasons` de dahil). **Admin**; bulunamazsa komut null doner. */
export interface ScanReportDetail extends ScanReportSummary {
  typeCounts: IngestTypeCount[];
  warnings: IngestWarning[];
  errors: IngestWarning[];
  skippedReasons: IngestWarning[];
}

/** Tarama/yeniden-indeks/watcher/tarama-raporu komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const ingestIpc = {
  // Yazma komutlari (Faz 6 / B1): `role` artik istemci argumani DEGIL — yetki
  // sunucu-tarafi kimlik-dogrulanmis oturumdan gelir (rbac::current_role).
  // `skipUnchanged`: artimsal tarama — degismeyen (mtime+size ayni) dosyalari atla.
  ingestFolder: (
    path: string,
    skipUnchanged: boolean,
    mode: IngestMode,
    onProgress?: (p: IngestProgress) => void,
    concurrency?: number,
    autoProject?: boolean,
    autoProjectStatus?: string,
    odaConcurrency?: number,
  ): Promise<IngestReport> => {
    // Canli ilerleme: Channel kur, mesajlari callback'e ilet. onProgress yoksa kanal
    // yine gecer (backend daima yollar) ama dinlenmez — zararsiz. `mode`: birlestir/
    // degistir/sifirla (yikici modlar admin + UI onayli; backend bilinmeyen modu reddeder).
    // `concurrency`: es-zamanli cikarim worker sayisi (undefined/0 → OTOMATIK cekirdek-bazli).
    // `odaConcurrency`: ODA (DWG→DXF) es-zamanlilik ust siniri (undefined → backend varsayilani 1
    // korunur). Genel `concurrency`'den AYRI: ODA alt-surec+disk-bagli → ayri kapilanir.
    const channel = new Channel<IngestProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<IngestReport>("ingest_folder", {
      path,
      skipUnchanged,
      mode,
      concurrency,
      odaConcurrency,
      autoProject: autoProject ?? false,
      // YENI olusan oto-projeye yazilacak durum (yerellestirilmis; yoksa null → durum bos).
      autoProjectStatus: autoProjectStatus ?? null,
      onProgress: channel,
    });
  },

  /** Birden fazla bagimsiz kaynak klasoru tek backend kosusunda indeksler. Toplam dosya sayisi
   * butun kokler tarandiktan sonra belirlenir; Reset bir kez, Replace kok basina uygulanir. */
  ingestFolders: (
    paths: string[],
    skipUnchanged: boolean,
    mode: IngestMode,
    onProgress?: (p: IngestProgress) => void,
    concurrency?: number,
    autoProject?: boolean,
    autoProjectStatus?: string,
    odaConcurrency?: number,
  ): Promise<IngestReport> => {
    const channel = new Channel<IngestProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<IngestReport>("ingest_folders", {
      paths,
      skipUnchanged,
      mode,
      concurrency,
      odaConcurrency,
      autoProject: autoProject ?? false,
      autoProjectStatus: autoProjectStatus ?? null,
      onProgress: channel,
    });
  },

  /** Calisan ingest'i IPTAL et (H2 `raceInvoke` pariteli). Pipeline bir sonraki dosyada durur →
   *  `ingestFolder` KISMI raporla normal doner (yazilmis asset'ler DB'de kalir; yikici post-pass'ler
   *  [REPLACE prune + oto-proje] atlanir). Backend DB'ye DOKUNMAZ → ingest db kilidini tutarken bile
   *  aninda etkili. Ingest yoksa zararsiz (bir sonraki taramanin basinda sifirlanir). */
  /** Canli ilerlemenin Channel'dan bagimsiz yedek kaynagi. */
  ingestStatus: (): Promise<IngestStatus> => invoke<IngestStatus>("ingest_status"),

  cancelIngest: (): Promise<void> => invoke<void>("cancel_ingest"),

  /** Secili asset'leri ZORLA yeniden-indeksle (cikarici iyilesince mevcut asset'ler geri-doldurulur;
   *  or. PSD/EPS thumbnail + phash/renk). **Admin** — viewer/editor'da backend Err atar. Silme YOK:
   *  yalniz metadata/thumbnail tazelenir, asset id KORUNUR (backend garanti). Canli ilerleme Channel
   *  ile akar (INGEST ile BIREBIR ayni desen); onProgress yoksa kanal yine gecer (backend daima yollar)
   *  ama dinlenmez — zararsiz. `missing` = kaynak dosya bu makinede yok (cok-lokasyon; graceful). */
  reindexAssets: (
    ids: number[],
    onProgress?: (p: ReindexProgress) => void,
  ): Promise<ReindexReport> => {
    const channel = new Channel<ReindexProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ReindexReport>("reindex_assets", { ids, onProgress: channel });
  },

  // ── P2.5 Klasor watcher (canli izleme; admin) — tespit → `folder_changed` olayi ──
  // (`WatchFailure` tipi asagida dosya sonunda; `startWatchingRoot` reject payload'i.)
  // useFolderWatcher kullanir: kok basina start; ayar/oturum kapaninca stopAll.
  /** Bir koku izlemeye basla. Basarisizlikta reject payload'i `WatchFailure`'dir (sinif kodu + ham
   *  metin + TAM yol) — cagiran onu YUTMAMALI: neden bilinmeden kullanicinin yapacagi sey de
   *  bilinemez (silinmis klasor / cevrimdisi ag surucusu / izin / izleme siniri = 4 farkli eylem). */
  startWatchingRoot: (path: string): Promise<void> =>
    invoke<void>("start_watching_root", { path }),
  // NOT (2026-07-18 olu-kod taramasi): `stopWatchingRoot` sarmalayicisi KALDIRILDI — cagirani
  // yoktu ve TASARIMCA gereksiz: `useFolderWatcher` kok listesi degisince effect'i yeniden
  // kurar (cleanup `stopAllWatchers` → sonra kalan kokleri yeniden `start`). Yani tek-kok
  // durdurma yolu hic kullanilmiyor, kullanilmasi da gerekmiyor. Backend komutu
  // (`stop_watching_root`) duruyor — ileride tek-kok durdurma istenirse hazir.
  stopAllWatchers: (): Promise<void> => invoke<void>("stop_all_watchers"),

  /** SU AN izlenemeyen kokler (salt-okuma; her rol). Toast GECICIDIR, izlenememek KALICI bir
   *  durumdur — Kaynak Klasorler paneli bunu kok basina rozet olarak cizer. Bos liste = sorun yok
   *  VEYA izleme hic kurulmadi (ayar kapali / admin degil); ikisinde de rozet gosterilmez. */
  watchFailures: (): Promise<WatchFailure[]> => invoke<WatchFailure[]>("watch_failures"),

  // ── P2.5 ④ Tarama raporlari gecmisi (kalici scan history; hepsi ADMIN — backend gate) ──
  /** Tarama raporu ozetleri (en yeni once, ts DESC; `limit` verilmezse backend varsayilani).
   *  **Admin** (aksi halde backend Err). Hafif liste satiri — tam detay AYRI (`getScanReport`). */
  listScanReports: (limit?: number): Promise<ScanReportSummary[]> =>
    invoke<ScanReportSummary[]>("list_scan_reports", { limit: limit ?? null }),

  /** Bir tarama raporunun TAM detayi (typeCounts/warnings/errors dahil). **Admin**. Yoksa null. */
  getScanReport: (id: number): Promise<ScanReportDetail | null> =>
    invoke<ScanReportDetail | null>("get_scan_report", { id }),

  /** Tum tarama raporlarini sil. **Admin**. Silinen kayit sayisi doner. */
  clearScanReports: (): Promise<number> => invoke<number>("clear_scan_reports"),

  /** Bir tarama raporunu dosyaya yaz (`dest` kaydet-diyalogundan gelen TAM yol). **Admin**.
   *  `format`: "txt" (insan-okur) | "json" (yapilandirilmis). */
  exportScanReport: (id: number, format: "txt" | "json", dest: string): Promise<void> =>
    invoke<void>("export_scan_report", { id, format, dest }),
};
