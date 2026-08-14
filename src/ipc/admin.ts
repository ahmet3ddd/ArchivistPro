// IPC alan modulu: auth/oturum + kullanici yonetimi + denetim gunlugu + crash raporlari +
// yedekleme (snapshot) + veri sagligi / acilis-kurtarma / lokasyon durumu (cogu ADMIN yuzeyi).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.

import { Channel, invoke } from "@tauri-apps/api/core";

export type Role = "admin" | "editor" | "viewer";

/** Kimlik-dogrulanmis oturum/giris ozeti (sunucu-tarafi `SessionDto` ile birebir).
 *  Alan adlari snake_case (serde varsayilani). `must_change` yalniz `login`
 *  sonucunda anlamlidir; `current_session` her zaman false doner. */
export interface Session {
  user_id: number;
  username: string;
  role: Role;
  is_founder: boolean;
  must_change: boolean;
}

/** Admin panelinde listelenen kullanici (sunucu-tarafi `UserDto`). */
export interface UserRow {
  id: number;
  username: string;
  role: Role;
  is_founder: boolean;
  created_at: number;
}

/** Arşiv-geneli giriş kaba-kuvvet politikası. Yalnız admin okuyup değiştirebilir. */
export interface LockoutPolicy {
  threshold: number;
  duration_minutes: number;
}

/** Bir denetim gunlugu (audit log) kaydi — sunucu-tarafi `AuditRowDto` ile birebir (camelCase).
 *  Aktor alanlari (`username`/`role`) eylem-ani SNAPSHOT'idir (`users`'a FK yok; kullanici silinse
 *  de iz dogru kalir); `role` serbest string olabilir (admin/editor/viewer veya sistem). `ts` unix
 *  SANIYE'dir (JS Date icin ×1000 gerekir — `formatDate` bunu yapar). `targetType`/`targetId`/
 *  `detail` null olabilir. Salt-okuma (yalniz admin; backend `audit_log`/`audit_count` gate'ler). */
/** Crash/panik raporu (P2.5; `crash_reports` — camelCase, sunucu `CrashReport` ile birebir).
 *  `ts` unix SANIYE (×1000 → JS Date). `backtrace` bos olabilir (ilk ~4000 karakter). Salt-okuma
 *  (yalniz admin). */
export interface CrashReport {
  ts: number;
  thread: string;
  message: string;
  location: string;
  backtrace: string;
}

/** XMP sidecar export ozeti (sunucu `XmpExportSummary`, camelCase). `written` dosya yanina,
 *  `fallback` xmp-sidecar/ altina (yan yazilamayanlar); `errors` basarisizlar. */
export interface XmpExportSummary {
  written: number;
  fallback: number;
  errors: { fileName: string; error: string }[];
}

export interface AuditRow {
  id: number;
  ts: number; // unix saniye (×1000 → JS Date)
  userId: number;
  username: string;
  role: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
}

export interface HealthReport {
  schema_version: number;
  integrity_ok: boolean;
  asset_count: number;
  orphan_count: number;
}

/** `repair_db` sonucu (Veri Sagligi/Doctor karti). DIKKAT: `HealthReport`'un SNAKE_CASE
 *  istisnasindan farkli — bu camelCase (normal kontrat). `removed` = temizlenen yetim satir
 *  (db_health.orphan_count ile ayni 5 kaynak: "N sayildi ⇒ N silindi"), `integrityOk` = onarim
 *  sonrasi butunluk, `orphanCountAfter` = kalan yetim (basarili onarim → 0). **Admin** (viewer/
 *  editor'da backend Err atar). */
export interface RepairReport {
  removed: number;
  integrityOk: boolean;
  orphanCountAfter: number;
}

/** Doctor'un dosya-sistemi ayagi (I) — Arsiv Guncelligi (staleness). Aktif her asset'in kaynak
 *  dosyasi diskte hala var mi / mtime degismis mi. Backend camelCase serialize; enum'lar STRING.
 *  `stale` = dosya diskte AMA degistirilmis (yeniden-taranmali) · `missing` = dosya bulunamadi
 *  (silinmis/tasinmis) · `offline` = kok erisilemez (disk/ag cikarilmis) → "gercekten silinmis"
 *  DEGIL (kitle-silmeye itmeyen koruma). Salt-okuma (async, agir olabilir). */
