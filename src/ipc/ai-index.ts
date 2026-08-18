// IPC alan modulu: AI indeksleme — metin/gorsel (CLIP) embedding, hibrit + gorsel arama,
// RAG chunk indeksleme, AI model bootstrap (import) ve tarama-sonrasi otomatik indeks
// kuyrugu + olay abonelikleri. Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AssetPage, AssetRow, ListOpts } from "./assets";

/** Semantik (embedding) indeks durumu (sunucu-tarafi `EmbedStatus`; camelCase).
 *  `embedded` = vektoru olan aktif asset, `pending` = vektoru olmayan, `total` =
 *  toplam aktif. `modelReady` = embedding modeli dosyalari bulundu mu (false ise
 *  uretim yapilamaz). Salt-okuma (her rol). */
export interface EmbedStatus {
  embedded: number;
  pending: number;
  total: number;
  modelReady: boolean;
}

/** Embedding uretim canli ilerlemesi (Channel ile akar; INGEST ile BIREBIR ayni
 *  desen, camelCase). `processed` tamamlanan, `total` toplam islenecek, `currentPath`
 *  su an embedlenen dosya (LTR; son ozette bos olabilir). */
export interface EmbedProgress {
  processed: number;
  total: number;
  currentPath: string;
}

/** Embedding uretim raporu (`run_embedding` sonucu; camelCase). `embedded` basariyla
 *  vektorlenen, `failed` hata alan, `elapsedMs` gecen sure (ms). */
export interface EmbedRunReport {
  embedded: number;
  failed: number;
  elapsedMs: number;
}

/** RAG indeks durumu (Artim 2; sunucu `RagIndexStatusDto`; camelCase). `indexed` = **guncel
 *  parcalama kuraliyla** en az bir chunk'i olan aktif asset, `pending` = olmayan (hic chunk'i
 *  yok VEYA hepsi bayat), `chunks` = toplam parca, `staleChunks` = eski kuralla uretilmis parca. */
export interface RagIndexStatus {
  indexed: number;
  pending: number;
  total: number;
  chunks: number;
  /** >0 → parcalama kurallari degisti, bu parcalar yeniden uretilmeyi bekliyor (migration 0033). */
  staleChunks: number;
  modelReady: boolean;
}

/** RAG indeksleme canli ilerlemesi (Channel; embed ile ayni sekil). */
export interface RagProgress {
  processed: number;
  total: number;
  currentPath: string;
}

/** RAG indeksleme raporu (`run_rag_indexing` sonucu). `indexed` asset, `chunks` parca,
 *  `failed` hata, `elapsedMs` sure. */
export interface RagRunReport {
  indexed: number;
  chunks: number;
  failed: number;
  elapsedMs: number;
}

/** Bir asset'in tek RAG parcasi (detay "Parçalar" sekmesi; sunucu `AssetChunkDto`, camelCase).
 *  `chunkIndex < 0` → metadata chunk (dosya/proje/etiket/EAV ozeti). Genelde tek parcadir (-1)
 *  ama uzun katman/blok listeleri token butcesine bolunur → -1, -2, -3... `0,1,2...` govde. */
export interface AssetChunkRow {
  chunkId: number;
  chunkIndex: number;
  page: number | null;
  text: string;
}

/** Gorsel (CLIP) indeks durumu (Faz 5.3; sunucu-tarafi `ImageEmbedStatus`; camelCase).
 *  `embedded` = gorsel vektoru olan aktif gorsel, `pending` = vektoru olmayan, `total` =
 *  toplam embedlenebilir gorsel. `modelReady` = CLIP model dosyalari bulundu mu (false ise
 *  uretim yapilamaz). Salt-okuma (her rol). */
export interface ImageEmbedStatus {
  embedded: number;
  pending: number;
  total: number;
  modelReady: boolean;
  /** Çok-dilli metin modeli mevcut mu (Faz 5.4) → metin→görsel sorgusu Türkçe dahil
   *  çok dilde çalışır. false → İngilizce CLIP metin kodlayıcısına düşülür. */
  multilingual: boolean;
}

/** Gorsel embedleme canli ilerlemesi (Channel ile akar; EmbedProgress ile birebir ayni
 *  desen, camelCase). `processed` tamamlanan, `total` toplam islenecek, `currentPath` su an
 *  embedlenen gorsel (LTR; son ozette bos olabilir). */
export interface ImageEmbedProgress {
  processed: number;
  total: number;
  currentPath: string;
}

