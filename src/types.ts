/* ── Archivist Pro: Type Definitions ── */

export type AssetType =
    // Mevcut formatlar
    | 'DWG' | 'RVT' | 'MAX' | 'PSD' | 'TGA' | 'TIFF' | 'PDF' | 'DOC' | 'TXT' | 'JPEG' | 'PNG' | 'IFC'
    // 3D / CAD / BIM
    | '3DS'   // 3D Studio (legacy DOS format)
    | 'SKP'   // SketchUp
    | '3DM'   // Rhino
    | 'OBJ'   // Wavefront Object
    | 'MTL'   // Wavefront Material (OBJ ile birlikte)
    | 'FBX'   // Autodesk FBX
    | 'C4D'   // Cinema 4D
    | 'BLEND' // Blender
    | 'GLB'   // glTF Binary / gltf
    | 'STL'   // Stereolithography
    | 'DAE'   // Collada
    | 'NWD'   // Navisworks (nwd/nwc/nwf)
    | 'DGN'   // MicroStation
    | 'DXF'   // AutoCAD DXF (Drawing Exchange Format)
    | 'DWF'   // AutoCAD DWF/DWFx
    | 'STEP'  // STEP (stp/step)
    | 'PLN'   // ArchiCAD
    | 'VWX'   // Vectorworks
    | 'E57'   // Point Cloud
    // Görsel / Render
    | 'BMP' | 'WEBP' | 'SVG' | 'AI' | 'EPS' | 'EXR' | 'HDR'
    // Döküman
    | 'XLS' | 'PPT' | 'CSV' | 'RTF'
    // Video
    | 'MP4'
    // Yapısal Analiz
    | 'SAP2K'   // SAP2000 / ETABS (CSi)
    // Yedek
    | 'BAK';    // Yedek dosyalar (.bak, .~bak, .dwl, .dwl2)

export type ProjectPhase = 'Konsept' | 'Avan' | 'Ruhsat' | 'Uygulama';

export type ApprovalStatus = 'draft' | 'review' | 'approved' | 'rejected';

export type RelationType = 'pdf_export' | 'render_of' | 'version_of' | 'project_group';

export interface AssetRelation {
    id: string;           // `${sourceId}:${targetId}:${relationType}`
    sourceId: string;
    targetId: string;
    relationType: RelationType;
    notes?: string;
    createdAt: string;
    createdBy: 'user' | 'auto';
}

export type MaterialGroup = 'Beton' | 'Cam' | 'Metal' | 'Ahşap' | 'Taş' | 'Seramik' | 'Kompozit';

export type ColorTheme = 'Sıcak Tonlar' | 'Soğuk Tonlar' | 'Monokrom' | 'Toprak Tonları' | 'Pastel';

export type CategoryType = '2D Çizim' | '3D Model' | 'Döküman' | 'Render' | 'Fotoğraf' | 'Doku' | 'Video';

export type ArchitecturalStyle = 'Modern' | 'Minimalist' | 'Endüstriyel' | 'Brütalist' | 'Neoklasik' | 'Organik';

export type ViewMode = 'explorer' | 'dashboard' | 'technical' | 'folders';

export type SortBy = 'name' | 'date' | 'modified' | 'type' | 'size' | 'aiScore';
export type SortOrder = 'asc' | 'desc';

export interface AITag {
    label: string;
    confidence: number; // 0-1
    source: 'clip' | 'nlp' | 'metadata' | 'color';
}

export interface ColorPalette {
    hex: string;
    percentage: number;
    ralCode?: string;
    name?: string;
}

