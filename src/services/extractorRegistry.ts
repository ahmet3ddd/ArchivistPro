/**
 * ArchivistPro — Extractor Registry
 *
 * Her dosya tipi için metadata çıkarıcılarının (extractor) bildirimsel kaydı.
 * Yeni çıkarıcı eklendiğinde veya mevcut bump yapıldığında staleness
 * checker otomatik olarak eski dosyaları tespit eder.
 *
 * Kullanım:
 *   1. Yeni Rust komutu veya metadata alanı eklediğinde → buraya ExtractorDef ekle
 *   2. Mevcut çıkarıcının çıktısı değiştiğinde → version'ı artır
 *   3. SCANNER_VERSIONS otomatik güncellenir, manuel bump gereksiz
 */

// ── Types ──

export interface ExtractorDef {
    /** Benzersiz sabit ad, ör. 'dwg:binary_meta' */
    name: string;
    /** Monoton versiyon — çıktı değişince artır */
    version: number;
    /** Bu çıkarıcının uygulandığı dosya tipleri */
    fileTypes: readonly string[];
    /** Çıkarıcının metadata_json'a yazdığı alan adları */
    producedFields: readonly string[];
    /** Delta taramada çağrılacak Rust komutu (opsiyonel — bazıları JS-only) */
    rustCommand?: string;
}

// ── Registry ──

