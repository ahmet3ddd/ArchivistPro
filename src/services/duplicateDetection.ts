/**
 * Kopya & Benzer Dosya Tespiti
 *
 * 4 mod:
 *  1. Birebir Kopya — hash GROUP BY
 *  2. Aynı İsim    — fileName GROUP BY
 *  3. Görsel Benzerlik — pHash Hamming distance (pure JS, Tauri çağrısı yok)
 *  4. Yapısal Benzerlik — Jaccard similarity (metadata_json: layers/materials/blocks)
 */

import type { Asset } from '../types';

/* ── Tipler ── */

export type DuplicateType =
  | 'exact-hash'
  | 'same-name'
  | 'visual-similar'
  | 'structural-similar';

export interface SimilarityDetail {
  type: DuplicateType;
  score: number;            // 0–100
  reason: string;           // Kullanıcıya gösterilecek kısa açıklama
  matchedFields?: string[]; // Opsiyonel detay satırları
}

export interface DuplicateGroup {
  id: string;               // Benzersiz grup UUID
  type: DuplicateType;
  assets: Asset[];
  detail: SimilarityDetail;
}

/** Boyut karşılaştırma toleransı — exact: tam eşleşme, 1kb: ±1024 bayt, 1percent: ±%1 */
export type SizeTolerance = 'exact' | '1kb' | '1percent';

/** Karşılaştırma kriterleri — Genel + Format-spesifik */
export interface ComparisonCriteria {
  // ── Genel (Aynı İsim ve Yapısal Benzerlik modlarında uygulanır) ──
  sameSize: boolean;
  sizeTolerance: SizeTolerance;
  sameModifiedWithinDays: number;   // 0 = devre dışı
  sameParentFolder: boolean;        // parent folder basename eşleşmesi

  // ── DWG / DXF ──
  dwgLayers: boolean;
  dwgBlocks: boolean;
  dwgTextContents: boolean;
  dwgXrefs: boolean;

  // ── 3DS MAX ──
  maxMaterials: boolean;
  maxRenderEngine: boolean;
  maxVersion: boolean;

  // ── SketchUp ──
  skpComponents: boolean;
  skpLayers: boolean;
  skpVersion: boolean;

  // ── Revit (RVT) ──
  rvtStoreys: boolean;
  rvtProjectName: boolean;

  // ── IFC ──
  ifcStoreys: boolean;
  ifcEntities: boolean;

  // ── PDF / Office ──
  officeTitle: boolean;
  officeAuthor: boolean;
  pdfPageCount: boolean;
}

/** Performans ön-filtresi — taranacak asset havuzunu daraltır */
export interface PerformanceFilters {
  minFileSizeKb: number; // 0 = devre dışı
}

export const DEFAULT_CRITERIA: ComparisonCriteria = {
  // Genel — opt-in (varsayılan kapalı, tarama davranışı geriye uyumlu kalır)
  sameSize: false,
  sizeTolerance: 'exact',
  sameModifiedWithinDays: 0,
  sameParentFolder: false,

  // DWG / DXF
  dwgLayers: true,
  dwgBlocks: true,
  dwgTextContents: true,
  dwgXrefs: true,

  // MAX
  maxMaterials: true,
  maxRenderEngine: true,
  maxVersion: true,

  // SKP
  skpComponents: true,
  skpLayers: true,
  skpVersion: true,

  // RVT
  rvtStoreys: true,
  rvtProjectName: true,

  // IFC
  ifcStoreys: true,
  ifcEntities: true,

  // Office / PDF
  officeTitle: true,
  officeAuthor: true,
  pdfPageCount: true,
};

export const DEFAULT_PERFORMANCE_FILTERS: PerformanceFilters = {
  minFileSizeKb: 0,
};

export interface DuplicateScanOptions {
  checkExactHash: boolean;
  checkSameName: boolean;
  checkVisual: boolean;
  checkStructural: boolean;
  threshold: number;        // 0–100 (görsel + yapısal için)
  criteria: ComparisonCriteria;
  performance?: PerformanceFilters;
  /** İlerleme geri bildirim fonksiyonu — UI'da progress göstermek için */
  onProgress?: (current: number, total: number, phase: string) => void;
}

export interface DuplicateScanResult {
  groups: DuplicateGroup[];
  scannedCount: number;
  missingHashCount: number;
  missingPhashCount: number;     // görsel dosyalar arasında phash eksik olanlar
  missingMetadataCount: number;  // yapısal dosyalar arasında metadata eksik olanlar
  durationMs: number;
  /** Tarama iptal edildiyse true — kısmi sonuçlar döner */
  cancelled?: boolean;
}

/** UI thread'ine nefes aldır — her N iterasyonda çağrılır */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/* ── Yardımcı: Hamming Distance (hex string, pure JS) ── */

