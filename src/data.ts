import type { Asset, FacetKey } from './types';
import i18n from './i18n';

/* ── Demo / Mock Data ── */
// Bu veriler, uygulamanın çalışır görünmesi için kullanılır.
// İlerleyen fazlarda SQLite+AI gerçek indeksleme verileriyle değiştirilecektir.

export const MOCK_ASSETS: Asset[] = [
    {
        id: '1',
        fileName: 'ANA_CEPHE_DETAY.dwg',
        filePath: 'C:/Projeler/OtelKonsept/Cizimler/ANA_CEPHE_DETAY.dwg',
        fileSize: 4_850_000,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2025-09-14T10:30:00',
        modifiedAt: '2025-11-02T16:45:00',
        projectName: 'Sapphire Otel Konsept',
        projectPhase: 'Ruhsat',
        materialGroup: 'Cam',
        colorTheme: 'Soğuk Tonlar',
        architecturalStyle: 'Modern',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Giydirme Cephe', confidence: 0.94, source: 'clip' },
            { label: 'Cam Panel', confidence: 0.88, source: 'metadata' },
            { label: 'Curtain Wall', confidence: 0.91, source: 'nlp' },
        ],
        colorPalette: [
            { hex: '#2c3e50', percentage: 35, name: 'Koyu Gri' },
            { hex: '#85c1e9', percentage: 25, name: 'Açık Mavi' },
            { hex: '#ecf0f1', percentage: 40, name: 'Beyaz' },
        ],
        metadata: {
            layers: ['A-WALL', 'A-GLAZ', 'A-DOOR', 'S-GRID', 'A-ANNO'],
            blockCount: 142,
        },
        omniclassCode: '21-02 20 00',
        isIndexed: true,
        hash: 'a1b2c3d4',
    },
    {
        id: '2',
        fileName: 'LOBBY_RENDER_FINAL.psd',
        filePath: 'C:/Projeler/OtelKonsept/Renderlar/LOBBY_RENDER_FINAL.psd',
        fileSize: 285_000_000,
        fileType: 'PSD',
        category: 'Render',
        createdAt: '2025-10-20T09:00:00',
        modifiedAt: '2025-12-01T14:20:00',
        projectName: 'Sapphire Otel Konsept',
        projectPhase: 'Konsept',
        materialGroup: 'Taş',
        colorTheme: 'Sıcak Tonlar',
        architecturalStyle: 'Modern',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Mermer Zemin', confidence: 0.96, source: 'clip' },
            { label: 'Lobi Alanı', confidence: 0.92, source: 'clip' },
            { label: 'Otel', confidence: 0.89, source: 'nlp' },
            { label: 'Premium Finish', confidence: 0.85, source: 'clip' },
        ],
        colorPalette: [
            { hex: '#8d6e63', percentage: 30, name: 'Kahverengi' },
            { hex: '#d4a373', percentage: 25, name: 'Altın' },
            { hex: '#fefae0', percentage: 30, name: 'Krem' },
            { hex: '#283618', percentage: 15, name: 'Koyu Yeşil' },
        ],
        metadata: {
            resolution: { width: 4096, height: 2160 },
            colorProfile: 'sRGB',
            channels: 4,
        },
        isIndexed: true,
        hash: 'e5f6g7h8',
    },
    {
        id: '3',
        fileName: 'YAPI_MODELI_v3.rvt',
        filePath: 'C:/Projeler/KonutBlok_A/BIM/YAPI_MODELI_v3.rvt',
        fileSize: 520_000_000,
        fileType: 'RVT',
        category: '3D Model',
        createdAt: '2025-06-10T08:15:00',
        modifiedAt: '2026-01-15T11:30:00',
        projectName: 'Yeşilvadi Konut Blok A',
        projectPhase: 'Uygulama',
        materialGroup: 'Beton',
        colorTheme: 'Monokrom',
        architecturalStyle: 'Minimalist',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Betonarme', confidence: 0.97, source: 'metadata' },
            { label: 'Konut', confidence: 0.93, source: 'nlp' },
            { label: 'C30 Beton', confidence: 0.88, source: 'nlp' },
            { label: 'LOD 400', confidence: 0.90, source: 'metadata' },
        ],
        colorPalette: [
            { hex: '#6b7280', percentage: 50, name: 'Gri' },
            { hex: '#374151', percentage: 30, name: 'Koyu Gri' },
            { hex: '#d1d5db', percentage: 20, name: 'Açık Gri' },
        ],
        metadata: {
            roomNames: ['Salon', 'Yatak Odası 1', 'Yatak Odası 2', 'Mutfak', 'Banyo', 'WC', 'Antre'],
            materialList: ['C30 Beton', 'Q188 Hasır Çelik', 'XPS Yalıtım', 'Alçı Sıva'],
        },
        omniclassCode: '22-02 10 00',
        isIndexed: true,
        hash: 'i9j0k1l2',
    },
    {
        id: '4',
        fileName: 'SAHNE_DIS_MEKAN.max',
        filePath: 'C:/Projeler/VillaGol/3DMax/SAHNE_DIS_MEKAN.max',
        fileSize: 180_000_000,
        fileType: 'MAX',
        category: '3D Model',
        createdAt: '2025-08-05T11:00:00',
        modifiedAt: '2025-10-22T17:50:00',
        projectName: 'Göl Villa Projesi',
        projectPhase: 'Konsept',
        materialGroup: 'Ahşap',
        colorTheme: 'Toprak Tonları',
        architecturalStyle: 'Organik',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Villa', confidence: 0.95, source: 'clip' },
            { label: 'Doğal Ahşap', confidence: 0.92, source: 'clip' },
            { label: 'V-Ray', confidence: 0.99, source: 'metadata' },
            { label: 'Peyzaj', confidence: 0.87, source: 'clip' },
        ],
        colorPalette: [
            { hex: '#4a3728', percentage: 30, name: 'Koyu Ahşap' },
            { hex: '#7c9a5e', percentage: 25, name: 'Yeşil' },
            { hex: '#87ceeb', percentage: 20, name: 'Gökyüzü' },
            { hex: '#c4956a', percentage: 25, name: 'Ahşap' },
        ],
        metadata: {
            renderEngine: 'V-Ray 6.1',
            textureCount: 87,
        },
        isIndexed: true,
        hash: 'm3n4o5p6',
    },
    {
        id: '5',
        fileName: 'TEKNIK_SARTNAME_MEKANIK.pdf',
        filePath: 'C:/Projeler/KonutBlok_A/Dokumanlar/TEKNIK_SARTNAME_MEKANIK.pdf',
        fileSize: 12_500_000,
        fileType: 'PDF',
        category: 'Döküman',
        createdAt: '2025-11-01T09:30:00',
        modifiedAt: '2025-12-18T10:00:00',
        projectName: 'Yeşilvadi Konut Blok A',
        projectPhase: 'Uygulama',
        materialGroup: 'Metal',
        colorTheme: 'Monokrom',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Mekanik Tesisat', confidence: 0.96, source: 'nlp' },
            { label: 'HVAC', confidence: 0.91, source: 'nlp' },
            { label: 'Teknik Şartname', confidence: 0.98, source: 'nlp' },
        ],
        colorPalette: [],
        metadata: {
            pageCount: 245,
        },
        omniclassCode: '23-27 00 00',
        isIndexed: true,
        hash: 'q7r8s9t0',
    },
    {
        id: '6',
        fileName: 'DIS_CEPHE_RENDER_01.tga',
        filePath: 'C:/Projeler/VillaGol/Renderlar/DIS_CEPHE_RENDER_01.tga',
        fileSize: 37_000_000,
        fileType: 'TGA',
        category: 'Render',
        createdAt: '2025-10-10T14:00:00',
        modifiedAt: '2025-10-10T14:00:00',
        projectName: 'Göl Villa Projesi',
        projectPhase: 'Konsept',
        materialGroup: 'Ahşap',
        colorTheme: 'Toprak Tonları',
        architecturalStyle: 'Organik',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Dış Cephe', confidence: 0.97, source: 'clip' },
            { label: 'Ahşap Kaplama', confidence: 0.93, source: 'clip' },
            { label: 'Doğa ile Uyum', confidence: 0.85, source: 'clip' },
        ],
        colorPalette: [
            { hex: '#3e2723', percentage: 20, name: 'Koyu Kahve' },
            { hex: '#8bc34a', percentage: 30, name: 'Yeşil' },
            { hex: '#b0bec5', percentage: 20, name: 'Gri' },
            { hex: '#e8d5b7', percentage: 30, name: 'Bej' },
        ],
        metadata: {
            resolution: { width: 3840, height: 2160 },
            channels: 4,
        },
        isIndexed: true,
        hash: 'u1v2w3x4',
    },
    {
        id: '7',
        fileName: 'ZEMIN_KAT_PLAN.dwg',
        filePath: 'C:/Projeler/OtelKonsept/Cizimler/ZEMIN_KAT_PLAN.dwg',
        fileSize: 3_200_000,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2025-07-20T13:00:00',
        modifiedAt: '2025-09-30T09:15:00',
        projectName: 'Sapphire Otel Konsept',
        projectPhase: 'Avan',
        materialGroup: 'Beton',
        colorTheme: 'Monokrom',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Kat Planı', confidence: 0.98, source: 'metadata' },
            { label: 'Zemin Kat', confidence: 0.95, source: 'nlp' },
            { label: 'Otel', confidence: 0.88, source: 'nlp' },
        ],
        colorPalette: [
            { hex: '#1a1a2e', percentage: 60, name: 'Siyah' },
            { hex: '#e0e0e0', percentage: 40, name: 'Beyaz' },
        ],
        metadata: {
            layers: ['A-WALL', 'A-DOOR', 'A-FURN', 'A-DIMS', 'A-GRID'],
            blockCount: 98,
        },
        omniclassCode: '21-02 10 00',
        isIndexed: true,
        hash: 'y5z6a7b8',
    },
    {
        id: '8',
        fileName: 'MALZEME_DOKU_MERMER.tiff',
        filePath: 'C:/Projeler/Kutuphane/Dokular/MALZEME_DOKU_MERMER.tiff',
        fileSize: 52_000_000,
        fileType: 'TIFF',
        category: 'Doku',
        createdAt: '2025-03-15T10:00:00',
        modifiedAt: '2025-03-15T10:00:00',
        projectName: 'Malzeme Kütüphanesi',
        projectPhase: 'Konsept',
        materialGroup: 'Taş',
        colorTheme: 'Sıcak Tonlar',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Mermer', confidence: 0.99, source: 'clip' },
            { label: 'Doku', confidence: 0.97, source: 'metadata' },
            { label: 'Doğal Taş', confidence: 0.91, source: 'clip' },
        ],
        colorPalette: [
            { hex: '#f5f0e8', percentage: 45, name: 'Krem' },
            { hex: '#c8b89a', percentage: 35, name: 'Bej' },
            { hex: '#8d7b68', percentage: 20, name: 'Kahve Damar' },
        ],
        metadata: {
            resolution: { width: 4096, height: 4096 },
            channels: 3,
        },
        isIndexed: true,
        hash: 'c9d0e1f2',
    },
    {
        id: '9',
        fileName: 'IHALE_DOSYASI_TESISAT.doc',
        filePath: 'C:/Projeler/KonutBlok_A/Dokumanlar/IHALE_DOSYASI_TESISAT.doc',
        fileSize: 8_700_000,
        fileType: 'DOC',
        category: 'Döküman',
        createdAt: '2025-12-05T08:00:00',
        modifiedAt: '2026-01-10T15:40:00',
        projectName: 'Yeşilvadi Konut Blok A',
        projectPhase: 'Uygulama',
        thumbnailUrl: '',
        aiTags: [
            { label: 'İhale', confidence: 0.96, source: 'nlp' },
            { label: 'Tesisat İşleri', confidence: 0.93, source: 'nlp' },
            { label: 'Maliyet Analizi', confidence: 0.80, source: 'nlp' },
        ],
        colorPalette: [],
        metadata: {
            pageCount: 128,
        },
        omniclassCode: '23-00 00 00',
        isIndexed: true,
        hash: 'g3h4i5j6',
    },
    {
        id: '10',
        fileName: 'IC_MEKAN_YATAK_ODASI.jpeg',
        filePath: 'C:/Projeler/VillaGol/Renderlar/IC_MEKAN_YATAK_ODASI.jpeg',
        fileSize: 6_200_000,
        fileType: 'JPEG',
        category: 'Render',
        createdAt: '2025-11-15T16:20:00',
        modifiedAt: '2025-11-15T16:20:00',
        projectName: 'Göl Villa Projesi',
        projectPhase: 'Konsept',
        materialGroup: 'Ahşap',
        colorTheme: 'Pastel',
        architecturalStyle: 'Minimalist',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Yatak Odası', confidence: 0.97, source: 'clip' },
            { label: 'İç Mekan', confidence: 0.95, source: 'clip' },
            { label: 'Minimal Mobilya', confidence: 0.88, source: 'clip' },
            { label: 'Doğal Işık', confidence: 0.84, source: 'clip' },
        ],
        colorPalette: [
            { hex: '#f8f4ef', percentage: 40, name: 'Beyaz' },
            { hex: '#c9b99a', percentage: 25, name: 'Bej' },
            { hex: '#a8d8ea', percentage: 15, name: 'Pastel Mavi' },
            { hex: '#d4a5a5', percentage: 20, name: 'Pastel Pembe' },
        ],
        metadata: {
            resolution: { width: 3000, height: 2000 },
            channels: 3,
        },
        isIndexed: true,
        hash: 'k7l8m9n0',
    },
    {
        id: '11',
        fileName: 'CEPHE_SISTEMI_DETAY.dwg',
        filePath: 'C:/Projeler/OtelKonsept/Cizimler/CEPHE_SISTEMI_DETAY.dwg',
        fileSize: 5_100_000,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2025-08-25T10:00:00',
        modifiedAt: '2025-10-15T12:30:00',
        projectName: 'Sapphire Otel Konsept',
        projectPhase: 'Uygulama',
        materialGroup: 'Metal',
        colorTheme: 'Soğuk Tonlar',
        architecturalStyle: 'Modern',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Cephe Detayı', confidence: 0.96, source: 'metadata' },
            { label: 'Alüminyum Profil', confidence: 0.89, source: 'nlp' },
            { label: 'Isı Yalıtımı', confidence: 0.82, source: 'nlp' },
        ],
        colorPalette: [
            { hex: '#37474f', percentage: 45, name: 'Antrasit' },
            { hex: '#90a4ae', percentage: 30, name: 'Açık Gri' },
            { hex: '#eceff1', percentage: 25, name: 'Beyaz' },
        ],
        metadata: {
            layers: ['A-WALL', 'A-GLAZ', 'A-INSUL', 'A-METAL', 'A-ANNO', 'A-DIMS'],
            blockCount: 67,
        },
        omniclassCode: '21-02 20 00',
        isIndexed: true,
        hash: 'o1p2q3r4',
    },
    {
        id: '12',
        fileName: 'PEYZAJ_GENEL_PLAN.dwg',
        filePath: 'C:/Projeler/VillaGol/Cizimler/PEYZAJ_GENEL_PLAN.dwg',
        fileSize: 7_300_000,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2025-09-01T09:00:00',
        modifiedAt: '2025-12-08T14:15:00',
        projectName: 'Göl Villa Projesi',
        projectPhase: 'Avan',
        materialGroup: 'Taş',
        colorTheme: 'Toprak Tonları',
        thumbnailUrl: '',
        aiTags: [
            { label: 'Peyzaj', confidence: 0.98, source: 'metadata' },
            { label: 'Bahçe Düzenlemesi', confidence: 0.90, source: 'nlp' },
            { label: 'Doğal Taş Yürüyüş Yolu', confidence: 0.83, source: 'clip' },
        ],
        colorPalette: [
            { hex: '#2e7d32', percentage: 35, name: 'Koyu Yeşil' },
            { hex: '#795548', percentage: 30, name: 'Toprak' },
            { hex: '#90caf9', percentage: 20, name: 'Su Mavisi' },
            { hex: '#fff8e1', percentage: 15, name: 'Krem' },
        ],
        metadata: {
            layers: ['L-PLNT', 'L-WALK', 'L-WATER', 'L-FURN', 'L-BLDG', 'L-TOPO'],
            blockCount: 215,
        },
        isIndexed: true,
        hash: 's5t6u7v8',
    },
];