/** Gorsel embedleme raporu (`run_image_embedding` sonucu; camelCase). `embedded` basariyla
 *  vektorlenen gorsel, `failed` hata alan, `elapsedMs` gecen sure (ms). */
export interface ImageEmbedRunReport {
  embedded: number;
  failed: number;
  elapsedMs: number;
}

/** Bir GORSEL ARAMA (CLIP metin→gorsel) isabeti: asset satiri (mevcut `AssetRow` reuse) +
 *  GERCEK cosine benzerlik skoru `[0,1]`. Ayni asset TEK kez (asset-duzeyi, en iyi skor).
 *  Sonuclar skor AZALAN sirali gelir → UI skoru gorunur kilar + istemci-tarafi esik uygular.
 *  `ShapeHit` ile ayni sekil ama AYRI olcek (CLIP metin-gorsel yakinligi) → ayri tip. */
export interface VisualHit {
  asset: AssetRow;
  score: number;
}

// ── P0.4 AI model bootstrap (guided in-app import) ──────────────────────────────
/** Gerekli bir AI modelinin frontend anahtari (backend `ModelSpec.key` ile birebir). */
export type ModelKey = "text" | "clip" | "mclip";

/** Tek bir AI modelinin durumu (sunucu-tarafi `ModelInfo`; camelCase). `ready` = embedder'in
 *  gordugu gercek (resolve edilebiliyor mu); `path` = resolve edilen dizin (yalniz ready ise). */
export interface ModelInfo {
  key: ModelKey;
  dirName: string;
  ready: boolean;
  path: string | null;
}

/** Tum AI modellerinin durumu + import hedefi (sunucu-tarafi `ModelsStatusDto`; camelCase).
 *  `importRoot` = app_local_data_dir/models (import buraya kopyalar; UI gosterir). */
export interface ModelsStatusDto {
  allReady: boolean;
  models: ModelInfo[];
  importRoot: string;
}

/** Model import canli ilerlemesi (Channel; sunucu `ImportProgress`, camelCase). `phase`:
 *  tarama → kopyalama → dogrulama → bitti. Yuzde = copiedBytes/totalBytes (copying'de anlamli). */
export interface ImportProgress {
  phase: "scanning" | "copying" | "validating" | "done";
  current: string;
  copiedBytes: number;
  totalBytes: number;
}

/** Model import sonucu (`import_models`; camelCase). `imported` yeni kopyalanan, `already` zaten
 *  var olan, `missing` kaynakta bulunamayan model dizin adlari; `destRoot` kopyalama hedefi. */
export interface ImportReport {
  imported: string[];
  already: string[];
  missing: string[];
  destRoot: string;
}

// ── P1 Tarama-sonrasi OTOMATIK AI indeks kuyrugu (kalici; yerel 3 stage) ────────
/** Otomatik indeks yerel adimi: `text` metin embedding · `image` gorsel (CLIP) embedding ·
 *  `chunk` RAG parcalama. Vision (Ollama) DAHIL DEGIL — o opt-in, ayri kartla (manuel) surer. */
export type AutoIndexStage = "text" | "image" | "chunk";

/** Otomatik indeks durumu (`auto_index_status`; salt-okuma, rol yok). `enabled` = ozellik acik mi
 *  (varsayilan true), `active` = surucu su an bir tur kosuyor mu, `skipped` = kalici-basarisiz
 *  (indekslenemeyen) iz sayisi ("yeniden dene" ile temizlenir). */
export interface AutoIndexStatus {
  enabled: boolean;
  active: boolean;
  skipped: number;
}

/** Yerel AI indekslerini sifirlama raporu. Yalniz turetilmis metin/CLIP/RAG verileri sayilir;
 * kaynak dosyalar ve vision analizi korunur. */
export interface AiIndexResetReport {
  textVectors: number;
  imageVectors: number;
  chunks: number;
  skipped: number;
}

/** `index_started` olay yuku — bir indeks turu basladi. `pending` = yerel 3 stage'in toplam
 *  bekleyeni (banner "basliyor" indeterminate gostergesi). */
export interface IndexStartedEvent {
  pending: number;
}

/** `index_progress` olay yuku — canli ilerleme. `stage` su anki yerel adim; `processed`/`total`
 *  o adimin ilerleyisi; `currentPath` islenen dosya (LTR; banner'da kisaltilir). */
export interface IndexProgressEvent {
  stage: AutoIndexStage;
  processed: number;
  total: number;
  currentPath: string;
}