export type StaleKind = "ok" | "stale" | "missing" | "offline";
export interface StaleItem {
  id: number;
  path: string;
  kind: StaleKind;
}
/** Kart/listede rozetlemek için tüm problemli kayıtların yolsuz özeti. */
export interface StaleStatus {
  id: number;
  kind: StaleKind;
}
export interface StalenessReport {
  total: number;
  ok: number;
  stale: number;
  missing: number;
  offline: number;
  /** Yalniz stale + missing (offline HARIC — gurultu), ilk ~200. */
  samples: StaleItem[];
  /** Tüm stale + missing kayıtları; kart rozeti için eksiksiz, yolsuz liste. */
  problemStatuses: StaleStatus[];
}

/** Doctor'un dosya-sistemi ayagi (II) — Icerik Butunlugu (fixity / bit-rot). Orneklem BLAKE3
 *  rehash ↔ ingest-ani baseline. `mismatch` = icerik sessizce bozulmus (bit-rot suphesi; yedekten
 *  geri-yukle) · `missing` = dosya okunamadi · `noBaseline` = kiyaslanacak baseline yok. Pahali →
 *  orneklem yuzdesi (samplePct 1..=100). Salt-okuma (async). */
export type FixityKind = "ok" | "mismatch" | "missing" | "noBaseline";
export interface FixityItem {
  id: number;
  path: string;
  kind: FixityKind;
}
export interface FixityReport {
  sampled: number;
  ok: number;
  mismatch: number;
  missing: number;
  noBaseline: number;
  /** mismatch + missing, ilk ~200. */
  mismatches: FixityItem[];
}

/** Doctor'un Office biçim denetimi. Salt dosya-imzası okur; gerçek eski OLE
 * (DOC/XLS/PPT) belgelerini ve uzantı-içerik çelişkilerini listeler. Dosyaya
 * veya DB'ye yazmaz; erişilemeyen dosya için Staleness raporu esas kaynaktır. */
export type OfficeFormatKind = "legacyBinary" | "extensionMismatch" | "unknown";
export interface OfficeFormatItem {
  id: number;
  path: string;
  kind: OfficeFormatKind;
}
export interface OfficeFormatReport {
  checked: number;
  legacyBinary: number;
  extensionMismatch: number;
  unknown: number;
  items: OfficeFormatItem[];
}

/** P2.6 acilis kurtarma sonucu (`recovery_status`). `outcome`: sorunsuz / snapshot'tan
 *  geri yuklendi / temiz bos baslatildi. `snapshot`/`quarantined` ilgili durumda dolu. */
export interface RecoveryInfo {
  outcome: "healthy" | "restored" | "fresh";
  snapshot: string | null;
  quarantined: string | null;
}

/** Slice 2 lokasyon durumu (`location_status`). `likelyForeign=true` → kaynak dosyalar bu
 *  makinede erisilemez (onizleme modu; Replace/Reset backend'de reddedilir). `archiveHost` =
 *  arsivi indeksleyen makine (null = bilinmiyor/eski arsiv). `hostMismatch` = host farkli. */
export interface LocationStatus {
  archiveHost: string | null;
  currentHost: string;
  hostMismatch: boolean;
  sampled: number;
  accessible: number;
  likelyForeign: boolean;
}

/** Uygulamanın Windows süreç önceliği. `background`, güvenli normal-altı sınıftır;
 * yüksek/gerçek-zamanlı sınıflar özellikle desteklenmez. */
export type ProcessPriority = "normal" | "background";

/** Ayarlar → Bakım makine/derleme teşhisi. Disk yalnız arşiv DB'sinin bulunduğu birimi
 * temsil eder; kaynak klasörleri ayrı birimlerde olabilir. */
export interface DiskSpace {
  freeBytes: number;
  totalBytes: number;
}
export interface SystemInfo {
  appVersion: string;
  buildProfile: string;
  targetOs: string;
  targetArch: string;
  buildFeatures: string[];
  hostname: string;
  localIp: string;
  archivePath: string;
  disk: DiskSpace | null;
  diskError: string | null;
}

/** Onceki surumun (H2 / ArchivistPro) bu makinedeki durumu — salt-gozlem.
 *
 *  `installed` (program kurulu mu) ile `dataDir` (verisi duruyor mu) BAGIMSIZ iki sinyaldir:
 *  H2 kaldirilmis olsa bile arsiv dosyalari `%APPDATA%` altinda kalir ve tasinmayi bekler.
 *  `assetCount` **en iyi caba** — okunamayan DB atlanir; hicbiri okunamazsa `null` ("sayamadim",
 *  "kayit yok" DEGIL). */
