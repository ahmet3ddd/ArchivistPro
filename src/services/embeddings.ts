/**
 * Archivist Pro — AI Embedding Servisi (Transformers.js v4)
 *
 * Yerel olarak çalışan, veri dışarıya göndermeyen semantik vektör üretimi.
 * MiniLM modeli ~ 113MB (q8) veya ~470MB (fp32) — uygulamayla paketli.
 * Dynamic import kullanılır — uygulama başlangıcında yüklenmez.
 *
 * Cihaz seçimi (embedding_device ayarı):
 *  - 'auto'   → navigator.gpu varsa webgpu, yoksa wasm
 *  - 'webgpu' → zorunlu WebGPU (yoksa hata)
 *  - 'wasm'   → CPU
 * WebGPU + fp32 model dosyası yoksa otomatik olarak wasm+q8'e düşer (toast bildirimi).
 */

import { debugLog, systemLog } from './logger';

/**
 * Embedding cihaz seçimi (webgpu/wasm, dtype) telemetrisi — hem dev console'a
 * hem kalıcı sistem loguna (Rust tracing dosyası). fp32/WebGPU teşhisi kullanıcı
 * sahasında bu satırlarla yapılır; ephemeral console yeterli değil.
 */
function logEmbeddingDevice(msg: string) {
    console.info('[Embeddings] ' + msg);
    void systemLog('INFO', 'Embeddings', msg).catch(() => { /* Tauri dışı (test) */ });
}
import { getSetting } from './database';
import { useStore } from '../store/useStore';

type PipelineFn = (texts: string | string[], options?: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

let embeddingPipeline: PipelineFn | null = null;
let isLoading = false;
let loadError: string | null = null;

export type EmbeddingDevice = 'webgpu' | 'wasm';
export type EmbeddingDevicePref = 'auto' | 'webgpu' | 'wasm';

let activeDevice: EmbeddingDevice | null = null;

export type EmbeddingStatus = {
    isReady: boolean;
    isLoading: boolean;
    error: string | null;
    progress: number;
    device: EmbeddingDevice | null;
};

const listeners: Set<(status: EmbeddingStatus) => void> = new Set();

function notifyListeners(status: EmbeddingStatus) {
    listeners.forEach(fn => fn(status));
}

export function onEmbeddingStatusChange(fn: (status: EmbeddingStatus) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function getEmbeddingStatus(): EmbeddingStatus {
    return {
        isReady: embeddingPipeline !== null,
        isLoading,
        error: loadError,
        progress: embeddingPipeline ? 100 : 0,
        device: activeDevice,
    };
}

export function getActiveEmbeddingDevice(): EmbeddingDevice | null {
    return activeDevice;
}

// Multilingual model — Türkçe dahil 50+ dili destekler (384 boyut)
const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

// Görsel (CLIP) model — Pikseller üzerinden 512 boyutlu görsel haritası çıkartır
const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';

let clipPipeline: PipelineFn | null = null;
let isClipLoading = false;

// CLIP text encoder — image embedding ile aynı 512-dim uzayda metin vektörü üretir.
// text→image arama için (English-only, multilingual değil — Türkçe sorgular önce çevrilmeli).
let clipTextTokenizer: { (input: string | string[], opts?: { padding?: boolean; truncation?: boolean }): Promise<unknown> } | null = null;
let clipTextModel: { (inputs: unknown): Promise<{ text_embeds?: { data: Float32Array | number[] }; pooler_output?: { data: Float32Array | number[] } }> } | null = null;
let isClipTextLoading = false;

export const IMAGE_EMBEDDING_SOURCES = [
    'image_global',
    'image_center',
    'image_top_left',
    'image_top_right',
    'image_bottom_center',
] as const;

type ImageEmbeddingSource = typeof IMAGE_EMBEDDING_SOURCES[number];

function normalizeVector(vec: number[]): number[] {
    const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    if (norm === 0) return vec;
    return vec.map(v => v / norm);
}

/**
 * Kullanıcı ayarına ve runtime probe'a göre etkin cihazı seçer.
 * 'auto' → navigator.gpu varsa webgpu, yoksa wasm.
 * Hata fırlatmaz; her zaman geçerli bir cihaz döner.
 */
export async function probeWebGPU(): Promise<boolean> {
    try {
        const nav = navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } };
        if (!nav.gpu) return false;
        const adapter = await nav.gpu.requestAdapter();
        return !!adapter;
    } catch {
        return false;
    }
}