/* ── Facet Configuration ── */
export const FACET_GROUPS: Array<{ key: FacetKey; label: string; options: string[]; optionLabels?: Record<string, string> }> = [
    {
        key: 'projectPhase',
        label: i18n.t('facets.projectPhase'),
        options: ['Konsept', 'Avan', 'Ruhsat', 'Uygulama'],
    },
    {
        key: 'approvalStatus',
        label: i18n.t('facets.approvalStatus'),
        options: ['draft', 'review', 'approved', 'rejected'],
        optionLabels: {
            draft: i18n.t('facets.approvalStatus.draft'),
            review: i18n.t('facets.approvalStatus.review'),
            approved: i18n.t('facets.approvalStatus.approved'),
            rejected: i18n.t('facets.approvalStatus.rejected'),
        },
    },
    {
        key: 'category',
        label: i18n.t('facets.category'),
        options: ['2D Çizim', '3D Model', 'Döküman', 'Render', 'Fotoğraf', 'Doku', 'Video'],
    },
    {
        key: 'materialGroup',
        label: i18n.t('facets.materialGroup'),
        options: ['Beton', 'Cam', 'Metal', 'Ahşap', 'Taş', 'Seramik', 'Kompozit'],
    },
    {
        key: 'colorTheme',
        label: i18n.t('facets.colorTheme'),
        options: ['Sıcak Tonlar', 'Soğuk Tonlar', 'Monokrom', 'Toprak Tonları', 'Pastel'],
    },
    {
        key: 'architecturalStyle',
        label: i18n.t('facets.architecturalStyle'),
        options: ['Modern', 'Minimalist', 'Endüstriyel', 'Brütalist', 'Neoklasik', 'Organik'],
    },
];

