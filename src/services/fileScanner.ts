/**
 * Archivist Pro — Dosya Tarayıcı Servisi
 * 
 * File System Access API kullanarak kullanıcının seçtiği klasörü tarayan,
 * dosya türüne göre metadata çıkaran ve AI embedding oluşturan indeksleme motoru.
 */
import type { Asset, AssetType, AssetMetadata, CategoryType, ProjectPhase } from '../types';
import { generateEmbedding, generateImageEmbeddingsMulti, generateBatchEmbeddings } from './embeddings';
import { upsertAsset, saveEmbedding, saveDatabase, getSetting, getAssetById, upsertTextChunk, saveChunkEmbedding, getChunkCountByAssetIdAsync, getChunksByAssetIdAsync, deleteTextChunksByAssetId, deleteChunkEmbeddingsByAssetId, detectAndSaveSameStemRelationsAsync, getActiveArchive } from './database';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, stat as fsStat } from '@tauri-apps/plugin-fs';
import { classifyImageType, detectMaterials, analyzeDWGContent, type DWGBinaryMetadata } from './vision';
import type { AIConfig } from '../components/AISettingsModal';
import { chunkTextForEmbedding } from './textChunking';
import { ocrImageToText } from './ocr';
import { debugLog } from './logger';
import pLimit from 'p-limit';

/**
 * Extractor sürümleri — dosya tipi başına.
 *
 * Bir file type'ın metadata çıkarımı anlamlı şekilde değiştiğinde (yeni field,
 * format parse düzeltmesi, yeni output alanı) o tipin sürümünü bir artır.
 *
 * Ne zaman bumplanır:
 *   ✓ Yeni metadata field eklendi (örn. DWG'den artık layer listesi de çıkar)
 *   ✓ Parse hatası düzeltildi ve çıktı değişir (örn. encoding fix)
 *   ✓ Format spec güncellendi
 *
 * Ne zaman bumplanmaz:
 *   ✗ Null-safety / defensive kod (çıktı aynı)
 *   ✗ Performans iyileştirmesi
 *   ✗ Refactoring / log satırı eklenmesi
 *
 * Dosya tipi → bileşik extractor versiyonu.
 * extractorRegistry.ts'den otomatik hesaplanır — manuel bump gereksiz.
 * Yeni çıkarıcı eklendiğinde veya mevcut bump yapıldığında bu değer otomatik artar.
 */
import { computeAllVersions, buildAppliedRecord } from './extractorRegistry';
export const SCANNER_VERSIONS: Record<string, number> = computeAllVersions();

/** Verilen dosya tipi için beklenen extractor sürümü (varsayılan 1). */
export function expectedScannerVersion(fileType: string): number {
    return SCANNER_VERSIONS[fileType] ?? 1;
}

// ── Dosya uzantısı → AssetType haritası ──
const EXTENSION_MAP: Record<string, AssetType> = {
    // AutoCAD
    dwg: 'DWG', dxf: 'DWG', dwf: 'DWF', dwfx: 'DWF',
    // Revit / BIM
    rvt: 'RVT', rfa: 'RVT',
    // IFC
    ifc: 'IFC', ifczip: 'IFC',
    // 3ds Max
    max: 'MAX',
    // 3D Studio (legacy DOS format, 3ds Max ile aynı değil)
    '3ds': '3DS',
    // SketchUp
    skp: 'SKP',
    // Rhino
    '3dm': '3DM',
    // Blender
    blend: 'BLEND',
    // Cinema 4D
    c4d: 'C4D',
    // Universal 3D
    obj: 'OBJ', mtl: 'MTL',
    fbx: 'FBX',
    glb: 'GLB', gltf: 'GLB',
    stl: 'STL',
    dae: 'DAE',
    // Navisworks
    nwd: 'NWD', nwc: 'NWD', nwf: 'NWD',
    // MicroStation
    dgn: 'DGN',
    // Engineering CAD
    step: 'STEP', stp: 'STEP',
    igs: 'STEP', iges: 'STEP',
    // ArchiCAD
    pln: 'PLN', mod: 'PLN', plp: 'PLN',
    // Vectorworks
    vwx: 'VWX',
    // Point Cloud
    e57: 'E57', pts: 'E57', ptx: 'E57',
    // Photoshop
    psd: 'PSD',
    // Raster images
    jpg: 'JPEG', jpeg: 'JPEG',
    png: 'PNG',
    bmp: 'BMP',
    webp: 'WEBP',
    tga: 'TGA',
    tif: 'TIFF', tiff: 'TIFF',
    // Vector
    svg: 'SVG',
    ai: 'AI', eps: 'EPS',
    // HDR / Render
    exr: 'EXR',
    hdr: 'HDR',
    // Documents
    pdf: 'PDF',
    doc: 'DOC', docx: 'DOC',
    xls: 'XLS', xlsx: 'XLS', xlsm: 'XLS', xlsb: 'XLS', xltx: 'XLS', xltm: 'XLS',
    ods: 'XLS',   // OpenDocument Spreadsheet
    ppt: 'PPT', pptx: 'PPT',
    txt: 'TXT',
    rtf: 'RTF',
    csv: 'CSV',
    // Video (mimari animasyonlar)
    mp4: 'MP4', mov: 'MP4', avi: 'MP4', mkv: 'MP4', wmv: 'MP4',
    // Yapısal Analiz (CSi)
    sdb: 'SAP2K',  // SAP2000 Database
    s2k: 'SAP2K',  // SAP2000 text format
    '$2k': 'SAP2K', // SAP2000 binary
    e2k: 'SAP2K',  // ETABS text format
    edb: 'SAP2K',  // ETABS database
    sap: 'SAP2K',  // SAP eski format
    '$et': 'SAP2K', // ETABS binary
    // Yedek dosyalar
    bak: 'BAK',
    '~bak': 'BAK',  // Word/Excel geçici yedek
    dwl: 'BAK',    // AutoCAD kilit/yedek dosyası
    dwl2: 'BAK',   // AutoCAD kilit/yedek dosyası
    sv$: 'BAK',    // AutoCAD autosave
    asv: 'BAK',    // AutoCAD autosave
};

// ── Tag duplicate koruması ──
type AITagSource = 'clip' | 'nlp' | 'metadata' | 'color';
function pushTagIfNew(tags: { label: string; confidence: number; source: AITagSource }[], label: string, confidence: number, source: AITagSource) {
    if (!label || tags.some(t => t.label === label)) return;
    tags.push({ label, confidence, source });
}

// ── AssetType → Category haritası ──
const CATEGORY_MAP: Record<AssetType, CategoryType> = {
    // 2D Çizim
    DWG: '2D Çizim', DXF: '2D Çizim', DGN: '2D Çizim', DWF: '2D Çizim', SVG: '2D Çizim', VWX: '2D Çizim',
    // 3D Model
    RVT: '3D Model', IFC: '3D Model',
    MAX: '3D Model', '3DS': '3D Model', SKP: '3D Model', '3DM': '3D Model',
    OBJ: '3D Model', MTL: '3D Model', FBX: '3D Model', GLB: '3D Model', BLEND: '3D Model',
    C4D: '3D Model', STL: '3D Model', DAE: '3D Model',
    NWD: '3D Model', STEP: '3D Model', PLN: '3D Model', E57: '3D Model',
    // Render / Görsel
    // NOT: TGA ve TIFF de Render'da — 3dsMax render output'u TGA (32-bit alpha),
    // TIFF de profesyonel fotoğraf/render formatı. Doku tespiti boyut + klasör + suffix
    // sinyalleri ile yapılır (refineCategory + refineCategoryWithMetadata).
    PSD: 'Render', JPEG: 'Render', PNG: 'Render', BMP: 'Render',
    WEBP: 'Render', AI: 'Render', EPS: 'Render', EXR: 'Render', HDR: 'Render',
    TGA: 'Render', TIFF: 'Render',
    // Döküman
    PDF: 'Döküman', DOC: 'Döküman', TXT: 'Döküman',
    XLS: 'Döküman', PPT: 'Döküman', CSV: 'Döküman', RTF: 'Döküman',
    // Video
    MP4: 'Video',
    // Yapısal Analiz
    SAP2K: 'Döküman',
    // Yedek
    BAK: 'Döküman',
};

// ── Dosya adından proje safhası tahmini ──
const PHASE_KEYWORDS: Record<ProjectPhase, string[]> = {
    Konsept: ['konsept', 'concept', 'eskiz', 'sketch', 'fikir'],
    Avan: ['avan', 'on_proje', 'schematic', 'sd'],
    Ruhsat: ['ruhsat', 'permit', 'izin', 'yasal'],
    Uygulama: ['uygulama', 'application', 'detay', 'detail', 'as-built', 'asbuilt'],
};

// ── Dosya adından malzeme grubu tahmini ──
const MATERIAL_KEYWORDS: Record<string, string[]> = {
    Beton: ['beton', 'concrete', 'betonarme', 'c30', 'c25'],
    Cam: ['cam', 'glass', 'cephe', 'curtain', 'giydirme'],
    Metal: ['metal', 'celik', 'steel', 'alumin', 'demir', 'iron'],
    Ahşap: ['ahsap', 'ahşap', 'wood', 'timber', 'kereste', 'parke'],
    Taş: ['tas', 'taş', 'stone', 'mermer', 'marble', 'granit', 'granite'],
    Seramik: ['seramik', 'ceramic', 'fayans', 'karo'],
    Kompozit: ['kompozit', 'composite', 'grc', 'gfrc'],
};

// ── Render ipuçları ──
// STRONG: substring eşleşmesi yeterli — bu kelimeler bir fotoğrafta neredeyse hiç geçmez
const RENDER_STRONG_KEYWORDS = [
    'render', 'rendering', 'rendered', 'rendre',
    'vray', 'v-ray', 'corona', 'lumion', 'enscape', 'twinmotion',
    'archviz', 'cgi', 'visualisation', 'visualization',
    'gorsellestirme', 'görsellestirme', 'gorsellestirilmis',
    // Render motorları / pass adları
    'arnold', 'octane', 'redshift', 'maxwell', 'mentalray', 'mental_ray',
    'cycles', 'eevee', 'iray', 'fstorm', 'thearender',
    // Pass / AOV adları
    'beauty', 'masterbeauty', 'crypto', 'cryptomatte', 'denoised',
];
// WEAK: kelime sınırı (word-boundary) ile eşleşmeli — substring olarak fotoğraflarda da geçebilir
const RENDER_WEAK_KEYWORDS = [
    'viz', '3d', 'final', 'output', 'view', 'scene', 'sahne',
    'gorunum', 'görünüm', 'visual', 'gorsel', 'görsel',
    'exterior', 'interior', 'perspective', 'perspektif',
    'cam', 'camera', // 'cam_01', 'camera_view' gibi render kamera adları
];

// PHOTO: substring + dosya adı pattern'leri
const PHOTO_KEYWORDS = [
    // Türkçe / yapım
    'foto', 'fotograf', 'fotoğraf', 'photograph',
    'cek', 'çek', 'cekim', 'çekim',
    'santiye', 'şantiye', 'mevcut', 'existing', 'as_built', 'asbuilt',
    'screenshot', 'ekran_goruntusu', 'ekran_görüntüsü',
    'dcim', 'photo_', '_photo', 'photos',
    // Profesyonel kamera markaları
    'canon', 'nikon', 'sony', 'fujifilm', 'leica',
    'panasonic', 'olympus', 'pentax', 'lumix', 'hasselblad',
    // Mobil / telefon
    'iphone', 'samsung', 'galaxy', 'xiaomi', 'redmi',
    'huawei', 'pixel', 'oneplus', 'oppo', 'vivo',
    // Drone / action cam
    'dji', 'mavic', 'phantom', 'inspire', 'gopro',
    // Sosyal / mesajlaşma
    'whatsapp', 'wechat', 'telegram',
];

// PHOTO filename pattern'leri (regex). Cihazların ürettiği standart isimler.
// Bunlar refineCategory'de en yüksek önceliklidir — pattern eşleşirse hemen Fotoğraf.
const PHOTO_FILENAME_PATTERNS: RegExp[] = [
    /^img[-_]\d{4,}/i,                    // IMG_0001, IMG-1234
    /^img[-_]\d{8}[-_]wa\d{4}/i,          // IMG-20240515-WA0001 (WhatsApp)
    /^img[-_]\d{8}[-_]\d{6}/i,            // IMG_20240515_133045
    /^dsc[-_]?\d{4,}/i,                   // DSC_0001, DSCN0001 (Nikon)
    /^dscf\d{4,}/i,                       // DSCF1234 (Fujifilm)
    /^dscn\d{4,}/i,                       // DSCN1234 (Nikon)
    /^pxl[-_]\d{8}[-_]\d{6}/i,            // PXL_20240515_133045 (Pixel)
    /^p\d{7,}/i,                          // P1234567 (Panasonic, Olympus, Samsung)
    /^p[a-z]{2,4}\d{4,}/i,                // PANO0001, PSPECT, PMNG vb.
    /^dji[-_]\d{4,}/i,                    // DJI_0001
    /^gopr\d{4,}/i,                       // GOPR1234
    /^gx?\d{6,}/i,                        // GX010001, G0010001 (GoPro)
    /^\d{8}[-_]\d{6}/,                    // 20240515_133045 (genel timestamp)
    /^\d{4}-\d{2}-\d{2}[-_t]\d{2}[-:]?\d{2}/i, // 2024-05-15T13:30 ISO timestamp
    /^mvimg[-_]\d{8}/i,                   // MVIMG_20240515 (Motion Photo)
    /^pano[-_]?\d{4,}/i,                  // PANO0001
    /^burst\d+/i,                         // BURST0001
    /^selfie/i,                           // SELFIE
    /^\d{13,}/,                           // 1715772645123 (epoch ms timestamp)
];

const TEXTURE_KEYWORDS = [
    'doku', 'texture', 'material', 'malzeme', 'kaplama', 'surface',
    'seamless', 'tileable', 'tile', 'pattern', 'desen',
    'map', 'mapping',
    'pbr', 'swatch',
];

/**
 * Bir kelimenin metinde "kelime sınırı" ile eşleşip eşleşmediğini kontrol eder.
 * Örn: hasWordToken('rendered_final.jpg', 'final') → true
 *      hasWordToken('finally.jpg', 'final') → false
 * Kelime sınırı = string başı/sonu veya alfanümerik olmayan karakter.
 */
function hasWordToken(haystack: string, needle: string): boolean {
    if (!needle) return false;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    return re.test(haystack);
}

// Doku dosya adı son ekleri (_diff, _norm, vb.)
const TEXTURE_SUFFIX_PATTERNS = [
    '_diff', '_diffuse', '_albedo', '_basecolor', '_base_color', '_col', '_color',
    '_norm', '_normal', '_nrm', '_normalmap',
    '_bump', '_height', '_disp', '_displacement',
    '_spec', '_specular', '_gloss', '_glossiness',
    '_rough', '_roughness', '_rgh',
    '_metal', '_metallic', '_metalness', '_met',
    '_ao', '_ambient_occlusion', '_occlusion', '_cavity',
    '_opacity', '_alpha', '_mask', '_transparency',
    '_emissive', '_emission', '_self_illumination',
    '_refl', '_reflection', '_ior',
    '_env', '_hdri', '_cubemap',
    '_1k', '_2k', '_4k', '_8k', '_16k',
    '_512', '_1024', '_2048', '_4096',
];

// Klasör adlarında doku/map ipuçları
const TEXTURE_FOLDER_KEYWORDS = [
    'texture', 'textures', 'tex', 'doku', 'dokular',
    'material', 'materials', 'malzeme', 'malzemeler',
    'map', 'maps', 'mapping',
    'kaplama', 'kaplamalar',
    'surface', 'surfaces',
    'pbr', 'tileable', 'seamless',
    '06-dokular', 'dokular',
];

// Klasör adlarında render ipuçları
const RENDER_FOLDER_KEYWORDS = [
    'render', 'renders', 'renderlar', '04-renderlar',
    'output', 'outputs', 'cikti',
    'final', 'gorsel', 'gorseller', 'visual', 'visuals',
    'vray', 'v-ray', 'corona', 'lumion', 'enscape',
    'archviz', 'visualization',
];

// Boş uzantı seti — sibling kontrolünde "kardeş yok" durumunu temsil eder (alokasyon kaçınma).
const EMPTY_EXT_SET: ReadonlySet<string> = new Set();

// "Aynı stem'de" bulunduğunda render iş akışı sinyali veren uzantılar.
// Örn: living_room.jpg + living_room.psd → JPG render'ın final çıktısıdır.
// 3dsMax workflow: TGA (ham) → PSD (Photoshop post) → JPG (final flatten).
const RENDER_SIBLING_EXTENSIONS = new Set([
    'psd',          // Photoshop post-process
    'max', '3ds',   // 3dsMax kaynak sahne
    'blend',        // Blender
    'c4d',          // Cinema 4D
    'skp',          // SketchUp
    'rvt',          // Revit
    'fbx', 'obj',   // ortak 3D formatlar
    'exr', 'hdr',   // HDR render output
]);

// Klasör adlarında fotoğraf ipuçları
const PHOTO_FOLDER_KEYWORDS = [
    'foto', 'fotograf', 'fotograflar', 'fotoğraf', 'fotoğraflar',
    'photo', 'photos', 'photograph', 'photographs',
    'santiye', 'şantiye', 'santiye_fotograflari',
    'mevcut_durum', 'mevcut', 'as_built', 'asbuilt', 'as-built',
    'dcim', 'screenshot', 'screenshots', 'ekran_goruntusu', 'ekran_görüntüsü',
    'site_photos', 'site_photo', 'survey', 'field',
    'cekim', 'çekim', 'cekimler', 'çekimler',
];

export interface ScanProgress {
    total: number;
    processed: number;
    current: string;
    errors: string[];
    isComplete: boolean;
    isCancelled?: boolean;
    /** Değişmeyen dosyalar için DB kaydı kullanıldı (yeniden indekslenmedi) */
    skipped?: number;
    /** Dosya türlerine göre sayım (ör. { DWG: 45, MAX: 12, PDF: 23 }) */
    typeCounts?: Record<string, number>;
    /** Tarama başlamadan önce model/hazırlık aşaması */
    isPreparing?: boolean;
    /** Atlanan / hata veren dosyalar için yapılandırılmış rapor (TXT'ye yazılır) */
    report?: ScanReportEntry[];
}

/** Tarama sırasında bir dosyanın taranamamasının kategorize sebebi. */
export type ScanReportCategory =
    | 'extension_skip'      // Uzantı whitelist dışı
    | 'permission_denied'   // FS izin reddi (ACL, ağ erişim)
    | 'too_large'           // Boyut limiti aşıldı
    | 'path_too_long'       // Path uzunluk limiti (Windows 260)
    | 'depth_limit'         // Derinlik limiti aşıldı
    | 'symlink_loop'        // Symlink/junction döngüsü atlandı
    | 'stat_failed'         // Dosya metadata okunamadı
    | 'directory_error'     // Klasör listelenemedi
    | 'metadata_error'      // Metadata extractor hatası
    | 'thumbnail_error'     // Önizleme üretim hatası
    | 'extractor_error'     // İçerik extractor hatası
    | 'embedding_error'     // Metin embedding hatası
    | 'image_embedding_error' // CLIP görsel embedding hatası
    | 'text_index_error'    // RAG metin indeks hatası
    | 'checkpoint_error'    // DB checkpoint hatası
    | 'unknown_error';      // Sınıflandırılamayan hata

