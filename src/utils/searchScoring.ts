import type { Asset } from '../types';
import { expandQuery } from '../services/queryExpansion';
import { findMatchSources, type MatchSource } from '../services/queryExpansion';

/**
 * Türkçe-güvenli lowercase: İ→i, I→ı, Ş→ş, Ğ→ğ, Ü→ü, Ö→ö, Ç→ç
 * WebView2'de toLocaleLowerCase('tr') platform bağımlı olabilir,
 * bu yüzden manuel dönüşüm yapıyoruz.
 */
const TR_UPPER = 'İIŞĞÜÖÇ';
const TR_LOWER = 'iışğüöç';
export function turkishLower(s: string): string {
  let result = '';
  for (let i = 0; i < s.length; i++) {
    const idx = TR_UPPER.indexOf(s[i]);
    if (idx >= 0) {
      result += TR_LOWER[idx];
    } else {
      result += s[i].toLowerCase();
    }
  }
  return result;
}

/** Görsel vektör sorgusu mu (metin semantiğini ezmemek için). */
export function isVisualVectorQueryString(searchQuery: string): boolean {
  return (
    searchQuery.startsWith('🔍 Görsel Sonuçlar') ||
    searchQuery === '🔍 Görsel Vektör Sonuçları (CLIP)'
  );
}

// WeakMap cache — aynı Asset nesnesi için tekrar hesaplama önlenir, GC-friendly
const _searchTextCache = new WeakMap<Asset, string>();

export function buildFullSearchableText(a: Asset): string {
  const cached = _searchTextCache.get(a);
  if (cached !== undefined) return cached;

  const text = [
    a.fileName,
    a.projectName,
    a.category,
    a.materialGroup,
    a.colorTheme,
    a.architecturalStyle,
    a.omniclassCode,
    a.fileType,
    a.projectPhase,
    ...a.aiTags.map((t) => t.label),
    ...(a.metadata.layers || []),
    ...(a.metadata.roomNames || []),
    ...(a.metadata.materialList || []),
    a.metadata.renderEngine,
    ...(a.metadata.dwgLayers || []),
    ...(a.metadata.dwgBlockNames || []),
    ...(a.metadata.dwgTextContents || []),
    ...(a.metadata.dwgXrefNames || []),
    a.metadata.dwgProperties?.title,
    a.metadata.dwgProperties?.subject,
    a.metadata.dwgProperties?.keywords,
    a.metadata.dwgProperties?.author,
    a.metadata.dwgEstimatedScale,
    a.metadata.dwgUnitType,
    a.metadata.dwgDrawingType,
    a.metadata.dwgDescription,
    ...(a.metadata.dwgElements || []),
    ...(a.metadata.dwgSpaces || []),
    ...(a.metadata.dwgKeywords || []),
    ...(a.metadata.dwgDomainTerms || []),
    a.metadata.maxVersion,
    a.metadata.skpVersion,
    a.metadata.dwgProperties?.comments,
    a.metadata.dwgProperties?.lastSavedBy,
    a.metadata.renderSoftware as string | undefined,
    a.metadata.cameraInfo as string | undefined,
    // RVT metadata
    a.metadata.rvtVersion,
    a.metadata.rvtProjectName,
    a.metadata.rvtFormat,
    ...(a.metadata.rvtStoreyNames || []),
    // IFC metadata
    a.metadata.ifcSchema,
    a.metadata.ifcOriginatingSystem,
    a.metadata.ifcProjectName,
    a.metadata.ifcBuildingName,
    ...(a.metadata.ifcStoreyNames || []),
    // Kullanıcı etiketleri de aramaya dahil
    ...(a.userTags || []).map(t => t.name),
    // Proje durumu alanları (kullanıcı tanımlı)
    a.clientName,
    a.approvalStatus,
    a.versionLabel,
    a.deadline,
    // MAX layer ve obje isimleri
    ...(a.metadata.maxLayers || []),
    ...(a.metadata.maxObjects || []),
  ]
    .filter(Boolean)
    .join(' ');
  const lower = turkishLower(text);

  _searchTextCache.set(a, lower);
  return lower;
}

// Regex cache — aynı kelime için tekrar derleme önlenir
const _regexCache = new Map<string, RegExp>();
function getWordBoundaryRegex(word: string): RegExp {
  let cached = _regexCache.get(word);
  if (!cached) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cached = new RegExp(`(^|[\\s,;._\\-/])${escaped}([\\s,;._\\-/]|$)`);
    // Cache boyutunu sınırla
    if (_regexCache.size > 500) _regexCache.clear();
    _regexCache.set(word, cached);
  }
  return cached;
}