/* ── Helper: format file size ── */
export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

/* ── Helper: format date ── */
export function formatDate(iso: string): string {
    const d = new Date(iso);
    const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ── Helper: type badge color map ── */
export function getTypeBadgeStyle(fileType: string): React.CSSProperties {
    const map: Record<string, { bg: string; color: string }> = {
        // AutoCAD / 2D
        DWG: { bg: 'rgba(239,68,68,0.15)', color: '#f87171' },
        DWF: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5' },
        DGN: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5' },
        SVG: { bg: 'rgba(239,68,68,0.10)', color: '#fca5a5' },
        VWX: { bg: 'rgba(239,68,68,0.10)', color: '#fca5a5' },
        // BIM
        RVT: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
        IFC: { bg: 'rgba(20,184,166,0.15)', color: '#2dd4bf' },
        PLN: { bg: 'rgba(59,130,246,0.12)', color: '#93c5fd' },
        NWD: { bg: 'rgba(59,130,246,0.10)', color: '#93c5fd' },
        // 3D
        MAX: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
        SKP: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
        '3DM': { bg: 'rgba(168,85,247,0.12)', color: '#d8b4fe' },
        BLEND: { bg: 'rgba(168,85,247,0.12)', color: '#d8b4fe' },
        C4D: { bg: 'rgba(168,85,247,0.10)', color: '#d8b4fe' },
        OBJ: { bg: 'rgba(99,102,241,0.15)', color: '#a5b4fc' },
        FBX: { bg: 'rgba(99,102,241,0.12)', color: '#a5b4fc' },
        GLB: { bg: 'rgba(99,102,241,0.10)', color: '#a5b4fc' },
        STL: { bg: 'rgba(99,102,241,0.10)', color: '#a5b4fc' },
        DAE: { bg: 'rgba(99,102,241,0.10)', color: '#a5b4fc' },
        STEP: { bg: 'rgba(99,102,241,0.10)', color: '#a5b4fc' },
        E57: { bg: 'rgba(6,182,212,0.15)', color: '#67e8f9' },
        // Görsel / Render
        PSD: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
        JPEG: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
        PNG: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
        TGA: { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
        TIFF: { bg: 'rgba(236,72,153,0.15)', color: '#f472b6' },
        BMP: { bg: 'rgba(245,158,11,0.10)', color: '#fbbf24' },
        WEBP: { bg: 'rgba(34,197,94,0.10)', color: '#4ade80' },
        AI: { bg: 'rgba(245,158,11,0.15)', color: '#fb923c' },
        EPS: { bg: 'rgba(245,158,11,0.10)', color: '#fb923c' },
        EXR: { bg: 'rgba(251,191,36,0.20)', color: '#fde68a' },
        HDR: { bg: 'rgba(251,191,36,0.15)', color: '#fde68a' },
        // Döküman
        PDF: { bg: 'rgba(239,68,68,0.15)', color: '#f87171' },
        DOC: { bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
        XLS: { bg: 'rgba(34,197,94,0.15)', color: '#4ade80' },
        PPT: { bg: 'rgba(249,115,22,0.15)', color: '#fb923c' },
        TXT: { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' },
        CSV: { bg: 'rgba(34,197,94,0.10)', color: '#86efac' },
        RTF: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8' },
        // Video
        MP4: { bg: 'rgba(239,68,68,0.20)', color: '#f87171' },
        // Yapısal Analiz (CSi)
        SAP2K: { bg: 'rgba(168,85,247,0.15)', color: '#c084fc' },
    };
    const style = map[fileType] || { bg: 'rgba(148,163,184,0.15)', color: '#94a3b8' };
    return { background: style.bg, color: style.color };
}

/* ── Helper: category icon mapping ── */
export function getCategoryIcon(category: string): string {
    const map: Record<string, string> = {
        '2D Çizim': '📐',
        '3D Model': '🧊',
        'Döküman': '📄',
        'Render': '🖼️',
        'Fotoğraf': '📷',
        'Doku': '🎨',
        'Video': '🎬',
    };
    return map[category] || '📁';
}