async function resolveDevice(): Promise<EmbeddingDevice> {
    const pref = (getSetting('embedding_device') ?? 'auto') as EmbeddingDevicePref;
    if (pref === 'wasm') return 'wasm';
    if (pref === 'webgpu') {
        // Manuel zorlama — probe başarısız olsa bile webgpu deneyecek;
        // yükleme başarısız olursa fallback wasm devreye girer.
        return 'webgpu';
    }
    // 'auto'
    return (await probeWebGPU()) ? 'webgpu' : 'wasm';
}

function dtypeForDevice(device: EmbeddingDevice, fp32Available: boolean): 'fp32' | 'q8' {
    // fp32 ('model.onnx') YALNIZCA kullanıcı fp32 ağacını import ettiyse vardır.
    // Paketli q8-only ağaçta WebGPU'da bile q8 kullanılmalı: aksi halde
    // transformers var olmayan 'model.onnx'i ister → sunucu index.html/404
    // döner → onnxruntime ERROR_CODE 7 "protobuf parsing failed" (V249-6).
    // WebGPU + q8 transformers.js'te geçerli ve WASM'dan hızlıdır.
    return device === 'webgpu' && fp32Available ? 'fp32' : 'q8';
}

/**
 * Transformers.js v4'ü tam offline çalışacak şekilde yapılandırır.
 * Hem model dosyaları (public/models/) hem de ONNX runtime WASM
 * dosyaları (public/ort/) uygulamayla birlikte paketlendiği için
 * hiçbir CDN'e erişim gerekmez.
 */
/**
 * Model temel yolunu çözer:
 *  - fp32 import edilmişse → app_local_data_dir/models (asset protokol URL'si)
 *    Kullanıcı `models:download:fp32` ağacını Ayarlar'dan import etti; q8+fp32+config
 *    hepsi orada. WebGPU bu sayede prod'da çalışır (MSI'ye gömülmeden, offline).
 *  - değilse → '/models/' (MSI'ye paketli q8 ağacı — bugünkü davranış, değişmez)
 *
 * Tek seferlik çözülür ve cache'lenir (oturum boyunca sabit; import sonrası
 * yeniden başlatma Ayarlar kartında belirtilir). Tauri dışı (test) → '/models/'.
 */
let _modelBaseCache: Promise<{ base: string; fp32Imported: boolean }> | null = null;
function resolveModelBase(): Promise<{ base: string; fp32Imported: boolean }> {
    if (_modelBaseCache) return _modelBaseCache;
    _modelBaseCache = (async () => {
        try {
            const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
            const status = await invoke<{ imported: boolean; path: string }>('fp32_models_status');
            if (status?.imported && status.path) {
                // Windows '\' → '/': transformers.js localModelPath'e modelId'yi
                // string olarak ekliyor; ayraç tutarlılığı için forward-slash.
                const norm = status.path.replace(/\\/g, '/').replace(/\/+$/, '');
                const base = convertFileSrc(norm);
                return { base: base.endsWith('/') ? base : base + '/', fp32Imported: true };
            }
        } catch {
            // Tauri dışı ortam (test) veya komut yok → paketli q8
        }
        return { base: '/models/', fp32Imported: false };
    })();
    return _modelBaseCache;
}

async function isFp32Available(): Promise<boolean> {
    return (await resolveModelBase()).fp32Imported;
}