// ─── Faz 4.4 — Boolean query parser (AND/OR/NOT + tırnak frase) ───────────

type BoolExpr =
  | { type: 'term'; value: string; isPhrase: boolean }
  | { type: 'not'; child: BoolExpr }
  | { type: 'and'; left: BoolExpr; right: BoolExpr }
  | { type: 'or'; left: BoolExpr; right: BoolExpr };

const BOOL_OP_MAP: Record<string, string> = {
  'and': 'AND', 've': 'AND',
  'or': 'OR', 'veya': 'OR',
  'not': 'NOT', 'değil': 'NOT', 'degil': 'NOT',
};

/** Sorgunun Boolean operatör içerip içermediğini hızlı kontrol eder. */
export function hasBooleanOperators(query: string): boolean {
  // Tırnak frase veya operatör kelimesi var mı?
  if (query.includes('"')) return true;
  const words = query.toLowerCase().split(/\s+/);
  return words.some((w) => w in BOOL_OP_MAP);
}

/** Sorguyu token'lara ayırır: tırnak fraseler, operatörler, kelimeler. */
function tokenizeBoolQuery(query: string): Array<{ type: 'phrase' | 'op' | 'word'; value: string }> {
  const tokens: Array<{ type: 'phrase' | 'op' | 'word'; value: string }> = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    if (m[1] !== undefined) {
      tokens.push({ type: 'phrase', value: turkishLower(m[1]) });
    } else {
      const w = m[2];
      const op = BOOL_OP_MAP[w.toLowerCase()];
      if (op) {
        tokens.push({ type: 'op', value: op });
      } else if (w.length > 1) {
        tokens.push({ type: 'word', value: turkishLower(w) });
      }
    }
  }
  return tokens;
}

/**
 * Basit recursive descent parser — operatör önceliği: NOT > AND > OR.
 * Operatörsüz ardışık terimler implicit AND olarak yorumlanır.
 */
function parseBoolExpr(tokens: Array<{ type: 'phrase' | 'op' | 'word'; value: string }>): BoolExpr | null {
  let pos = 0;

  function peek() { return tokens[pos]; }
  function advance() { return tokens[pos++]; }

  function parsePrimary(): BoolExpr | null {
    const tok = peek();
    if (!tok) return null;
    if (tok.type === 'op' && tok.value === 'NOT') {
      advance();
      const child = parsePrimary();
      if (!child) return null;
      return { type: 'not', child };
    }
    if (tok.type === 'phrase') {
      advance();
      return { type: 'term', value: tok.value, isPhrase: true };
    }
    if (tok.type === 'word') {
      advance();
      return { type: 'term', value: tok.value, isPhrase: false };
    }
    // Beklenmeyen operatör → atla
    advance();
    return parsePrimary();
  }

  function parseAnd(): BoolExpr | null {
    let left = parsePrimary();
    if (!left) return null;
    while (pos < tokens.length) {
      const tok = peek();
      if (!tok) break;
      if (tok.type === 'op' && tok.value === 'AND') {
        advance();
        const right = parsePrimary();
        if (!right) break;
        left = { type: 'and', left, right };
      } else if (tok.type === 'op' && tok.value === 'OR') {
        break; // OR daha düşük öncelikli
      } else if (tok.type === 'word' || tok.type === 'phrase' || (tok.type === 'op' && tok.value === 'NOT')) {
        // Implicit AND: "plan mutfak" = "plan AND mutfak"
        const right = parsePrimary();
        if (!right) break;
        left = { type: 'and', left, right };
      } else {
        break;
      }
    }
    return left;
  }

  function parseOr(): BoolExpr | null {
    let left = parseAnd();
    if (!left) return null;
    while (pos < tokens.length) {
      const tok = peek();
      if (tok && tok.type === 'op' && tok.value === 'OR') {
        advance();
        const right = parseAnd();
        if (!right) break;
        left = { type: 'or', left, right };
      } else {
        break;
      }
    }
    return left;
  }

  return parseOr();
}

