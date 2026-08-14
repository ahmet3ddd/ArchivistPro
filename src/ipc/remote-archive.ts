// IPC alan modulu: UZAK (ana) ARSIV OKUMA — LAN Faz 2. Backend `src-tauri/src/remote_archive.rs`.
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.
//
// YETKI: eslesme (host+kod kaydetme) Admin'in (bkz lan-client.ts); OKUMA Admin+Editor'un.
// 8-hane kod buraya HIC gelmez — backend host bilgisini app_meta'dan kendisi okur.
//
// Salt-okuma: yerel DB'ye hicbir sey yazilmaz, uzak arsive hicbir sey gonderilmez.

import { invoke } from "@tauri-apps/api/core";

import type { AnalysisScope, RagChatOptions, RetrieveDiag } from "./ai-chat";
import type { AssetDetail, AssetPage, FolderSummaryDto, ListOpts, ThumbnailDto } from "./assets";

/** Uzak arsiv baglanti durumu (backend `RemoteStatus`, camelCase). Auth kodu ICERMEZ. */
export interface RemoteArchiveStatus {
  /** Eslesme kayitli mi (host + kod var mi) — kodun DEGERI degil, varligi. */
  configured: boolean;
  /** Host su an ulasilabilir mi (`/ping` yanit verdi mi). */
  reachable: boolean;
  /** Host'un uygulama surumu (ulasilabiliyorsa). */
  appVersion: string | null;
  /** Gorunur etiket ("192.168.1.5:9471") — UI'da kaynak adinin yaninda. */
  hostLabel: string | null;
}

/** Uzak arsiv hata token'lari — backend `RemoteError::token()` ile BIREBIR eslesir.
 *  i18n anahtarlari bunlara bagli (`remote_archive.err_*`); degisirse 5 dil de degisir.
 *  `remote_not_indexed` (LAN Faz 5): host'ta embedding modeli/indeks YOK (HTTP 503) → uzak
 *  semantik/RAG calisamaz; "sunucu hatasi"ndan ayri, "ana arsivde AI indeksi olusturun" der. */
export type RemoteErrorToken =
  | "not_configured"
  | "auth_failed"
  | "timeout"
  | "server_busy"
  | "network_error"
  | "bad_response"
  | "remote_not_indexed";

/** Bilinen token'lar — gelen hatanin tipli mi yoksa beklenmedik mi oldugunu ayirmak icin. */
const KNOWN_TOKENS: readonly string[] = [
  "not_configured",
  "auth_failed",
  "timeout",
  "server_busy",
  "network_error",
  "bad_response",
  "remote_not_indexed",
];

/** Backend'den gelen hatayi bilinen token'a esle; taninmayan hata → null (cagiran ham metni gosterir).
 *  Saf fonksiyon → birim test edilir. */
export function remoteErrorToken(e: unknown): RemoteErrorToken | null {
  const raw = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  const trimmed = raw.trim();
  return KNOWN_TOKENS.includes(trimmed) ? (trimmed as RemoteErrorToken) : null;
}

/**
 * Uzak hatayi KULLANICIYA gosterilecek metne cevir: tipli token → `remote_archive.err_*`
 * cevirisi; taninmayan hata → ham metin (sessiz yutma YOK — projenin dersi).
 *
 * ⚠️ Neden ortak: bu esleme once yalniz Pano ve gezginde vardi; **Sohbet'in hata balonu
 * atlanmisti** → canli testte ekranda ham `remote_not_indexed` token'i cikti (kullanici
 * ekran goruntusu, 2026-07-22). Ucuncu kopya yerine tek fonksiyon: yeni bir cagiran
 * eklendiginde ceviriyi unutma yuzeyi kalmaz.
 *
 * `t` disaridan verilir → bu modul i18n'e BAGLANMAZ (saf; dogrudan test edilir).
 */
export function remoteErrorMessage(e: unknown, t: (key: string) => string): string {
  const token = remoteErrorToken(e);
  return token ? t(`remote_archive.err_${token}`) : String(e);
}

/** Ana arsivin indeks/sayac ozeti (LAN Faz 5; backend `RemoteStatsDto`, camelCase). "Ana arsiv ne
 *  kadar AI-indeksli / uzak semantik-RAG kullanilabilir mi" gorunumunu besler (uzak Pano karti).
 *  Salt-okuma; tetikleyici/kuyruk YOK (uzak Pano yalniz sayac gosterir — H2 dersi). */
export interface RemoteStatsDto {
  /** Metin vektoru olan (semantik aranabilir) asset sayisi. */
  vectorCount: number;
  /** Vektoru bekleyen (henuz embedlenmemis) aktif asset. */
  pendingEmbed: number;
  /** En az bir RAG chunk'i olan asset. */
  chunkedAssets: number;
  /** Chunk'lanmayi bekleyen aktif asset. */
  pendingChunk: number;
  /** Toplam RAG chunk (govde + metadata). */
  chunkCount: number;
  /** Toplam aktif asset (cop haric). */
  assetCount: number;
  /** Klasor (ust-dizin) sayisi. */
  folderCount: number;
  /** Host'ta embedding modeli hazir mi (uzak semantik/RAG calisabilir mi). */
  modelReady: boolean;
}