async function configureTransformersOffline(transformers: typeof import('@huggingface/transformers')) {
    const env = transformers.env as unknown as {
        allowLocalModels: boolean;
        allowRemoteModels: boolean;
        localModelPath: string;
        remoteHost: string;
        remotePathTemplate: string;
        useBrowserCache: boolean;
        backends: { onnx: { wasm: { wasmPaths: string } } };
    };
    const { base, fp32Imported } = await resolveModelBase();
    env.allowLocalModels = true;
    env.localModelPath = base;
    env.useBrowserCache = false;

    // transformers.js v4.2.0 `_get_file_metadata`, yerel dosya var-mı kontrolünü
    // SADECE localModelPath bir URL DEĞİLSE yapar (`if (!isURL)`). fp32 import
    // edilince base `http://asset.localhost/...` (Tauri asset protokolü) bir
    // URL'dir → yerel kontrol atlanır; allowRemoteModels=false ise tokenizer/
    // processor "yok" sayılır → çağrıda `this.tokenizer/processor is not a
    // function` (V249-5). Çözüm: asset URL'de uzak-yolu AYNI asset köküne
    // yönlendir; metadata HEAD isteği asset protokolünden 200 alır, dosyalar
    // gerçekte oradadır. Paketli '/models/' göreli yoldur (URL değil) → yerel
    // kontrol zaten çalışır, uzak kapalı kalır (eski davranış birebir korunur).
    if (/^https?:\/\//i.test(base)) {
        env.allowRemoteModels = true;
        env.remoteHost = base;
        env.remotePathTemplate = '{model}/';
    } else {
        env.allowRemoteModels = false;
    }
    // Hangi model kaynağı aktif — fp32 import teşhisi (kalıcı sistem logu):
    //   '/models/'           → MSI'ye paketli q8 ağacı (veya dev'de public/models)
    //   'http://asset...'    → app_local_data_dir/models (kullanıcı fp32 import etti)
    logEmbeddingDevice(`localModelPath = ${env.localModelPath}${fp32Imported ? ' (fp32)' : ''}`);

    // wasmPaths cihaza/moda göre koşullu:
    //  - Dev mode: SET ETME — transformers v4 import.meta.url ile node_modules'tan
    //    çözümlüyor. /ort/'a işaret edersek Vite "public dir source import" hatası verir.
    //  - Prod build: '/ort/' SET ET — Vite asyncify.wasm'ı bundle ediyor ama JSEP
    //    (WebGPU) varyantını static analiz edemiyor, /public/ort/'tan servis gerek.
    if (import.meta.env.PROD) {
        env.backends.onnx.wasm.wasmPaths = '/ort/';
    }
}

function emitDeviceFallbackToast(reason: string) {
    try {
        const store = useStore.getState();
        if (typeof store.addToast === 'function') {
            store.addToast(`AI hesaplama CPU'ya düştü: ${reason}`, 'warning');
        }
    } catch (err) {
        debugLog('Embeddings', 'fallback toast emit failed', err);
    }
}

/**
 * Önceki yükleme hatasını temizleyip modeli yeniden yüklemeyi dener.
 * Kullanıcının sidebar'dan tetiklediği "Yeniden dene" akışı için.
 */
export async function retryEmbeddingModel(): Promise<void> {
    if (isLoading) return;
    loadError = null;
    notifyListeners(getEmbeddingStatus());
    await loadEmbeddingModel();
}