/** Boolean expression'ı searchText'e karşı değerlendirir. */
function evalBoolExpr(expr: BoolExpr, searchText: string): boolean {
  switch (expr.type) {
    case 'term':
      if (expr.isPhrase) {
        return searchText.includes(expr.value);
      }
      // Kelime: substring match veya fuzzy
      if (searchText.includes(expr.value)) return true;
      return fuzzyWordMatch(searchText, expr.value) > 0;
    case 'not':
      return !evalBoolExpr(expr.child, searchText);
    case 'and':
      return evalBoolExpr(expr.left, searchText) && evalBoolExpr(expr.right, searchText);
    case 'or':
      return evalBoolExpr(expr.left, searchText) || evalBoolExpr(expr.right, searchText);
  }
}

/** Boolean expression'dan scoring için pozitif terimleri çıkarır (NOT hariç). */
function extractPositiveTerms(expr: BoolExpr): string[] {
  switch (expr.type) {
    case 'term': return [expr.value];
    case 'not': return []; // NOT terimler sıralamaya katkı yapmaz
    case 'and':
    case 'or':
      return [...extractPositiveTerms(expr.left), ...extractPositiveTerms(expr.right)];
  }
}

// ─── Faz 4.4 — Levenshtein fuzzy matching ─────────────────────────────────

/** Levenshtein mesafesi — düzenle uzaklığı. O(min(a,b)) alan kullanır. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Kısa olanı satır olarak kullan (bellek optimizasyonu)
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const m = a.length;
  const n = b.length;
  let prev = new Array(m + 1);
  let curr = new Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  for (let j = 1; j <= n; j++) {
    curr[0] = j;
    for (let i = 1; i <= m; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m];
}

/**
 * Fuzzy kelime eşleştirme — searchText içindeki her kelimeye karşı query word'ü dener.
 * Eşik: max %30 hata (distance / maxLen <= 0.3), min 4 karakter query word.
 * Dönüş: en iyi fuzzy skor (0–1) veya 0.
 */
function fuzzyWordMatch(searchText: string, queryWord: string): number {
  if (queryWord.length < 4) return 0; // Kısa kelimelerde fuzzy kapalı (false positive riski)
  const maxAllowedDist = Math.floor(queryWord.length * 0.3);
  if (maxAllowedDist === 0) return 0;

  // searchText'i kelimelere ayır — sadece benzer uzunluktaki kelimelere bak
  const minLen = queryWord.length - maxAllowedDist;
  const maxLen = queryWord.length + maxAllowedDist;

  let bestScore = 0;
  // Kelime sınırları ile split
  const words = searchText.split(/[\s,;._\-/]+/);
  for (const w of words) {
    if (w.length < minLen || w.length > maxLen) continue;
    const dist = levenshteinDistance(queryWord, w);
    if (dist <= maxAllowedDist) {
      const sim = 1 - dist / Math.max(queryWord.length, w.length);
      if (sim > bestScore) bestScore = sim;
    }
  }
  return bestScore;
}

/** Anahtar kelime eşleşme skoru (0–1). Faz 4.4: fuzzy matching dahil. */
export function computeKeywordScore(searchText: string, query: string): number {
  const lowerQuery = turkishLower(query).trim();

  // Boşluksuz kısa kodlar (A1-c3, P2.dwg vb.) tire/nokta parçalanmadan
  // doğrudan alt-dizi olarak aransın
  if (!/\s/.test(lowerQuery) && lowerQuery.length >= 2 && searchText.includes(lowerQuery)) {
    return getWordBoundaryRegex(lowerQuery).test(searchText) ? 1 : 0.85;
  }

  const rawQueryWords = lowerQuery
    .split(/[\s,.;:!?-]+/)
    .filter((w) => w.length > 1);
  if (rawQueryWords.length === 0) return 0;

  const queryWords = Array.from(new Set(rawQueryWords));

  let matchCount = 0;
  let exactBonus = 0;
  let fuzzyTotal = 0;

  for (const word of queryWords) {
    if (searchText.includes(word)) {
      // Tam eşleşme
      matchCount++;
      if (getWordBoundaryRegex(word).test(searchText)) {
        exactBonus += 0.2;
      }
    } else {
      // Fuzzy eşleşme dene
      const fuzzySim = fuzzyWordMatch(searchText, word);
      if (fuzzySim > 0) {
        matchCount += fuzzySim * 0.8; // Fuzzy match tam match'in %80'i kadar değerli
        fuzzyTotal += fuzzySim;
      }
    }
  }

  if (matchCount === 0) return 0;

  const maxExpectedMatches = Math.min(queryWords.length, 3);
  const baseScore = matchCount / maxExpectedMatches;

  return Math.min(1, baseScore + exactBonus);
}