function hammingDistanceHex(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    let xor = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (xor) { dist += xor & 1; xor >>= 1; }
  }
  return dist;
}

/** pHash Hamming mesafesini 0–100 benzerlik skoruna çevirir (64-bit hash varsayımı: 16 hex char) */
function hammingToScore(dist: number): number {
  return Math.round((1 - dist / 64) * 100);
}

/* ── Yardımcı: Jaccard Similarity ── */

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map(s => s.toLowerCase().trim()));
  const setB = new Set(b.map(s => s.toLowerCase().trim()));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return 0;
  const intersection = [...setA].filter(x => setB.has(x)).length;
  return Math.round((intersection / union.size) * 100);
}

/* ── Yardımcı: Genel kriterler (boyut, tarih, klasör) ── */

const ONE_DAY_MS = 86400000;

function _basename(p: string): string {
  if (!p) return '';
  const segs = p.split(/[\\/]/);
  return segs[segs.length - 1] ?? '';
}

function _parentDirBasename(p: string): string {
  if (!p) return '';
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (idx <= 0) return '';
  const parent = p.slice(0, idx);
  return _basename(parent);
}

/** İki dosyanın boyutu, verilen toleransla eşleşiyor mu? */
function sizesMatch(a: Asset, b: Asset, tolerance: SizeTolerance): boolean {
  const sa = a.fileSize ?? 0;
  const sb = b.fileSize ?? 0;
  if (tolerance === 'exact') return sa === sb;
  if (tolerance === '1kb') return Math.abs(sa - sb) <= 1024;
  if (tolerance === '1percent') {
    const max = Math.max(sa, sb);
    if (max === 0) return sa === sb;
    return Math.abs(sa - sb) / max <= 0.01;
  }
  return sa === sb;
}

/** İki dosya verilen gün penceresi içinde değiştirilmiş mi? days<=0 ise her zaman true (devre dışı). */
function datesWithinDays(a: Asset, b: Asset, days: number): boolean {
  if (days <= 0) return true;
  const da = Date.parse(a.modifiedAt ?? '');
  const db = Date.parse(b.modifiedAt ?? '');
  if (isNaN(da) || isNaN(db)) return true; // tarih okunamıyorsa engelleme
  return Math.abs(da - db) <= days * ONE_DAY_MS;
}

/** İki dosyanın parent klasör basename'i (case-insensitive) eşleşiyor mu? */
function parentFoldersMatch(a: Asset, b: Asset): boolean {
  const pa = _parentDirBasename(a.filePath ?? '').toLowerCase();
  const pb = _parentDirBasename(b.filePath ?? '').toLowerCase();
  return pa.length > 0 && pa === pb;
}

/**
 * Genel kriterleri (boyut, tarih, parent folder) ortak filtre olarak uygular.
 * Aktif kriter yoksa true döner. Bir kriter aktif ve eşleşmiyorsa false.
 */
function passesGeneralCriteria(a: Asset, b: Asset, c: ComparisonCriteria): boolean {
  if (c.sameSize && !sizesMatch(a, b, c.sizeTolerance)) return false;
  if (c.sameModifiedWithinDays > 0 && !datesWithinDays(a, b, c.sameModifiedWithinDays)) return false;
  if (c.sameParentFolder && !parentFoldersMatch(a, b)) return false;
  return true;
}

/* ── Yardımcı: Metadata'dan alan çıkar ── */

type MetadataRecord = Record<string, unknown>;

function getStringArray(meta: MetadataRecord, ...keys: string[]): string[] {
  for (const key of keys) {
    const val = meta[key];
    if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  }
  return [];
}