export async function loadEmbeddingModel(): Promise<void> {
    if (embeddingPipeline || isLoading) return;

    isLoading = true;
    loadError = null;
    notifyListeners(getEmbeddingStatus());

    let simulatedProgress = 0;
    let simulateInterval: ReturnType<typeof setInterval> | null = null;

    try {
        // Dynamic import — uygulama başlangıcında yüklenmez
        const transformers = await import('@huggingface/transformers');
        await configureTransformersOffline(transformers);

        // Tahmini ilerleme: yerel paketli modelde gerçek progress callback gelmediği
        // için kullanıcıya görsel geri bildirim sağla (her 500ms +3, max %95)
        simulateInterval = setInterval(() => {
            if (simulatedProgress < 95) {
                simulatedProgress = Math.min(simulatedProgress + 3, 95);
                notifyListeners({
                    isReady: false,
                    isLoading: true,
                    error: null,
                    progress: simulatedProgress,
                    device: activeDevice,
                });
            }
        }, 500);

        const progressCb = (progress: { status: string; progress?: number }) => {
            if (progress.status === 'progress' && progress.progress !== undefined) {
                const real = Math.round(progress.progress);
                if (real > simulatedProgress) {
                    simulatedProgress = real;
                    notifyListeners({
                        isReady: false,
                        isLoading: true,
                        error: null,
                        progress: simulatedProgress,
                        device: activeDevice,
                    });
                }
            }
        };

        const desired = await resolveDevice();
        const fp32Available = await isFp32Available();
        try {
            embeddingPipeline = await transformers.pipeline(
                'feature-extraction',
                EMBEDDING_MODEL,
                {
                    device: desired,
                    dtype: dtypeForDevice(desired, fp32Available),
                    progress_callback: progressCb,
                }
            ) as unknown as PipelineFn;
            activeDevice = desired;
            logEmbeddingDevice(`text model device = ${activeDevice} (dtype=${dtypeForDevice(activeDevice, fp32Available)})`);
        } catch (err) {
            if (desired === 'webgpu') {
                // WebGPU başarısız → WASM fallback
                debugLog('Embeddings', 'WebGPU yükleme başarısız, WASM fallback', err);
                emitDeviceFallbackToast(err instanceof Error ? err.message : 'bilinmeyen hata');
                embeddingPipeline = await transformers.pipeline(
                    'feature-extraction',
                    EMBEDDING_MODEL,
                    {
                        device: 'wasm',
                        dtype: 'q8',
                        progress_callback: progressCb,
                    }
                ) as unknown as PipelineFn;
                activeDevice = 'wasm';
                logEmbeddingDevice('text model device = wasm (fallback)');
            } else {
                throw err;
            }
        }

        if (simulateInterval) clearInterval(simulateInterval);
        isLoading = false;
        notifyListeners(getEmbeddingStatus());
    } catch (err) {
        if (simulateInterval) clearInterval(simulateInterval);
        isLoading = false;
        loadError = err instanceof Error ? err.message : 'Model yüklenirken hata oluştu';
        notifyListeners(getEmbeddingStatus());
        throw err;
    }
}

/**
 * Metni vektöre dönüştür.
 * Çıktı: 384 boyutlu normalize edilmiş vektör (MiniLM-L12-v2).
 */
export async function generateEmbedding(text: string): Promise<number[]> {
    if (!embeddingPipeline) {
        await loadEmbeddingModel();
    }
    if (!embeddingPipeline) throw new Error('Embedding model yüklenemedi');

    const output = await embeddingPipeline(text, {
        pooling: 'mean',
        normalize: true,
    });

    return Array.from(output.data);
}

/**
 * Modeli yükledikten sonra ONNX inference graph'ını JIT-compile etmek için
 * tek bir dummy inference çalıştırır.
 *
 * WebGPU cold-start 1-3 sn alır; warmup tarama başında çağrılırsa ilk dosya
 * gecikme yaşamaz.
 */
export async function warmupEmbeddingModel(): Promise<void> {
    if (!embeddingPipeline) return;
    try {
        const t0 = performance.now();
        await embeddingPipeline('warmup', { pooling: 'mean', normalize: true });
        const ms = Math.round(performance.now() - t0);
        console.info(`[Embeddings] text model warmup: ${ms}ms (device=${activeDevice})`);
    } catch (err) {
        debugLog('Embeddings', 'text warmup failed (non-fatal)', err);
    }
}

// 1×1 transparent PNG (43 byte) — warmup için sentetik girdi.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

/**
 * CLIP image model'i ısıtmak için 1×1 transparent PNG ile dummy inference.
 *
 * NOT: `data:` URI yerine Blob kullanılır. transformers.js girdiyi `fetch()`
 * ile çözer; CSP `connect-src`'de `data:` yoktur (`blob:` vardır). `data:`
 * kullanılırsa warmup CSP'ye takılıp sessizce çöker → WebGPU pipeline ön-
 * derlenemez → ilk taranan görselde uzun donma. Blob → `blob:` yolu gerçek
 * tarama yolunun (generateImageEmbedding) birebir aynısıdır, CSP-güvenli.
 */