export function visualSearchThreshold(searchSensitivity: number): number {
  return 0.35 + (searchSensitivity / 100) * 0.5;
}

export function semanticMatchThreshold(searchSensitivity: number): number {
  return 0.15 + (searchSensitivity / 100) * 0.3;
}

export function computeHybridFinalScore(
  kwScore: number,
  semScore: number,
  threshold: number
): number {
  // threshold >= 1 durumunda semantik skor katkısı sıfır (bölme sıfıra koruması)
  const denom = 1 - threshold;
  const adjustedSemScore =
    semScore > threshold && denom > 0.001
      ? Math.min(1, (semScore - (threshold - 0.05)) * (1 / denom))
      : 0;
  return Math.min(1, kwScore + adjustedSemScore - kwScore * adjustedSemScore);
}

export function collectMatchSources(
  selectedAsset: Asset | null,
  searchQuery: string,
  isImageSearching: boolean
): MatchSource[] {
  if (!selectedAsset || !searchQuery.trim() || isImageSearching) return [];
  return findMatchSources(selectedAsset, searchQuery);
}

export function filterAssetsHybrid(args: {
  allAssets: Asset[];
  activeFilters: Partial<Record<string, string[]>>;
  searchQuery: string;
  semanticResults: Array<{ assetId: string; score: number; chunkId?: string }> | null;
  isImageSearching: boolean;
  searchSensitivity: number;
  isVisualVectorQuery: boolean;
  activeRootFilters?: string[];
  activeTagFilters?: number[];
  dateRangeFilter?: { from: string | null; to: string | null };
}): Asset[] {
  const {
    allAssets,
    activeFilters,
    searchQuery,
    semanticResults,
    isImageSearching,
    searchSensitivity,
    isVisualVectorQuery,
    activeRootFilters,
    activeTagFilters,
    dateRangeFilter,
  } = args;

  let result = [...allAssets];

  // Arama aktifken kaynak klasör filtresi bypass edilir.
  // Kullanıcı arama yaptığında (metin veya görsel) tüm arşivde sonuç bekler,
  // hangi klasörün seçili olduğu arama sonuçlarını kısıtlamamalıdır.
  const hasActiveSearch = searchQuery.trim().length > 0 || isVisualVectorQuery || isImageSearching;

  // Kaynak klasör filtresi (Faz 1.5): file_path prefix match
  // Sadece arama yokken uygulanır — klasör drill-down için.
  if (!hasActiveSearch && activeRootFilters && activeRootFilters.length > 0) {
    result = result.filter((a) =>
      activeRootFilters.some((rootPath) => a.filePath.startsWith(rootPath))
    );
  }

  // Etiket filtresi: asset en az bir seçili tag'i taşımalı (OR mantığı)
  if (activeTagFilters && activeTagFilters.length > 0) {
    const want = new Set(activeTagFilters);
    result = result.filter((a) => (a.userTags ?? []).some((t) => want.has(t.id)));
  }

  for (const [key, selectedVals] of Object.entries(activeFilters)) {
    if (!selectedVals || selectedVals.length === 0) continue;
    result = result.filter((a) => {
      const val = a[key as keyof Asset];
      return selectedVals.includes(val as string);
    });
  }

  // Tarih aralığı filtresi (Faz 4.4): modifiedAt bazlı
  if (dateRangeFilter) {
    const { from, to } = dateRangeFilter;
    if (from) {
      const fromDate = from + 'T00:00:00';
      result = result.filter((a) => (a.modifiedAt || a.createdAt) >= fromDate);
    }
    if (to) {
      const toDate = to + 'T23:59:59';
      result = result.filter((a) => (a.modifiedAt || a.createdAt) <= toDate);
    }
  }

  // Seçili klasör önceliği: arama aktifken filtre bypass edilir ama
  // seçili klasörlerdeki sonuçlara küçük bir sıralama avantajı verilir.
  const ROOT_BOOST = 0.12;
  const hasRootBoost = hasActiveSearch && activeRootFilters && activeRootFilters.length > 0;
  const isInSelectedRoot = hasRootBoost
    ? (filePath: string) => activeRootFilters!.some((rp) => filePath.startsWith(rp))
    : () => false;

  if (isVisualVectorQuery) {
    const visualScoreMap = new Map((semanticResults || []).map((r) => [r.assetId, r.score]));
    const visualThreshold = visualSearchThreshold(searchSensitivity);
    return result
      .filter((a) => {
        const score = visualScoreMap.get(a.id);
        return score !== undefined && score >= visualThreshold;
      })
      .sort((a, b) => {
        const sa = (visualScoreMap.get(a.id) || 0) + (isInSelectedRoot(a.filePath) ? ROOT_BOOST : 0);
        const sb = (visualScoreMap.get(b.id) || 0) + (isInSelectedRoot(b.filePath) ? ROOT_BOOST : 0);
        return sb - sa;
      });
  }

  if (searchQuery.trim() && !isImageSearching) {
    const rawQ = turkishLower(searchQuery);
    const isBool = hasBooleanOperators(searchQuery);
    const boolExpr = isBool ? parseBoolExpr(tokenizeBoolQuery(searchQuery)) : null;

    // Boolean olmayan sorgular için: mevcut expandQuery + hybrid scoring
    // Boolean sorgular için: önce Boolean filtre, sonra pozitif terimlerle scoring
    const scoringQuery = boolExpr
      ? extractPositiveTerms(boolExpr).join(' ')
      : expandQuery(rawQ);

    const semanticScoreMap = new Map((semanticResults || []).map((r) => [r.assetId, r.score]));
    const threshold = semanticMatchThreshold(searchSensitivity);

    const scored: Array<{ asset: Asset; finalScore: number }> = [];

    for (const asset of result) {
      const searchText = buildFullSearchableText(asset);

      // Boolean filtre — eşleşmiyorsa bu asset'i atla
      if (boolExpr && !evalBoolExpr(boolExpr, searchText)) continue;

      const kwScore = scoringQuery ? computeKeywordScore(searchText, scoringQuery) : (boolExpr ? 0.5 : 0);
      const semScore = semanticScoreMap.get(asset.id) || 0;

      if (kwScore === 0 && semScore === 0) continue;

      let finalScore = computeHybridFinalScore(kwScore, semScore, threshold);
      if (isInSelectedRoot(asset.filePath)) finalScore = Math.min(1, finalScore + ROOT_BOOST);
      const minDisplayScore = searchSensitivity / 100;

      if ((kwScore > 0 || semScore >= threshold) && finalScore >= minDisplayScore) {
        scored.push({ asset, finalScore });
      }
    }

    scored.sort((a, b) => b.finalScore - a.finalScore);
    return scored.map((s) => s.asset);
  }

  return result;
}

