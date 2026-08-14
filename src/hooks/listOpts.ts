// Aktif gorunum filtresinden `ListOpts` kuran ORTAK saf yardimci — tek dogruluk kaynagi.
//
// Hem sonsuz-kaydirma listesi (useInfiniteAssets) hem arsiv EXTRACT (ArchiveExtractModal)
// AYNI facet filtresini kullanir ("aktif gorunum filtrene uyanlari cikar"). Kopya-yapistir
// yerine ikisi de bu fonksiyondan gecer → filtre semasi tek yerde tanimli kalir.

import type { AssetSort, ListOpts } from "../ipc/client";

/** Varsayilan sayfa boyu (list_assets sayfalama). */
export const DEFAULT_PAGE_SIZE = 60;

/** YYYY-MM-DD → unix saniye (gun basi/sonu). Bos/gecersiz → null. */
export function dateToEpoch(date: string, endOfDay: boolean): number | null {
  if (!date) return null;
  const ms = new Date(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}`).getTime();
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/** Aktif facet filtresi (store'daki gorunum durumu; tarih EPOCH'a onceden cevrilmis). */
export interface FacetFilter {
  sort: AssetSort;
  ext: string[];
  tag: string[];
  collection: number[];
  project: number[];
  modifiedAfter: number | null;
  modifiedBefore: number | null;
  favoritesOnly: boolean;
  pathPrefix: string | null;
  approvalStatus: string[];
  clientName: string[];
  versionLabel: string[];
  deadlineYear: string[];
  // AI gorsel-analizi tri-state filtresi: true = yalniz analizli, false = yalniz analizsiz,
  // null/undefined = filtre yok. Opsiyonel → kapsam cagiranlari (extract/gorsel-arama/vision)
  // alani vermezse filtresiz gecer (geriye uyum).
  aiAnalyzed?: boolean | null;
  // Gorsel turu filtresi (AI vision `ai_gorsel_turu`): kanonik token ("Fotoğraf"|"Render"|"Doku")
  // veya null/undefined = filtre yok. Opsiyonel (aiAnalyzed ile ayni konvansiyon; geriye uyum).
  gorselTuru?: string | null;
  // GENEL metadata (EAV) facet secimleri: anahtar → secili degerler ("unit_type" → ["Metre"]).
  // Bos dizi ya da eksik anahtar = o facet filtre disi. Opsiyonel (aiAnalyzed ile ayni
  // konvansiyon; kapsam cagiranlari [extract/gorsel-arama] vermezse filtresiz gecer).
  //
  // KAYIT olarak tutulur (facet basina ayri alan DEGIL): yeni bir metadata facet'i eklemek
  // bu tipi, store'u, buildListOpts'u ve tum tuketicileri DEGISTIRMEZ — yalniz yeni bir anahtar
  // girer. Rust tarafi da parametrik (bkz FILTER_FRAG `:metadata`).
  metadata?: Record<string, string[]>;
}

/** Metadata facet kaydini IPC dizisine cevir — **bos secimler elenir** (o anahtar filtre disi).
 *  Anahtar sirasi sabitlenir (sort): ayni secim her zaman AYNI ListOpts'u uretir → React
 *  identity/deps karsilastirmalari ve sorgu onbellegi kararli kalir. */
export function metadataToDto(meta: Record<string, string[]> | undefined) {
  if (!meta) return [];
  return Object.keys(meta)
    .sort()
    .filter((k) => meta[k]?.length)
    .map((key) => ({ key, values: meta[key] }));
}

/** Metadata secimlerinden KARARLI bir identity parcasi uret (React deps/onbellek karsilastirmasi).
 *  Anahtarlar ve degerler sirasiz gelebilir → ikisi de siralanir: ayni secim daima AYNI dize.
 *  Sirasiz birakilirsa "ayni filtre" farkli dize uretip GEREKSIZ yeniden-sorgu tetiklerdi. */
export function metaIdentity(meta: Record<string, string[]> | undefined): string {
  if (!meta) return "";
  return Object.keys(meta)
    .sort()
    .filter((k) => meta[k]?.length)
    .map((k) => `${k}=${[...meta[k]].sort().join("|")}`)
    .join(";");
}

/** Sayfali sorgu (liste/FTS) ust-alanlari — EXTRACT bunlari onemsemez (varsayilan gecer;
 *  backend FTS `query`'yi zaten yok sayar). Liste yolu her sayfa/sorgu icin override eder. */
export interface QueryBase {
  page?: number;
  pageSize?: number;
  query?: string | null;
  fuzzy?: boolean;
}

/** Aktif facet filtresi (+ opsiyonel sayfalama/sorgu) → Rust `ListOpts` (snake_case; birebir).
 *  Facet alanlari `list_assets`/`semantic_search`/extract'ta AYNI uygulanir; ust-alanlar (page/
 *  query/fuzzy) yalniz sayfali liste yolunda anlamlidir. */
export function buildListOpts(f: FacetFilter, base: QueryBase = {}): ListOpts {
  const opts: ListOpts = {
    page: base.page ?? 0,
    page_size: base.pageSize ?? DEFAULT_PAGE_SIZE,
    sort: f.sort,
    query: base.query ?? null,
    fuzzy: base.fuzzy ?? false,
    ext: f.ext,
    tag: f.tag,
    collection: f.collection,
    project: f.project,
    modified_after: f.modifiedAfter,
    modified_before: f.modifiedBefore,
    favorites_only: f.favoritesOnly,
    path_prefix: f.pathPrefix ?? null,
    approval_status: f.approvalStatus,
    client_name: f.clientName,
    version_label: f.versionLabel,
    deadline_year: f.deadlineYear,
  };
  // Tri-state: yalniz belirli (true/false) iken gonder; null/undefined → alan absent (filtre yok).
  if (f.aiAnalyzed != null) opts.ai_analyzed = f.aiAnalyzed;
  // Gorsel turu: yalniz secili iken gonder; null/undefined → alan absent (filtre yok).
  if (f.gorselTuru != null) opts.gorsel_turu = f.gorselTuru;
  // Metadata: yalniz DOLU secim varsa gonder; hepsi bossa alan absent (filtre yok).
  const meta = metadataToDto(f.metadata);
  if (meta.length > 0) opts.metadata = meta;
  return opts;
}