export interface ScanReportEntry {
    filePath: string;
    category: ScanReportCategory;
    reason: string;
    timestamp: string;
}

/** Limit: tek tarama maks 10000 entry — milyon dosyalı klasörlerde bellek koruması. */
const SCAN_REPORT_MAX_ENTRIES = 10000;

function pushReport(progress: ScanProgress, filePath: string, category: ScanReportCategory, reason: string): void {
    if (!progress.report) progress.report = [];
    if (progress.report.length >= SCAN_REPORT_MAX_ENTRIES) return;
    progress.report.push({
        filePath,
        category,
        reason: reason.length > 500 ? reason.slice(0, 500) + '…' : reason,
        timestamp: new Date().toISOString(),
    });
}

export type ScanProgressCallback = (progress: ScanProgress) => void;

/**
 * Tarama sürecini duraklat / devam ettir / iptal et.
 * race() ile herhangi bir async işlemi iptal sinyaline karşı yarıştırabilir.
 */
export class ScanController {
    isCancelled = false;
    isPaused = false;
    private _resumeFn: (() => void) | null = null;
    private _cancelPromise: Promise<never>;
    private _cancelReject!: (err: Error) => void;

    constructor() {
        this._cancelPromise = new Promise<never>((_, reject) => {
            this._cancelReject = reject;
        });
        // Yakalanmamış rejection uyarısını bastır — race() içinde yakalanacak
        this._cancelPromise.catch(() => {});
    }

    pause() {
        if (!this.isCancelled) this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
        const fn = this._resumeFn;
        this._resumeFn = null;
        fn?.();
    }

    cancel() {
        this.isCancelled = true;
        this._cancelReject(new Error('SCAN_CANCELLED'));
        this.resume(); // bloklu await'i serbest bırak
    }

    /** Her dosya arasında çağrılır. İptal edilmişse hata fırlatır, duraklatılmışsa bekler. */
    async checkPoint(): Promise<void> {
        if (this.isCancelled) throw new Error('SCAN_CANCELLED');
        if (this.isPaused) {
            await new Promise<void>(resolve => { this._resumeFn = resolve; });
            if (this.isCancelled) throw new Error('SCAN_CANCELLED');
        }
    }

    /**
     * Bir promise'i iptal sinyaline karşı yarıştırır.
     * İptal gelirse SCAN_CANCELLED hatası fırlatır — uzun Rust invoke çağrıları
     * tamamlanmayı beklemeden döngüden çıkılır.
     */
    race<T>(promise: Promise<T>): Promise<T> {
        if (this.isCancelled) return Promise.reject(new Error('SCAN_CANCELLED'));
        return Promise.race([promise, this._cancelPromise]);
    }
}

/** Tarama döngüsü içinde await sonrası iptal/duraklat (dosya ortasında) */
async function scanYield(controller?: ScanController): Promise<void> {
    if (controller) await controller.checkPoint();
}

function rethrowIfScanCancelled(err: unknown): void {
    if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err;
}

/**
 * Tarama sırasında yazma işlemlerini biriktirir ve Rust rusqlite ile doğrudan diske yazar.
 * sql.js db.export() (tüm DB kopyası) yerine sadece yeni verileri INSERT eder — OOM riski yok.
 */
class ScanWriteBuffer {
    private readonly _archiveAt: string;
    private _assets: Array<Record<string, unknown>> = [];
    private _embeddings: Array<Record<string, unknown>> = [];
    private _textChunks: Array<Record<string, unknown>> = [];
    private _deleteChunksFor: string[] = [];
    private _dwgShapes: Array<Record<string, unknown>> = [];
    private _deleteShapesFor: string[] = [];
    private _relations: Array<Record<string, unknown>> = [];
    private _scannedRoots: Array<Record<string, unknown>> = [];

    constructor(archiveAt: string) {
        this._archiveAt = archiveAt;
    }

    get isEmpty(): boolean {
        return this._assets.length === 0
            && this._embeddings.length === 0
            && this._textChunks.length === 0
            && this._deleteChunksFor.length === 0
            && this._dwgShapes.length === 0
            && this._deleteShapesFor.length === 0
            && this._relations.length === 0
            && this._scannedRoots.length === 0;
    }

    get shouldAutoFlush(): boolean {
        return this._assets.length >= 100
            || this._embeddings.length >= 500
            || this._textChunks.length >= 1000
            || this._dwgShapes.length >= 2000;
    }

    addAsset(asset: {
        id: string; fileName: string; filePath: string; fileSize: number;
        fileType: string; category: string; createdAt: string; modifiedAt: string;
        projectName: string; projectPhase: string;
        materialGroup?: string; colorTheme?: string;
        architecturalStyle?: string; omniclassCode?: string;
        hash?: string; phash?: string; contentHash?: string;
        metadata?: Record<string, unknown>;
        aiTags?: Array<{ label: string; confidence: number; source: string }>;
        colorPalette?: Array<{ hex: string; percentage: number; name?: string }>;
        thumbnailUrl?: string; rawMetadata?: Record<string, unknown>;
        fsMtime?: number; metadataVersion?: number;
        appliedExtractors?: Record<string, number>;
    }): void {
        this._assets.push({
            id: asset.id,
            file_name: asset.fileName,
            file_path: asset.filePath,
            file_size: asset.fileSize,
            file_type: asset.fileType,
            category: asset.category,
            created_at: asset.createdAt,
            modified_at: asset.modifiedAt,
            project_name: asset.projectName,
            project_phase: asset.projectPhase,
            material_group: asset.materialGroup || null,
            color_theme: asset.colorTheme || null,
            architectural_style: asset.architecturalStyle || null,
            omniclass_code: asset.omniclassCode || null,
            hash: asset.hash || null,
            phash: asset.phash || null,
            content_hash: asset.contentHash || null,
            metadata_json: JSON.stringify(asset.metadata || {}),
            ai_tags_json: JSON.stringify(asset.aiTags || []),
            color_palette_json: JSON.stringify(asset.colorPalette || []),
            thumbnail_url: asset.thumbnailUrl || null,
            raw_metadata: asset.rawMetadata ? JSON.stringify(asset.rawMetadata) : null,
            fs_mtime: asset.fsMtime ?? null,
            metadata_version: asset.metadataVersion ?? 1,
            applied_extractors: asset.appliedExtractors ? JSON.stringify(asset.appliedExtractors) : null,
        });
    }

    addEmbedding(assetId: string, vector: number[], source: string, refId?: string): void {
        const id = refId ? `${refId}_${source}` : `${assetId}_${source}`;
        const f32 = new Float32Array(vector);
        const blob = Array.from(new Uint8Array(f32.buffer));
        this._embeddings.push({ id, asset_id: assetId, ref_id: refId || null, vector_blob: blob, source });
    }

    addTextChunk(row: { id: string; assetId: string; chunkIndex: number; page?: number; text: string; lang?: string }): void {
        this._textChunks.push({
            id: row.id, asset_id: row.assetId, chunk_index: row.chunkIndex,
            page: row.page ?? null, text: row.text, lang: row.lang ?? null,
        });
    }

    markDeleteChunks(assetId: string): void {
        if (!this._deleteChunksFor.includes(assetId)) {
            this._deleteChunksFor.push(assetId);
        }
    }

    addDwgShapes(assetId: string, shapes: Array<{
        entity_type: string; layer_name: string; vertex_count: number;
        is_closed: boolean; area: number; perimeter: number; aspect_ratio: number;
        regularity: number; bbox_w: number; bbox_h: number;
        centroid_x: number; centroid_y: number;
        compactness?: number; solidity?: number; rectangularity?: number;
    }>, layerCategorize: (layerName: string) => string): void {
        for (let idx = 0; idx < shapes.length; idx++) {
            const s = shapes[idx];
            this._dwgShapes.push({
                id: `${assetId}:${idx}`,
                asset_id: assetId,
                layer_name: s.layer_name || '0',
                layer_category: layerCategorize(s.layer_name),
                entity_type: s.entity_type,
                vertex_count: s.vertex_count,
                is_closed: s.is_closed ? 1 : 0,
                area: s.area, perimeter: s.perimeter,
                aspect_ratio: s.aspect_ratio, regularity: s.regularity,
                bbox_w: s.bbox_w, bbox_h: s.bbox_h,
                centroid_x: s.centroid_x, centroid_y: s.centroid_y,
                compactness: s.compactness ?? 0,
                solidity: s.solidity ?? 0,
                rectangularity: s.rectangularity ?? 0,
            });
        }
    }

    markDeleteShapes(assetId: string): void {
        if (!this._deleteShapesFor.includes(assetId)) {
            this._deleteShapesFor.push(assetId);
        }
    }

    addRelation(row: { id: string; sourceId: string; targetId: string; relationType: string; createdAt: string; createdBy: string }): void {
        this._relations.push({
            id: row.id, source_id: row.sourceId, target_id: row.targetId,
            relation_type: row.relationType, created_at: row.createdAt, created_by: row.createdBy,
        });
    }

    addScannedRootRow(row: { id: string; path: string; label: string; status: string; lastScan?: string | null; fileCount?: number | null }): void {
        this._scannedRoots.push({
            id: row.id, path: row.path, label: row.label, status: row.status,
            last_scan: row.lastScan ?? null, file_count: row.fileCount ?? 0,
        });
    }

    /**
     * rusqlite write path'ini ısıtır: boş payload ile bir scan_write_batch çağrısı yapar.
     * Connection aç + PRAGMA + CREATE TABLE IF NOT EXISTS + empty transaction + commit.
     * OS file cache, SQLite page cache ve schema validation maliyeti scan başında ödenir.
     * Aksi halde ilk gerçek flush 8-10 sn sürer (cold), warmup'tan sonra ~1 sn olur.
     * Hata sessiz — başarısız olsa gerçek flush yine çalışır.
     */
    async warmup(): Promise<void> {
        try {
            const t0 = performance.now();
            await invoke('scan_write_batch', {
                payload: {
                    assets: [],
                    embeddings: [],
                    text_chunks: [],
                    delete_chunks_for: [],
                    dwg_shapes: [],
                    delete_shapes_for: [],
                    relations: [],
                    scanned_roots: [],
                },
                archiveAt: this._archiveAt,
            });
            const ms = Math.round(performance.now() - t0);
            console.info(`[ScanWriteBuffer] rusqlite warmup: ${ms}ms`);
        } catch (err) {
            debugLog('Scanner', 'rusqlite warmup failed (non-fatal)', err);
        }
    }

    async flush(): Promise<boolean> {
        if (this.isEmpty) {
            console.info('[ScanWriteBuffer] flush skipped (buffer empty)');
            return true;
        }
        const sizes = {
            assets: this._assets.length,
            embeddings: this._embeddings.length,
            chunks: this._textChunks.length,
            chunkDeletes: this._deleteChunksFor.length,
            shapes: this._dwgShapes.length,
            shapeDeletes: this._deleteShapesFor.length,
            relations: this._relations.length,
            roots: this._scannedRoots.length,
        };
        const t0 = performance.now();
        try {
            const result = await invoke<{
                assets_written: number;
                embeddings_written: number;
                chunks_written: number;
                chunks_deleted: number;
                shapes_written: number;
                shapes_deleted: number;
                relations_written: number;
                roots_written: number;
            }>('scan_write_batch', {
                payload: {
                    assets: this._assets,
                    embeddings: this._embeddings,
                    text_chunks: this._textChunks,
                    delete_chunks_for: this._deleteChunksFor,
                    dwg_shapes: this._dwgShapes,
                    delete_shapes_for: this._deleteShapesFor,
                    relations: this._relations,
                    scanned_roots: this._scannedRoots,
                },
                archiveAt: this._archiveAt,
            });
            // v2.4.8+: dwg_shapes ayrı DB'de — scan_write_batch sonrası batch invoke.
            // _dwgShapes asset_id'ye göre grupla ve tek tx içinde yaz.
            let shapesBatchWritten = 0;
            if (this._dwgShapes.length > 0) {
                type ShapeRow = {
                    asset_id: string; layer_name: string; entity_type: string;
                    vertex_count: number; is_closed: number;
                    area: number; perimeter: number; aspect_ratio: number; regularity: number;
                    bbox_w: number; bbox_h: number; centroid_x: number; centroid_y: number;
                    compactness: number; solidity: number; rectangularity: number;
                };
                const rowsTyped = this._dwgShapes as unknown as ShapeRow[];
                const grouped = new Map<string, ShapeRow[]>();
                for (const row of rowsTyped) {
                    const arr = grouped.get(row.asset_id) ?? [];
                    arr.push(row);
                    grouped.set(row.asset_id, arr);
                }
                const entries = Array.from(grouped.entries()).map(([assetId, rows]) => ({
                    asset_id: assetId,
                    shapes: rows.map(r => ({
                        entity_type: r.entity_type,
                        layer_name: r.layer_name,
                        vertex_count: r.vertex_count,
                        is_closed: r.is_closed === 1,
                        area: r.area, perimeter: r.perimeter,
                        aspect_ratio: r.aspect_ratio, regularity: r.regularity,
                        bbox_w: r.bbox_w, bbox_h: r.bbox_h,
                        centroid_x: r.centroid_x, centroid_y: r.centroid_y,
                        compactness: r.compactness, solidity: r.solidity, rectangularity: r.rectangularity,
                    })),
                }));
                try {
                    shapesBatchWritten = await invoke<number>('persist_dwg_shapes_batch', {
                        entries,
                        archiveAt: this._archiveAt,
                    });
                } catch (e) {
                    console.warn('[ScanWriteBuffer] persist_dwg_shapes_batch failed (non-fatal)', e);
                }
            }

            const elapsed = (performance.now() - t0).toFixed(0);
            console.info(
                `[ScanWriteBuffer] flush ok in ${elapsed}ms — ` +
                `assets=${result.assets_written}/${sizes.assets} ` +
                `embeds=${result.embeddings_written}/${sizes.embeddings} ` +
                `chunks=${result.chunks_written}/${sizes.chunks} ` +
                `chunkDeletes=${result.chunks_deleted} ` +
                `shapes=${shapesBatchWritten}/${sizes.shapes} ` +
                `relations=${result.relations_written}/${sizes.relations} ` +
                `roots=${result.roots_written}/${sizes.roots}`
            );
            this.clear();
            return true;
        } catch (err) {
            console.error(`[ScanWriteBuffer] flush FAILED (queued: ${JSON.stringify(sizes)})`, err);
            return false;
        }
    }

    clear(): void {
        this._assets = [];
        this._embeddings = [];
        this._textChunks = [];
        this._deleteChunksFor = [];
        this._dwgShapes = [];
        this._deleteShapesFor = [];
        this._relations = [];
        this._scannedRoots = [];
    }
}

/**
 * Dosya bilgisine göre deterministik hash oluştur (ismin ve boyutun birleşimi)
 * Bu sayede dosya gerçekten değişmedikçe DB'de id si aynı kalır (duplicate olmaz)
 */
async function generateHash(canonicalPath: string, size: number, lastModified: number): Promise<string> {
    const rawString = `${canonicalPath}_${size}_${lastModified}`;
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(rawString));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
}

function normalizePathForMatch(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
}

/**
 * Dosya adından proje safhası tahmin et.
 */
function guessPhase(fileName: string, dirPath: string): ProjectPhase {
    const combined = (fileName + ' ' + dirPath).toLowerCase();
    for (const [phase, keywords] of Object.entries(PHASE_KEYWORDS)) {
        if (keywords.some(kw => combined.includes(kw))) {
            return phase as ProjectPhase;
        }
    }
    return 'Konsept'; // varsayılan
}

/**
 * Dosya adından malzeme grubu tahmin et.
 */