export async function warmupClipModel(): Promise<void> {
    if (!clipPipeline) return;
    try {
        const bin = atob(TINY_PNG_B64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blob = new Blob([bytes], { type: 'image/png' });
        const t0 = performance.now();
        await generateImageEmbedding(blob);
        const ms = Math.round(performance.now() - t0);
        console.info(`[Embeddings] CLIP model warmup: ${ms}ms`);
    } catch (err) {
        debugLog('Embeddings', 'CLIP warmup failed (non-fatal)', err);
    }
}

/**
 * CLIP Image Modelini yükle.
 */
export async function loadClipModel(): Promise<void> {
    if (clipPipeline || isClipLoading) return;

    isClipLoading = true;
    try {
        const transformers = await import('@huggingface/transformers');
        await configureTransformersOffline(transformers);

        const desired = await resolveDevice();
        const fp32Available = await isFp32Available();
        try {
            clipPipeline = await transformers.pipeline(
                'image-feature-extraction',
                CLIP_MODEL,
                { device: desired, dtype: dtypeForDevice(desired, fp32Available) }
            ) as unknown as PipelineFn;
            logEmbeddingDevice(`CLIP image model device = ${desired}`);
        } catch (err) {
            if (desired === 'webgpu') {
                debugLog('Embeddings', 'CLIP WebGPU yükleme başarısız, WASM fallback', err);
                clipPipeline = await transformers.pipeline(
                    'image-feature-extraction',
                    CLIP_MODEL,
                    { device: 'wasm', dtype: 'q8' }
                ) as unknown as PipelineFn;
                logEmbeddingDevice('CLIP image model device = wasm (fallback)');
            } else {
                throw err;
            }
        }

        isClipLoading = false;
    } catch (err) {
        isClipLoading = false;
        debugLog('Embeddings', 'CLIP modeli yüklenirken hata', err);
        throw err;
    }
}

/**
 * CLIP text encoder'ı yükler. Vision model ile aynı checkpoint'ten tokenizer + text_model.onnx.
 * Çıktı vektörü vision encoder ile aynı 512-dim uzayda — text→image arama mümkün olur.
 */
export async function loadClipTextModel(): Promise<void> {
    if (clipTextModel || isClipTextLoading) return;
    isClipTextLoading = true;
    try {
        const transformers = await import('@huggingface/transformers');
        await configureTransformersOffline(transformers);
        const desired = await resolveDevice();
        const fp32Available = await isFp32Available();
        const tokenizer = await (transformers as unknown as { AutoTokenizer: { from_pretrained: (id: string) => Promise<unknown> } })
            .AutoTokenizer.from_pretrained(CLIP_MODEL);

        type ClipTextModelLoader = {
            from_pretrained: (id: string, opts?: { device?: EmbeddingDevice; dtype?: 'fp32' | 'q8' }) => Promise<unknown>;
        };
        const loader = (transformers as unknown as { CLIPTextModelWithProjection: ClipTextModelLoader }).CLIPTextModelWithProjection;
        let model: unknown;
        try {
            model = await loader.from_pretrained(CLIP_MODEL, { device: desired, dtype: dtypeForDevice(desired, fp32Available) });
        } catch (err) {
            if (desired === 'webgpu') {
                debugLog('Embeddings', 'CLIP text WebGPU yükleme başarısız, WASM fallback', err);
                model = await loader.from_pretrained(CLIP_MODEL, { device: 'wasm', dtype: 'q8' });
            } else {
                throw err;
            }
        }
        clipTextTokenizer = tokenizer as typeof clipTextTokenizer extends infer T ? Exclude<T, null> : never;
        clipTextModel = model as typeof clipTextModel extends infer T ? Exclude<T, null> : never;
        isClipTextLoading = false;
    } catch (err) {
        isClipTextLoading = false;
        debugLog('Embeddings', 'CLIP text modeli yüklenemedi', err);
        throw err;
    }
}

/**
 * Metni CLIP image embeddings ile aynı 512-dim uzayda vektörleştirir.
 * Sadece İngilizce için optimize — Türkçe sorgular önce çevrilmeli.
 */
export async function generateClipTextEmbedding(text: string): Promise<number[]> {
    if (!clipTextModel || !clipTextTokenizer) {
        await loadClipTextModel();
    }
    if (!clipTextModel || !clipTextTokenizer) throw new Error('CLIP text modeli yüklenemedi');

    const inputs = await clipTextTokenizer(text, { padding: true, truncation: true });
    const output = await clipTextModel(inputs);
    const data = output.text_embeds?.data ?? output.pooler_output?.data;
    if (!data) throw new Error('CLIP text encoder beklenen çıktıyı vermedi');
    return normalizeVector(Array.from(data as Float32Array));
}

/**
 * Resmi vektöre dönüştür. (CLIP)
 * Çıktı: 512 boyutlu normalize edilmiş vektör.
 */
export async function generateImageEmbedding(imageUrlOrBase64: string | Blob): Promise<number[]> {
    if (!clipPipeline) {
        await loadClipModel();
    }
    if (!clipPipeline) throw new Error('CLIP model yüklenemedi');

    let input = imageUrlOrBase64;
    // Blob verildiğinde pipeline için bir object url üret
    if (input instanceof Blob) {
        input = URL.createObjectURL(input);
    }

    try {
        const output = await clipPipeline(input as string);
        return normalizeVector(Array.from(output.data));
    } finally {
        // Eğer objectURL üretildiyse bellek sızıntısını önlemek için iptal et
        if (imageUrlOrBase64 instanceof Blob && typeof input === 'string') {
            URL.revokeObjectURL(input);
        }
    }
}

// CLIP girişi için canvas en büyük kenar sınırı.
// CLIP modeli zaten 224×224 bekliyor; daha büyüğünü tutmanın
// arama kalitesine katkısı yok, bellek yükü büyük.
const MAX_SOURCE_DIM = 1024;

async function loadImageToCanvas(source: string | Blob): Promise<HTMLCanvasElement> {
    let bitmap: ImageBitmap | null = null;
    let img: HTMLImageElement | null = null;
    let origW = 0;
    let origH = 0;
    let objectUrl: string | null = null;

    // createImageBitmap: Blob'ı doğrudan decode eder, <img> aşamasını atlayarak
    // Tauri WebView2'de nadiren görülen "tainted canvas" sorununu önler.
    if (source instanceof Blob && typeof createImageBitmap === 'function') {
        try {
            bitmap = await createImageBitmap(source);
            origW = bitmap.width;
            origH = bitmap.height;
        } catch {
            bitmap = null; // fallback path'e düş
        }
    }

    // Fallback: <img> elementi üzerinden decode
    if (!bitmap) {
        const src = source instanceof Blob ? URL.createObjectURL(source) : source;
        if (source instanceof Blob) objectUrl = src;
        try {
            img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const el = new Image();
                // crossOrigin: data: ve blob: için nötr, ama bazı WebView yapılandırmalarında
                // tainting'i defansif olarak engeller.
                el.crossOrigin = 'anonymous';
                el.onload = () => resolve(el);
                el.onerror = (event) => {
                    const detail = typeof event === 'string' ? event : (event as ErrorEvent).message || 'decode hatası';
                    const srcKind = source instanceof Blob ? 'blob' : (src.startsWith('data:') ? 'data-url' : 'url');
                    reject(new Error(`Görsel decode edilemedi (${srcKind}): ${detail}`));
                };
                el.src = src;
            });
            origW = img.naturalWidth || img.width;
            origH = img.naturalHeight || img.height;
        } catch (err) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            throw err;
        }
    }

    try {
        if (!origW || !origH) throw new Error(`Görsel boyutları 0 (w=${origW}, h=${origH}) — muhtemelen bozuk JPEG`);

        // Büyük görselleri CLIP işlemeden önce küçült — bellek piklerini önler
        const scale = Math.min(1, MAX_SOURCE_DIM / Math.max(origW, origH));
        const w = Math.max(1, Math.round(origW * scale));
        const h = Math.max(1, Math.round(origH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context alınamadı');
        try {
            ctx.drawImage((bitmap ?? img) as CanvasImageSource, 0, 0, w, h);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`Canvas drawImage başarısız (${origW}x${origH} → ${w}x${h}): ${msg}`);
        }
        return canvas;
    } finally {
        // Decoded pixel buffer'ı erken bırak — browser GC beklemesin
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        if (img) img.src = '';
        if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Canvas blob üretilemedi');
    return blob;
}

async function cropBlob(
    baseCanvas: HTMLCanvasElement,
    cropX: number,
    cropY: number,
    cropW: number,
    cropH: number
): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = 224;
    canvas.height = 224;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context alınamadı');
    ctx.drawImage(baseCanvas, cropX, cropY, cropW, cropH, 0, 0, 224, 224);
    return canvasToBlob(canvas);
}