export interface AssetMetadata {
    layers?: string[];
    blockCount?: number;
    renderEngine?: string;
    textureCount?: number;
    roomNames?: string[];
    materialList?: string[];
    pageCount?: number;
    title?: string;
    author?: string;
    subject?: string;
    sheetNames?: string[];
    components?: string[];
    resolution?: { width: number; height: number };
    colorProfile?: string;
    bitDepth?: number;
    dateTaken?: string;
    gpsLat?: number;
    gpsLon?: number;
    isoSpeed?: number;
    focalLength?: string;
    exposureTime?: string;
    channels?: number;
    videoDuration?: string;
    videoCodec?: string;
    videoWidth?: number;
    videoHeight?: number;
    lineCount?: number;
    wordCount?: number;
    charCount?: number;
    csvColumnCount?: number;
    csvRowCount?: number;
    rvtStreamCount?: number;
    maxVersion?: string;
    /** Thumbnail çıkarılamadıysa sebep kodu (i18n key olarak kullanilir):
     *  file_too_big | no_preview_in_file | parse_failed | format_unsupported */
    thumbnailMissingReason?: string;
    /** 3ds Max dosyasından çıkarılan katman isimleri */
    maxLayers?: string[];
    /** 3ds Max dosyasından çıkarılan obje isimleri */
    maxObjects?: string[];
    /** Sürüm dönüştürme bilgisi: orijinal dosya yolu ve sürümü */
    convertedFrom?: { path: string; version: string };
    skpVersion?: string;
    dwgVersion?: string;
    dwgCreatedAt?: string;
    bakSourceType?: string;
    backupOfPath?: string;
    // DWG binary metadata (Rust extraction)
    dwgLayers?: string[];
    dwgBlockNames?: string[];
    dwgTextContents?: string[];
    dwgXrefNames?: string[];
    dwgImageRefs?: string[];
    dwgOleObjects?: string[];
    dwgProperties?: {
        title?: string;
        subject?: string;
        author?: string;
        keywords?: string;
        comments?: string;
        lastSavedBy?: string;
    };
    dwgEstimatedScale?: string;
    dwgUnitType?: string;
    // DWG AI çizim analizi
    dwgDrawingType?: string;
    dwgDescription?: string;
    dwgElements?: string[];
    dwgSpaces?: string[];
    dwgKeywords?: string[];
    dwgDomainTerms?: string[];
    // AI Classification
    aiClassification?: {
        type: 'Fotoğraf' | 'Render';
        confidence: number;
        reason: string;
    };
    // Rendering & Camera
    renderSoftware?: string;
    cameraInfo?: string;
    isRenderByExif?: boolean;
    // RVT (Revit) metadata
    rvtVersion?: string;
    rvtBuild?: string;
    rvtProjectName?: string;
    rvtCentralPath?: string;
    rvtWorkshared?: boolean;
    rvtFormat?: string;
    rvtStoreyCount?: number;
    rvtStoreyNames?: string[];
    rvtSpaceCount?: number;
    // IFC metadata
    ifcSchema?: string;
    ifcOriginatingSystem?: string;
    ifcProjectName?: string;
    ifcBuildingName?: string;
    ifcTotalEntities?: number;
    ifcEntityCounts?: Array<{ entity_type: string; count: number }>;
    ifcStoreyCount?: number;
    ifcStoreyNames?: string[];
    ifcSpaceCount?: number;
    [key: string]: unknown; // For Record<string, unknown> compatibility
}

export interface Asset {
    id: string;
    fileName: string;
    filePath: string;
    fileSize: number;          // bytes
    fileType: AssetType;
    category: CategoryType;
    createdAt: string;
    modifiedAt: string;
    projectName: string;
    projectPhase: ProjectPhase;
    materialGroup?: MaterialGroup;
    colorTheme?: ColorTheme;
    architecturalStyle?: ArchitecturalStyle;
    thumbnailUrl?: string;
    aiTags: AITag[];
    colorPalette: ColorPalette[];
    metadata: AssetMetadata;
    omniclassCode?: string;
    /** Kullanıcı tanımlı etiketler (AI tag'lerden ayrı) */
    userTags?: Array<{ id: number; name: string; color: string }>;
    isIndexed: boolean;
    hash?: string;
    /** Dosya içerik hash'i (SHA-256, streaming) — birebir kopya tespiti için */
    contentHash?: string;
    phash?: string;
    /** Ham metadata — formatından çıkarılabilecek her şey (JSON) */
    rawMetadata?: Record<string, unknown>;
    /** Metadata şema versiyonu — yeniden parse için */
    metadataVersion?: number;
    /** Hangi çıkarıcıların (extractor) hangi versiyonda uygulandığını kaydeder */
    appliedExtractors?: Record<string, number>;
    /** Metadata çıkarma zamanı (ISO) */
    extractedAt?: string;
    /** Tarama anındaki dosya sistemi mtime'ı (unix saniye) — güncellik kontrolü için */
    fsMtime?: number;
    /** Müşteri adı (kullanıcı tanımlı) */
    clientName?: string;
    /** Onay durumu (kullanıcı tanımlı) */
    approvalStatus?: ApprovalStatus;
    /** Red sebebi — rejected durumundayken admin tarafından girilir */
    rejectionReason?: string;
    /** Versiyon etiketi — v1.0, Rev-A vb. (kullanıcı tanımlı) */
    versionLabel?: string;
    /** Teslim tarihi ISO (kullanıcı tanımlı) */
    deadline?: string;
    /** AI sohbetten hariç tutulmuş mu (admin tarafından) */
    ragExcluded?: boolean;
}

export interface TrashItem extends Asset {
    deletedAt: string;
}

export type FacetKey = 'category' | 'projectPhase' | 'materialGroup' | 'colorTheme' | 'architecturalStyle' | 'approvalStatus';

export interface FacetGroup {
    key: FacetKey;
    label: string;
    options: FacetOption[];
}

export interface FacetOption {
    value: string;
    label: string;
    count: number;
}

export interface SearchResult {
    asset: Asset;
    score: number;  // cosine similarity
}

export interface IndexingStatus {
    totalFiles: number;
    indexedFiles: number;
    currentFile?: string;
    isRunning: boolean;
    startedAt?: string;
    errors: number;
}