/** `index_done` olay yuku — tur bitti (banner gizlenir + ozet toast). `embedded` metin,
 *  `imageEmbedded` gorsel, `chunked` RAG-parcalanan asset; `skipped` bu turda atlanan; `stopped`
 *  kullanici "Durdur" ile mi bitirdi; `elapsedMs` gecen sure. */
export interface IndexDoneEvent {
  embedded: number;
  imageEmbedded: number;
  chunked: number;
  skipped: number;
  stopped: boolean;
  elapsedMs: number;
}

/** AI indeks (embed/CLIP/hibrit/RAG-indeks/model/oto-indeks) komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const aiIndexIpc = {
  // ── Semantik arama / embedding (Faz 5.1): anlam-bazli arama + vektor uretimi ──
  /** Semantik indeks durumu: kac asset embedlendi / kac kaldi + model hazir mi.
   *  Salt-okuma (her rol). Dashboard "Semantik Indeks" karti bunu cizer. */
  embedStatus: (): Promise<EmbedStatus> => invoke<EmbedStatus>("embed_status"),

  /** Eksik embedding'leri uret (admin). Canli ilerleme Channel ile akar (INGEST ile
   *  birebir ayni desen). onProgress yoksa kanal yine gecer (backend daima yollar) ama
   *  dinlenmez — zararsiz. Bitince `EmbedRunReport` doner. */
  runEmbedding: (onProgress?: (p: EmbedProgress) => void): Promise<EmbedRunReport> => {
    const channel = new Channel<EmbedProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<EmbedRunReport>("run_embedding", { onProgress: channel });
  },

  // ── RAG chunk indeksleme (Artim 2): govde + metadata chunk → MiniLM embed ──
  /** ANLAMLI (semantik/vektor) arama — sorgu metni embedlenir + kNN → `AssetPage` (grid ile AYNI
   *  sekil). Items EKSTRA `score` (gercek cosine, yuksek=benzer) tasir → kartta % benzerlik rozeti.
   *  FTS'ten AYRI kod yolu (H3 mimarisi: FTS ile vektor ayri backend yollari). Backend'de KAYITLI;
   *  bu sarmalayici "acik anlamli-ara modu"nu (SearchBar keyword↔anlamli) yerelde de aydinlatir.
   *  `query` AYRI parametre (backend `semantic_search(query, opts)`); `opts.query` YOK SAYILIR.
   *  Model yoksa komut Err doner (cagiran ham mesaji gosterir). Tek sayfa (top-k); bos sorgu → bos. */
  semanticSearch: (query: string, opts: ListOpts): Promise<AssetPage> =>
    invoke<AssetPage>("semantic_search", { query, opts }),

  /** RAG indeks durumu (indekslenmis/bekleyen/toplam asset + chunk sayisi + model hazir mi).
   *  Salt-okuma (her rol). Dashboard "RAG Indeks" karti bunu cizer. */
  ragIndexStatus: (): Promise<RagIndexStatus> => invoke<RagIndexStatus>("rag_index_status"),

  /** Bekleyen asset'leri RAG icin indeksle (admin). Canli ilerleme Channel ile (embed deseni).
   *  Bitince `RagRunReport` doner. */
  runRagIndexing: (onProgress?: (p: RagProgress) => void): Promise<RagRunReport> => {
    const channel = new Channel<RagProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<RagRunReport>("run_rag_indexing", { onProgress: channel });
  },

  /** Bir asset'in RAG parcalari (detay "Parçalar" sekmesi). Metadata chunk (-1) once, sonra
   *  govde parcalari. Salt-okuma (her rol). Bos liste → asset henuz indekslenmemis. */
  assetChunks: (assetId: number): Promise<AssetChunkRow[]> =>
    invoke<AssetChunkRow[]>("asset_chunks", { assetId }),

  // ── Gorsel / CLIP arama (Faz 5.3): metin→gorsel + gorsel→gorsel + gorsel embedleme ──
  /** Gorsel (CLIP) indeks durumu: kac gorsel embedlendi / kac kaldi + model hazir mi.
   *  Salt-okuma (her rol). Dashboard "Gorsel Indeks" karti bunu cizer. */
  imageEmbedStatus: (): Promise<ImageEmbedStatus> =>
    invoke<ImageEmbedStatus>("image_embed_status"),

  // NOT (2026-07-18 olu-kod taramasi): `imageSearch` sarmalayicisi KALDIRILDI — cagirani yoktu
  // ve `visualSearch` onun YERINI ALMISTI: ayni girdi, daha zengin cikti (gercek cosine +
  // bolge-max) ve daha dogru siralama (vec0 mesafe-metriginden BAGIMSIZ; bkz
  // `archivist-db/image.rs` `image_search_scored` dokumani). Iki benzer API'yi yan yana
  // birakmak bugun ogrendigimiz surukleme tuzagi: sonraki gelistirici yanlis olani cagirir.
  // Backend `image_search` komutu (image_commands.rs) HALA KAYITLI ve testli — silinmedi,
  // karar kullaniciya birakildi (bkz docs/H2_PARITY.md olu-kod notu).

  /** Amacli GORSEL ARAMA (metin→gorsel CLIP; ana FTS kutusundan AYRI arac — H2 disiplini).
   *  `query` metni cok-dilli metin kodlayicisiyla gorsellerle eslestirilir (Turkce DOGRUDAN —
   *  ceviri GEREKMEZ). Kaldirilan `imageSearch`'ten farki: `AssetPage` degil GERCEK cosine skorlu
   *  `VisualHit[]` doner (skor AZALAN sirali) → UI skoru gorunur kilar + istemci-tarafi esik
   *  uygular (kor-kalibrasyon yok). Tum filtreler `opts` ile uygulanir (gorsel sorgu ayri gecer;
   *  `opts.query` onemsiz). Tek sayfa (top-k). Bos sorgu → []. Model yoksa komut Err doner
   *  (mesajda "model"/"CLIP" → UI "Pano'dan iceri aktar" ipucu). */
  visualSearch: (query: string, opts: ListOpts): Promise<VisualHit[]> =>
    invoke<VisualHit[]>("visual_search", { query, opts }),

  /** Gorsel→gorsel ("benzer gorseller"; Faz 5.3): verilen `assetId`'nin CLIP vektorune
   *  en yakin gorseller. `list_assets` ile AYNI `AssetPage` seklini doner; benzerlik-skoru
   *  sirali. Tum filtreler `opts` ile uygulanir. Tek sayfa (top-k); sayfalama yok. */
  similarImages: (assetId: number, opts: ListOpts): Promise<AssetPage> =>
    invoke<AssetPage>("similar_images", { assetId, opts }),

  /** Eksik gorsel (CLIP) embedding'lerini uret (admin). Canli ilerleme Channel ile akar
   *  (`runEmbedding` ile BIREBIR ayni desen). onProgress yoksa kanal yine gecer (backend
   *  daima yollar) ama dinlenmez — zararsiz. Bitince `ImageEmbedRunReport` doner. */
  runImageEmbedding: (
    onProgress?: (p: ImageEmbedProgress) => void,
  ): Promise<ImageEmbedRunReport> => {
    const channel = new Channel<ImageEmbedProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ImageEmbedRunReport>("run_image_embedding", { onProgress: channel });
  },

  /** Katman 1 render/foto/doku BACKFILL (admin; Doctor/bakim): `ai_gorsel_turu` etiketi OLMAYAN
   *  mevcut raster gorselleri EXIF/ad/klasor/boyut sinyallerinden DETERMINISTIK siniflandirir
   *  (model GEREKMEZ, tam offline). Idempotent — yalniz eksikler islenir; sinyalsiz gorseller
   *  etiketsiz kalir (Katman 2 vision doldurabilir). Yeni indekslenen gorseller ingest'te ZATEN
   *  oto-siniflanir; bu komut MEVCUT gorselleri (or. bu ozellikten onceki arsiv) toplu etiketler.
   *  Doner: yeni yazilan (siniflanan) asset sayisi. Non-admin backend'de reddedilir (Err). */
  backfillImageKind: (): Promise<number> => invoke<number>("backfill_image_kind"),

  // ── P0.4 AI model bootstrap (guided in-app import; import ADMIN) ──
  /** AI model durumu: her modelin hazir mi + resolve yolu + import hedefi (importRoot).
   *  Bilgilendirme (her rol okur; import'un kendisi admin). */
  modelStatus: (): Promise<ModelsStatusDto> => invoke<ModelsStatusDto>("model_status"),

  /** Modelleri bir kaynak klasorden app_local_data_dir/models'a ICE AKTAR (admin; offline —
   *  kullanici klasoru getirir). Canli ilerleme Channel ile akar (INGEST/embed ile ayni desen).
   *  onProgress yoksa kanal yine gecer (backend daima yollar) ama dinlenmez — zararsiz. Bitince
   *  `ImportReport` doner. Non-admin cagri backend'de reddedilir (Err). */
  importModels: (
    sourceDir: string,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportReport> => {
    const channel = new Channel<ImportProgress>();
    if (onProgress) channel.onmessage = onProgress;
    return invoke<ImportReport>("import_models", { sourceDir, onProgress: channel });
  },

  // ── P1 Otomatik AI indeks kuyrugu (tarama-sonrasi; kalici yerel 3 stage) ──
  /** Otomatik indeks durumu: acik mi · su an aktif mi · atlanan (skip) sayisi. Salt-okuma (her rol).
   *  Ayar karti (aç/kapa + "N atlandı → yeniden dene") bunu cizer. */
  autoIndexStatus: (): Promise<AutoIndexStatus> => invoke<AutoIndexStatus>("auto_index_status"),

  /** Otomatik indekslemeyi ac/kapa (ADMIN). Acilinca surucu birikmis kalan isi hemen devralir;
   *  kapaliyken tarama-sonrasi adimlar tetiklenmez (yalniz ilgili panellerden elle). */
  setAutoIndexEnabled: (enabled: boolean): Promise<void> =>
    invoke<void>("set_auto_index_enabled", { enabled }),

  /** Devam eden otomatik indeks turunu durdur (ADMIN; banner "Durdur"). Kalan is bekleyen kalir →
   *  bir sonraki tik/tarama devam ettirir. */
  stopAutoIndex: (): Promise<void> => invoke<void>("stop_auto_index"),

  /** Kalici-atlanmis (indekslenemeyen) izleri temizle → asset'ler yeniden bekleyen olur + surucuye
   *  tik (ADMIN). `stage` verilmezse TUM adimlar (v1: stage'siz cagir = hepsi). Temizlenen iz
   *  sayisini doner. */
  retrySkippedIndex: (stage?: AutoIndexStage): Promise<number> =>
    invoke<number>("retry_skipped_index", { stage }),

  /** Semantik metin, CLIP gorsel ve RAG indekslerini atomik temizle (ADMIN). Kaynak asset,
   * metadata, thumbnail, klasik FTS ve vision sonucu korunur. Oto-indeks aciksa yeniden uretim
   * hemen baslar; kapaliysa ilgili kartlardaki elle "Embedle/Indeksle" eylemleri kullanilir. */
  resetLocalAiIndexes: (): Promise<AiIndexResetReport> =>
    invoke<AiIndexResetReport>("reset_local_ai_indexes"),

  /** YALNIZ RAG parcalarini sil (ADMIN) — semantik ve CLIP gorsel indeksleri KORUNUR.
   * Silinen parca sayisini doner. Parcalama kurallari degistiginde gerekir: parcalar bayatlar
   * ama vektor indeksleri gecerli kalir, dolayisiyla tam sifirlama gereksiz pahali olur.
   * Sonrasinda "Indeksle" ile tum arsiv yeni kurallarla yeniden parcalanir. */
  resetRagChunks: (): Promise<number> => invoke<number>("reset_rag_chunks"),
};