/** Uzak RAG retrieval'in bir isabeti (backend `ChunkHit`, camelCase). Host embed+retrieve KENDI
 *  yapar (indeksi ONCEDEN insa etti); istemci donen chunk'larla LLM uretir. Yerel `Citation` ile
 *  ayni alanlar + `score` (birlesik retrieval skoru). */
export interface ChunkHit {
  chunkId: number;
  assetId: number;
  fileName: string;
  path: string;
  /** Govde parcasi sirasi (0,1,...); metadata chunk icin -1. */
  chunkIndex: number;
  page: number | null;
  text: string;
  /** Birlesik skor (RRF; yuksek = daha iyi). */
  score: number;
}

/** Uzak RAG retrieval sonucu (`remote_rag_retrieve` cikti sekli): host'un dondugu chunk'lar +
 *  retrieval tanisi (`RetrieveDiag` yerel sohbetle AYNI camelCase). */
export interface RemoteRetrieveResult {
  chunks: ChunkHit[];
  diag: RetrieveDiag;
}

/** Uzak arsiv komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const remoteArchiveIpc = {
  /** Ana arsivde sayfali sorgu (Admin+Editor). Sekil yerel `listAssets` ile AYNI (`AssetPage`)
   *  → mevcut grid/hook katmani yeniden kullanilir, ikinci bir grid yazilmaz. */
  remoteListAssets: (opts: ListOpts): Promise<AssetPage> =>
    invoke<AssetPage>("remote_list_assets", { opts }),

  /** Uzak arsiv durumu (Admin+Editor). Eslesme yoksa configured=false (hata DEGIL). */
  remoteArchiveStatus: (): Promise<RemoteArchiveStatus> =>
    invoke<RemoteArchiveStatus>("remote_archive_status"),

  /** Ana arsivde tek asset detayi (Admin+Editor). Yoksa/cop'teyse null.
   *  Sekil yerel `getAsset` ile AYNI → detay paneli yeniden kullanilir (SALT-OKUMA). */
  remoteGetAsset: (id: number): Promise<AssetDetail | null> =>
    invoke<AssetDetail | null>("remote_get_asset", { id }),

  /** Ana arsivden kucuk resimler (Admin+Editor, BATCH). Yerel `getThumbnails` ile ayni sekil. */
  remoteThumbnails: (ids: number[]): Promise<ThumbnailDto[]> =>
    invoke<ThumbnailDto[]>("remote_thumbnails", { ids }),

  /** Ana arsivin klasor ozetleri (Admin+Editor, GIRDISIZ). Yerel `folderSummary` ile AYNI sekil
   *  → "Klasorler" gorunumu yeniden kullanilir (uzak modda SALT-OKUMA: yazma eylemleri kapali). */
  remoteFolderSummary: (): Promise<FolderSummaryDto[]> =>
    invoke<FolderSummaryDto[]>("remote_folder_summary"),

  /** Ana arsivde UZAK SEMANTIK (vektor) arama (Admin+Editor; LAN Faz 5). `opts.query` = semantik
   *  sorgu metni; HOST embed + kNN yapar → yerel `semanticSearch`/grid ile AYNI `AssetPage` sekli.
   *  Items'ta EKSTRA `score` (gercek cosine, yuksek=benzer) → kartta % benzerlik rozeti. Host'ta
   *  model/indeks yoksa `remote_not_indexed` (503) token'i doner. Tek sayfa (top-k). */
  remoteSemanticSearch: (opts: ListOpts): Promise<AssetPage> =>
    invoke<AssetPage>("remote_semantic_search", { opts }),

  /** Ana arsivin indeks/sayac ozeti (Admin+Editor, GIRDISIZ; LAN Faz 5). Uzak Pano salt-okuma
   *  "Ana arsiv ozeti" kartini besler. */
  remoteStats: (): Promise<RemoteStatsDto> => invoke<RemoteStatsDto>("remote_stats"),

  /** Ana arsivde UZAK RAG RETRIEVAL (Admin+Editor; LAN Faz 5). Host embed + retrieve KENDI yapar
   *  (indeksi ONCEDEN insa etti); istemci donen chunk'larla LLM uretir (uretim istemcide). `scope`
   *  yerel sohbetle AYNI tagged JSON; `options` RAG zenginlestirme. Host'ta model/chunk yoksa
   *  `remote_not_indexed` (503). NOT: sohbet akisi normalde `ragChat(..., remote=true)` uzerinden
   *  gider (retrieval host + uretim istemci tek komutta); bu dusuk-seviye sarmalayici sozlesme
   *  butunlugu + ileride dogrudan retrieval gerektiren yuzeyler icin. */
  remoteRagRetrieve: (
    question: string,
    scope: AnalysisScope,
    options: RagChatOptions,
  ): Promise<RemoteRetrieveResult> =>
    invoke<RemoteRetrieveResult>("remote_rag_retrieve", { question, scope, options }),
};