export interface LegacyArchive {
  installed: boolean;
  version: string | null;
  dataDir: string | null;
  archiveCount: number;
  totalBytes: number;
  assetCount: number | null;
  /** Son basarili aktarimin kalici ozeti (hic aktarim yapilmadiysa null) — kart bununla
   *  "yapilmis is" moduna gecer (dugme "Yeniden aktar", ipucu neden-hala-gorundugunu anlatir). */
  lastImport: H2LastImport | null;
}

/** `app_meta[h2_last_import]` ozeti — backend `H2LastImportDto` (camelCase). */
export interface H2LastImport {
  /** Aktarim ani (unix saniye). */
  ts: number;
  source: string;
  inserted: number;
  existing: number;
  ai: number;
  tags: number;
}

/** Aday H2 arsiv veritabani (aktarim sihirbazi 1. adim) — backend `H2CandidateDb` (camelCase).
 *  `source`: "config" (archivist_config.json yonlendirmesi — GERCEK arsivler cogunlukla burada) |
 *  "appdata" (klasor taramasi). `exists=false` config kaydi: dosya tasinmis/eksik — UI soyler.
 *  `lockedHint`: yaninda `.lock` var, H2 acik olabilir. `assetCount` en-iyi-caba (null = sayamadim). */
export interface H2CandidateDb {
  path: string;
  label: string;
  kind: "main" | "local" | "extra" | "scan";
  source: "config" | "appdata";
  exists: boolean;
  sizeBytes: number;
  assetCount: number | null;
  lockedHint: boolean;
  trashed: boolean;
}

/** H2 arsiv envanteri (aktarim sihirbazi 2. adim) — backend `H2Inventory` (camelCase).
 *  `hasCuratedData`: insan-yapimi veri (etiket/favori/koleksiyon/grup/proje-durum) var mi.
 *  `users`: parola TASINAMAZ raporu icin (PBKDF2≠argon2id). `missingTables`: cok eski
 *  H2 semasinda bulunamayan tablolar (hata degil, bilgi). */
export interface H2Inventory {
  dbPath: string;
  fileBytes: number;
  assets: number;
  assetsDeleted: number;
  assetsWithAi: number;
  assetsWithThumbnail: number;
  tags: number;
  assetTags: number;
  favorites: number;
  collections: number;
  collectionItems: number;
  scannedRoots: number;
  rootGroups: number;
  rootTags: number;
  projectMetaRows: number;
  users: { username: string; role: string | null }[];
  chatSessions: number;
  missingTables: string[];
  hasCuratedData: boolean;
}

/** Aktarim secenekleri (onay kutulari; varsayilan ikisi de true — kayipsizlik). */
export interface H2ImportOptions {
  includeDeleted: boolean;
  includeThumbnails: boolean;
}

/** Aktarim ilerlemesi (Channel; embed/ingest deseni). stage: assets|roots|collections. */
export interface H2ImportProgress {
  stage: string;
  done: number;
  total: number;
}

/** Kuru kosu VE uygula AYNI sekli doldurur (backend simetri testiyle kilitli) —
 *  "kuru kosuda gordugum = uygulanan". Sayaclar "gercekten yazilan/yazilacak" adettir;
 *  ikinci kosu (idempotency) hepsini 0 dondurur. */
export interface H2ImportReport {
  dryRun: boolean;
  assetsSeen: number;
  assetsInserted: number;
  assetsExisting: number;
  assetsDeletedCarried: number;
  deletedConflicts: number;
  duplicateH2Rows: number;
  aiWritten: number;
  aiSkippedExisting: number;
  aiSkippedThin: number;
  drawingTypeDropped: number;
  gorselTuruWritten: number;
  tagsWritten: number;
  favoritesWritten: number;
  collectionsCreated: number;
  collectionItemsWritten: number;
  projectMetaWritten: number;
  projectMetaSkippedExisting: number;
  rootsAdded: number;
  rootsExisting: number;
  groupsCreated: number;
  rootTagsWritten: number;
  thumbnailsCarried: number;
  thumbnailsInvalid: number;
  unparsableTimes: number;
  usersNotMigrated: { username: string; role: string | null }[];
  chatSessionsNotMigrated: number;
  errors: [string, string][];
  droppedErrors: number;
  elapsedMs: number;
}