// ── P1 Otomatik AI indeks OLAYLARI (Tauri `listen`) — banner/hook abonelik yardimcilari ──
// Olay adlari + yuklerini tipli baglar (renderer yalniz bunlari dinler; `useAutoIndex` kullanir).
// Her helper `UnlistenFn` (Promise) doner → effect cleanup'ta cagrilir (useFolderWatcher deseni).
export const AUTO_INDEX_EVENT = {
  started: "index_started",
  progress: "index_progress",
  done: "index_done",
} as const;

/** `index_started`'a abone ol → tur baslayinca `handler(payload)`. Cleanup icin `UnlistenFn` doner. */
export const onIndexStarted = (handler: (p: IndexStartedEvent) => void): Promise<UnlistenFn> =>
  listen<IndexStartedEvent>(AUTO_INDEX_EVENT.started, (e) => handler(e.payload));

/** `index_progress`'e abone ol → her ilerleme adiminda `handler(payload)`. */
export const onIndexProgress = (handler: (p: IndexProgressEvent) => void): Promise<UnlistenFn> =>
  listen<IndexProgressEvent>(AUTO_INDEX_EVENT.progress, (e) => handler(e.payload));

/** `index_done`'a abone ol → tur bitince `handler(payload)` (ozet toast). */
export const onIndexDone = (handler: (p: IndexDoneEvent) => void): Promise<UnlistenFn> =>
  listen<IndexDoneEvent>(AUTO_INDEX_EVENT.done, (e) => handler(e.payload));