function getString(meta: MetadataRecord, ...keys: string[]): string {
  for (const key of keys) {
    const val = meta[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return '';
}

/* ── Görsel kategori tespiti ── */

const VISUAL_TYPES = new Set([
  'JPG', 'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'PSD',
]);

export function isVisualAsset(a: Asset): boolean {
  return VISUAL_TYPES.has(a.fileType?.toUpperCase() ?? '');
}

/* ── Yapısal karşılaştırma yapılabilecek türler ── */

const STRUCTURAL_TYPES = new Set([
  'DWG', 'DXF', 'MAX', 'SKP', 'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'RVT', 'IFC',
]);

export function isStructuralAsset(a: Asset): boolean {
  return STRUCTURAL_TYPES.has(a.fileType?.toUpperCase() ?? '');
}

/** Yapısal benzerlik için gerekli metadata var mı kontrol et */
export function hasStructuralMetadata(a: Asset): boolean {
  const meta = (a.rawMetadata ?? a.metadata ?? {}) as Record<string, unknown>;
  const type = a.fileType?.toUpperCase() ?? '';
  if (['DWG', 'DXF', 'IFC'].includes(type)) {
    return (
      (Array.isArray(meta.layers) && (meta.layers as unknown[]).length > 0) ||
      (Array.isArray(meta.dwgLayers) && (meta.dwgLayers as unknown[]).length > 0) ||
      (Array.isArray(meta.dwgBlockNames) && (meta.dwgBlockNames as unknown[]).length > 0)
    );
  }
  // MAX: malzeme listesi Rust tarafında çıkarılmıyor (sadece AI ile dolabilir)
  // SKP: katman extraction implemente edilmemiş (sadece skpVersion alınıyor)
  // PDF/Office: başlık/yazar extraction implemente edilmemiş
  // → Bu türler için "eksik metadata" uyarısı verme.
  if (['MAX', 'SKP', 'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX'].includes(type)) {
    return true;
  }
  return false;
}

/* ── Yapısal benzerlik detayı ── */

function structuralSimilarity(
  a: Asset,
  b: Asset,
  criteria: ComparisonCriteria
): { score: number; reason: string; matchedFields: string[] } | null {
  const metaA = (a.rawMetadata ?? a.metadata ?? {}) as MetadataRecord;
  const metaB = (b.rawMetadata ?? b.metadata ?? {}) as MetadataRecord;

  const typeA = a.fileType?.toUpperCase() ?? '';

  // DWG / DXF
  if (['DWG', 'DXF'].includes(typeA)) {
    const layersA = criteria.dwgLayers ? getStringArray(metaA, 'layers', 'layerNames', 'dwgLayers') : [];
    const layersB = criteria.dwgLayers ? getStringArray(metaB, 'layers', 'layerNames', 'dwgLayers') : [];
    const blocksA = criteria.dwgBlocks ? getStringArray(metaA, 'blocks', 'blockNames', 'dwgBlockNames') : [];
    const blocksB = criteria.dwgBlocks ? getStringArray(metaB, 'blocks', 'blockNames', 'dwgBlockNames') : [];
    const textsA = criteria.dwgTextContents ? getStringArray(metaA, 'dwgTextContents') : [];
    const textsB = criteria.dwgTextContents ? getStringArray(metaB, 'dwgTextContents') : [];
    const xrefsA = criteria.dwgXrefs ? getStringArray(metaA, 'dwgXrefNames', 'xrefs', 'xrefNames') : [];
    const xrefsB = criteria.dwgXrefs ? getStringArray(metaB, 'dwgXrefNames', 'xrefs', 'xrefNames') : [];

    const subs: { score: number; weight: number; field?: string }[] = [];
    if (layersA.length > 0 || layersB.length > 0) {
      const s = jaccard(layersA, layersB);
      const common = layersA.filter(l => layersB.map(x => x.toLowerCase()).includes(l.toLowerCase())).length;
      subs.push({ score: s, weight: 1.0, field: `Katmanlar: ${common}/${Math.max(layersA.length, layersB.length)} ortak` });
    }
    if (blocksA.length > 0 || blocksB.length > 0) {
      const s = jaccard(blocksA, blocksB);
      const common = blocksA.filter(l => blocksB.map(x => x.toLowerCase()).includes(l.toLowerCase())).length;
      subs.push({ score: s, weight: 1.0, field: `Bloklar: ${common}/${Math.max(blocksA.length, blocksB.length)} ortak` });
    }
    if (textsA.length > 0 || textsB.length > 0) {
      const s = jaccard(textsA, textsB);
      const common = textsA.filter(l => textsB.map(x => x.toLowerCase()).includes(l.toLowerCase())).length;
      subs.push({ score: s, weight: 0.8, field: `Metin içeriği: ${common}/${Math.max(textsA.length, textsB.length)} ortak` });
    }
    if (xrefsA.length > 0 || xrefsB.length > 0) {
      const s = jaccard(xrefsA, xrefsB);
      const common = xrefsA.filter(l => xrefsB.map(x => x.toLowerCase()).includes(l.toLowerCase())).length;
      subs.push({ score: s, weight: 0.6, field: `Xref'ler: ${common}/${Math.max(xrefsA.length, xrefsB.length)} ortak` });
    }
    if (subs.length === 0) return null;
    const totalWeight = subs.reduce((acc, s) => acc + s.weight, 0);
    const weighted = subs.reduce((acc, s) => acc + s.score * s.weight, 0);
    const combined = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
    const fields = subs.map(s => s.field).filter((f): f is string => Boolean(f));
    if (combined === 0) return null;
    return { score: combined, reason: `Yapısal benzerlik: %${combined}`, matchedFields: fields };
  }

  // IFC — entity sayısı + storey sayısı + (varsa) layer'lar
  if (typeA === 'IFC') {
    const layersA = criteria.dwgLayers ? getStringArray(metaA, 'layers', 'layerNames', 'dwgLayers') : [];
    const layersB = criteria.dwgLayers ? getStringArray(metaB, 'layers', 'layerNames', 'dwgLayers') : [];
    const layerScore = jaccard(layersA, layersB);
    const hasLayers = layersA.length > 0 || layersB.length > 0;

    const storA = (metaA['ifcStoreyCount'] as number) ?? 0;
    const storB = (metaB['ifcStoreyCount'] as number) ?? 0;
    const entA = (metaA['ifcTotalEntities'] as number) ?? 0;
    const entB = (metaB['ifcTotalEntities'] as number) ?? 0;

    const fields: string[] = [];
    let score = 0;
    if (hasLayers && layerScore > 0) {
      const common = layersA.filter(l => layersB.map(x => x.toLowerCase()).includes(l.toLowerCase())).length;
      fields.push(`Katmanlar: ${common}/${Math.max(layersA.length, layersB.length)} ortak`);
      score = layerScore;
    }
    if (criteria.ifcStoreys && storA > 0 && storB > 0) {
      if (storA === storB) {
        fields.push(`Kat sayısı eşit: ${storA}`);
        score = Math.max(score, 60);
      } else {
        const diff = Math.abs(storA - storB) / Math.max(storA, storB);
        if (diff < 0.2) {
          fields.push(`Kat sayısı yakın: ${storA} / ${storB}`);
          score = Math.max(score, 40);
        }
      }
    }
    if (criteria.ifcEntities && entA > 0 && entB > 0) {
      const diff = Math.abs(entA - entB) / Math.max(entA, entB);
      if (diff < 0.05) {
        fields.push(`Entity sayısı çok yakın: ${entA} / ${entB}`);
        score = Math.max(score, 70);
      } else if (diff < 0.15) {
        fields.push(`Entity sayısı yakın: ${entA} / ${entB}`);
        score = Math.max(score, 45);
      }
    }
    if (score === 0) return null;
    return { score, reason: `IFC yapısal benzerlik: %${score}`, matchedFields: fields };
  }

  // MAX
  if (typeA === 'MAX') {
    const matsA = criteria.maxMaterials ? getStringArray(metaA, 'materialList', 'materials', 'materialNames', 'aiDetectedMaterials') : [];
    const matsB = criteria.maxMaterials ? getStringArray(metaB, 'materialList', 'materials', 'materialNames', 'aiDetectedMaterials') : [];
    const renderA = criteria.maxRenderEngine ? getString(metaA, 'renderEngine', 'render_engine') : '';
    const renderB = criteria.maxRenderEngine ? getString(metaB, 'renderEngine', 'render_engine') : '';
    const verA = criteria.maxVersion ? getString(metaA, 'maxVersion') : '';
    const verB = criteria.maxVersion ? getString(metaB, 'maxVersion') : '';
    const matScore = jaccard(matsA, matsB);
    let combined = matScore;
    const fields: string[] = [];
    if (matsA.length || matsB.length) fields.push(`Malzeme örtüşmesi: %${matScore}`);
    if (renderA && renderB && renderA.toLowerCase() === renderB.toLowerCase()) {
      fields.push(`Render motoru: ${renderA}`);
      combined = Math.max(combined, 50);
    }
    if (verA && verB && verA.toLowerCase() === verB.toLowerCase()) {
      fields.push(`Max sürümü: ${verA}`);
      combined = Math.max(combined, 35);
    }
    if (combined === 0) return null;
    return { score: combined, reason: `Yapısal benzerlik: %${combined}`, matchedFields: fields };
  }

  // SKP
  if (typeA === 'SKP') {
    const compsA = criteria.skpComponents ? getStringArray(metaA, 'components', 'componentNames') : [];
    const compsB = criteria.skpComponents ? getStringArray(metaB, 'components', 'componentNames') : [];
    const layersA = criteria.skpLayers ? getStringArray(metaA, 'layers') : [];
    const layersB = criteria.skpLayers ? getStringArray(metaB, 'layers') : [];
    const verA = criteria.skpVersion ? getString(metaA, 'skpVersion') : '';
    const verB = criteria.skpVersion ? getString(metaB, 'skpVersion') : '';
    const compScore = jaccard(compsA, compsB);
    const layerScore = jaccard(layersA, layersB);
    const hasComps = compsA.length > 0 || compsB.length > 0;
    const hasLayers = layersA.length > 0 || layersB.length > 0;
    let combined: number;
    if (hasComps && hasLayers) combined = Math.round((compScore + layerScore) / 2);
    else if (hasComps) combined = compScore;
    else if (hasLayers) combined = layerScore;
    else combined = 0;
    const fields: string[] = [];
    if (hasComps) {
      const common = compsA.filter(c => compsB.map(x => x.toLowerCase()).includes(c.toLowerCase())).length;
      fields.push(`Bileşenler: ${common}/${Math.max(compsA.length, compsB.length)} ortak`);
    }
    if (hasLayers) {
      const common = layersA.filter(l => layersB.map(x => x.toLowerCase()).includes(l.toLowerCase())).length;
      fields.push(`Katmanlar: ${common}/${Math.max(layersA.length, layersB.length)} ortak`);
    }
    if (verA && verB && verA.toLowerCase() === verB.toLowerCase()) {
      fields.push(`SketchUp sürümü: ${verA}`);
      combined = Math.max(combined, 35);
    }
    if (combined === 0) return null;
    return { score: combined, reason: `Yapısal benzerlik: %${combined}`, matchedFields: fields };
  }

  // RVT (Revit) — kat adları + proje adı + alan sayısı
  if (typeA === 'RVT') {
    const storeysA = criteria.rvtStoreys ? getStringArray(metaA, 'rvtStoreyNames') : [];
    const storeysB = criteria.rvtStoreys ? getStringArray(metaB, 'rvtStoreyNames') : [];
    const storeyScore = jaccard(storeysA, storeysB);
    const projA = criteria.rvtProjectName ? getString(metaA, 'rvtProjectName') : '';
    const projB = criteria.rvtProjectName ? getString(metaB, 'rvtProjectName') : '';
    const spacesA = (metaA['rvtSpaceCount'] as number) || 0;
    const spacesB = (metaB['rvtSpaceCount'] as number) || 0;
    const fields: string[] = [];
    let score = 0;
    if (storeysA.length > 0 || storeysB.length > 0) {
      if (storeyScore > 0) {
        const common = storeysA.filter(s => storeysB.map(x => x.toLowerCase()).includes(s.toLowerCase())).length;
        fields.push(`Katlar: ${common}/${Math.max(storeysA.length, storeysB.length)} ortak`);
        score = storeyScore;
      }
    }
    if (projA && projB && projA.toLowerCase() === projB.toLowerCase()) {
      fields.push(`Proje adı: "${projA}"`);
      score = Math.max(score, 50);
    }
    if (spacesA > 0 && spacesB > 0) {
      const spaceDiff = Math.abs(spacesA - spacesB) / Math.max(spacesA, spacesB);
      if (spaceDiff < 0.1) {
        fields.push(`Alan sayısı benzer: ${spacesA} / ${spacesB}`);
        score = Math.max(score, 30);
      }
    }
    if (score === 0) return null;
    return { score, reason: `Revit yapısal benzerlik: %${score}`, matchedFields: fields };
  }

  // PDF / Dökümanlar — başlık + yazar + sayfa sayısı
  if (['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX'].includes(typeA)) {
    const props = (metaA['dwgProperties'] ?? {}) as MetadataRecord;
    const propsB = (metaB['dwgProperties'] ?? {}) as MetadataRecord;
    const titleA = criteria.officeTitle ? (getString(metaA, 'title', 'Title') || getString(props, 'title', 'Title')) : '';
    const titleB = criteria.officeTitle ? (getString(metaB, 'title', 'Title') || getString(propsB, 'title', 'Title')) : '';
    const authorA = criteria.officeAuthor ? (getString(metaA, 'author', 'Author') || getString(props, 'author', 'Author')) : '';
    const authorB = criteria.officeAuthor ? (getString(metaB, 'author', 'Author') || getString(propsB, 'author', 'Author')) : '';
    const pagesA = criteria.pdfPageCount ? ((metaA['pageCount'] as number) ?? 0) : 0;
    const pagesB = criteria.pdfPageCount ? ((metaB['pageCount'] as number) ?? 0) : 0;
    const fields: string[] = [];
    let score = 0;
    if (titleA && titleB && titleA.toLowerCase() === titleB.toLowerCase()) {
      fields.push(`Başlık eşleşmesi: "${titleA}"`);
      score += 40;
    }
    if (authorA && authorB && authorA.toLowerCase() === authorB.toLowerCase()) {
      fields.push(`Yazar eşleşmesi: "${authorA}"`);
      score += 30;
    }
    if (pagesA > 0 && pagesB > 0 && pagesA === pagesB) {
      fields.push(`Sayfa sayısı eşit: ${pagesA}`);
      score += 30;
    }
    if (score === 0) return null;
    if (score > 100) score = 100;
    return { score, reason: `Metadata benzerliği: %${score}`, matchedFields: fields };
  }

  return null;
}

/* ── Mod 1: Birebir Kopya (contentHash GROUP BY) ── */

function findExactDuplicates(assets: Asset[]): DuplicateGroup[] {
  const byHash = new Map<string, Asset[]>();
  for (const a of assets) {
    // contentHash: dosya içeriğinden SHA-256 (farklı yolda aynı içerik = gerçek kopya)
    // Yoksa eskiye dönük olarak hash kullan (taranan ama contentHash olmayan dosyalar için)
    const key = a.contentHash ?? a.hash;
    if (!key) continue;
    const list = byHash.get(key) ?? [];
    list.push(a);
    byHash.set(key, list);
  }
  const groups: DuplicateGroup[] = [];
  for (const [, list] of byHash) {
    if (list.length < 2) continue;
    groups.push({
      id: `exact-${list[0].contentHash ?? list[0].hash}`,
      type: 'exact-hash',
      assets: list,
      detail: {
        type: 'exact-hash',
        score: 100,
        reason: 'Birebir aynı içerik (hash eşleşmesi)',
      },
    });
  }
  return groups;
}

/* ── Mod 2: Aynı İsim, Farklı Konum ── */

/**
 * Aynı isim grubu içinde, genel kriterlere (boyut/tarih/parent folder) göre alt-gruplara böler.
 * Hiç genel kriter aktif değilse tek grup döner (eski davranış).
 */
function _subdivideByGeneralCriteria(group: Asset[], c: ComparisonCriteria): Asset[][] {
  const anyActive = c.sameSize || c.sameModifiedWithinDays > 0 || c.sameParentFolder;
  if (!anyActive) return [group];

  // Equivalence partitioning: iki asset aynı bucket'ta ⟺ tüm aktif kriterler eşleşiyor
  const buckets: Asset[][] = [];
  for (const asset of group) {
    let placed = false;
    for (const bucket of buckets) {
      if (passesGeneralCriteria(asset, bucket[0], c)) {
        bucket.push(asset);
        placed = true;
        break;
      }
    }
    if (!placed) buckets.push([asset]);
  }
  return buckets;
}

function findNameDuplicates(assets: Asset[], criteria: ComparisonCriteria): DuplicateGroup[] {
  const byName = new Map<string, Asset[]>();
  for (const a of assets) {
    const name = a.fileName?.toLowerCase() ?? '';
    if (!name) continue;
    const list = byName.get(name) ?? [];
    list.push(a);
    byName.set(name, list);
  }
  const groups: DuplicateGroup[] = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const subgroups = _subdivideByGeneralCriteria(list, criteria);
    for (const sub of subgroups) {
      if (sub.length < 2) continue;
      const reasonParts = ['Aynı dosya adı'];
      if (criteria.sameSize) reasonParts.push('aynı boyut');
      if (criteria.sameModifiedWithinDays > 0) reasonParts.push(`${criteria.sameModifiedWithinDays} gün içinde değiştirildi`);
      if (criteria.sameParentFolder) reasonParts.push('aynı klasör adı');
      groups.push({
        id: `name-${name}-${groups.length}`,
        type: 'same-name',
        assets: sub,
        detail: {
          type: 'same-name',
          score: 100,
          reason: reasonParts.join(' + '),
        },
      });
    }
  }
  return groups;
}

/* ── Mod 3: Görsel Benzerlik (pHash) — Faz 4.4 bucket-optimized ── */

/**
 * pHash bucket pre-filter: İlk N hex karakteri (prefix) bucket key olarak kullanılır.
 * Aynı bucket + komşu bucket'lar karşılaştırılır — O(n²) yerine O(n × bucket_size²).
 * 3000 dosyada ~4.5M → ~50-200K karşılaştırmaya düşer (threshold=60+ için).
 */
function buildPhashBuckets(visuals: Asset[], prefixLen: number): Map<string, Asset[]> {
  const buckets = new Map<string, Asset[]>();
  for (const a of visuals) {
    const key = a.phash!.substring(0, prefixLen).toLowerCase();
    const list = buckets.get(key) ?? [];
    list.push(a);
    buckets.set(key, list);
  }
  return buckets;
}

/** Komşu bucket key'leri üretir — 1 hex karakter farkına kadar (Hamming prefix tolerance). */
function neighborBucketKeys(key: string): string[] {
  const neighbors: string[] = [key];
  const hexChars = '0123456789abcdef';
  for (let pos = 0; pos < key.length; pos++) {
    const orig = key[pos];
    for (const h of hexChars) {
      if (h !== orig) {
        neighbors.push(key.substring(0, pos) + h + key.substring(pos + 1));
      }
    }
  }
  return neighbors;
}

async function findVisualSimilar(
  assets: Asset[], threshold: number, signal?: AbortSignal,
  onProgress?: (current: number, total: number, phase: string) => void,
): Promise<DuplicateGroup[]> {
  const visuals = assets.filter(a => isVisualAsset(a) && a.phash && a.phash.length >= 4);
  if (visuals.length === 0) return [];

  const groups: DuplicateGroup[] = [];
  const paired = new Set<string>();

  // Yüksek eşik (≥75): dar bucket (prefix=3, ~4096 bucket) → çok hızlı
  // Düşük eşik (<75): geniş bucket (prefix=2, ~256 bucket) → daha kapsamlı
  const prefixLen = threshold >= 75 ? 3 : 2;
  const buckets = buildPhashBuckets(visuals, prefixLen);
  const bucketKeys = [...buckets.keys()];

  let iter = 0;
  const totalEstimate = visuals.length; // Yaklaşık (bucket karşılaştırma sayısı değişken)

  for (let bi = 0; bi < bucketKeys.length; bi++) {
    if (signal?.aborted) break;
    const keyA = bucketKeys[bi];
    const bucketA = buckets.get(keyA)!;
    const neighborKeys = neighborBucketKeys(keyA);

    for (const nKey of neighborKeys) {
      if (signal?.aborted) break;
      const bucketB = buckets.get(nKey);
      if (!bucketB) continue;
      const sameKey = nKey === keyA;

      for (let i = 0; i < bucketA.length; i++) {
        if (signal?.aborted) break;
        const a = bucketA[i];
        const startJ = sameKey ? i + 1 : 0;
        for (let j = startJ; j < bucketB.length; j++) {
          const b = bucketB[j];
          if (a.id === b.id) continue;

          const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
          if (paired.has(pairKey)) continue;

          if (++iter % 3000 === 0) {
            await yieldToUI();
            onProgress?.(iter, totalEstimate, 'visual');
          }

          const dist = hammingDistanceHex(a.phash!, b.phash!);
          const score = hammingToScore(dist);
          if (score < threshold) continue;

          paired.add(pairKey);
          groups.push({
            id: `visual-${pairKey}`,
            type: 'visual-similar',
            assets: [a, b],
            detail: {
              type: 'visual-similar',
              score,
              reason: `pHash farkı: ${dist}/64 bit → %${score} benzerlik`,
            },
          });
        }
      }
    }
  }

  return mergeOverlappingGroups(groups, 'visual-similar');
}

/* ── Mod 4: Yapısal Benzerlik — Faz 4.4 type-bucket + fingerprint optimized ── */

/**
 * Yapısal fingerprint: layer/block isimlerini sıralayıp hash'le.
 * Aynı fingerprint → yüksek benzerlik olasılığı (önce bunlar karşılaştırılır).
 * Farklı fingerprint → sadece threshold düşükse karşılaştır.
 */
function computeStructuralFingerprint(a: Asset): string {
  const meta = (a.rawMetadata ?? a.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  const layers = getStringArray(meta as MetadataRecord, 'layers', 'layerNames', 'dwgLayers');
  if (layers.length > 0) parts.push('L:' + layers.slice(0, 20).map(s => s.toLowerCase()).sort().join(','));
  const blocks = getStringArray(meta as MetadataRecord, 'blocks', 'blockNames', 'dwgBlockNames');
  if (blocks.length > 0) parts.push('B:' + blocks.slice(0, 20).map(s => s.toLowerCase()).sort().join(','));
  if (parts.length === 0) return a.fileType?.toUpperCase() ?? '';
  return parts.join('|');
}

async function findStructuralSimilar(
  assets: Asset[], threshold: number, criteria: ComparisonCriteria,
  signal?: AbortSignal,
  onProgress?: (current: number, total: number, phase: string) => void,
): Promise<DuplicateGroup[]> {
  const structural = assets.filter(a => isStructuralAsset(a));
  if (structural.length === 0) return [];

  // Type-bucket: sadece aynı dosya türleri karşılaştırılır
  const byType = new Map<string, Asset[]>();
  for (const a of structural) {
    const t = a.fileType?.toUpperCase() ?? '';
    const list = byType.get(t) ?? [];
    list.push(a);
    byType.set(t, list);
  }

  // Fingerprint pre-compute (bir kez hesapla, çiftlerde kullan)
  const fingerprints = new Map<string, string>();
  for (const a of structural) {
    fingerprints.set(a.id, computeStructuralFingerprint(a));
  }

  const groups: DuplicateGroup[] = [];
  const paired = new Set<string>();
  let iter = 0;
  const totalPairs = structural.length; // Yaklaşık

  for (const [, typeBucket] of byType) {
    if (typeBucket.length < 2) continue;

    // Boyut sırala → yakın boyutlu dosyalar bitişik → boyut farkı kontrolü hızlı skip
    typeBucket.sort((a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0));

    for (let i = 0; i < typeBucket.length; i++) {
      if (signal?.aborted) break;
      const a = typeBucket[i];
      const fpA = fingerprints.get(a.id)!;

      for (let j = i + 1; j < typeBucket.length; j++) {
        if (signal?.aborted) break;
        const b = typeBucket[j];

        if (++iter % 2000 === 0) {
          await yieldToUI();
          onProgress?.(iter, totalPairs, 'structural');
        }

        // Early termination: boyut 10x farkı varsa yapısal benzerlik düşük
        const sizeA = a.fileSize ?? 0;
        const sizeB = b.fileSize ?? 0;
        if (sizeA > 0 && sizeB > 0) {
          const ratio = Math.max(sizeA, sizeB) / Math.max(Math.min(sizeA, sizeB), 1);
          if (ratio > 10) continue; // 10x+ boyut farkı → atla
        }

        // Fingerprint pre-filter: farklı fingerprint + yüksek eşik → atla
        const fpB = fingerprints.get(b.id)!;
        if (fpA !== fpB && threshold >= 70) continue;

        const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (paired.has(pairKey)) continue;

        // Genel kriterler ön-filtresi
        if (!passesGeneralCriteria(a, b, criteria)) continue;

        const sim = structuralSimilarity(a, b, criteria);
        if (!sim || sim.score < threshold) continue;

        paired.add(pairKey);
        groups.push({
          id: `struct-${pairKey}`,
          type: 'structural-similar',
          assets: [a, b],
          detail: {
            type: 'structural-similar',
            score: sim.score,
            reason: sim.reason,
            matchedFields: sim.matchedFields,
          },
        });
      }
    }
  }

  return mergeOverlappingGroups(groups, 'structural-similar');
}

/* ── Yardımcı: Örtüşen çiftleri birleştir (Union-Find) ── */

function mergeOverlappingGroups(
  pairGroups: DuplicateGroup[],
  type: DuplicateType
): DuplicateGroup[] {
  // Her ID'yi bir gruba bağla
  const parent = new Map<string, string>();
  const groupData = new Map<string, { detail: SimilarityDetail; ids: Set<string> }>();

  function find(id: string): string {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  }

  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const g of pairGroups) {
    const ids = g.assets.map(a => a.id);
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Köke göre grupla
  const assetMap = new Map<string, Asset>();
  for (const g of pairGroups) for (const a of g.assets) assetMap.set(a.id, a);

  for (const g of pairGroups) {
    const root = find(g.assets[0].id);
    if (!groupData.has(root)) {
      groupData.set(root, { detail: g.detail, ids: new Set() });
    }
    for (const a of g.assets) groupData.get(root)!.ids.add(a.id);
    // En düşük skoru koru (muhafazakar)
    const existing = groupData.get(root)!;
    if (g.detail.score < existing.detail.score) existing.detail = g.detail;
  }

  const result: DuplicateGroup[] = [];
  for (const [root, data] of groupData) {
    if (data.ids.size < 2) continue;
    result.push({
      id: `${type}-${root}`,
      type,
      assets: [...data.ids].map(id => assetMap.get(id)!).filter(Boolean),
      detail: data.detail,
    });
  }
  return result;
}

/* ── Ana Tarama Fonksiyonu ── */

export async function runDuplicateScan(
  assets: Asset[],
  options: DuplicateScanOptions,
  signal?: AbortSignal,
): Promise<DuplicateScanResult> {
  const t0 = performance.now();
  const groups: DuplicateGroup[] = [];

  // Performans ön-filtresi: minFileSizeKb altındaki dosyaları havuzdan çıkar
  const perfFilters = options.performance ?? DEFAULT_PERFORMANCE_FILTERS;
  const minSizeBytes = Math.max(0, perfFilters.minFileSizeKb) * 1024;
  const pool = minSizeBytes > 0
    ? assets.filter(a => (a.fileSize ?? 0) >= minSizeBytes)
    : assets;

  const criteria = options.criteria ?? DEFAULT_CRITERIA;

  // contentHash: içerik bazlı, hash: eski yol-bazlı. İkisi de yoksa eksik sayılır.
  const missingHashCount = pool.filter(a => !a.contentHash && !a.hash).length;

  const missingPhashCount = options.checkVisual
    ? pool.filter(a => isVisualAsset(a) && !a.phash).length
    : 0;

  const missingMetadataCount = options.checkStructural
    ? pool.filter(a => isStructuralAsset(a) && !hasStructuralMetadata(a)).length
    : 0;

  if (options.checkExactHash && !signal?.aborted) {
    groups.push(...findExactDuplicates(pool));
  }

  if (options.checkSameName && !signal?.aborted) {
    const nameDups = findNameDuplicates(pool, criteria);
    const exactIds = new Set(groups.flatMap(g => g.assets.map(a => a.id)));
    for (const g of nameDups) {
      // Filter out assets already in exact-hash groups
      const filtered = g.assets.filter(a => !exactIds.has(a.id));
      if (filtered.length >= 2) {
        groups.push({ ...g, assets: filtered });
      }
    }
  }

  if (options.checkVisual && !signal?.aborted) {
    groups.push(...await findVisualSimilar(pool, options.threshold, signal, options.onProgress));
  }

  if (options.checkStructural && !signal?.aborted) {
    groups.push(...await findStructuralSimilar(pool, options.threshold, criteria, signal, options.onProgress));
  }

  return {
    groups,
    scannedCount: pool.length,
    missingHashCount,
    missingPhashCount,
    missingMetadataCount,
    durationMs: Math.round(performance.now() - t0),
    cancelled: signal?.aborted,
  };
}