function guessMaterial(fileName: string): string | undefined {
    const lower = fileName.toLowerCase();
    for (const [material, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
        if (keywords.some(kw => lower.includes(kw))) {
            return material;
        }
    }
    return undefined;
}

/**
 * Klasör adı ve komşu dosyalardan malzeme çıkarımı yapar.
 */
function inferMaterialFromContext(filePath: string, siblingMaterials: Map<string, number>): string | undefined {
    const pathLower = filePath.toLowerCase();

    for (const [material, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
        if (keywords.some(kw => pathLower.includes(kw))) {
            return material;
        }
    }

    if (siblingMaterials.size > 0) {
        const sortedMaterials = Array.from(siblingMaterials.entries())
            .sort((a, b) => b[1] - a[1]);
        const [topMaterial, topCount] = sortedMaterials[0];
        const totalSiblings = Array.from(siblingMaterials.values()).reduce((a, b) => a + b, 0);

        if (topCount / totalSiblings >= 0.5) {
            return topMaterial;
        }
    }

    return undefined;
}

/**
 * Kategoriyi daha hassas tahmin et (render vs foto vs doku).
 * İlk geçiş: dosya adı + klasör yolu + (varsa) klasördeki kardeş uzantıları kullanır.
 *
 * Öncelik sırası:
 *   1. Cihaz dosya adı pattern'i (IMG_0001, DSC_0001, DJI_, PXL_, 20240515_133045) → Fotoğraf
 *   2. Doku suffix'i (_diff, _norm, _2k) → Doku
 *   3. Klasör adı (foto/doku/render klasörü)
 *   4. Sibling render sinyali (aynı stem'de PSD/MAX/3DS/BLEND vb.) → Render
 *      3dsMax workflow: living_room.tga + living_room.psd + living_room.jpg üçlüsü
 *   5. Dosya adı anahtar kelimeleri (PHOTO > TEXTURE > RENDER strong > RENDER weak)
 *
 * @param siblingExtensions Aynı klasör + aynı stem'deki diğer dosyaların uzantı seti.
 *   Tarama akışında scanDirectory pre-walk sonrası inşa edilir; testlerde opsiyonel.
 */
function refineCategory(
    baseCategory: CategoryType,
    fileName: string,
    filePath: string,
    siblingExtensions?: ReadonlySet<string>,
): CategoryType {
    if (baseCategory !== 'Render' && baseCategory !== 'Doku') return baseCategory;

    const lower = fileName.toLowerCase();
    const nameWithoutExt = lower.replace(/\.[^.]+$/, '');
    const pathLower = filePath.toLowerCase().replace(/\\/g, '/');
    const pathSegments = pathLower.split('/').slice(0, -1); // klasör parçaları (dosya adı hariç)

    // 1) En yüksek öncelik: cihaz dosya adı pattern'leri (IMG_0001, DSC_0001, DJI_, vb.)
    //    Bu pattern'ler render dosyalarında neredeyse hiç görülmez — kesin Fotoğraf sinyali.
    //    Yine de doku suffix'i olan nadir durumları (DSC_0001_diff.jpg) önce kontrol et.
    const hasTextureSuffix = TEXTURE_SUFFIX_PATTERNS.some(sfx => nameWithoutExt.endsWith(sfx));
    if (!hasTextureSuffix && PHOTO_FILENAME_PATTERNS.some(re => re.test(nameWithoutExt))) {
        return 'Fotoğraf';
    }

    // 2) Doku suffix'i kesin Doku sinyali
    if (hasTextureSuffix) return 'Doku';

    // 3) Klasör yolu ipuçları
    const inTextureFolder = pathSegments.some(seg =>
        TEXTURE_FOLDER_KEYWORDS.some(kw => seg === kw || seg.includes(kw))
    );
    const inRenderFolder = pathSegments.some(seg =>
        RENDER_FOLDER_KEYWORDS.some(kw => seg === kw || seg.includes(kw))
    );
    const inPhotoFolder = pathSegments.some(seg =>
        PHOTO_FOLDER_KEYWORDS.some(kw => seg === kw || seg.includes(kw))
    );

    // Klasör ipucu kesinse direkt ata (öncelik: Foto > Doku > Render — fotoğraf en güvenilir bağlam)
    if (inPhotoFolder && !inTextureFolder) return 'Fotoğraf';
    if (inTextureFolder && !inRenderFolder && !inPhotoFolder) return 'Doku';
    if (inRenderFolder && !inTextureFolder && !inPhotoFolder) {
        // Render klasöründe bile dosya adı fotoğraf ipucu içeriyorsa Fotoğraf
        if (PHOTO_KEYWORDS.some(kw => lower.includes(kw))) return 'Fotoğraf';
        return 'Render';
    }

    // 4) Sibling render sinyali — aynı stem'de PSD/MAX/3DS vb. varsa render iş akışı.
    //    Doku/Foto klasör ipucu yok; ek olarak doku klasörü zaten yukarıda yakalanırdı.
    if (siblingExtensions && siblingExtensions.size > 0) {
        for (const ext of siblingExtensions) {
            if (RENDER_SIBLING_EXTENSIONS.has(ext)) {
                // Bir kardeş PSD/MAX vb. var — render iş akışının parçası.
                // Yine de dosya adı fotoğraf/doku ipucu içeriyorsa onu önemse.
                if (PHOTO_KEYWORDS.some(kw => lower.includes(kw))) return 'Fotoğraf';
                if (TEXTURE_KEYWORDS.some(kw => lower.includes(kw))) return 'Doku';
                return 'Render';
            }
        }
    }

    // 5) Dosya adı anahtar kelime kontrolü
    //    Sıralama: Foto (en spesifik) > Doku > Render-strong (substring) > Render-weak (word-boundary)
    if (PHOTO_KEYWORDS.some(kw => lower.includes(kw))) return 'Fotoğraf';
    if (TEXTURE_KEYWORDS.some(kw => lower.includes(kw))) return 'Doku';
    if (RENDER_STRONG_KEYWORDS.some(kw => lower.includes(kw))) return 'Render';
    if (RENDER_WEAK_KEYWORDS.some(kw => hasWordToken(lower, kw))) return 'Render';

    return baseCategory;
}

// Yazılım damgasından render motorunu tanımak için (renderSoftware EXIF alanı)
const KNOWN_RENDER_ENGINES = [
    'v-ray', 'vray', 'corona', 'lumion', 'enscape', 'twinmotion',
    'arnold', 'octane', 'redshift', 'maxwell', 'mental ray', 'mentalray',
    'cycles', 'eevee', 'iray', 'fstorm',
    '3ds max', '3dsmax', 'blender', 'sketchup', 'cinema 4d',
    'modo', 'rhino', 'keyshot', 'thearender',
];

/**
 * İkinci geçiş: EXIF, görsel boyut ve kamera bilgisiyle nihai kategori belirle.
 * Tarama döngüsünde metadata çıkarıldıktan sonra çağrılır.
 *
 * Sinyal hiyerarşisi:
 *   1. EXIF foto sinyalleri (cameraInfo, GPS, focalLength, exposureTime, isoSpeed) → Fotoğraf
 *   2. EXIF render bayrağı (isRenderByExif) veya renderSoftware → Render
 *   3. Boyut sezgisi: kare + 2^n → Doku
 *   4. Yüksek çözünürlük + geniş ekran (en az QHD) → Render
 *
 * NOT: 1920x1080 + 16:9 ARTIK render kabul edilmiyor — modern telefon fotoğrafları bu boyutta.
 */
function refineCategoryWithMetadata(
    currentCategory: CategoryType,
    metadata: AssetMetadata & Record<string, unknown>,
    fileSize?: number,
): CategoryType {
    if (currentCategory !== 'Render' && currentCategory !== 'Doku') return currentCategory;

    // 1) EXIF foto sinyalleri — herhangi biri varsa bu bir fotoğraf.
    //    Render motorları kamera/GPS/optik metadata yazmaz.
    const cameraInfo = metadata.cameraInfo as string | undefined;
    const gpsLat = metadata.gpsLat as number | undefined;
    const gpsLon = metadata.gpsLon as number | undefined;
    const focalLength = metadata.focalLength as string | number | undefined;
    const exposureTime = metadata.exposureTime as string | number | undefined;
    const isoSpeed = metadata.isoSpeed as string | number | undefined;

    const hasCamera = cameraInfo !== undefined && cameraInfo !== null && String(cameraInfo).trim().length > 0;
    const hasGps = (gpsLat !== undefined && gpsLat !== null && gpsLat !== 0)
        || (gpsLon !== undefined && gpsLon !== null && gpsLon !== 0);
    const hasFocal = focalLength !== undefined && focalLength !== null
        && String(focalLength).trim().length > 0 && String(focalLength).trim() !== '0';
    const hasExposure = exposureTime !== undefined && exposureTime !== null
        && String(exposureTime).trim().length > 0 && String(exposureTime).trim() !== '0';
    const hasIso = isoSpeed !== undefined && isoSpeed !== null
        && String(isoSpeed).trim().length > 0 && String(isoSpeed).trim() !== '0';

    if (hasCamera || hasGps || hasFocal || hasExposure || hasIso) {
        return 'Fotoğraf';
    }

    // 2) Render bayrakları
    const isRenderByExif = metadata.isRenderByExif as boolean | undefined;
    if (isRenderByExif === true) return 'Render';

    const renderSoftware = metadata.renderSoftware as string | undefined;
    if (renderSoftware && renderSoftware.trim().length > 0) {
        const sw = renderSoftware.toLowerCase();
        if (KNOWN_RENDER_ENGINES.some(eng => sw.includes(eng))) return 'Render';
    }

    // 3) Boyut sezgileri
    const resolution = metadata.resolution as { width: number; height: number } | undefined;
    if (resolution && resolution.width > 0 && resolution.height > 0) {
        const { width, height } = resolution;
        const isSquare = width === height;
        const isPowerOf2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
        const maxSide = Math.max(width, height);

        // Kare + 2^n → çok yüksek olasılıkla doku
        if (isSquare && isPowerOf2(width) && width >= 64) {
            return 'Doku';
        }

        // Yaygın doku boyutları (her iki boyut da 2^n listesinde, kare olmasa bile)
        const commonTexSizes = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384];
        if (commonTexSizes.includes(width) && commonTexSizes.includes(height)) {
            return 'Doku';
        }

        // YENİ: Küçük boyut → Doku eğilimi.
        // Mimari render iş akışında çıktı boyutu en az 1920px'tir (kullanıcı iş akışı: 3dsMax → TGA).
        // Dokular ise tipik olarak 256/512/1024/2048 boyutunda — max kenar ≤1280 ise Doku.
        // EXIF foto sinyali yukarıda zaten elenmiş olduğundan, bu küçük dosya doku olma olasılığı yüksek.
        if (maxSide <= 1280) {
            return 'Doku';
        }

        // Render boyut sezgisi: yalnızca QHD ve üstü + geniş ekran + EXIF foto sinyali yok.
        // 1920x1080 (Full HD) artık render demez — modern telefonların standart fotoğraf boyutu.
        const aspect = width / height;
        const isWidescreen = aspect >= 1.3 && aspect <= 2.4;
        const isUltraHighRes = width >= 2560 || height >= 1440;
        if (isWidescreen && isUltraHighRes && currentCategory === 'Render') {
            return 'Render';
        }
    }

    // 4) Dosya boyutu sezgisi — piksel boyutu çıkarılamadıysa son çare.
    // Mimari render çıktıları (3dsMax TGA→JPG) tipik olarak >500 KB.
    // 500 KB altı JPEG/PNG/TGA/TIFF → referans görsel veya doku.
    if (!resolution && fileSize !== undefined && fileSize > 0 && fileSize < 500 * 1024) {
        return 'Doku';
    }

    return currentCategory;
}

/**
 * Yedek dosyanın kaynak dosya yolunu tahmin et.
 * Örn: "plan.dwg.bak" → "plan.dwg", "plan.sv$" → "plan.dwg" (bakSourceType=dwg)
 */
function guessBackupSourcePath(fileName: string, filePath: string, bakSourceType?: string): string {
    const BAK_EXTENSIONS = new Set(['bak', '~bak']);
    // DWG lock/autosave uzantıları — kaynak her zaman DWG
    const DWG_BACKUP_EXTENSIONS = new Set(['dwl', 'dwl2', 'sv$', 'asv']);
    const dir = filePath.substring(0, filePath.length - fileName.length);
    const parts = fileName.split('.');
    const lastExt = (parts[parts.length - 1] || '').toLowerCase();

    // .dwl, .dwl2, .sv$, .asv → her zaman DWG'nin yedeği/kilidi
    if (parts.length >= 2 && DWG_BACKUP_EXTENSIONS.has(lastExt)) {
        const stem = parts.slice(0, -1).join('.');
        return dir + stem + '.dwg';
    }

    // Double extension: "file.dwg.bak" → strip last extension → "file.dwg"
    if (parts.length >= 3 && BAK_EXTENSIONS.has(lastExt)) {
        const sourceName = parts.slice(0, -1).join('.');
        return dir + sourceName;
    }

    // Single .bak extension: "file.bak" → use detected source type
    if (parts.length >= 2 && lastExt === 'bak' && bakSourceType) {
        const SOURCE_EXT_MAP: Record<string, string> = {
            dwg: 'dwg', psd: 'psd', max: 'max', rvt: 'rvt',
            doc: 'doc', docx: 'docx', xls: 'xls', xlsx: 'xlsx',
            ppt: 'ppt', pptx: 'pptx', pdf: 'pdf', blend: 'blend',
            skp: 'skp', ifc: 'ifc', pln: 'pln', glb: 'glb', txt: 'txt',
        };
        const ext = SOURCE_EXT_MAP[bakSourceType];
        if (ext) {
            const stem = parts.slice(0, -1).join('.');
            return dir + stem + '.' + ext;
        }
    }

    return '';
}

/**
 * Dosya adından ve konumundan proje adı tahmin et.
 */
function guessProjectName(pathParts: string[]): string {
    // En üst dizin genellikle proje adıdır
    if (pathParts.length >= 2) {
        return pathParts[0];
    }
    return 'Genel Arşiv';
}

/**
 * DWG layer isimlerini analiz ederek çizim kategorilerini belirler.
 * AIA layer naming convention: X-YYYY (Discipline-Component)
 * A=Architectural, S=Structural, E=Electrical, M=Mechanical, P=Plumbing, etc.
 */
function analyzeDwgLayerCategories(layers: string[]): string[] {
    const categories = new Set<string>();
    const prefixMap: Record<string, string> = {
        'A-': 'Mimari', 'AR-': 'Mimari', 'MIM-': 'Mimari',
        'S-': 'Strüktür', 'ST-': 'Strüktür', 'YAP-': 'Strüktür',
        'E-': 'Elektrik', 'EL-': 'Elektrik', 'ELE-': 'Elektrik',
        'M-': 'Mekanik', 'ME-': 'Mekanik', 'MAK-': 'Mekanik',
        'P-': 'Tesisat', 'PL-': 'Tesisat', 'SIH-': 'Tesisat', 'TES-': 'Tesisat',
        'L-': 'Peyzaj', 'LA-': 'Peyzaj',
        'C-': 'İnşaat', 'CI-': 'İnşaat',
        'I-': 'İç Mekan', 'F-': 'Mobilya',
        'G-': 'Genel',
    };
    const contentMap: Record<string, string> = {
        'WALL': 'Duvar', 'DOOR': 'Kapı', 'WINDOW': 'Pencere', 'COLUMN': 'Kolon',
        'BEAM': 'Kiriş', 'SLAB': 'Döşeme', 'STAIR': 'Merdiven', 'ROOF': 'Çatı',
        'ELEV': 'Asansör', 'HATCH': 'Tarama', 'DIM': 'Ölçü', 'TEXT': 'Yazı',
        'FURNITURE': 'Mobilya', 'PLUMB': 'Sıhhi Tesisat', 'HVAC': 'İklimlendirme',
        'FIRE': 'Yangın', 'LIGHT': 'Aydınlatma',
    };

    for (const layer of layers) {
        const upper = layer.toUpperCase();
        for (const [prefix, category] of Object.entries(prefixMap)) {
            if (upper.startsWith(prefix)) {
                categories.add(category);
                break;
            }
        }
        for (const [keyword, label] of Object.entries(contentMap)) {
            if (upper.includes(keyword)) {
                categories.add(label);
            }
        }
    }
    return Array.from(categories);
}

/**
 * Dosya için aranacak metin belgesi oluştur (embedding için).
 */
function buildSearchableText(asset: Partial<Asset>): string {
    const parts: string[] = [];
    if (asset.fileName) parts.push(asset.fileName.replace(/[_.-]/g, ' '));
    if (asset.projectName) parts.push(asset.projectName);
    if (asset.category) parts.push(asset.category);
    if (asset.fileType) parts.push(asset.fileType);
    if (asset.materialGroup) parts.push(asset.materialGroup);
    if (asset.projectPhase) parts.push(asset.projectPhase);
    if (asset.colorTheme) parts.push(asset.colorTheme);
    if (asset.architecturalStyle) parts.push(asset.architecturalStyle);
    if (asset.aiTags) parts.push(...asset.aiTags.map(t => t.label));

    // DWG binary metadata'yı embedding'e dahil et
    const meta = asset.metadata;
    if (meta) {
        // Binary extraction: layers, blocks, texts, xrefs, properties
        if (meta.dwgLayers?.length) parts.push(...meta.dwgLayers.map(l => l.replace(/[-_]/g, ' ')));
        if (meta.dwgBlockNames?.length) parts.push(...meta.dwgBlockNames.map(b => b.replace(/[-_]/g, ' ')));
        if (meta.dwgTextContents?.length) parts.push(...meta.dwgTextContents);
        if (meta.dwgXrefNames?.length) parts.push(...meta.dwgXrefNames.map(x => x.replace(/\.(dwg|dxf)$/i, '').replace(/[-_]/g, ' ')));
        if (meta.dwgImageRefs?.length) parts.push(...meta.dwgImageRefs.map(x => x.replace(/\.(jpe?g|png|bmp|tiff?|gif|pcx|ecw)$/i, '').replace(/[-_]/g, ' ')));
        if (meta.dwgProperties?.title) parts.push(meta.dwgProperties.title);
        if (meta.dwgProperties?.subject) parts.push(meta.dwgProperties.subject);
        if (meta.dwgProperties?.keywords) parts.push(meta.dwgProperties.keywords);
        if (meta.dwgProperties?.author) parts.push(meta.dwgProperties.author);
        if (meta.dwgEstimatedScale) parts.push(meta.dwgEstimatedScale);
        if (meta.dwgUnitType) parts.push(meta.dwgUnitType);

        // AI çizim analizi sonuçları
        if (meta.dwgDrawingType) parts.push(meta.dwgDrawingType);
        if (meta.dwgDescription) parts.push(meta.dwgDescription);
        if (meta.dwgElements?.length) parts.push(...meta.dwgElements);
        if (meta.dwgSpaces?.length) parts.push(...meta.dwgSpaces);
        if (meta.dwgKeywords?.length) parts.push(...meta.dwgKeywords);
        if (meta.dwgDomainTerms?.length) parts.push(...meta.dwgDomainTerms);
    }

    return parts.join(' ');
}

/** Ön-sayım sonucu: büyük klasör uyarısı için */
export interface PreCountResult {
    fileCount: number;
    folderCount: number;
    maxDepthReached: boolean;
    symlinksSkipped: number;
}

/**
 * Kullanıcının bilgisayarından klasör seçip tüm dosyaları tara.
 * Tauri Native FS API kullanır.
 */
export async function scanDirectory(
    onProgress: ScanProgressCallback,
    generateEmbeddings: boolean = true,
    controller?: ScanController,
    extractColors: boolean = false,
    aiConfig?: AIConfig,
    /** Sağlanırsa klasör diyalogu atlanır; string[] ise dosya modu, string ise klasör modu */
    externalPaths?: string[] | string,
    /** Bu yollardaki dosyalar önbellekten değil her zaman yeniden işlenir */
    forcePaths?: Set<string>,
    /** Büyük klasör tespit edildiğinde çağrılır; false dönerse tarama iptal edilir */
    onConfirmLargeScan?: (info: PreCountResult) => Promise<boolean>,
    /** Geriye uyumluluk için tutulan no-op. scanDirectory artık final saveDatabaseAsync
     *  çağırmıyor — tüm tablolar rusqlite ile diske yazılır. Caller'lar parametreyi
     *  iletmeye devam edebilir; etkisi yok. */
    _skipFinalSave: boolean = false,
): Promise<Asset[]> {
    // Disk alanı kontrolü — düşükse uyarı (engellemez)
    try {
        const { checkDiskSpaceAndWarn } = await import('./database');
        await checkDiskSpaceAndWarn();
    } catch { /* sessiz */ }

    const fileEntries: Array<{ name: string; path: string; size: number; lastModified: number; pathParts: string[] }> = [];
    // Pre-walk fazında progress objesi henüz yok — lokal array'de topla, sonra merge.
    const walkReport: ScanReportEntry[] = [];
    const pushWalkReport = (filePath: string, category: ScanReportCategory, reason: string) => {
        if (walkReport.length >= SCAN_REPORT_MAX_ENTRIES) return;
        walkReport.push({
            filePath, category,
            reason: reason.length > 500 ? reason.slice(0, 500) + '…' : reason,
            timestamp: new Date().toISOString(),
        });
    };

    if (externalPaths && Array.isArray(externalPaths) && externalPaths.length > 0) {
        // Dosya modu: sağlanan yollardan direkt entry oluştur
        for (const filePath of externalPaths) {
            const sep = filePath.includes('\\') ? '\\' : '/';
            const name = filePath.split(sep).pop() || '';
            const ext = name.split('.').pop()?.toLowerCase() || '';
            if (!EXTENSION_MAP[ext]) {
                pushWalkReport(filePath, 'extension_skip', `Uzantı desteklenmiyor: .${ext}`);
                continue;
            }
            try {
                const meta = await fsStat(filePath);
                fileEntries.push({
                    name,
                    path: filePath,
                    size: meta.size ?? 0,
                    lastModified: meta.mtime?.getTime() ?? Date.now(),
                    pathParts: filePath.split(/[\\/]/).filter(Boolean),
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                pushWalkReport(filePath, 'stat_failed', `Dosya bilgisi okunamadı: ${msg}`);
            }
        }
    } else {
        // Klasör modu: externalPaths string ise doğrudan kullan, yoksa diyalog aç
        let selectedPath: string | null = typeof externalPaths === 'string' ? externalPaths : null;
        if (!selectedPath) {
            try {
                selectedPath = await open({
                    title: "Taranacak Arşiv Klasörünü Seçin",
                    directory: true,
                    multiple: false,
                });
            } catch (err) {
                debugLog('Scanner', 'Klasör seçim hatası', err);
                return [];
            }
        }

        if (!selectedPath) return [];

        const separator = selectedPath.includes('\\') ? '\\' : '/';
        const folderName = selectedPath.split(separator).pop() || 'Bilinmeyen_Klasor';

        // ── Güvenlik sabitleri ──
        const MAX_WALK_DEPTH = 50;
        const LARGE_SCAN_THRESHOLD = 500;

        // ── Katman 1: Hızlı ön-sayım (stat almaz, sadece sayar) ──
        const preCount: PreCountResult = { fileCount: 0, folderCount: 0, maxDepthReached: false, symlinksSkipped: 0 };
        const visitedCanonical = new Set<string>();

        async function quickCount(currentPath: string, depth: number) {
            if (depth > MAX_WALK_DEPTH) {
                preCount.maxDepthReached = true;
                debugLog('Scanner', `Ön-sayım: derinlik limiti aşıldı (${MAX_WALK_DEPTH}): ${currentPath}`);
                return;
            }
            // Symlink loop koruması: normalize edilmiş path tekrar gelirse atla
            const canonical = currentPath.replace(/\\/g, '/').toLowerCase();
            if (visitedCanonical.has(canonical)) {
                preCount.symlinksSkipped++;
                debugLog('Scanner', `Ön-sayım: döngüsel klasör atlandı: ${currentPath}`);
                return;
            }
            visitedCanonical.add(canonical);

            let entries;
            try { entries = await readDir(currentPath); } catch { return; }
            for (const entry of entries) {
                if (!entry.name) continue;
                const fullPath = `${currentPath}${separator}${entry.name}`;
                if (entry.isDirectory) {
                    preCount.folderCount++;
                    await quickCount(fullPath, depth + 1);
                } else if (entry.isFile) {
                    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
                    if (EXTENSION_MAP[ext]) preCount.fileCount++;
                }
            }
        }

        try {
            await quickCount(selectedPath, 0);
        } catch (err) {
            debugLog('Scanner', 'Ön-sayım başarısız, taramaya devam ediliyor', err);
        }

        debugLog('Scanner', `Ön-sayım sonucu: ${preCount.fileCount} dosya, ${preCount.folderCount} klasör, derinlik-aşımı=${preCount.maxDepthReached}, symlink-atlanan=${preCount.symlinksSkipped}`);

        // Büyük klasör uyarısı — kullanıcı onayı
        if (preCount.fileCount >= LARGE_SCAN_THRESHOLD && onConfirmLargeScan) {
            const confirmed = await onConfirmLargeScan(preCount);
            if (!confirmed) {
                onProgress({
                    total: 0, processed: 0, current: '', isComplete: true, isCancelled: true,
                    errors: [],
                });
                return [];
            }
        }

        // ── Katman 2 & 3: Korumalı walkDir (derinlik + symlink korumalı) ──
        visitedCanonical.clear(); // Tekrar kullanmak için sıfırla

        async function walkDir(currentPath: string, parts: string[], depth: number) {
            // Derinlik koruması
            if (depth > MAX_WALK_DEPTH) {
                debugLog('Scanner', `walkDir: derinlik limiti (${MAX_WALK_DEPTH}) aşıldı, dal atlanıyor: ${currentPath}`);
                pushWalkReport(currentPath, 'depth_limit', `Derinlik limiti aşıldı (${MAX_WALK_DEPTH})`);
                return;
            }
            // Symlink / junction loop koruması
            const canonical = currentPath.replace(/\\/g, '/').toLowerCase();
            if (visitedCanonical.has(canonical)) {
                debugLog('Scanner', `walkDir: döngüsel klasör atlandı: ${currentPath}`);
                pushWalkReport(currentPath, 'symlink_loop', 'Döngüsel klasör/junction atlandı');
                return;
            }
            visitedCanonical.add(canonical);

            let entries;
            try {
                entries = await readDir(currentPath);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                debugLog('Scanner', `Klasör okunamadı: ${currentPath}`, err);
                if (currentPath === selectedPath) {
                    throw new Error(`Seçilen klasör okunamadı. Tauri izin hatası olabilir.\nDetay: ${msg}`);
                }
                // Permission denied / network error / path too long — kategori msg içeriğine göre
                const lowerMsg = msg.toLowerCase();
                const cat: ScanReportCategory = lowerMsg.includes('access') || lowerMsg.includes('permission') || lowerMsg.includes('denied')
                    ? 'permission_denied'
                    : lowerMsg.includes('too long') || lowerMsg.includes('260')
                        ? 'path_too_long'
                        : 'directory_error';
                pushWalkReport(currentPath, cat, msg);
                return;
            }

            for (const entry of entries) {
                if (!entry.name) continue;
                const fullPath = `${currentPath}${separator}${entry.name}`;
                if (entry.isDirectory) {
                    await walkDir(fullPath, [...parts, entry.name], depth + 1);
                } else if (entry.isFile) {
                    const ext = entry.name.split('.').pop()?.toLowerCase() || '';
                    if (EXTENSION_MAP[ext]) {
                        try {
                            const meta = await fsStat(fullPath);
                            fileEntries.push({
                                name: entry.name,
                                path: fullPath,
                                size: meta.size ?? 0,
                                lastModified: meta.mtime?.getTime() ?? Date.now(),
                                pathParts: [...parts, entry.name],
                            });
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            debugLog('Scanner', `Dosya bilgisi okunamadı: ${fullPath}`, err);
                            pushWalkReport(fullPath, 'stat_failed', msg);
                        }
                    } else {
                        // Uzantı whitelist dışı — kullanıcı görmek isteyebilir
                        pushWalkReport(fullPath, 'extension_skip', `Uzantı desteklenmiyor: .${ext || '(yok)'}`);
                    }
                }
            }
        }

        try {
            await walkDir(selectedPath, [folderName], 0);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onProgress({
                total: 0, processed: 0, current: '', isComplete: true,
                errors: [`Klasör taranamadı: ${msg}`],
            });
            return [];
        }
    } // else (klasör modu) sonu

    const progress: ScanProgress = {
        total: fileEntries.length,
        processed: 0,
        current: '',
        errors: [],
        isComplete: false,
        skipped: 0,
        typeCounts: {},
        // Pre-walk fazında biriken atlama kayıtlarını taşı — per-file hatalar bunun üzerine eklenecek
        report: walkReport.length > 0 ? walkReport.slice() : [],
    };

    // ── Sibling tespit map'i: dir → stem → uzantı seti ──
    // refineCategory'ye geçilir; aynı klasör+stem'deki PSD/MAX kardeşleri "render iş akışı" sinyalidir.
    // Pre-walk sonrası bir kez kurulur, prepareEntry'de sadece okunur (immutable).
    const folderSiblingsMap = new Map<string, Map<string, Set<string>>>();
    for (const fe of fileEntries) {
        const dirEnd = fe.path.length - fe.name.length;
        const dir = fe.path.substring(0, dirEnd);
        const dotIdx = fe.name.lastIndexOf('.');
        const stem = (dotIdx > 0 ? fe.name.substring(0, dotIdx) : fe.name).toLowerCase();
        const ext = (dotIdx > 0 ? fe.name.substring(dotIdx + 1) : '').toLowerCase();
        let stemMap = folderSiblingsMap.get(dir);
        if (!stemMap) {
            stemMap = new Map();
            folderSiblingsMap.set(dir, stemMap);
        }
        let extSet = stemMap.get(stem);
        if (!extSet) {
            extSet = new Set();
            stemMap.set(stem, extSet);
        }
        extSet.add(ext);
    }

    /** Bir entry için (kendi uzantısı hariç) aynı stem'deki kardeş uzantıları döner. */
    function getSiblingExtensions(entry: typeof fileEntries[0]): ReadonlySet<string> {
        const dirEnd = entry.path.length - entry.name.length;
        const dir = entry.path.substring(0, dirEnd);
        const dotIdx = entry.name.lastIndexOf('.');
        const stem = (dotIdx > 0 ? entry.name.substring(0, dotIdx) : entry.name).toLowerCase();
        const ownExt = (dotIdx > 0 ? entry.name.substring(dotIdx + 1) : '').toLowerCase();
        const set = folderSiblingsMap.get(dir)?.get(stem);
        if (!set || set.size <= 1) return EMPTY_EXT_SET;
        const result = new Set<string>(set);
        result.delete(ownExt);
        return result;
    }

    onProgress({ ...progress });

    // One-time ODA check: if DWG files are present and ODA is not installed, notify once per session
    if (!scanDirectory._odaChecked) {
        const hasDwg = fileEntries.some(f => {
            const ext = f.name.split('.').pop()?.toLowerCase() || '';
            return ext === 'dwg';
        });
        if (hasDwg) {
            scanDirectory._odaChecked = true;
            try {
                const odaPath = await invoke<string | null>('get_oda_converter_path_cmd');
                if (!odaPath) {
                    const { notifyInfo } = await import('./notificationCenter');
                    const { default: i18n } = await import('../i18n');
                    notifyInfo(i18n.t('scanner.odaNotInstalled'));
                }
            } catch {
                // sessiz fail
            }
        }
    }

    const assets: Asset[] = [];

    const folderMaterialMap = new Map<string, Map<string, number>>();

    function cleanExtractedTextForIndexing(input: string): { text: string; isLikelyGarbage: boolean } {
        const s = (input || '').replace(/\r\n/g, '\n');
        if (!s.trim()) return { text: '', isLikelyGarbage: false };

        // Kontrol karakterlerini ayıkla (newline/tab hariç). Unicode replacement char'ı da temizle.
        let cleaned = '';
        let nonPrintable = 0;
        let replacementCount = 0;
        let printable = 0;

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            const code = ch.charCodeAt(0);

            if (ch === '\uFFFD') {
                replacementCount++;
                nonPrintable++;
                continue;
            }

            const isAllowedControl = ch === '\n' || ch === '\t';
            const isControl = code < 32 || code === 127;
            if (isControl && !isAllowedControl) {
                nonPrintable++;
                continue;
            }

            // Çok nadir görülen private-use / surrogates vs. filtrelemeyi hafif tutalım.
            // Genel yaklaşım: metin olarak kullanılabilecek karakterleri koru.
            cleaned += ch;
            printable++;
        }

        cleaned = cleaned
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const len = Math.max(1, s.length);
        const nonPrintableRatio = nonPrintable / len;
        const replacementRatio = replacementCount / len;

        // Çok yüksek non-printable veya replacement char oranı → büyük ihtimalle binary / yanlış decode.
        const isLikelyGarbage =
            cleaned.length < 40 ||
            nonPrintableRatio > 0.15 ||
            replacementRatio > 0.02;

        return { text: cleaned, isLikelyGarbage };
    }

    /** invoke çağrısını iptal sinyaline karşı yarıştırır — iptal gelince Rust'ın bitmesini beklemez */
    function raceInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
        const p = invoke<T>(cmd, args);
        return controller ? controller.race(p) : p;
    }

    async function ensureDocumentChunksIndexed(asset: Asset, filePath: string): Promise<void> {
        // Bu fonksiyon "best-effort": başarısız olursa taramayı bozmaz.
        const DOC_TEXT_TYPES = new Set(['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'TXT', 'CSV', 'RTF', 'SAP2K', 'BAK']);
        if (!DOC_TEXT_TYPES.has(asset.fileType)) return;

        // Zaten chunk varsa tekrar üretme (gereksiz maliyet).
        // Ancak bazı dosyalarda çıkarılan içerik binary/bozuk olabilir; bu durumda temizleyip yeniden üretmek gerekir.
        // V3 PRE-5c: epoch>=2'de text_chunks vec.db'de → async routing.
        const existing = await getChunkCountByAssetIdAsync(asset.id);
        if (existing > 0) {
            const preview = (await getChunksByAssetIdAsync(asset.id, 1))[0]?.text || '';
            const cleanedPreview = cleanExtractedTextForIndexing(preview);
            if (!cleanedPreview.isLikelyGarbage) return;

            // Çöp içerik tespit edildi → chunk + chunk embedding'leri temizle ve yeniden üret.
            deleteTextChunksByAssetId(asset.id);
            deleteChunkEmbeddingsByAssetId(asset.id, 'chunk_text');
            writeBuffer.markDeleteChunks(asset.id);
        }

        try {
            const normalizedPath = filePath.replace(/\\/g, '/');
            const extracted = await raceInvoke<{ text: string; truncated: boolean; kind: string }>(
                'extract_text_for_indexing',
                { path: normalizedPath, maxChars: 350000 }
            );
            await scanYield(controller);
            const rawText = extracted?.text || '';
            const cleaned = cleanExtractedTextForIndexing(rawText);
            if (!cleaned.isLikelyGarbage && cleaned.text.trim().length >= 250) {
                const chunks = chunkTextForEmbedding(cleaned.text, {
                    maxChunkChars: 2400,
                    overlapChars: 180,
                    minChunkChars: 220,
                    maxChunks: 2500,
                });
                if (chunks.length > 0) {
                    for (const c of chunks) {
                        const chunkId = `${asset.id}_c${c.index}`;
                        upsertTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: c.page, text: c.text, lang: c.lang });
                        writeBuffer.addTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: c.page, text: c.text, lang: c.lang });
                    }

                    const EMBED_BATCH = 32;
                    for (let off = 0; off < chunks.length; off += EMBED_BATCH) {
                        await scanYield(controller);
                        const slice = chunks.slice(off, off + EMBED_BATCH);
                        const vectors = await generateBatchEmbeddings(slice.map((c) => c.text));
                        for (let i = 0; i < vectors.length; i++) {
                            const chunkId = `${asset.id}_c${slice[i].index}`;
                            const vec = vectors[i];
                            if (vec && vec.length > 0) {
                                saveChunkEmbedding(asset.id, chunkId, vec, 'chunk_text');
                                writeBuffer.addEmbedding(asset.id, vec, 'chunk_text', chunkId);
                            }
                        }
                    }
                }
                return;
            }

            // Metin çıkmadıysa (tarama/PDF image vb.) → Ollama + thumbnail üzerinden OCR (opsiyonel).
            if (
                aiConfig &&
                aiConfig.apiProvider === 'ollama' &&
                (asset.thumbnailUrl && !asset.thumbnailUrl.includes('image/svg+xml'))
            ) {
                const ocrText = await ocrImageToText(asset.thumbnailUrl, aiConfig).catch(() => '');
                if (ocrText && ocrText.trim().length >= 120) {
                    const ocrChunks = chunkTextForEmbedding(ocrText, {
                        maxChunkChars: 2000,
                        overlapChars: 120,
                        minChunkChars: 120,
                        maxChunks: 200,
                    });
                    if (ocrChunks.length > 0) {
                        for (const c of ocrChunks) {
                            const chunkId = `${asset.id}_ocr${c.index}`;
                            upsertTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: 1, text: c.text, lang: 'ocr' });
                            writeBuffer.addTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: 1, text: c.text, lang: 'ocr' });
                        }
                        const OCR_EMBED_BATCH = 32;
                        for (let off = 0; off < ocrChunks.length; off += OCR_EMBED_BATCH) {
                            await scanYield(controller);
                            const slice = ocrChunks.slice(off, off + OCR_EMBED_BATCH);
                            const vectors = await generateBatchEmbeddings(slice.map((c) => c.text));
                            for (let i = 0; i < vectors.length; i++) {
                                const chunkId = `${asset.id}_ocr${slice[i].index}`;
                                const vec = vectors[i];
                                if (vec && vec.length > 0) {
                                    saveChunkEmbedding(asset.id, chunkId, vec, 'chunk_ocr');
                                    writeBuffer.addEmbedding(asset.id, vec, 'chunk_ocr', chunkId);
                                }
                            }
                        }
                    }
                }
            }
        } catch (err) {
            rethrowIfScanCancelled(err);
            debugLog('Scanner', `Chunk indexing failed: ${asset.id}`, err);
        }
    }

    function getParentFolder(path: string): string {
        const parts = path.split(/[/\\]/);
        return parts.slice(0, -1).join('/');
    }

    // Checkpoint aralığı: ayarlardan oku (1-100 arası, varsayılan 50)
    const _cpRaw = getSetting('scan_checkpoint_interval');
    const CHECKPOINT_INTERVAL = _cpRaw ? Math.max(1, Math.min(100, parseInt(_cpRaw, 10) || 50)) : 50;
    console.info(`[Scanner] checkpoint interval = ${CHECKPOINT_INTERVAL} (raw setting: ${_cpRaw ?? 'null'})`);

    // İnkremental diske yazma buffer'ı — db.export() yerine rusqlite ile doğrudan INSERT
    const writeBuffer = new ScanWriteBuffer(getActiveArchive());
    // rusqlite write path'ini önceden ısıt — ilk flush 8-10 sn yerine ~1 sn olur.
    // Fire-and-forget; ilk flush'tan önce büyük olasılıkla biter (prepareEntry havuzu doluyor).
    void writeBuffer.warmup();

    // Aşama 1 Commit 2 (2026-04-30): processSingleEntry → prepareEntry + processEntry.
    // prepareEntry: PHASE A-G (hash, cache check, asset.build, metadata, thumbnail, content/pHash,
    //   AI classification) — Rust komutları ağırlıklı, paralele uygun (Commit 2b'de p-limit).
    // processEntry: PHASE H (DB upsert, embeddings, chunks, metadata chunk, materialMap WRITE,
    //   bookkeeping) — sql.js + ONNX singleton, sıralı kalmalı.
    // Davranış %100 aynı; folderMaterialMap WRITE prepareEntry'den processEntry'e taşındı (race önleme).
    type PrepShapeResult = {
        kind: 'dxf' | 'dwg';
        shapes: import('./dwgShapeIndex').DxfShapeRaw[];
        odaMissing: boolean;
    };
    type PrepResult =
        | { kind: 'cached'; asset: Asset; categoryUpdated?: boolean }
        | { kind: 'new'; asset: Asset; materialGuess: string | undefined; shapeResult?: PrepShapeResult }
        | { kind: 'error' };

    // Görsel kategorileri — refineCategoryWithMetadata yalnızca bu setteki dosyalar için çalışır
    const IMAGE_CATEGORY_TYPES = new Set<CategoryType>(['Render', 'Doku', 'Fotoğraf']);

    // Görsel dosya tipleri — resolution metadata'sının zorunlu olduğu file type'lar.
    // Cache hit'te resolution eksikse incomplete kayıt sayılır (eski tarama metadata extract etmemiş).
    const IMAGE_FILE_TYPES = new Set<AssetType>([
        'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'EXR', 'HDR', 'PSD',
    ]);

    async function prepareEntry(entry: typeof fileEntries[0]): Promise<PrepResult> {
        try {
            const ext = entry.name.split('.').pop()?.toLowerCase() || '';
            const fileType = EXTENSION_MAP[ext] || 'TXT';
            const baseCategory = CATEGORY_MAP[fileType] || 'Döküman';
            const siblings = getSiblingExtensions(entry);
            let category = refineCategory(baseCategory, entry.name, entry.path, siblings);
            const hash = await generateHash(entry.path, entry.size, entry.lastModified);
            await scanYield(controller);

            const cached = getAssetById(hash);
            const isForced = forcePaths?.has(entry.path) || forcePaths?.has(entry.path.replace(/\\/g, '/')) || false;

            // Görsel asset için resolution metadata'sı zorunlu.
            // Eski taramalardan kalan incomplete kayıtlarda resolution eksik olabilir;
            // bu durumda cache invalid sayılır ve tam yeniden işlenir (Rust extract çağrılır).
            const cachedHasIncompleteImageMeta = cached
                && IMAGE_FILE_TYPES.has(cached.fileType)
                && !((cached.metadata as Record<string, unknown> | undefined)?.resolution);

            if (
                !isForced &&
                !cachedHasIncompleteImageMeta &&
                cached &&
                normalizePathForMatch(cached.filePath) === normalizePathForMatch(entry.path) &&
                cached.fileSize === entry.size
            ) {
                // Cache hit — dosya değişmedi. Ama sınıflandırma kuralları güncellenmiş olabilir
                // (refineCategory + refineCategoryWithMetadata). Yeni kategoriyi mevcut metadata
                // üzerinden hesapla; farklıysa cached asset'i güncelle (processEntry DB'ye yazar).
                let resolvedCategory = category;
                if (IMAGE_CATEGORY_TYPES.has(resolvedCategory) && cached.metadata) {
                    resolvedCategory = refineCategoryWithMetadata(
                        resolvedCategory,
                        cached.metadata as AssetMetadata & Record<string, unknown>,
                        entry.size,
                    );
                }
                if (cached.category !== resolvedCategory) {
                    const updated: Asset = { ...cached, category: resolvedCategory };
                    return { kind: 'cached', asset: updated, categoryUpdated: true };
                }
                return { kind: 'cached', asset: cached };
            }

            // folderMaterialMap WRITE processEntry'e ertelendi (paralel prepare safety).
            // Burada sadece READ — inferMaterialFromContext başka klasörlerin yazmasını okuyabilir
            // ama tamponun yazımı tek thread'de (processEntry) sıralı yapılır.
            let materialGuess = guessMaterial(entry.name);
            if (!materialGuess) {
                const parentFolder = getParentFolder(entry.path);
                const siblingMaterials = folderMaterialMap.get(parentFolder) || new Map<string, number>();
                materialGuess = inferMaterialFromContext(entry.path, siblingMaterials);
            }

            const asset: Asset = {
                id: hash,
                fileName: entry.name,
                filePath: entry.path,
                fileSize: entry.size,
                fileType,
                category,
                createdAt: new Date(entry.lastModified).toISOString(),
                modifiedAt: new Date(entry.lastModified).toISOString(),
                fsMtime: Math.floor(entry.lastModified / 1000),
                metadataVersion: expectedScannerVersion(fileType),
                projectName: guessProjectName(entry.pathParts),
                projectPhase: guessPhase(entry.name, entry.path),
                materialGroup: materialGuess as Asset['materialGroup'],
                aiTags: [],
                colorPalette: [],
                metadata: {},
                isIndexed: true,
                hash,
            };

            // Shape extract sonucu (DXF/DWG) — persist processEntry'de yapılır.
            let shapeResult: PrepShapeResult | undefined;

            // Metadata tahmini etiketler
            const inferredTags: Asset['aiTags'] = [];
            if (asset.materialGroup) {
                pushTagIfNew(inferredTags, asset.materialGroup, 0.7, 'metadata');
            }
            if (category === 'Render') {
                pushTagIfNew(inferredTags, 'Render Görseli', 0.8, 'metadata');
            }
            if (category === '2D Çizim') {
                pushTagIfNew(inferredTags, 'Teknik Çizim', 0.85, 'metadata');
            }
            if (category === '3D Model') {
                pushTagIfNew(inferredTags, '3D Çizim', 0.85, 'metadata');
            }
            if (category === 'Döküman') {
                pushTagIfNew(inferredTags, 'Döküman', 0.85, 'metadata');
            }
            if (asset.fileType === 'BAK') {
                pushTagIfNew(inferredTags, 'Yedek Dosya', 0.95, 'metadata');
                // Detect original file type from magic bytes
                try {
                    const srcType = await raceInvoke<string>('detect_bak_source_type', { path: entry.path });
                    if (srcType) {
                        asset.metadata.bakSourceType = srcType;
                        const sourceLabel: Record<string, string> = {
                            dwg: 'DWG Yedeği', psd: 'PSD Yedeği', max: '3ds Max Yedeği',
                            rvt: 'Revit Yedeği', doc: 'Word Yedeği', docx: 'Word Yedeği',
                            xls: 'Excel Yedeği', xlsx: 'Excel Yedeği', ppt: 'PowerPoint Yedeği',
                            pptx: 'PowerPoint Yedeği', pdf: 'PDF Yedeği', blend: 'Blender Yedeği',
                            skp: 'SketchUp Yedeği', ifc: 'IFC Yedeği', pln: 'ArchiCAD Yedeği',
                            glb: 'glTF Yedeği', txt: 'Metin Yedeği',
                            ole: 'Office/OLE Yedeği', zip: 'ZIP Yedeği',
                        };
                        pushTagIfNew(inferredTags, sourceLabel[srcType] || `${srcType.toUpperCase()} Yedeği`, 0.9, 'metadata');
                    }
                } catch { /* sessiz */ }
                // Compute probable source file path for backup→source linking
                asset.metadata.backupOfPath = guessBackupSourcePath(entry.name, entry.path, asset.metadata.bakSourceType);
            }
            // Dosya adındaki anahtar kelimeleri etiket olarak ekle
            const nameWords = entry.name.replace(/[_.-]/g, ' ').split(' ').filter(w => w.length > 2);
            nameWords.slice(0, 3).forEach(word => {
                pushTagIfNew(inferredTags, word, 0.6, 'nlp');
            });
            asset.aiTags = inferredTags;

            // Try to extract real file dates and thumbnail via Rust Desktop Backend
            try {
                // Export real OS Dates
                const meta = await raceInvoke<{ created_at: string | null; modified_at: string | null }>('get_file_metadata', { path: entry.path });
                if (meta.created_at) asset.createdAt = meta.created_at;
                if (meta.modified_at) asset.modifiedAt = meta.modified_at;
                await scanYield(controller);

                // Extract Max version + rich metadata (malzeme, plugin, render motoru)
                if (asset.fileType === 'MAX') {
                    try {
                        const version = await raceInvoke<string | null>('get_max_version', { path: entry.path });
                        if (version) asset.metadata.maxVersion = version;
                    } catch (e) {
                        debugLog('Scanner', `MAX version extraction failed: ${entry.name}`, e);
                    }
                    try {
                        const maxMeta = await raceInvoke<{
                            version: string | null;
                            material_names: string[];
                            plugin_names: string[];
                            detected_strings: string[];
                            stream_names: string[];
                            stream_count: number;
                            object_names: string[];
                            layer_names: string[];
                            cfb_storage_names: string[];
                            file_size_bytes: number;
                        }>('extract_max_metadata', { path: entry.path });
                        if (maxMeta.material_names?.length) asset.metadata.materialList = maxMeta.material_names;
                        if (maxMeta.object_names?.length) asset.metadata.maxObjects = maxMeta.object_names;
                        if (maxMeta.layer_names?.length) asset.metadata.maxLayers = maxMeta.layer_names;
                        // Render motoru: ilk match'i belirle
                        const renderEngines = ['V-Ray', 'Corona', 'Arnold', 'Mental Ray', 'Scanline', 'Octane', 'Redshift'];
                        const detectedRender = renderEngines.find(e =>
                            maxMeta.detected_strings?.some(s => s.toLowerCase().includes(e.toLowerCase()))
                        );
                        if (detectedRender) asset.metadata.renderEngine = detectedRender;
                    } catch (e) {
                        debugLog('Scanner', `MAX rich metadata extraction failed: ${entry.name}`, e);
                    }
                }

                // Extract SketchUp version + rich metadata (bileşenler, katmanlar, malzemeler)
                if (asset.fileType === 'SKP') {
                    try {
                        const skpMeta = await raceInvoke<{
                            version: string | null;
                            file_size_bytes: number;
                            component_names: string[];
                            layer_names: string[];
                            material_names: string[];
                            geo_location: string | null;
                            description: string | null;
                            scene_unit: string | null;
                        }>('extract_skp_metadata', { path: entry.path });
                        if (skpMeta.version) asset.metadata.skpVersion = skpMeta.version;
                        if (skpMeta.component_names?.length) asset.metadata.components = skpMeta.component_names;
                        if (skpMeta.layer_names?.length) asset.metadata.layers = skpMeta.layer_names;
                        if (skpMeta.material_names?.length) asset.metadata.materialList = skpMeta.material_names;
                    } catch (e) {
                        debugLog('Scanner', `SKP metadata extraction failed: ${entry.name}`, e);
                    }
                }

                // Extract RVT metadata (Revit version, project name, etc.)
                if (asset.fileType === 'RVT') {
                    try {
                        const rvtMeta = await raceInvoke<{
                            revit_version: string | null;
                            build: string | null;
                            project_name: string | null;
                            central_path: string | null;
                            is_workshared: boolean;
                            format: string | null;
                            storey_count: number;
                            storey_names: string[];
                            space_count: number;
                            stream_count: number;
                        }>('extract_rvt_metadata', { path: entry.path });

                        if (rvtMeta.revit_version) asset.metadata.rvtVersion = rvtMeta.revit_version;
                        if (rvtMeta.build) asset.metadata.rvtBuild = rvtMeta.build;
                        if (rvtMeta.project_name) asset.metadata.rvtProjectName = rvtMeta.project_name;
                        if (rvtMeta.central_path) asset.metadata.rvtCentralPath = rvtMeta.central_path;
                        if (rvtMeta.is_workshared) asset.metadata.rvtWorkshared = true;
                        if (rvtMeta.format) asset.metadata.rvtFormat = rvtMeta.format;
                        if (rvtMeta.storey_count) asset.metadata.rvtStoreyCount = rvtMeta.storey_count;
                        if (rvtMeta.storey_names?.length) asset.metadata.rvtStoreyNames = rvtMeta.storey_names;
                        if (rvtMeta.space_count) asset.metadata.rvtSpaceCount = rvtMeta.space_count;
                        if (rvtMeta.stream_count) asset.metadata.rvtStreamCount = rvtMeta.stream_count;
                    } catch (e) {
                        debugLog('Scanner', `RVT metadata extraction failed: ${entry.name}`, e);
                    }
                }

                // Extract IFC metadata (schema, entities, storeys, etc.)
                if (asset.fileType === 'IFC') {
                    try {
                        const ifcMeta = await raceInvoke<{
                            schema: string | null;
                            originating_system: string | null;
                            project_name: string | null;
                            building_name: string | null;
                            total_entities: number;
                            entity_counts: Array<{ entity_type: string; count: number }>;
                            storey_count: number;
                            storey_names: string[];
                            space_count: number;
                        }>('extract_ifc_metadata', { path: entry.path });

                        if (ifcMeta.schema) asset.metadata.ifcSchema = ifcMeta.schema;
                        if (ifcMeta.originating_system) asset.metadata.ifcOriginatingSystem = ifcMeta.originating_system;
                        if (ifcMeta.project_name) asset.metadata.ifcProjectName = ifcMeta.project_name;
                        if (ifcMeta.building_name) asset.metadata.ifcBuildingName = ifcMeta.building_name;
                        if (ifcMeta.total_entities) asset.metadata.ifcTotalEntities = ifcMeta.total_entities;
                        if (ifcMeta.entity_counts?.length) {
                            asset.metadata.ifcEntityCounts = ifcMeta.entity_counts.slice(0, 10);
                        }
                        if (ifcMeta.storey_count) asset.metadata.ifcStoreyCount = ifcMeta.storey_count;
                        if (ifcMeta.storey_names?.length) asset.metadata.ifcStoreyNames = ifcMeta.storey_names;
                        if (ifcMeta.space_count) asset.metadata.ifcSpaceCount = ifcMeta.space_count;
                    } catch (e) {
                        debugLog('Scanner', `IFC metadata extraction failed: ${entry.name}`, e);
                    }
                }
                await scanYield(controller);

                // Extract Office metadata (tarih + başlık/yazar/konu/sayfa sayısı)
                const ALL_OFFICE_TYPES = new Set(['XLS', 'DOC', 'PPT', 'DOCX', 'XLSX', 'PPTX']);
                const LEGACY_OFFICE_TYPES = new Set(['XLS', 'DOC', 'PPT']);
                if (ALL_OFFICE_TYPES.has(asset.fileType)) {
                    try {
                        const officeMeta = await raceInvoke<{
                            file_size_bytes: number;
                            file_format: string;
                            title: string | null;
                            author: string | null;
                            subject: string | null;
                            keywords: string | null;
                            last_modified_by: string | null;
                            created_at: string | null;
                            modified_at: string | null;
                            page_count: number | null;
                            word_count: number | null;
                            slide_count: number | null;
                            sheet_names: string[];
                        }>('extract_office_metadata', { path: entry.path });
                        // Tarihler (tüm Office)
                        if (officeMeta.created_at) asset.createdAt = officeMeta.created_at;
                        if (officeMeta.modified_at) asset.modifiedAt = officeMeta.modified_at;
                        // Başlık / yazar — yapısal benzerlik için kritik
                        if (officeMeta.title) asset.metadata.title = officeMeta.title;
                        if (officeMeta.author) asset.metadata.author = officeMeta.author;
                        if (officeMeta.subject) asset.metadata.subject = officeMeta.subject;
                        // Sayfa/slayt/kelime sayısı
                        if (officeMeta.page_count) asset.metadata.pageCount = officeMeta.page_count;
                        if (officeMeta.sheet_names?.length) asset.metadata.sheetNames = officeMeta.sheet_names;
                    } catch (e) {
                        // Eski format için fallback: sadece tarih al
                        if (LEGACY_OFFICE_TYPES.has(asset.fileType)) {
                            try {
                                const officeDates = await raceInvoke<{ created_at: string | null; modified_at: string | null }>(
                                    'get_office_dates', { path: entry.path }
                                );
                                if (officeDates.created_at) asset.createdAt = officeDates.created_at;
                                if (officeDates.modified_at) asset.modifiedAt = officeDates.modified_at;
                            } catch { /* sessiz fail */ }
                        }
                        debugLog('Scanner', `Office rich metadata extraction failed: ${entry.name}`, e);
                    }
                }

                // Extract PDF metadata (başlık, yazar, sayfa sayısı)
                if (asset.fileType === 'PDF') {
                    try {
                        const pdfMeta = await raceInvoke<{
                            page_count: number;
                            file_size_bytes: number;
                            text_length: number;
                            has_text: boolean;
                            title: string | null;
                            author: string | null;
                            creator: string | null;
                            producer: string | null;
                            created_at: string | null;
                            modified_at: string | null;
                        }>('extract_pdf_metadata', { path: entry.path });
                        if (pdfMeta.title) asset.metadata.title = pdfMeta.title;
                        if (pdfMeta.author) asset.metadata.author = pdfMeta.author;
                        if (pdfMeta.page_count) asset.metadata.pageCount = pdfMeta.page_count;
                        // PDF internal dates override OS file system dates
                        if (pdfMeta.created_at) asset.createdAt = pdfMeta.created_at;
                        if (pdfMeta.modified_at) asset.modifiedAt = pdfMeta.modified_at;
                    } catch (e) {
                        debugLog('Scanner', `PDF metadata extraction failed: ${entry.name}`, e);
                    }
                }

                // Extract DWG/DXF internal metadata: layers, blocks, texts, xrefs, properties
                if (asset.fileType === 'DWG') {
                    const fileExt = entry.name.split('.').pop()?.toLowerCase() || '';
                    const isDxf = fileExt === 'dxf';

                    // DWG-only: internal creation date (TDCREATE header variable)
                    // Overwrites OS created_at — internal date survives copy/move
                    if (!isDxf) {
                        try {
                            const dwgDate = await raceInvoke<string | null>('get_dwg_creation_date', { path: entry.path });
                            if (dwgDate) {
                                asset.metadata.dwgCreatedAt = dwgDate;
                                asset.createdAt = dwgDate;
                            }
                        } catch {
                            // sessiz fail
                        }
                    }

                    // Choose backend command based on file extension
                    const metaCommand = isDxf ? 'extract_dxf_metadata' : 'extract_dwg_metadata';

                    try {
                        const dwgMeta = await raceInvoke<{
                            version: string | null;
                            layers: string[];
                            block_names: string[];
                            text_contents: string[];
                            xref_names: string[];
                            image_refs: string[];
                            ole_objects: string[];
                            drawing_properties: {
                                title: string | null;
                                subject: string | null;
                                author: string | null;
                                keywords: string | null;
                                comments: string | null;
                                last_saved_by: string | null;
                            };
                            estimated_scale: string | null;
                            unit_type: string | null;
                        }>(metaCommand, { path: entry.path });

                        if (dwgMeta.version) asset.metadata.dwgVersion = dwgMeta.version;
                        if (dwgMeta.layers.length) asset.metadata.dwgLayers = dwgMeta.layers;
                        if (dwgMeta.block_names.length) asset.metadata.dwgBlockNames = dwgMeta.block_names;
                        if (dwgMeta.text_contents.length) asset.metadata.dwgTextContents = dwgMeta.text_contents;
                        if (dwgMeta.xref_names.length) asset.metadata.dwgXrefNames = dwgMeta.xref_names;
                        if (dwgMeta.image_refs.length) asset.metadata.dwgImageRefs = dwgMeta.image_refs;
                        if (dwgMeta.ole_objects?.length) asset.metadata.dwgOleObjects = dwgMeta.ole_objects;
                        if (dwgMeta.estimated_scale) asset.metadata.dwgEstimatedScale = dwgMeta.estimated_scale;
                        if (dwgMeta.unit_type) asset.metadata.dwgUnitType = dwgMeta.unit_type;

                        const props = dwgMeta.drawing_properties;
                        if (props.title || props.subject || props.author || props.keywords) {
                            asset.metadata.dwgProperties = {
                                ...(props.title && { title: props.title }),
                                ...(props.subject && { subject: props.subject }),
                                ...(props.author && { author: props.author }),
                                ...(props.keywords && { keywords: props.keywords }),
                                ...(props.comments && { comments: props.comments }),
                                ...(props.last_saved_by && { lastSavedBy: props.last_saved_by }),
                            };
                        }

                        // Auto-generate tags from layer analysis
                        if (dwgMeta.layers.length) {
                            const layerCategories = analyzeDwgLayerCategories(dwgMeta.layers);
                            layerCategories.forEach(cat => {
                                pushTagIfNew(asset.aiTags, cat, 0.8, 'metadata');
                            });
                        }
                    } catch (err) {
                        debugLog('Scanner', `${isDxf ? 'DXF' : 'DWG'} binary metadata extraction failed: ${entry.name}`, err);
                    }

                    // Faz 4.1 + 4.2 — Geometrik shape extract (DXF doğrudan, DWG ODA cache üzerinden)
                    // Persist processEntry'de upsertAsset sonrası yapılır (FK constraint: asset_id → assets.id).
                    try {
                        const { extractDxfShapesOnly, extractDwgShapesOnly } = await import('./dwgShapeIndex');
                        if (isDxf) {
                            const shapes = await extractDxfShapesOnly(entry.path);
                            shapeResult = { kind: 'dxf', shapes, odaMissing: false };
                        } else {
                            const r = await extractDwgShapesOnly(entry.path);
                            shapeResult = { kind: 'dwg', shapes: r.shapes, odaMissing: r.odaMissing };
                        }
                    } catch (err) {
                        debugLog('Scanner', `Shape extract failed: ${entry.name}`, err);
                    }
                }
                await scanYield(controller);

                // extract_image_metadata: boyut + EXIF + color profile + GPS + ISO (tek çağrı)
                // EXR/HDR: boyut/format alınır ama EXIF yok → yine de çalışır
                // PSD: extract_image_metadata desteklemiyor → ayrı get_image_dimensions
                const RICH_IMAGE_TYPES = new Set(['JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'EXR', 'HDR']);
                if (RICH_IMAGE_TYPES.has(asset.fileType)) {
                    try {
                        const imgMeta = await raceInvoke<{
                            file_size_bytes: number;
                            width: number;
                            height: number;
                            format: string;
                            color_profile: string | null;
                            bit_depth: number | null;
                            has_alpha: boolean;
                            software: string | null;
                            camera_make: string | null;
                            camera_model: string | null;
                            date_taken: string | null;
                            gps_lat: number | null;
                            gps_lon: number | null;
                            iso_speed: number | null;
                            focal_length: string | null;
                            exposure_time: string | null;
                            is_render: boolean;
                        }>('extract_image_metadata', { path: entry.path });
                        if (imgMeta.width && imgMeta.height) {
                            asset.metadata.resolution = { width: imgMeta.width, height: imgMeta.height };
                        }
                        if (imgMeta.color_profile) asset.metadata.colorProfile = imgMeta.color_profile;
                        if (imgMeta.bit_depth) asset.metadata.bitDepth = imgMeta.bit_depth;
                        if (imgMeta.software) asset.metadata.renderSoftware = imgMeta.software;
                        if (imgMeta.camera_make || imgMeta.camera_model) {
                            asset.metadata.cameraInfo = `${imgMeta.camera_make || ''} ${imgMeta.camera_model || ''}`.trim();
                        }
                        if (imgMeta.date_taken) {
                            asset.metadata.dateTaken = imgMeta.date_taken;
                            // EXIF format "YYYY:MM:DD HH:MM:SS" → ISO 8601
                            const exifIso = imgMeta.date_taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T') + 'Z';
                            if (!isNaN(Date.parse(exifIso))) asset.createdAt = exifIso;
                        }
                        if (imgMeta.gps_lat != null) asset.metadata.gpsLat = imgMeta.gps_lat;
                        if (imgMeta.gps_lon != null) asset.metadata.gpsLon = imgMeta.gps_lon;
                        if (imgMeta.iso_speed) asset.metadata.isoSpeed = imgMeta.iso_speed;
                        if (imgMeta.focal_length) asset.metadata.focalLength = imgMeta.focal_length;
                        if (imgMeta.exposure_time) asset.metadata.exposureTime = imgMeta.exposure_time;
                        asset.metadata.isRenderByExif = imgMeta.is_render;
                    } catch (e) {
                        debugLog('Scanner', `Image rich metadata failed: ${entry.name}`, e);
                    }
                    // Boyut hâlâ yoksa (exception veya 0×0 dönüş) → get_image_dimensions fallback
                    if (!asset.metadata.resolution) {
                        try {
                            const dims = await raceInvoke<[number, number]>('get_image_dimensions', { path: entry.path });
                            if (dims[0] > 0 && dims[1] > 0) {
                                asset.metadata.resolution = { width: dims[0], height: dims[1] };
                            }
                        } catch { /* sessiz fail */ }
                    }
                    // Son çare: tarayıcı Image elementi (JPEG/PNG/BMP/WEBP).
                    // Rust image crate'in okuyamadığı JPEG varyantlarını (bazı sRGB/CMYK encoding'ler)
                    // WebView motoru sorunsuz okur — thumbnail zaten bu yolla gösterilir.
                    if (!asset.metadata.resolution && ['JPEG', 'PNG', 'BMP', 'WEBP'].includes(asset.fileType)) {
                        try {
                            const imgUrl = convertFileSrc(entry.path);
                            const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
                                const img = new Image();
                                const timer = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, 5000);
                                img.onload = () => { clearTimeout(timer); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
                                img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
                                img.src = imgUrl;
                            });
                            if (dims.width > 0 && dims.height > 0) {
                                asset.metadata.resolution = dims;
                            }
                        } catch { /* sessiz fail */ }
                    }
                } else if (asset.fileType === 'PSD') {
                    // PSD: extract_image_metadata desteklemiyor, sadece boyut
                    try {
                        const dims = await raceInvoke<[number, number]>('get_image_dimensions', { path: entry.path });
                        asset.metadata.resolution = { width: dims[0], height: dims[1] };
                    } catch { /* sessiz fail */ }
                }

                // Extract dominant colors (only when user opted in, only formats supported by image crate)
                //
                // NOT: image::open() dosyayı resize'dan önce tamamen belleğe yükler.
                // Büyük bir TIFF/JPEG için bu işlem birkaç saniye sürebilir; JavaScript
                // döngüsü await ile sıralı çalıştığından o süre boyunca diğer dosyaların
                // işlenmesi de bloke olur — sıradaki DWG/MAX gibi dosyalar da yavaşlamış
                // gibi görünür. Bu nedenle büyük dosyalar renk analizinden muaf tutulur.
                const COLOR_EXTRACT_TYPES = new Set(['JPEG', 'PNG', 'BMP', 'TIFF', 'TGA']);
                const COLOR_EXTRACT_MAX_BYTES = 15 * 1024 * 1024; // 15 MB
                if (extractColors && COLOR_EXTRACT_TYPES.has(asset.fileType) && asset.fileSize <= COLOR_EXTRACT_MAX_BYTES) {
                    try {
                        const colors = await raceInvoke<Array<{ hex: string; percentage: number }>>(
                            'get_dominant_colors',
                            { path: entry.path, numColors: 5 }
                        );
                        asset.colorPalette = colors.map(c => ({ hex: c.hex, percentage: Math.round(c.percentage) }));
                    } catch {
                        // sessiz fail — colorPalette [] kalır
                    }
                }

                // İkinci geçiş: EXIF, boyut ve kamera bilgisiyle kategori iyileştir
                if (IMAGE_CATEGORY_TYPES.has(asset.category)) {
                    const refined = refineCategoryWithMetadata(
                        asset.category,
                        asset.metadata as AssetMetadata & Record<string, unknown>,
                        entry.size,
                    );
                    if (refined !== asset.category) {
                        asset.category = refined;
                        category = refined;
                        // Tag'leri yeni kategoriye göre güncelle
                        const tagIdx = asset.aiTags.findIndex(t => t.label === 'Render Görseli' || t.label === 'Doku Görseli');
                        const newLabel = refined === 'Doku' ? 'Doku Görseli'
                            : refined === 'Fotoğraf' ? 'Fotoğraf' : 'Render Görseli';
                        if (tagIdx >= 0) {
                            asset.aiTags[tagIdx] = { label: newLabel, confidence: 0.85, source: 'metadata' };
                        } else {
                            pushTagIfNew(asset.aiTags, newLabel, 0.85, 'metadata');
                        }
                    }
                }
                // Extract video metadata (MP4 ve diğer video türleri)
                if (asset.fileType === 'MP4') {
                    try {
                        const vidMeta = await raceInvoke<{
                            file_size_bytes: number;
                            duration_hint: string | null;
                            width: number | null;
                            height: number | null;
                            codec_hint: string | null;
                            file_type_brand: string | null;
                        }>('extract_video_metadata', { path: entry.path });
                        if (vidMeta.duration_hint) asset.metadata.videoDuration = vidMeta.duration_hint;
                        if (vidMeta.codec_hint) asset.metadata.videoCodec = vidMeta.codec_hint;
                        if (vidMeta.width) asset.metadata.videoWidth = vidMeta.width;
                        if (vidMeta.height) asset.metadata.videoHeight = vidMeta.height;
                    } catch (e) {
                        debugLog('Scanner', `Video metadata extraction failed: ${entry.name}`, e);
                    }
                }

                // Extract text metadata (TXT, CSV, RTF)
                const TEXT_RICH_TYPES = new Set(['TXT', 'CSV', 'RTF']);
                if (TEXT_RICH_TYPES.has(asset.fileType)) {
                    try {
                        const txtMeta = await raceInvoke<{
                            file_size_bytes: number;
                            line_count: number;
                            word_count: number;
                            char_count: number;
                            encoding_hint: string;
                            is_utf8: boolean;
                            has_bom: boolean;
                            csv_column_count: number | null;
                            csv_row_count: number | null;
                            rtf_language: string | null;
                            preview_lines: string[];
                        }>('extract_text_metadata', { path: entry.path, fileType: asset.fileType });
                        if (txtMeta.line_count) asset.metadata.lineCount = txtMeta.line_count;
                        if (txtMeta.word_count) asset.metadata.wordCount = txtMeta.word_count;
                        if (txtMeta.char_count) asset.metadata.charCount = txtMeta.char_count;
                        if (txtMeta.csv_column_count != null) asset.metadata.csvColumnCount = txtMeta.csv_column_count;
                        if (txtMeta.csv_row_count != null) asset.metadata.csvRowCount = txtMeta.csv_row_count;
                    } catch (e) {
                        debugLog('Scanner', `Text metadata extraction failed: ${entry.name}`, e);
                    }
                }

                await scanYield(controller);

            } catch (err: unknown) {
                rethrowIfScanCancelled(err);
                const msg = err instanceof Error ? err.message : String(err);
                debugLog('Scanner', `Tauri metadata request failed: ${entry.path} ${msg}`);
                progress.errors.push(`Metadata hatası: ${entry.name}`);
                pushReport(progress, entry.path, 'metadata_error', msg);
            }

            // Generate thumbnails for formats that can't be displayed directly by the browser
            // Web-compatible formats (JPEG, PNG, BMP, WEBP, SVG) use convertFileSrc at render time
            // Ayrı try-catch: thumbnail hatası metadata kaybına yol açmasın
            try {
                const normalizedPath = entry.path.replace(/\\/g, '/');
                let thumbB64 = '';
                if (asset.fileType === 'TGA' || asset.fileType === 'TIFF') {
                    thumbB64 = await raceInvoke<string>('generate_thumbnail', { path: normalizedPath, assetType: asset.fileType });
                } else if (asset.fileType === 'PSD') {
                    thumbB64 = await raceInvoke<string>('get_psd_thumbnail', { path: normalizedPath });
                } else if (asset.fileType === 'DWG') {
                    const r = await raceInvoke<{ data: string; missing_reason: string | null }>('get_dwg_thumbnail', { path: normalizedPath });
                    thumbB64 = r.data;
                    if (!r.data && r.missing_reason) asset.metadata.thumbnailMissingReason = r.missing_reason;
                } else if (asset.fileType === 'MAX') {
                    const r = await raceInvoke<{ data: string; missing_reason: string | null }>('get_max_thumbnail', { path: normalizedPath });
                    thumbB64 = r.data;
                    if (!r.data && r.missing_reason) asset.metadata.thumbnailMissingReason = r.missing_reason;
                } else if (['DOC', 'XLS', 'PPT'].includes(asset.fileType)) {
                    thumbB64 = await raceInvoke<string>('get_office_thumbnail', { path: normalizedPath });
                } else if (asset.fileType === 'PDF') {
                    thumbB64 = await raceInvoke<string>('get_pdf_thumbnail', { path: normalizedPath });
                } else if (['TXT', 'CSV', 'RTF', 'SAP2K', 'MTL'].includes(asset.fileType)) {
                    thumbB64 = await raceInvoke<string>('get_text_thumbnail', { path: normalizedPath });
                } else if (asset.fileType === 'EPS') {
                    thumbB64 = await raceInvoke<string>('get_eps_thumbnail', { path: normalizedPath });
                } else if (asset.fileType === 'SKP') {
                    thumbB64 = await raceInvoke<string>('get_skp_thumbnail', { path: normalizedPath });
                } else if (asset.fileType === 'RVT') {
                    thumbB64 = await raceInvoke<string>('get_rvt_thumbnail', { path: normalizedPath });
                }

                // Fallback: if document-category file has no real thumbnail, generate an SVG icon
                const DOC_CATEGORY_TYPES = new Set(['DOC', 'XLS', 'PPT', 'PDF', 'TXT', 'CSV', 'RTF', 'SAP2K', 'BAK', 'MTL', 'EPS', 'SKP']);
                if (!thumbB64 && DOC_CATEGORY_TYPES.has(asset.fileType)) {
                    thumbB64 = await raceInvoke<string>('get_doc_icon_thumbnail', {
                        fileType: asset.fileType,
                        fileName: asset.fileName,
                    });
                }

                if (thumbB64) {
                    asset.thumbnailUrl = thumbB64;
                }
            } catch (err: unknown) {
                rethrowIfScanCancelled(err);
                const msg = err instanceof Error ? err.message : String(err);
                debugLog('Scanner', `Thumbnail extraction failed: ${entry.path} ${msg}`);
                progress.errors.push(`Thumbnail hatası: ${entry.name} - ${msg}`);
                pushReport(progress, entry.path, 'thumbnail_error', msg);
            }
            await scanYield(controller);

            // İçerik hash'i: dosyanın bayt içeriğinden SHA-256 (birebir kopya tespiti için)
            try {
                const normalizedPath = entry.path.replace(/\\/g, '/');
                asset.contentHash = await raceInvoke<string>('compute_file_hash', { path: normalizedPath });
            } catch (err: unknown) {
                rethrowIfScanCancelled(err);
                const msg = err instanceof Error ? err.message : String(err);
                debugLog('Scanner', `Content hash failed: ${entry.path} ${msg}`);
            }
            await scanYield(controller);

            // pHash üretimi: birebir/çok yakın görselleri daha doğru sıralamak için
            try {
                const normalizedPath = entry.path.replace(/\\/g, '/');
                const NATIVE_PHASH_TYPES = new Set(['JPEG', 'PNG', 'BMP', 'WEBP', 'TGA', 'TIFF']);
                if (NATIVE_PHASH_TYPES.has(asset.fileType)) {
                    asset.phash = await raceInvoke<string>('compute_image_phash', { path: normalizedPath });
                } else if (asset.thumbnailUrl && !asset.thumbnailUrl.includes('image/svg+xml') && asset.thumbnailUrl.includes('base64,')) {
                    const base64Data = asset.thumbnailUrl.split('base64,')[1];
                    if (base64Data) {
                        asset.phash = await raceInvoke<string>('compute_image_phash_from_bytes', { base64Data });
                    }
                }
            } catch (err: unknown) {
                rethrowIfScanCancelled(err);
                const msg = err instanceof Error ? err.message : String(err);
                debugLog('Scanner', `pHash extraction failed: ${entry.path} ${msg}`);
            }
            await scanYield(controller);

            // AI-based classification and material detection (if AI config provided)
            if (aiConfig && (aiConfig.apiKey || aiConfig.apiProvider === 'ollama')) {
                const VISUAL_TYPES = new Set(['JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'PSD']);

                if (VISUAL_TYPES.has(asset.fileType) && (category === 'Render' || category === 'Fotoğraf' || category === 'Doku')) {
                    try {
                        const fileBlob = await (controller ? controller.race(fetch(convertFileSrc(asset.filePath)).then(r => r.blob())) : fetch(convertFileSrc(asset.filePath)).then(r => r.blob()));
                        await scanYield(controller);
                        const file = new File([fileBlob], asset.fileName, { type: `image/${asset.fileType.toLowerCase()}` });

                        const classification = await classifyImageType(file, aiConfig);
                        await scanYield(controller);
                        asset.metadata.aiClassification = {
                            type: classification.type,
                            confidence: classification.confidence,
                            reason: classification.reason
                        };

                        if (!classification.error) {
                            if (classification.type === 'Fotoğraf' && classification.confidence > 0.7) {
                                asset.category = 'Fotoğraf';
                            } else if (classification.type === 'Render' && classification.confidence > 0.7
                                && asset.category !== 'Doku') {
                                // Boyut/EXIF kuralı zaten 'Doku' dediyse AI ezemez.
                                // Küçük görseller (saha fotoğrafı, referans vb.) render olarak yanlış sınıflandırılabilir.
                                asset.category = 'Render';
                            }
                        }

                        const materialResult = await detectMaterials(file, aiConfig);
                        if (materialResult.materials.length > 0 && !materialResult.error) {
                            asset.metadata.aiDetectedMaterials = materialResult.materials;
                            if (!asset.materialGroup && materialResult.materials.length > 0) {
                                asset.materialGroup = materialResult.materials[0] as Asset['materialGroup'];
                            }
                            materialResult.materials.forEach(mat => {
                                pushTagIfNew(asset.aiTags, mat, 0.75, 'clip');
                            });
                        }
                    } catch (err: unknown) {
                        rethrowIfScanCancelled(err);
                        debugLog('Scanner', `AI classification failed: ${entry.name}`, err);
                    }
                }

                // DWG çizim içerik analizi: thumbnail varsa AI ile çizimi incele
                // Binary metadata'yı AI'ya geçirerek daha doğru analiz sağla
                if (asset.fileType === 'DWG' && asset.thumbnailUrl) {
                    try {
                        const binaryMeta: DWGBinaryMetadata = {
                            layers: asset.metadata.dwgLayers,
                            blockNames: asset.metadata.dwgBlockNames,
                            textContents: asset.metadata.dwgTextContents,
                            xrefNames: asset.metadata.dwgXrefNames,
                            properties: asset.metadata.dwgProperties,
                            estimatedScale: asset.metadata.dwgEstimatedScale ?? undefined,
                            unitType: asset.metadata.dwgUnitType ?? undefined,
                        };
                        await scanYield(controller);
                        const dwgResult = await analyzeDWGContent(asset.thumbnailUrl, aiConfig, binaryMeta);
                        // "Yok", "Yok.", "yok" gibi anlamsız AI çıktılarını filtrele
                        const isJunk = (s: string) => /^yok\.?$/i.test(s.trim()) || s.trim().length < 2 || (s.match(/yok/gi)?.length || 0) > 3;
                        const filterArr = (arr: string[]) => arr.filter(s => !isJunk(s));
                        if (!dwgResult.error) {
                            if (dwgResult.drawingType && !isJunk(dwgResult.drawingType)) asset.metadata.dwgDrawingType = dwgResult.drawingType;
                            if (dwgResult.description && !isJunk(dwgResult.description)) asset.metadata.dwgDescription = dwgResult.description;
                            asset.metadata.dwgElements = filterArr(dwgResult.elements);
                            asset.metadata.dwgSpaces = filterArr(dwgResult.spaces);
                            asset.metadata.dwgKeywords = filterArr(dwgResult.keywords);
                            asset.metadata.dwgDomainTerms = filterArr(dwgResult.domainTerms);

                            if (dwgResult.drawingType && !isJunk(dwgResult.drawingType)) {
                                pushTagIfNew(asset.aiTags, dwgResult.drawingType, 0.85, 'clip');
                            }
                            filterArr(dwgResult.elements).slice(0, 5).forEach(elem => {
                                pushTagIfNew(asset.aiTags, elem, 0.7, 'clip');
                            });
                            filterArr(dwgResult.spaces).slice(0, 5).forEach(space => {
                                pushTagIfNew(asset.aiTags, space, 0.7, 'clip');
                            });
                            filterArr(dwgResult.domainTerms).forEach(term => {
                                pushTagIfNew(asset.aiTags, term, 0.9, 'clip');
                            });
                        }
                    } catch (err: unknown) {
                        rethrowIfScanCancelled(err);
                        debugLog('Scanner', `DWG AI analysis failed: ${entry.name}`, err);
                    }
                }
            }
            await scanYield(controller);

            return { kind: 'new', asset, materialGuess, shapeResult };
        } catch (err: unknown) {
            // SCAN_CANCELLED outer loop'ta tek noktada handle edilir.
            if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err;
            const msg = err instanceof Error ? err.message : String(err);
            progress.errors.push(`İç işlem hatası: ${entry.name} — ${msg}`);
            pushReport(progress, entry.path, 'extractor_error', `Prepare: ${msg}`);
            return { kind: 'error' };
        }
    }

    // processEntry: prepareEntry'nin döndürdüğü PrepResult'u sıralı olarak DB'ye yazar,
    // embeddings/chunk/CLIP üretir, metadata chunk indexler ve bookkeeping yapar.
    // Tek thread'de çalışır (sql.js + ONNX singleton race-safe değil).
    async function processEntry(prep: PrepResult, entry: typeof fileEntries[0]): Promise<void> {
        if (prep.kind === 'error') return;

        if (prep.kind === 'cached') {
            const cached = prep.asset;
            try {
                // Sınıflandırma kuralları güncellendiyse kategoriyi DB'ye yaz.
                // Cache hit yolu normalde DB write yapmaz — bu, kategori güncellemesini kalıcılaştırır.
                if (prep.categoryUpdated) {
                    upsertAsset(cached);
                    writeBuffer.addAsset(cached);
                }
                // Dosya değişmemiş olabilir ama daha önce AI kapalıyken tarandıysa
                // döküman metin chunk'ları hiç üretilmemiş olabilir.
                if (generateEmbeddings) {
                    await ensureDocumentChunksIndexed(cached, entry.path);
                }
                // BAK dosyalarında backupOfPath eksikse (eski taramadan kalan) tamamla
                if (cached.fileType === 'BAK' && !cached.metadata.backupOfPath) {
                    let bakSrc = cached.metadata.bakSourceType;
                    if (!bakSrc) {
                        try {
                            bakSrc = await raceInvoke<string>('detect_bak_source_type', { path: entry.path });
                            if (bakSrc) cached.metadata.bakSourceType = bakSrc;
                        } catch { /* sessiz */ }
                    }
                    cached.metadata.backupOfPath = guessBackupSourcePath(entry.name, entry.path, bakSrc || undefined);
                    upsertAsset(cached);
                    writeBuffer.addAsset(cached);
                }
                if (cached.materialGroup) {
                    const parentFolder = getParentFolder(entry.path);
                    const siblingMaterials = folderMaterialMap.get(parentFolder) || new Map<string, number>();
                    siblingMaterials.set(
                        cached.materialGroup,
                        (siblingMaterials.get(cached.materialGroup) || 0) + 1
                    );
                    folderMaterialMap.set(parentFolder, siblingMaterials);
                }
                assets.push(cached);
                progress.skipped = (progress.skipped ?? 0) + 1;
                if (cached.fileType) {
                    progress.typeCounts![cached.fileType] = (progress.typeCounts![cached.fileType] ?? 0) + 1;
                }
            } catch (err: unknown) {
                if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err;
                const msg = err instanceof Error ? err.message : String(err);
                progress.errors.push(`İç işlem hatası: ${entry.name} — ${msg}`);
                pushReport(progress, entry.path, 'extractor_error', `Cached path: ${msg}`);
            }
            return;
        }

        // prep.kind === 'new'
        const asset = prep.asset;
        const materialGuess = prep.materialGuess;

        try {
            // folderMaterialMap WRITE (sıralı — paralel prepare race önleme)
            if (materialGuess) {
                const parentFolder = getParentFolder(entry.path);
                const siblingMaterials = folderMaterialMap.get(parentFolder) || new Map<string, number>();
                siblingMaterials.set(materialGuess, (siblingMaterials.get(materialGuess) || 0) + 1);
                folderMaterialMap.set(parentFolder, siblingMaterials);
            }

            // Veritabanına kaydet
            const assetData = {
                ...asset,
                metadata: asset.metadata as Record<string, unknown>,
                aiTags: asset.aiTags,
                colorPalette: asset.colorPalette,
                appliedExtractors: buildAppliedRecord(asset.fileType),
            };
            upsertAsset(assetData);
            writeBuffer.addAsset(assetData);

            // Faz 4.1 + 4.2 — Shape persist (v2.4.8+: ayrı archivist_shapes*.db dosyasında)
            // writeBuffer'a eklenir, checkpoint flush'unda Rust persist_dwg_shapes_batch ile
            // tek tx içinde yazılır. Asset başına invoke maliyeti elimine.
            if (prep.shapeResult) {
                try {
                    const { categorizeLayerForShape } = await import('./dwgShapeIndex');
                    if (prep.shapeResult.shapes.length > 0) {
                        writeBuffer.addDwgShapes(asset.id, prep.shapeResult.shapes, categorizeLayerForShape);
                    }
                    if (prep.shapeResult.odaMissing && !scanDirectory._odaShapeWarned) {
                        scanDirectory._odaShapeWarned = true;
                        try {
                            const { notifyInfo } = await import('./notificationCenter');
                            const { default: i18n } = await import('../i18n');
                            notifyInfo(i18n.t('scanner.odaNotInstalled'));
                        } catch { /* sessiz */ }
                    }
                } catch (err) {
                    debugLog('Scanner', `Shape persist failed: ${entry.name}`, err);
                }
            }

            // BAK dosyaları minimal scan: UI'da gizli oldukları için embedding/chunk/vision
            // boşuna iş. Yalnızca duplicate-detection için hash + backupOfPath tutulur.
            const isMinimalScan = asset.fileType === 'BAK';

            // AI Embedding oluştur (Metin)
            if (generateEmbeddings && !isMinimalScan) {
                try {
                    await scanYield(controller);
                    const searchText = buildSearchableText(asset);
                    const vector = await generateEmbedding(searchText);
                    saveEmbedding(asset.id, vector, 'text');
                    writeBuffer.addEmbedding(asset.id, vector, 'text');
                } catch (err: unknown) {
                    rethrowIfScanCancelled(err);
                    const msg = err instanceof Error ? err.message : String(err);
                    progress.errors.push(`Embedding hatası: ${entry.name} — ${msg}`);
                    pushReport(progress, entry.path, 'embedding_error', msg);
                }
            }

            // Döküman içerik indexleme (chunk embedding)
            if (generateEmbeddings && !isMinimalScan) {
                const DOC_TEXT_TYPES = new Set(['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'TXT', 'CSV', 'RTF', 'SAP2K']);
                if (DOC_TEXT_TYPES.has(asset.fileType)) {
                    try {
                        const normalizedPath = entry.path.replace(/\\/g, '/');
                        const extracted = await raceInvoke<{ text: string; truncated: boolean; kind: string }>(
                            'extract_text_for_indexing',
                            { path: normalizedPath, maxChars: 350000 }
                        );
                        await scanYield(controller);
                        const rawText = extracted?.text || '';
                        if (rawText.trim().length >= 250) {
                            const chunks = chunkTextForEmbedding(rawText, {
                                maxChunkChars: 2400,
                                overlapChars: 180,
                                minChunkChars: 220,
                                maxChunks: 2500,
                            });
                            if (chunks.length > 0) {
                                // Chunk kayıtları
                                for (const c of chunks) {
                                    const chunkId = `${asset.id}_c${c.index}`;
                                    upsertTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: c.page, text: c.text, lang: c.lang });
                                    writeBuffer.addTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: c.page, text: c.text, lang: c.lang });
                                }

                                const DOC_EMBED_BATCH = 32;
                                for (let off = 0; off < chunks.length; off += DOC_EMBED_BATCH) {
                                    await scanYield(controller);
                                    const slice = chunks.slice(off, off + DOC_EMBED_BATCH);
                                    const vectors = await generateBatchEmbeddings(slice.map((c) => c.text));
                                    for (let i = 0; i < vectors.length; i++) {
                                        const chunkId = `${asset.id}_c${slice[i].index}`;
                                        const vec = vectors[i];
                                        if (vec && vec.length > 0) {
                                            saveChunkEmbedding(asset.id, chunkId, vec, 'chunk_text');
                                            writeBuffer.addEmbedding(asset.id, vec, 'chunk_text', chunkId);
                                        }
                                    }
                                }
                            }
                        } else if (
                            aiConfig &&
                            aiConfig.apiProvider === 'ollama' &&
                            (asset.thumbnailUrl && !asset.thumbnailUrl.includes('image/svg+xml'))
                        ) {
                            // Hibrit OCR: metin çıkmadıysa en azından thumbnail üzerinden OCR dene (best-effort).
                            const ocrText = await ocrImageToText(asset.thumbnailUrl, aiConfig).catch(() => '');
                            await scanYield(controller);
                            if (ocrText && ocrText.trim().length >= 120) {
                                const ocrChunks = chunkTextForEmbedding(ocrText, {
                                    maxChunkChars: 2000,
                                    overlapChars: 120,
                                    minChunkChars: 120,
                                    maxChunks: 200,
                                });
                                if (ocrChunks.length > 0) {
                                    for (const c of ocrChunks) {
                                        const chunkId = `${asset.id}_ocr${c.index}`;
                                        upsertTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: 1, text: c.text, lang: 'ocr' });
                                        writeBuffer.addTextChunk({ id: chunkId, assetId: asset.id, chunkIndex: c.index, page: 1, text: c.text, lang: 'ocr' });
                                    }
                                    const MAIN_OCR_EMBED_BATCH = 32;
                                    for (let off = 0; off < ocrChunks.length; off += MAIN_OCR_EMBED_BATCH) {
                                        await scanYield(controller);
                                        const slice = ocrChunks.slice(off, off + MAIN_OCR_EMBED_BATCH);
                                        const vectors = await generateBatchEmbeddings(slice.map((c) => c.text));
                                        for (let i = 0; i < vectors.length; i++) {
                                            const chunkId = `${asset.id}_ocr${slice[i].index}`;
                                            const vec = vectors[i];
                                            if (vec && vec.length > 0) {
                                                saveChunkEmbedding(asset.id, chunkId, vec, 'chunk_text');
                                                writeBuffer.addEmbedding(asset.id, vec, 'chunk_text', chunkId);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } catch (err: unknown) {
                        rethrowIfScanCancelled(err);
                        const msg = err instanceof Error ? err.message : String(err);
                        // Metin çıkarımı best-effort; taramayı bozmasın
                        progress.errors.push(`Doküman metin index hatası: ${entry.name} — ${msg}`);
                        pushReport(progress, entry.path, 'text_index_error', msg);
                    }
                }
            }

            // Gelişmiş Görsel Vektör (CLIP + multi-crop)
            if (generateEmbeddings && aiConfig?.enableClipVision && !isMinimalScan) {
                // Yalnızca tarayıcının yerel olarak (<canvas> ile) okuyabileceği formatları doğrudan dosyadan alırız.
                const BROWSER_NATIVE_IMAGES = new Set(['JPEG', 'PNG', 'BMP', 'WEBP']);
                try {
                    if (BROWSER_NATIVE_IMAGES.has(asset.fileType)) {
                        await scanYield(controller);
                        // Dosyayı blob olarak belleğe almak yerine URL'yi doğrudan <img>'e ver.
                        // 20 MP panoramik JPEG'lerde peak memory'i önemli oranda düşürür.
                        const vectors = await generateImageEmbeddingsMulti(convertFileSrc(asset.filePath));
                        vectors.forEach(v => { saveEmbedding(asset.id, v.vector, v.source); writeBuffer.addEmbedding(asset.id, v.vector, v.source); });
                    } else if (asset.thumbnailUrl && !asset.thumbnailUrl.includes('image/svg+xml')) {
                        // Tarayıcı desteklemese de (PSD, TGA, TIFF, RAW, MAX, DWG vb.) arka planda çıkartılmış
                        // "gerçek" bir JPG/PNG raster thumbnail'ı varsa onun üzerinden arama vektörü (CLIP) çıkartılır.
                        // "image/svg+xml" (doc/xls vb. için üretilen jenerik logolar) aramayı bozacağı için atlanır.
                        await scanYield(controller);
                        const vectors = await generateImageEmbeddingsMulti(asset.thumbnailUrl);
                        vectors.forEach(v => { saveEmbedding(asset.id, v.vector, v.source); writeBuffer.addEmbedding(asset.id, v.vector, v.source); });
                    }
                } catch (err: unknown) {
                    rethrowIfScanCancelled(err);
                    debugLog('Scanner', `CLIP embedding error: ${entry.name}`, err);
                    const msg = err instanceof Error ? err.message : String(err);
                    progress.errors.push(`Görsel Embedding hatası: ${entry.name} — ${msg}`);
                    pushReport(progress, entry.path, 'image_embedding_error', msg);
                }
            }

            // Faz 4.4 pariteti — AI Chat'in asset'i "görmesi" için metadata chunk üret.
            // Best-effort: hata veya iptal taramayı durdurmasın. `indexAssetMetadata`
            // zaten embedding + FTS5 + metadata chunk tablolarını günceller.
            // BAK için atlanır — UI'da görünmediği için RAG'da aranmasına gerek yok.
            if (!isMinimalScan) {
                try {
                    const { indexAssetMetadata } = await import('./textChunker');
                    // skipSave: true — saveDatabase() (sql.js export → diske, 50-100MB) her
                    // dosyada tetiklenmesin. Final saveDatabaseAsync() (post-scan) metadata
                    // chunk'ları diske yazar. İptal halinde RAM'de kalan chunk'lar bir sonraki
                    // tarama veya RAG indexleme tarafından tamamlanır. Asset/embedding/text_chunk
                    // zaten rusqlite (writeBuffer) ile periyodik checkpoint'lerde güvende.
                    await indexAssetMetadata(asset.id, { skipSave: true });
                } catch (err: unknown) {
                    rethrowIfScanCancelled(err);
                    debugLog('Scanner', `Metadata chunk failed (non-fatal): ${entry.name}`, err);
                }
            }

            assets.push(asset);
            if (asset.fileType) {
                progress.typeCounts![asset.fileType] = (progress.typeCounts![asset.fileType] ?? 0) + 1;
            }
        } catch (err: unknown) {
            if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err;
            const msg = err instanceof Error ? err.message : String(err);
            progress.errors.push(`İç işlem hatası: ${entry.name} — ${msg}`);
            pushReport(progress, entry.path, 'extractor_error', `Process: ${msg}`);
        }
    }

    // Aşama 1 Commit 2b (2026-04-30): pipeline staging.
    // - prepareEntry concurrency=N: Rust hash/metadata/thumbnail komutları paralel başlar.
    // - processEntry tek thread: sql.js + ONNX singleton race-safe değil.
    // - Back-pressure max 2*N inflight: RAM patlamaz, embed kuyruğu yetişebilir.
    // - Sıra korunur: inflight FIFO drain edilir, processEntry orijinal fileEntries sırasıyla çalışır.
    // - İptal: outer try SCAN_CANCELLED yakalar; pending prepare promise'leri .catch() ile susturulur
    //   (Rust komutları arka planda tamamlanır ama sonuçları kullanılmaz — kabul edilebilir trade-off).
    // Concurrency setting'den okunur (1-16); kullanıcı donanıma göre ayarlar.
    // HDD 1-2, SSD 3-4, NVMe + 8-thread 6-8, NVMe + 16+ thread (Ryzen 9 / Threadripper / Xeon) 10-16.
    // Üst sınır 16: embed worker (singleton ONNX) bottleneck olur, daha fazlası RAM israfı.
    const _pwRaw = getSetting('scan_prepare_workers');
    const _pwParsed = _pwRaw ? parseInt(_pwRaw, 10) : 3;
    const PREPARE_CONCURRENCY = Number.isFinite(_pwParsed) && _pwParsed >= 1 && _pwParsed <= 16 ? _pwParsed : 3;
    const MAX_INFLIGHT = Math.max(4, PREPARE_CONCURRENCY * 2); // back-pressure her zaman 2x havuz
    console.info(`[Scanner] prepare workers = ${PREPARE_CONCURRENCY} (raw setting: ${_pwRaw ?? 'null'}), max inflight = ${MAX_INFLIGHT}`);
    const prepareLimit = pLimit(PREPARE_CONCURRENCY);
    const inflight: Array<{ entry: typeof fileEntries[0]; promise: Promise<PrepResult> }> = [];

    async function drainOne(): Promise<void> {
        const item = inflight.shift()!;
        const { entry, promise } = item;
        progress.current = entry.name;
        onProgress({ ...progress });
        let prep: PrepResult;
        try {
            prep = await promise;
        } catch (err) {
            if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err;
            // prepareEntry kendi catch'inde error variant döndürmesi gerek — buraya normalde düşmez
            const msg = err instanceof Error ? err.message : String(err);
            progress.errors.push(`Beklenmeyen prepare hatası: ${entry.name} — ${msg}`);
            pushReport(progress, entry.path, 'extractor_error', `Prepare: ${msg}`);
            progress.processed++;
            return;
        }
        try {
            await processEntry(prep, entry);
        } catch (err) {
            if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err;
            const msg = err instanceof Error ? err.message : String(err);
            progress.errors.push(`Beklenmeyen hata: ${entry.name} — ${msg}`);
            pushReport(progress, entry.path, 'unknown_error', msg);
        }
        progress.processed++;
        if (progress.processed % CHECKPOINT_INTERVAL === 0 || writeBuffer.shouldAutoFlush) {
            const cpOk = await writeBuffer.flush();
            if (!cpOk) {
                progress.errors.push(`DB checkpoint hatası (${progress.processed}. dosya)`);
                pushReport(progress, '', 'checkpoint_error', `Checkpoint başarısız (${progress.processed}. dosya)`);
            }
        }
        onProgress({ ...progress });
    }

    try {
        for (const entry of fileEntries) {
            if (controller) await controller.checkPoint();
            // Back-pressure: kuyruk doluysa drain et (FIFO; processEntry sırası korunur)
            while (inflight.length >= MAX_INFLIGHT) {
                await drainOne();
            }
            const promise = prepareLimit(() => prepareEntry(entry));
            inflight.push({ entry, promise });
        }
        // Kalan inflight'ı boşalt
        while (inflight.length > 0) {
            if (controller) await controller.checkPoint();
            await drainOne();
        }
    } catch (err) {
        if (err instanceof Error && err.message === 'SCAN_CANCELLED') {
            // Pending prepare promise'lerinin unhandled rejection'larını sustur
            for (const { promise } of inflight) {
                promise.catch(() => { /* squelched — Rust komutları arka planda devam ediyor, sonuçları yok sayılır */ });
            }
            // Kullanıcı iptal etti — inkremental yazım Rust tarafından zaten diske yazıldı;
            // son batch'i flush etmek yeterli. saveDatabase() çağırma: tüm sql.js DB'sini
            // export edip UI thread'i 1-3 sn bloklar (donma).
            progress.isComplete = true;
            progress.isCancelled = true;
            onProgress({ ...progress });
            await writeBuffer.flush();
            return assets;
        }
        throw err;
    }

    // Aynı-stem ilişkileri otomatik tespit — writeBuffer'a mirror et.
    // skipSave: true → caller (writeBuffer.flush) persist eder. PRE-6a: async
    // sürüm epoch>=3'te asset_relations vec.db'ye yönlenir; epoch<3'te sql.js
    // INSERT'leri eski gibi yapılır.
    try {
        const relCount = await detectAndSaveSameStemRelationsAsync(
            assets,
            (rel) => writeBuffer.addRelation(rel),
            { skipSave: true },
        );
        if (relCount > 0) debugLog('Scanner', `${relCount} dosya ilişkisi otomatik tespit edildi`);
    } catch (err) {
        debugLog('Scanner', 'detectAndSaveSameStemRelationsAsync error', err);
    }

    // Son buffer'ı flush et (kalan veriler + relations).
    // Tüm tablolar (assets, embeddings, text_chunks, dwg_shapes, asset_relations) artık rusqlite'a
    // yazılıyor → final saveDatabaseAsync gereksiz. scanned_roots mirror'ı useScanWorkflow yapar.
    const flushOk = await writeBuffer.flush();
    if (!flushOk) {
        progress.errors.push('Tarama verileri diske yazılamadı!');
        pushReport(progress, '', 'checkpoint_error', 'Tarama verileri diske yazılamadı (final flush)');
        try {
            const { notifyError } = await import('./notificationCenter');
            notifyError('Veritabanı Kayıt Hatası', 'Tarama sonuçları diske yazılamadı. Lütfen tekrar deneyin.');
        } catch { /* bildirim servisi yoksa sessiz */ }
    }

    progress.isComplete = true;
    onProgress({ ...progress });

    // Otomatik RAG indeksleme — fire-and-forget, taramayı bloklamaz
    scheduleAutoRagIndexing(assets).catch((err) => {
        debugLog('Scanner', 'auto-rag index failed', err);
    });

    return assets;
}

/**
 * Banner'daki "Durdur" butonu için: aktif RAG indekslemesini iptal eder.
 * Hem otomatik (tarama sonrası) hem manuel (sohbet ekranından) tetiklenenler aynı
 * store kanalına yazdığı için tek bir entry-point yeterli.
 */
export async function cancelAutoRagIndexing(): Promise<void> {
    const { useStore } = await import('../store/useStore');
    useStore.getState().autoRagIndexCancel?.();
}

/**
 * Tarama bittikten sonra RAG-indexlenebilir ve henüz indexlenmemiş dosyaları arka planda indeksler.
 * Settings'te `auto_rag_index_after_scan` 'false' ise hiç başlatılmaz.
 * İlerleme Zustand store'a yansıtılır → AutoRagIndexBanner gösterir, kullanıcı durdurabilir.
 */
async function scheduleAutoRagIndexing(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;
    if (getSetting('auto_rag_index_after_scan') === 'false') {
        debugLog('Scanner', 'auto-rag index disabled by setting');
        return;
    }
    const { bulkIndexAssets } = await import('./ragIndexStatus');
    const { queryAll } = await import('./database');
    const { useStore } = await import('../store/useStore');

    // Tüm asset'ler aday — body indexable değilse metadata-only chunk üretilir.
    const ids = assets.map((a) => a.id);
    const placeholders = ids.map(() => '?').join(',');
    const statusRows = queryAll(
        `SELECT id, rag_status FROM assets WHERE id IN (${placeholders})`,
        ids,
    );
    const statusMap = new Map(statusRows.map((r) => [r[0] as string, r[1] as string | null]));
    const pending = assets.filter((a) => {
        const s = statusMap.get(a.id);
        return s !== 'indexed' && s !== 'skipped';
    });
    if (pending.length === 0) return;

    debugLog('Scanner', `auto-indexing ${pending.length} new/changed assets (body+metadata)`);
    const list = pending.map((a) => ({ assetId: a.id, filePath: a.filePath, fileName: a.fileName }));

    const store = useStore.getState();
    store.setAutoRagIndexProgress({
        current: 0, total: list.length, currentFile: '',
        succeeded: 0, skipped: 0, failed: 0,
    });

    const { handle, donePromise } = await bulkIndexAssets(list, (p) => {
        useStore.getState().setAutoRagIndexProgress({
            current: p.current, total: p.total, currentFile: p.currentFile,
            succeeded: p.succeeded, skipped: p.skipped, failed: p.failed,
        });
    });
    useStore.getState().setAutoRagIndexCancel(() => handle.cancel());
    try {
        const result = await donePromise;
        debugLog('Scanner', 'auto-rag index done', result);
        if (result.succeeded > 0) {
            try {
                const { notifySuccess } = await import('./notificationCenter');
                notifySuccess(`AI indeksleme: ${result.succeeded} dosya sohbete hazırlandı.`);
            } catch { /* sessiz */ }
        }
    } finally {
        const s = useStore.getState();
        s.setAutoRagIndexCancel(null);
        s.setAutoRagIndexProgress(null);
    }
}
/** Session-level flag to avoid repeated ODA notifications */
scanDirectory._odaChecked = false as boolean;
scanDirectory._odaShapeWarned = false as boolean;

/* enrichDWGAssets kaldırıldı — DWG AI analizi artık tarama sırasında otomatik yapılıyor */

/* ── Test-only exports ── */
export {
    guessPhase as _guessPhase,
    guessMaterial as _guessMaterial,
    refineCategory as _refineCategory,
    refineCategoryWithMetadata as _refineCategoryWithMetadata,
    guessProjectName as _guessProjectName,
    guessBackupSourcePath as _guessBackupSourcePath,
    analyzeDwgLayerCategories as _analyzeDwgLayerCategories,
    buildSearchableText as _buildSearchableText,
    EXTENSION_MAP as _EXTENSION_MAP,
    CATEGORY_MAP as _CATEGORY_MAP,
};

// ═══════════════════════════════════════════════════════════════════
// ██ FAZ 3: Delta Tarama Motoru
// ═══════════════════════════════════════════════════════════════════

import { getMissingExtractors } from './extractorRegistry';
import { mergeAssetMetadata } from './database';

/**
 * Extractor runner: çıkarıcı adı → async fonksiyon.
 * Her runner ilgili Rust komutunu çağırır ve metadata alanlarını döndürür.
 */
type ExtractorRunner = (path: string, fileType: string) => Promise<Record<string, unknown>>;

const EXTRACTOR_RUNNERS: Record<string, ExtractorRunner> = {
    'max:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const v = await invoke<string | null>('get_max_version', { path });
            if (v) result.maxVersion = v;
        } catch { /* sessiz */ }
        try {
            const m = await invoke<{
                material_names: string[]; object_names: string[]; layer_names: string[];
                detected_strings: string[];
            }>('extract_max_metadata', { path });
            if (m.material_names?.length) result.materialList = m.material_names;
            if (m.object_names?.length) result.maxObjects = m.object_names;
            if (m.layer_names?.length) result.maxLayers = m.layer_names;
            const renderEngines = ['V-Ray', 'Corona', 'Arnold', 'Mental Ray', 'Scanline', 'Octane', 'Redshift'];
            const detected = renderEngines.find(e =>
                m.detected_strings?.some(s => s.toLowerCase().includes(e.toLowerCase()))
            );
            if (detected) result.renderEngine = detected;
        } catch { /* sessiz */ }
        return result;
    },

    'skp:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                version: string | null; component_names: string[];
                layer_names: string[]; material_names: string[];
            }>('extract_skp_metadata', { path });
            if (m.version) result.skpVersion = m.version;
            if (m.component_names?.length) result.components = m.component_names;
            if (m.layer_names?.length) result.layers = m.layer_names;
            if (m.material_names?.length) result.materialList = m.material_names;
        } catch { /* sessiz */ }
        return result;
    },

    'rvt:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                revit_version: string | null; build: string | null; project_name: string | null;
                central_path: string | null; is_workshared: boolean; format: string | null;
                storey_count: number; storey_names: string[]; space_count: number; stream_count: number;
            }>('extract_rvt_metadata', { path });
            if (m.revit_version) result.rvtVersion = m.revit_version;
            if (m.build) result.rvtBuild = m.build;
            if (m.project_name) result.rvtProjectName = m.project_name;
            if (m.central_path) result.rvtCentralPath = m.central_path;
            if (m.is_workshared) result.rvtWorkshared = true;
            if (m.format) result.rvtFormat = m.format;
            if (m.storey_count) result.rvtStoreyCount = m.storey_count;
            if (m.storey_names?.length) result.rvtStoreyNames = m.storey_names;
            if (m.space_count) result.rvtSpaceCount = m.space_count;
            if (m.stream_count) result.rvtStreamCount = m.stream_count;
        } catch { /* sessiz */ }
        return result;
    },

    'ifc:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                schema: string | null; originating_system: string | null;
                project_name: string | null; building_name: string | null;
                total_entities: number; entity_counts: Array<{ entity_type: string; count: number }>;
                storey_count: number; storey_names: string[]; space_count: number;
            }>('extract_ifc_metadata', { path });
            if (m.schema) result.ifcSchema = m.schema;
            if (m.originating_system) result.ifcOriginatingSystem = m.originating_system;
            if (m.project_name) result.ifcProjectName = m.project_name;
            if (m.building_name) result.ifcBuildingName = m.building_name;
            if (m.total_entities) result.ifcTotalEntities = m.total_entities;
            if (m.entity_counts?.length) result.ifcEntityCounts = m.entity_counts.slice(0, 10);
            if (m.storey_count) result.ifcStoreyCount = m.storey_count;
            if (m.storey_names?.length) result.ifcStoreyNames = m.storey_names;
            if (m.space_count) result.ifcSpaceCount = m.space_count;
        } catch { /* sessiz */ }
        return result;
    },

    'office:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                title: string | null; author: string | null; subject: string | null;
                page_count: number | null; sheet_names: string[];
            }>('extract_office_metadata', { path });
            if (m.title) result.title = m.title;
            if (m.author) result.author = m.author;
            if (m.subject) result.subject = m.subject;
            if (m.page_count) result.pageCount = m.page_count;
            if (m.sheet_names?.length) result.sheetNames = m.sheet_names;
        } catch { /* sessiz */ }
        return result;
    },

    'pdf:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                title: string | null; author: string | null; page_count: number;
            }>('extract_pdf_metadata', { path });
            if (m.title) result.title = m.title;
            if (m.author) result.author = m.author;
            if (m.page_count) result.pageCount = m.page_count;
        } catch { /* sessiz */ }
        return result;
    },

    'dwg:creation_date': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const date = await invoke<string | null>('get_dwg_creation_date', { path });
            if (date) result.dwgCreatedAt = date;
        } catch { /* sessiz */ }
        return result;
    },

    'dwg:binary_meta': async (path, _fileType) => {
        const result: Record<string, unknown> = {};
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const isDxf = ext === 'dxf';
        const cmd = isDxf ? 'extract_dxf_metadata' : 'extract_dwg_metadata';
        try {
            const m = await invoke<{
                version: string | null; layers: string[]; block_names: string[];
                text_contents: string[]; xref_names: string[]; image_refs: string[];
                ole_objects: string[]; estimated_scale: string | null; unit_type: string | null;
                drawing_properties: {
                    title: string | null; subject: string | null; author: string | null;
                    keywords: string | null; comments: string | null; last_saved_by: string | null;
                };
            }>(cmd, { path });
            if (m.version) result.dwgVersion = m.version;
            if (m.layers.length) result.dwgLayers = m.layers;
            if (m.block_names.length) result.dwgBlockNames = m.block_names;
            if (m.text_contents.length) result.dwgTextContents = m.text_contents;
            if (m.xref_names.length) result.dwgXrefNames = m.xref_names;
            if (m.image_refs.length) result.dwgImageRefs = m.image_refs;
            if (m.ole_objects?.length) result.dwgOleObjects = m.ole_objects;
            if (m.estimated_scale) result.dwgEstimatedScale = m.estimated_scale;
            if (m.unit_type) result.dwgUnitType = m.unit_type;
            const props = m.drawing_properties;
            if (props.title || props.subject || props.author || props.keywords) {
                result.dwgProperties = {
                    ...(props.title && { title: props.title }),
                    ...(props.subject && { subject: props.subject }),
                    ...(props.author && { author: props.author }),
                    ...(props.keywords && { keywords: props.keywords }),
                    ...(props.comments && { comments: props.comments }),
                    ...(props.last_saved_by && { lastSavedBy: props.last_saved_by }),
                };
            }
        } catch { /* sessiz */ }
        return result;
    },

    'image:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                width: number; height: number; color_profile: string | null;
                bit_depth: number | null; software: string | null;
                camera_make: string | null; camera_model: string | null;
                date_taken: string | null; gps_lat: number | null; gps_lon: number | null;
                iso_speed: number | null; focal_length: string | null;
                exposure_time: string | null; is_render: boolean;
            }>('extract_image_metadata', { path });
            if (m.width && m.height) result.resolution = { width: m.width, height: m.height };
            if (m.color_profile) result.colorProfile = m.color_profile;
            if (m.bit_depth) result.bitDepth = m.bit_depth;
            if (m.software) result.renderSoftware = m.software;
            if (m.camera_make || m.camera_model) {
                result.cameraInfo = `${m.camera_make || ''} ${m.camera_model || ''}`.trim();
            }
            if (m.date_taken) result.dateTaken = m.date_taken;
            if (m.gps_lat != null) result.gpsLat = m.gps_lat;
            if (m.gps_lon != null) result.gpsLon = m.gps_lon;
            if (m.iso_speed) result.isoSpeed = m.iso_speed;
            if (m.focal_length) result.focalLength = m.focal_length;
            if (m.exposure_time) result.exposureTime = m.exposure_time;
            result.isRenderByExif = m.is_render;
        } catch { /* sessiz */ }
        return result;
    },

    'video:rich': async (path) => {
        const result: Record<string, unknown> = {};
        try {
            const m = await invoke<{
                duration_secs: number; video_codec: string | null;
                width: number; height: number;
            }>('extract_video_metadata', { path });
            if (m.duration_secs) result.videoDuration = m.duration_secs;
            if (m.video_codec) result.videoCodec = m.video_codec;
            if (m.width) result.videoWidth = m.width;
            if (m.height) result.videoHeight = m.height;
        } catch { /* sessiz */ }
        return result;
    },

    'text:rich': async (path) => {
        const result: Record<string, unknown> = {};
        const ext = path.split('.').pop()?.toLowerCase() || '';
        const ftMap: Record<string, string> = { txt: 'TXT', csv: 'CSV', rtf: 'RTF' };
        const fileType = ftMap[ext] || 'TXT';
        try {
            const m = await invoke<{
                line_count: number; word_count: number; char_count: number;
                csv_column_count: number | null; csv_row_count: number | null;
            }>('extract_text_metadata', { path, fileType });
            if (m.line_count) result.lineCount = m.line_count;
            if (m.word_count) result.wordCount = m.word_count;
            if (m.char_count) result.charCount = m.char_count;
            if (m.csv_column_count) result.csvColumnCount = m.csv_column_count;
            if (m.csv_row_count) result.csvRowCount = m.csv_row_count;
        } catch { /* sessiz */ }
        return result;
    },
};