/** Bir yedek (DB snapshot) — backend `SnapshotDto` ile birebir (camelCase). `createdAt`:
 *  unix ms (frontend formatlar); `auto`: reset-oncesi otomatik yedek mi (panelde rozet). */
export interface SnapshotDto {
  name: string;
  createdAt: number;
  sizeBytes: number;
  auto: boolean;
}

/** Yonetim (auth/kullanici/denetim/crash/yedek/saglik) komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const adminIpc = {
  dbHealth: (): Promise<HealthReport> => invoke<HealthReport>("db_health"),

  /** DB yetim satirlarini onar/temizle (Veri Sagligi/Doctor karti). Arg YOK; db_health.orphan_count
   *  ile ayni 5 kaynak temizlenir. **Admin** — viewer/editor'da backend Err atar (UI gate yalniz
   *  gorunum). Bitince temizlenen sayi + onarim-sonrasi butunluk/yetim doner (camelCase). */
  repairDb: (): Promise<RepairReport> => invoke<RepairReport>("repair_db"),

  /** Arsiv Guncelligi denetimi (Doctor dosya-sistemi ayagi I): her aktif asset'in kaynagi diskte
   *  var mi / mtime degismis mi. Arg YOK. Salt-okuma (async, agir olabilir). */
  checkStaleness: (): Promise<StalenessReport> => invoke<StalenessReport>("check_staleness"),

  /** Icerik Butunlugu denetimi (Doctor dosya-sistemi ayagi II): `samplePct` (1..=100) orneklem
   *  BLAKE3 rehash ↔ baseline (bit-rot). Salt-okuma (async, pahali). */
  checkFixity: (samplePct: number): Promise<FixityReport> =>
    invoke<FixityReport>("check_fixity", { samplePct }),

  /** Eski/uyuşmayan Office dosya biçimlerini imzadan raporlar. Arg YOK; salt-okuma. */
  checkOfficeFormats: (): Promise<OfficeFormatReport> =>
    invoke<OfficeFormatReport>("check_office_formats"),

  // P2.6 acilis kurtarma durumu (bozuk-DB tespit/onarim) — AppShell acilista bir kez okur.
  recoveryStatus: (): Promise<RecoveryInfo> => invoke<RecoveryInfo>("recovery_status"),

  // Slice 2 lokasyon farkindaligi — kaynak dosyalar bu makinede mi (uzak-lokasyon banner).
  locationStatus: (): Promise<LocationStatus> => invoke<LocationStatus>("location_status"),

  /** Mevcut Arsiv-H3 işlemini anında normal veya arka-plan önceliğine alır. Admin gerekir. */
  setProcessPriority: (mode: ProcessPriority): Promise<void> =>
    invoke<void>("set_process_priority", { mode }),

  /** Makine ve derleme teşhisi (arşiv diski, yerel IP, hedef/profile). Admin gerekir. */
  systemInfo: (): Promise<SystemInfo> => invoke<SystemInfo>("system_info"),

  /** Onceki surumu (H2 / ArchivistPro) ALGILA — kurulu mu, verisi duruyor mu. Salt-okuma;
   *  hicbir seyi degistirmez, kaldirmayi ONERMEZ. Iki sinyal ayri: program kurulumu ile veri
   *  klasoru bagimsizdir (H2 kaldirilmis olsa bile arsiv dosyalari yerinde kalir). */
  legacyArchiveStatus: (): Promise<LegacyArchive> => invoke<LegacyArchive>("legacy_archive_status"),

  /** H2 aktarim sihirbazi — aday DB listesi (salt-okuma kesif; config yonlendirmesi dahil). */
  h2ImportCandidates: (): Promise<H2CandidateDb[]> =>
    invoke<H2CandidateDb[]>("h2_import_candidates"),

  /** ① H2 envanteri (ADMIN; H2 salt-okuma — H3'e dokunmaz). */
  h2ImportInventory: (dbPath: string): Promise<H2Inventory> =>
    invoke<H2Inventory>("h2_import_inventory", { dbPath }),

  /** ② Kuru kosu (ADMIN; H3'e YAZMAZ). Rapor uygulamayla ayni sekilde — on-gosterim. */
  h2ImportDryRun: (
    dbPath: string,
    opts: H2ImportOptions,
    onProgress?: (p: H2ImportProgress) => void,
  ): Promise<H2ImportReport> => {
    const channel = new Channel<H2ImportProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<H2ImportReport>("h2_import_dry_run", { dbPath, opts, onProgress: channel });
  },

  /** ③ Uygula (ADMIN). Backend ONCE otomatik yedek alir (snapshots/pre-h2-import-*.db);
   *  islem idempotent — yarida kesilirse yeniden kosmak guvenlidir. */
  h2ImportApply: (
    dbPath: string,
    opts: H2ImportOptions,
    onProgress?: (p: H2ImportProgress) => void,
  ): Promise<H2ImportReport> => {
    const channel = new Channel<H2ImportProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<H2ImportReport>("h2_import_apply", { dbPath, opts, onProgress: channel });
  },

  // ── Auth + oturum (Faz 6 / B1): kimlik-dogrulama gerektirmeyenler ──
  /** Ilk kurulum gerekli mi? (hic kullanici yoksa true). */
  needsSetup: (): Promise<boolean> => invoke<boolean>("needs_setup"),

  /** Ilk admin hesabini olustur (yalniz hic kullanici yokken). Oturum ACMAZ. */
  setupAdmin: (username: string, password: string): Promise<void> =>
    invoke<void>("setup_admin", { username, password }),

  /** Giris yap → sunucu-tarafi oturum kurulur, `SessionDto` doner. */
  login: (username: string, password: string): Promise<Session> =>
    invoke<Session>("login", { username, password }),

  /** Cikis → sunucu-tarafi oturum temizlenir. */
  logout: (): Promise<void> => invoke<void>("logout"),

  /** O anki oturum (yoksa null) — acilista durum tazeleme. */
  currentSession: (): Promise<Session | null> =>
    invoke<Session | null>("current_session"),

  /** Giris yapmis kullanicinin kendi parolasini degistir (eski parola dogrulanir). */
  changePassword: (oldPassword: string, newPassword: string): Promise<void> =>
    invoke<void>("change_password", { oldPassword, newPassword }),

  // ── Kullanici yonetimi (Faz 6 / B1): admin-gated; rol sunucu oturumundan ──
  /** Tum kullanicilar (admin paneli). Admin gerekir. */
  listUsers: (): Promise<UserRow[]> => invoke<UserRow[]>("list_users"),

  /** Etkin giriş kilidi eşiği (3–20 deneme, 1–120 dakika). Admin gerekir. */
  getAuthLockoutPolicy: (): Promise<LockoutPolicy> =>
    invoke<LockoutPolicy>("get_auth_lockout_policy"),

  /** Giriş kilidi eşiğini güncelle. Devam eden kilitler değişmez. Admin gerekir. */
  setAuthLockoutPolicy: (threshold: number, durationMinutes: number): Promise<void> =>
    invoke<void>("set_auth_lockout_policy", { threshold, durationMinutes }),

  /** Yeni kullanici olustur (rol + parola). Admin gerekir. id doner. */
  adminCreateUser: (username: string, role: Role, password: string): Promise<number> =>
    invoke<number>("admin_create_user", { username, role, password }),

  /** Kullaniciyi sil. Admin gerekir (son admin silinemez). */
  adminDeleteUser: (id: number): Promise<void> =>
    invoke<void>("admin_delete_user", { id }),

  /** Kullanicinin rolunu degistir. Admin gerekir. */
  adminSetRole: (id: number, role: Role): Promise<void> =>
    invoke<void>("admin_set_role", { id, role }),

  /** Kullanicinin parolasini sifirla (must_change_password=1). Admin gerekir. */
  adminResetPassword: (id: number, newPassword: string): Promise<void> =>
    invoke<void>("admin_reset_password", { id, newPassword }),

  // ── #8 Denetim gunlugu (audit log): admin-gated salt-okuma goruntuleyici ──
  /** Denetim kayitlari (en yeni once, sayfali). **Admin** (aksi halde backend Err atar). `limit`
   *  backend'de 1..=200 clamp'lenir; `offset` sayfa baslangici. Salt-okuma (yazma yok). */
  auditLog: (limit: number, offset: number): Promise<AuditRow[]> =>
    invoke<AuditRow[]>("audit_log", { limit, offset }),

  /** Toplam denetim kaydi sayisi (sayfalama icin). **Admin**. */
  auditCount: (): Promise<number> => invoke<number>("audit_count"),

  // ── P2.5 Crash raporlama: panik hook'un yazdigi crash log (admin; saha teshis) ──
  /** Crash/panik raporlari (en yeni once; en cok `limit`). **Admin** (aksi halde backend Err). */
  crashReports: (limit: number): Promise<CrashReport[]> =>
    invoke<CrashReport[]>("crash_reports", { limit }),

  /** Crash raporu sayisi (kart rozeti). **Admin**.
   *  ⚠️ Cagirani YOK (2026-07-18 olu-kod taramasi): rozetin kendisi hic yapilmadi. Silinmedi —
   *  ucuz ve degerli bir UX (Bakim sekmesinde "N crash" gorunurlugu); backend hazir. */
  crashReportCount: (): Promise<number> => invoke<number>("crash_report_count"),

  /** Crash log dosyasini temizle (sil). **Admin**. */
  clearCrashReports: (): Promise<void> => invoke<void>("clear_crash_reports"),

  /** Renderer'da yakalanan React hatasini crash log'a yaz (ErrorBoundary cagirir).
   *  **Yetki gate'i YOK** — UI hatasi giris ekraninda da olabilir (oturum yok) ve rapor
   *  kanali kapatilirsa hata izsiz kalir. H2 `writeCrashReport('react_error')` paritesi. */
  reportFrontendError: (message: string, location: string, stack: string): Promise<void> =>
    invoke<void>("report_frontend_error", { message, location, stack }),

  /** Uygulamayi sonlandir (cikis onayi sonrasi). **Rust komutu** — JS `window.destroy()`
   *  Tauri v2'de izin reddine duser (`core:window` varsayilanlari salt-okuma). Bkz
   *  `crash_commands::quit_app` basligi. */
  quitApp: (): Promise<void> => invoke<void>("quit_app"),

  /** Secili asset'ler icin XMP sidecar (`.xmp`) dosyalari yaz (**Admin**; yalniz yerel). Kurate
   *  metadata'yi (baslik/etiket/proje-durum) Adobe XMP standardinda dosya YANINA yazar; yazilamazsa
   *  xmp-sidecar/ altina duser. Kaynak dosyaya DOKUNMAZ (additive). Doner: {written, fallback, errors}. */
  exportXmpSidecars: (ids: number[]): Promise<XmpExportSummary> =>
    invoke<XmpExportSummary>("export_xmp_sidecars", { ids }),

  // ── Yedekleme (§O DB snapshot + restore): yonetilen yedek paneli (hepsi ADMIN) ──
  /** Yedekleri listele (en yeni ilk). Admin gerekir. */
  listSnapshots: (): Promise<SnapshotDto[]> => invoke<SnapshotDto[]>("list_snapshots"),

  /** Yeni yedek al (online backup API). Admin. Olusan yedegin kaydini doner. */
  createSnapshot: (): Promise<SnapshotDto> => invoke<SnapshotDto>("create_snapshot"),

  /** Zamanlanmis OTOMATIK yedek al + retention (otomatik yedeklerden en yeni `keep` tut).
   *  Admin. useBackupScheduler cagirir. */
  createAutoSnapshot: (keep: number): Promise<SnapshotDto> =>
    invoke<SnapshotDto>("create_auto_snapshot", { keep }),

  /** Bir yedekten geri yukle (UZERINE YAZAR — GERI-ALINAMAZ). Admin. UI onay ister. */
  restoreSnapshot: (name: string): Promise<void> =>
    invoke<void>("restore_snapshot", { name }),

  /** Bir yedegi sil. Admin. */
  deleteSnapshot: (name: string): Promise<void> => invoke<void>("delete_snapshot", { name }),

  /** Bir yedegi managed klasor disina kopyala (felaket-yedegi; `dest` kaydet-diyalogundan). Admin. */
  exportSnapshot: (name: string, dest: string): Promise<void> =>
    invoke<void>("export_snapshot", { name, dest }),

  /** Harici bir .db yedegi ice aktar (`src` ac-diyalogundan); listeye eklenir. Admin. */
  importSnapshot: (src: string): Promise<SnapshotDto> =>
    invoke<SnapshotDto>("import_snapshot", { src }),
};