export async function generateImageEmbeddingsMulti(imageUrlOrBase64: string | Blob): Promise<Array<{ source: ImageEmbeddingSource; vector: number[] }>> {
    const baseCanvas = await loadImageToCanvas(imageUrlOrBase64);
    const w = Math.max(1, baseCanvas.width);
    const h = Math.max(1, baseCanvas.height);
    const side = Math.max(1, Math.floor(Math.min(w, h) * 0.8));

    const cx = Math.floor((w - side) / 2);
    const cy = Math.floor((h - side) / 2);

    const crops: Array<{ source: ImageEmbeddingSource; x: number; y: number; s: number }> = [
        { source: 'image_global', x: 0, y: 0, s: Math.min(w, h) },
        { source: 'image_center', x: cx, y: cy, s: side },
        { source: 'image_top_left', x: 0, y: 0, s: side },
        { source: 'image_top_right', x: Math.max(0, w - side), y: 0, s: side },
        { source: 'image_bottom_center', x: cx, y: Math.max(0, h - side), s: side },
    ];

    const vectors: Array<{ source: ImageEmbeddingSource; vector: number[] }> = [];
    const cropErrors: string[] = [];
    for (const crop of crops) {
        try {
            const blob = await cropBlob(baseCanvas, crop.x, crop.y, crop.s, crop.s);
            const vector = await generateImageEmbedding(blob);
            vectors.push({ source: crop.source, vector });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            cropErrors.push(`${crop.source}: ${msg}`);
            debugLog('Embeddings', 'Multi-crop embedding atlandı: ' + crop.source, err);
        }
    }

    if (vectors.length === 0 && cropErrors.length > 0) {
        throw new Error(`Tüm kırpımlar başarısız — ${cropErrors[0]}`);
    }

    return vectors;
}