export function buildSearchScoreMap(args: {
  filteredAssets: Asset[];
  searchQuery: string;
  semanticResults: Array<{ assetId: string; score: number; chunkId?: string }> | null;
  isImageSearching: boolean;
  searchSensitivity: number;
  isVisualVectorQuery: boolean;
}): Record<string, number> | undefined {
  const {
    filteredAssets,
    searchQuery,
    semanticResults,
    isImageSearching,
    searchSensitivity,
    isVisualVectorQuery,
  } = args;

  if (!searchQuery.trim() || isImageSearching) return undefined;

  if (isVisualVectorQuery) {
    const visualMap: Record<string, number> = {};
    const visualScores = new Map((semanticResults || []).map((r) => [r.assetId, r.score]));
    for (const asset of filteredAssets) {
      const score = visualScores.get(asset.id);
      if (score !== undefined) visualMap[asset.id] = score;
    }
    return Object.keys(visualMap).length > 0 ? visualMap : undefined;
  }

  const isBool = hasBooleanOperators(searchQuery);
  const boolExpr = isBool ? parseBoolExpr(tokenizeBoolQuery(searchQuery)) : null;
  const q = boolExpr
    ? extractPositiveTerms(boolExpr).join(' ')
    : expandQuery(turkishLower(searchQuery));
  const semanticScores = new Map((semanticResults || []).map((r) => [r.assetId, r.score]));
  const map: Record<string, number> = {};
  const threshold = semanticMatchThreshold(searchSensitivity);

  for (const asset of filteredAssets) {
    const searchText = buildFullSearchableText(asset);
    const kwScore = q ? computeKeywordScore(searchText, q) : (boolExpr ? 0.5 : 0);
    const semScore = semanticScores.get(asset.id) || 0;
    const finalScore = computeHybridFinalScore(kwScore, semScore, threshold);
    if (finalScore > 0) map[asset.id] = finalScore;
  }

  return Object.keys(map).length > 0 ? map : undefined;
}