/**
 * Delta tarama: Sadece eksik çıkarıcıları çalıştırarak mevcut metadata'ya ekler.
 * Thumbnail, hash, embedding gibi pahalı işlemleri ATLAR.
 *
 * @param assets   Delta taranacak asset listesi
 * @param onProgress İlerleme callback'i
 * @returns Güncellenen asset listesi
 */
export async function deltaScanAssets(
    assets: Asset[],
    onProgress?: (done: number, total: number, current: string) => void,
): Promise<Asset[]> {
    const updated: Asset[] = [];
    const total = assets.length;

    for (let i = 0; i < total; i++) {
        const asset = assets[i];
        onProgress?.(i, total, asset.fileName);

        const missing = getMissingExtractors(asset.fileType, asset.appliedExtractors);
        if (missing.length === 0) continue;

        // Eksik çıkarıcıları çalıştır, metadata alanlarını topla
        const deltaMetadata: Record<string, unknown> = {};
        const newApplied: Record<string, number> = {};

        for (const ext of missing) {
            const runner = EXTRACTOR_RUNNERS[ext.name];
            if (!runner) {
                // Runner yoksa sadece versiyon kaydını güncelle (ör. shape_index gibi özel çıkarıcılar)
                newApplied[ext.name] = ext.version;
                continue;
            }
            try {
                const fields = await runner(asset.filePath, asset.fileType);
                Object.assign(deltaMetadata, fields);
                newApplied[ext.name] = ext.version;
            } catch (err) {
                debugLog('DeltaScan', `Extractor ${ext.name} failed for ${asset.fileName}`, err);
                // Hata olsa da versiyonu kaydet (sonsuz döngü önleme)
                newApplied[ext.name] = ext.version;
            }
        }

        // DB'ye birleştir
        const newVersion = expectedScannerVersion(asset.fileType);
        mergeAssetMetadata(asset.id, deltaMetadata, newApplied, newVersion);

        // In-memory asset'i de güncelle
        const updatedAsset: Asset = {
            ...asset,
            metadata: { ...(asset.metadata || {}), ...deltaMetadata },
            appliedExtractors: { ...(asset.appliedExtractors || {}), ...newApplied },
            metadataVersion: newVersion,
        };
        updated.push(updatedAsset);
    }

    onProgress?.(total, total, '');
    saveDatabase();
    return updated;
}