/**
 * Birden fazla metni tek pipeline çağrısıyla toplu olarak vektöre dönüştür.
 * Sıralı işlem yerine native batch — büyük arşivlerde 3-5x hız kazanımı sağlar.
 */
export async function generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!embeddingPipeline) {
        await loadEmbeddingModel();
    }
    if (!embeddingPipeline) throw new Error('Embedding model yüklenemedi');

    const EMBEDDING_DIM = 384;
    const CHUNK_SIZE = 32; // pipeline bellek sınırı için parça boyutu
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
        const chunk = texts.slice(i, i + CHUNK_SIZE);
        const output = await embeddingPipeline(chunk, { pooling: 'mean', normalize: true });
        for (let j = 0; j < chunk.length; j++) {
            results.push(Array.from(output.data.slice(j * EMBEDDING_DIM, (j + 1) * EMBEDDING_DIM)));
        }
    }

    return results;
}

/**
 * İki vektör arasında kosinüs benzerliği hesapla.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

/**
 * Sorgu vektörü ile tüm varlık vektörleri arasında arama yap.
 */
export function semanticSearch(
    queryVector: number[],
    assetVectors: Array<{ assetId: string; vector: number[] }>,
    topK: number = 20,
    threshold: number = 0.25
): Array<{ assetId: string; score: number }> {
    const scored = assetVectors.map(av => ({
        assetId: av.assetId,
        score: cosineSimilarity(queryVector, av.vector),
    }));

    return scored
        .filter(s => s.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}