const REGISTRY: readonly ExtractorDef[] = [
    // ── DWG/DXF ──
    {
        name: 'dwg:binary_meta',
        version: 1,
        fileTypes: ['DWG'],
        producedFields: [
            'dwgVersion', 'dwgLayers', 'dwgBlockNames', 'dwgTextContents',
            'dwgXrefNames', 'dwgImageRefs', 'dwgOleObjects',
            'dwgEstimatedScale', 'dwgUnitType', 'dwgProperties',
        ],
        rustCommand: 'extract_dwg_metadata',
    },
    {
        name: 'dwg:creation_date',
        version: 1,
        fileTypes: ['DWG'],
        producedFields: ['dwgCreatedAt'],
        rustCommand: 'get_dwg_creation_date',
    },

    // ── 3ds Max ──
    {
        name: 'max:rich',
        version: 1,
        fileTypes: ['MAX'],
        producedFields: ['maxVersion', 'materialList', 'maxObjects', 'maxLayers', 'renderEngine'],
        rustCommand: 'extract_max_metadata',
    },

    // ── SketchUp ──
    {
        name: 'skp:rich',
        version: 1,
        fileTypes: ['SKP'],
        producedFields: ['skpVersion', 'components', 'layers', 'materialList'],
        rustCommand: 'extract_skp_metadata',
    },

    // ── Revit ──
    {
        name: 'rvt:rich',
        version: 1,
        fileTypes: ['RVT'],
        producedFields: [
            'rvtVersion', 'rvtBuild', 'rvtProjectName', 'rvtCentralPath',
            'rvtWorkshared', 'rvtFormat', 'rvtStoreyCount', 'rvtStoreyNames',
            'rvtSpaceCount', 'rvtStreamCount',
        ],
        rustCommand: 'extract_rvt_metadata',
    },

    // ── IFC ──
    {
        name: 'ifc:rich',
        version: 1,
        fileTypes: ['IFC'],
        producedFields: [
            'ifcSchema', 'ifcOriginatingSystem', 'ifcProjectName', 'ifcBuildingName',
            'ifcTotalEntities', 'ifcEntityCounts', 'ifcStoreyCount', 'ifcStoreyNames',
            'ifcSpaceCount',
        ],
        rustCommand: 'extract_ifc_metadata',
    },

    // ── Office ──
    {
        name: 'office:rich',
        version: 1,
        fileTypes: ['XLS', 'XLSX', 'DOC', 'DOCX', 'PPT', 'PPTX'],
        producedFields: ['title', 'author', 'subject', 'pageCount', 'sheetNames'],
        rustCommand: 'extract_office_metadata',
    },

    // ── PDF ──
    {
        name: 'pdf:rich',
        version: 1,
        fileTypes: ['PDF'],
        producedFields: ['title', 'author', 'pageCount'],
        rustCommand: 'extract_pdf_metadata',
    },

    // ── Image ──
    {
        name: 'image:rich',
        version: 1,
        fileTypes: ['JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'EXR', 'HDR'],
        producedFields: [
            'resolution', 'colorProfile', 'bitDepth', 'renderSoftware',
            'cameraInfo', 'dateTaken', 'gpsLat', 'gpsLon',
            'isoSpeed', 'focalLength', 'exposureTime', 'isRenderByExif',
        ],
        rustCommand: 'extract_image_metadata',
    },

    // ── Video ──
    {
        name: 'video:rich',
        version: 1,
        fileTypes: ['MP4'],
        producedFields: ['videoDuration', 'videoCodec', 'videoWidth', 'videoHeight'],
        rustCommand: 'extract_video_metadata',
    },

    // ── Text ──
    {
        name: 'text:rich',
        version: 1,
        fileTypes: ['TXT', 'CSV', 'RTF'],
        producedFields: ['lineCount', 'wordCount', 'charCount', 'csvColumnCount', 'csvRowCount'],
        rustCommand: 'extract_text_metadata',
    },

    // ── PSD ──
    {
        name: 'psd:dimensions',
        version: 1,
        fileTypes: ['PSD'],
        producedFields: ['resolution'],
        rustCommand: 'get_image_dimensions',
    },

    // ── BAK ──
    {
        name: 'bak:source_detect',
        version: 1,
        fileTypes: ['BAK'],
        producedFields: ['bakSourceType', 'backupOfPath'],
        rustCommand: 'detect_bak_source_type',
    },

    // ── Thumbnail (format-agnostik: çıkarma desteği olan tüm formatlar) ──
    {
        name: 'thumbnail',
        version: 1,
        fileTypes: [
            'TGA', 'TIFF', 'PSD', 'DWG', 'MAX',
            'DOC', 'XLS', 'PPT', 'PDF',
            'TXT', 'CSV', 'RTF', 'EPS', 'SKP', 'RVT',
        ],
        producedFields: ['thumbnailUrl'],
    },

    // ── Dominant Colors ──
    {
        name: 'colors:dominant',
        version: 1,
        fileTypes: ['JPEG', 'PNG', 'BMP', 'TIFF', 'TGA'],
        producedFields: ['colorPalette'],
        rustCommand: 'get_dominant_colors',
    },

    // ── Content Hash (tüm formatlar için geçerli ama registry'de sadece ana tipler) ──
    {
        name: 'hash:content',
        version: 1,
        fileTypes: [
            'DWG', 'MAX', 'SKP', 'RVT', 'IFC', 'PDF',
            'XLS', 'XLSX', 'DOC', 'DOCX', 'PPT', 'PPTX',
            'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'PSD',
            'EXR', 'HDR', 'EPS', 'MP4', 'TXT', 'CSV', 'RTF',
            'BAK', 'DWF', 'FBX', 'OBJ', '3DS', 'STL', 'PLY',
            'GLTF', 'GLB', 'AI', 'INDD', 'MTL', 'SAP2K',
        ],
        producedFields: ['contentHash'],
        rustCommand: 'compute_file_hash',
    },

    // ── OS File Metadata (tüm formatlar) ──
    {
        name: 'core:file_dates',
        version: 1,
        fileTypes: [
            'DWG', 'MAX', 'SKP', 'RVT', 'IFC', 'PDF',
            'XLS', 'XLSX', 'DOC', 'DOCX', 'PPT', 'PPTX',
            'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'PSD',
            'EXR', 'HDR', 'EPS', 'MP4', 'TXT', 'CSV', 'RTF',
            'BAK', 'DWF', 'FBX', 'OBJ', '3DS', 'STL', 'PLY',
            'GLTF', 'GLB', 'AI', 'INDD', 'MTL', 'SAP2K',
        ],
        producedFields: ['createdAt', 'modifiedAt'],
        rustCommand: 'get_file_metadata',
    },
];

// ── Precomputed lookup (module load) ──

const _byFileType = new Map<string, ExtractorDef[]>();
for (const ext of REGISTRY) {
    for (const ft of ext.fileTypes) {
        const arr = _byFileType.get(ft) || [];
        arr.push(ext);
        _byFileType.set(ft, arr);
    }
}

// ── Public API ──

/** Verilen dosya tipi için geçerli tüm çıkarıcıları döndürür. */
export function getExtractorsForFileType(fileType: string): readonly ExtractorDef[] {
    return _byFileType.get(fileType) ?? [];
}

/**
 * Dosya tipi için bileşik versiyon numarası.
 * Her çıkarıcının versiyonlarının toplamı — yeni çıkarıcı eklenince veya
 * mevcut bump yapılınca bu değer otomatik artar.
 */
export function computeCompositeVersion(fileType: string): number {
    const extractors = getExtractorsForFileType(fileType);
    if (extractors.length === 0) return 1; // Registry'de olmayan tipler için varsayılan
    return extractors.reduce((sum, e) => sum + e.version, 0);
}

/**
 * Asset üzerinde eksik/eski çıkarıcıları tespit eder.
 * @param fileType  Dosya tipi (DWG, MAX vb.)
 * @param applied   Asset'te kayıtlı uygulanmış çıkarıcılar (name → version)
 * @returns         Çalıştırılması gereken çıkarıcı listesi
 */
export function getMissingExtractors(
    fileType: string,
    applied: Record<string, number> | undefined,
): ExtractorDef[] {
    const all = getExtractorsForFileType(fileType);
    if (all.length === 0) return [];
    if (!applied) return [...all]; // Hiç kayıt yoksa hepsi eksik

    return all.filter(ext => {
        const appliedVer = applied[ext.name];
        return appliedVer === undefined || appliedVer < ext.version;
    });
}

/**
 * Tam tarama sonunda kaydedilecek "uygulanmış çıkarıcılar" kaydını oluşturur.
 * Her çıkarıcının adı → version eşlemesi.
 */
export function buildAppliedRecord(fileType: string): Record<string, number> {
    const record: Record<string, number> = {};
    for (const ext of getExtractorsForFileType(fileType)) {
        record[ext.name] = ext.version;
    }
    return record;
}

/**
 * İlk deployment migration için: mevcut v1 çıkarıcıları "zaten uygulanmış"
 * kabul eden baseline kayıt. Yalnızca ilk seferlik migration'da kullanılır.
 */
export function buildBaselineRecord(fileType: string): Record<string, number> | null {
    const extractors = getExtractorsForFileType(fileType);
    if (extractors.length === 0) return null;
    const record: Record<string, number> = {};
    for (const ext of extractors) {
        record[ext.name] = ext.version;
    }
    return record;
}

/**
 * Tüm dosya tiplerinin bileşik versiyonlarını otomatik hesaplar.
 * fileScanner.ts'deki SCANNER_VERSIONS'ı besler.
 */
export function computeAllVersions(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const ft of _byFileType.keys()) {
        result[ft] = computeCompositeVersion(ft);
    }
    return result;
}

/**
 * Registry'deki tüm dosya tiplerini sıralı olarak döndürür.
 * UI tablosu için — hardcoded liste yerine buradan alınır.
 */
export function getAllRegisteredFileTypes(): string[] {
    // Öncelik sırasına göre sırala: CAD → BIM → Office → Image → Video → Text → Diğer
    const priority: Record<string, number> = {
        DWG: 1, MAX: 2, SKP: 3, RVT: 4, IFC: 5,
        PDF: 10, DOC: 11, DOCX: 12, XLS: 13, XLSX: 14, PPT: 15, PPTX: 16,
        JPEG: 20, PNG: 21, BMP: 22, WEBP: 23, TIFF: 24, TGA: 25, PSD: 26, EXR: 27, HDR: 28, EPS: 29,
        MP4: 30,
        TXT: 40, CSV: 41, RTF: 42, SAP2K: 43, MTL: 44,
        BAK: 50, DWF: 51,
        FBX: 60, OBJ: 61, '3DS': 62, STL: 63, PLY: 64, GLTF: 65, GLB: 66,
        AI: 70, INDD: 71,
    };
    return [..._byFileType.keys()].sort((a, b) => (priority[a] ?? 99) - (priority[b] ?? 99));
}
