/**
 * Türkçe mimari domain sözlüğü ile sorgu genişletme.
 * Kullanıcının arama terimini eş anlamlılar ve ilgili kavramlarla zenginleştirir.
 * Bu sayede "mukarnas" araması "muqarnas, stalaktit" gibi terimleri de kapsar.
 */

import { turkishLower } from '../utils/searchScoring';

const ARCH_SYNONYMS: Record<string, string[]> = {
  // ── Geleneksel süsleme & tezyinat ──────────────────────────────────────────
  mukarnas:    ['muqarnas', 'stalaktit', 'honeycomb vault', 'geometric carving', 'stalactite vault'],
  revzen:      ['vitray', 'stained glass', 'pencere süsü', 'renkli cam'],
  şebeke:      ['lattice', 'kafes', 'kafes pencere', 'openwork', 'mashrabiya'],
  rumi:        ['arabesque', 'islimi', 'rumi motif', 'kıvrımdal'],
  hatayi:      ['hatayi', 'floral arabesque', 'çiçek motifi'],
  palmet:      ['palmette', 'anthemion', 'palmiye yaprağı'],
  lotus:       ['lotus', 'nilüfer', 'su zambağı motifi'],
  lale:        ['tulip', 'lale motifi', 'osmanlı lalesi'],
  şemse:       ['medallion', 'güneş motifi', 'rozet'],
  zencerek:    ['interlace', 'geçme bordür', 'örgü bordür'],
  bordür:      ['border', 'kenar süsü', 'çerçeve', 'frame'],
  köşelik:     ['spandrel', 'köşe motifi', 'corner ornament'],
  tepelik:     ['cresting', 'tepe süsü', 'finial'],
  karanfil:    ['carnation', 'karanfil motifi'],
  fitil:       ['cable motif', 'halat motifi', 'twisted cord'],

  // ── Mimari elemanlar ────────────────────────────────────────────────────────
  niş:         ['niche', 'alcove', 'recess', 'girintili', 'oyuk', 'mihrabiye'],
  profil:      ['profile', 'molding', 'silme', 'kontur', 'kesit detayı', 'corniche'],
  silme:       ['molding', 'cornice', 'profil', 'bant', 'çıkıntı'],
  kemer:       ['arch', 'portal', 'tak', 'arc', 'vault'],
  sütun:       ['column', 'kolon', 'pillar', 'pilaster', 'direk'],
  başlık:      ['capital', 'sütun başlığı', 'column capital', 'capitel'],
  kaide:       ['base', 'plinth', 'podium', 'temel kaidesi'],
  kubbe:       ['dome', 'tonoz', 'dome structure', 'cupola'],
  pandantif:   ['pendentive', 'pandantif', 'köşe tromp'],
  tromp:       ['squinch', 'tromp', 'köşe dolgusu'],
  kasnak:      ['drum', 'tambour', 'kubbe kasnak'],
  alem:        ['finial', 'alem', 'tepe alemi', 'crescent finial'],
  şerefe:      ['balcony', 'minare şerefesi', 'muezzin balcony'],
  minare:      ['minaret', 'kule', 'cami kulesi'],
  mihrap:      ['mihrab', 'prayer niche', 'kıble nişi'],
  minber:      ['minbar', 'pulpit', 'vaaz kürsüsü'],
  fil_gözü:   ['oculus', 'round window', 'yuvarlak pencere', 'porthole'],
  vitray:      ['stained glass', 'renkli cam', 'revzen'],

  // ── Yapı türleri ────────────────────────────────────────────────────────────
  kulle:       ['külliye', 'mosque complex', 'dini külliye'],
  türbe:       ['mausoleum', 'tomb', 'kümbet', 'anıt mezar'],
  çeşme:       ['fountain', 'su çeşmesi', 'sebil'],
  sebil:       ['sebil', 'public fountain', 'su dağıtım yapısı'],
  han:         ['caravanserai', 'kervansaray', 'inn'],
  hamam:       ['bathhouse', 'turkish bath', 'hamamı'],

  // ── Mekanlar ────────────────────────────────────────────────────────────────
  avlu:        ['courtyard', 'iç bahçe', 'court', 'atrium'],
  eyvan:       ['iwan', 'alcove hall', 'eyvan mekanı', 'vaulted hall'],
  revak:       ['portico', 'arcade', 'colonnade', 'revaklı geçit', 'loggia'],
  son_cemaat:  ['son cemaat yeri', 'narthex', 'pronaos', 'giriş revağı'],
  şadırvan:    ['ablution fountain', 'wudu fountain', 'şadırvan havuzu'],
  sofa:        ['sofa', 'hayat', 'orta sofa', 'central hall'],
  hayat:       ['hayat', 'sofa', 'yarı açık mekan', 'semi-open space'],
  selamlık:    ['selamlık', 'men\'s quarters', 'reception area'],
  harem:       ['harem', 'women\'s quarters', 'private quarters'],

  // ── Çizim türleri ───────────────────────────────────────────────────────────
  'kat planı': ['floor plan', 'zemin planı', 'plan', 'building plan'],
  vaziyet:     ['site plan', 'vaziyet planı', 'situation plan', 'master plan'],
  cephe:       ['facade', 'elevation', 'ön görünüş', 'yan görünüş', 'cephe çizimi'],
  kesit:       ['section', 'cross section', 'enine kesit', 'boyuna kesit'],
  detay:       ['detail', 'ayrıntı', 'yapım detayı', 'construction detail'],
  'strüktür':  ['structural', 'taşıyıcı sistem', 'statik', 'structural plan'],
  tesisat:     ['mep', 'mechanical', 'plumbing', 'hvac', 'tesisat planı'],
  elektrik:    ['electrical', 'electric plan', 'elektrik planı'],
  çatı:        ['roof plan', 'çatı planı', 'roof', 'roofing'],
  süsleme:     ['ornament', 'decoration', 'tezyinat', 'süsleme detayı', 'ornamental detail'],
  restorasyon: ['restoration', 'rehabilitation', 'onarım', 'renovasyon', 'renovation'],

  // ── Malzeme & yapım ─────────────────────────────────────────────────────────
  çini:        ['tile', 'ceramic tile', 'iznik tile', 'faience', 'mosaic tile'],
  'kalem işi': ['painted decoration', 'fresco', 'duvar resmi', 'mural painting'],
  alçı:        ['stucco', 'plaster', 'gypsum', 'alçı işçiliği', 'plasterwork'],
  mermer:      ['marble', 'mermer kaplama', 'marble cladding'],
  traverten:   ['travertine', 'kireç taşı', 'doğal taş'],
  kundekari:   ['woodwork', 'geometric woodwork', 'ahşap geçme', 'kündekari'],
  ahşap_oyma:  ['wood carving', 'ahşap oyma', 'carved wood'],
  geçme:       ['interlocking', 'geçme tekniği', 'interlace', 'joinery'],
  taş_işçiliği:['stone carving', 'taş oyma', 'masonry', 'stonework'],

  // ── Genel arama iyileştirme ─────────────────────────────────────────────────
  salon:       ['living room', 'oturma odası', 'lounge', 'sitting room'],
  mutfak:      ['kitchen', 'yemek', 'cooking area'],
  yatak:       ['bedroom', 'yatak odası', 'sleeping'],
  banyo:       ['bathroom', 'bath', 'toilet'],
  koridor:     ['corridor', 'hallway', 'geçit', 'hole'],
  merdiven:    ['stair', 'staircase', 'stairway', 'basamak'],
  çatı_katı:   ['attic', 'mansard', 'loft'],
  bodrum:      ['basement', 'underground', 'yeraltı', 'zemin altı'],
};

/**
 * Kullanıcı sorgusunu mimari domain sözlüğüyle genişletir.
 * Orijinal sorgu korunur, bulunan eş anlamlılar eklenir.
 *
 * @param query - Kullanıcının girdiği arama metni
 * @returns Genişletilmiş arama metni (orijinal + eş anlamlılar)
 */
export function expandQuery(query: string): string {
  if (!query || !query.trim()) return query;

  const lower = turkishLower(query).trim();
  const expansions: string[] = [query];

  for (const [term, synonyms] of Object.entries(ARCH_SYNONYMS)) {
    // Alt çizgileri boşluğa çevir (sözlükteki compound key'ler için)
    const normalizedTerm = term.replace(/_/g, ' ');
    if (lower.includes(normalizedTerm)) {
      expansions.push(...synonyms);
    }
  }

  // Tekrarları kaldır, orijinal terimleri koru, eşanlamlıları max 20 ile sınırla
  const unique = [...new Set(expansions)];
  const originalTerms = query.split(/\s+/);
  const expansionTerms = unique.filter(t => !originalTerms.includes(t));
  return [...originalTerms, ...expansionTerms.slice(0, 20)].join(' ');
}

/**
 * Sadece genişletme yapılıp yapılmadığını kontrol eder (debug için).
 */
export function wasQueryExpanded(query: string): boolean {
  return expandQuery(query) !== query;
}

/**
 * Bir arama eşleşmesinin hangi alandan geldiğini temsil eder.
 * group: 'file'  → DWG binary'den çıkarılan gerçek dosya verisi
 *        'ai'    → AI'ın thumbnail analizi sonucu
 *        'meta'  → Dosya adı, proje adı gibi genel metadata
 */
export interface MatchSource {
  label: string;
  values: string[];
  group: 'file' | 'ai' | 'meta';
}

/**
 * Bir asset'in hangi alanlarında sorgu eşleşmesi olduğunu bulur.
 * Sonuçlar üç gruba ayrılır: dosya içeriği, AI tespiti, genel metadata.
 */
export function findMatchSources(asset: {
  fileName: string;
  projectName: string;
  fileType: string;
  aiTags: Array<{ label: string }>;
  metadata: {
    dwgLayers?: string[];
    dwgBlockNames?: string[];
    dwgTextContents?: string[];
    dwgDomainTerms?: string[];
    dwgKeywords?: string[];
    dwgElements?: string[];
    dwgSpaces?: string[];
    dwgDescription?: string;
    dwgDrawingType?: string;
    dwgProperties?: { title?: string; subject?: string; keywords?: string };
    layers?: string[];
    roomNames?: string[];
  };
}, query: string): MatchSource[] {
  if (!query.trim()) return [];

  const expanded = expandQuery(query);
  const words = [...new Set(
    turkishLower(expanded).split(/[\s,.;:!?]+/).filter(w => w.length > 2)
  )];
  if (words.length === 0) return [];

  const hit = (
    values: (string | undefined | null)[],
    label: string,
    group: MatchSource['group']
  ): MatchSource | null => {
    const matched = values
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .filter(v => words.some(w => turkishLower(v).includes(w)));
    if (matched.length === 0) return null;
    const unique = [...new Set(matched)].map(v => v.length > 70 ? v.slice(0, 67) + '…' : v);
    return { label, values: unique.slice(0, 5), group };
  };

  const sources: MatchSource[] = [];
  const meta = asset.metadata;

  const add = (v: (string | undefined | null)[], label: string, group: MatchSource['group']) => {
    const h = hit(v, label, group);
    if (h) sources.push(h);
  };

  // ── Dosya içeriği (DWG binary'den çıkarılan gerçek veri) ──────────────
  add(meta.dwgLayers || [], 'Katman adında', 'file');
  add(meta.dwgBlockNames || [], 'Blok adında', 'file');
  add(meta.dwgTextContents || [], 'Çizim metninde', 'file');
  add([meta.dwgProperties?.title], 'Dosya başlığında', 'file');
  add([meta.dwgProperties?.subject], 'Dosya konusunda', 'file');
  add([meta.dwgProperties?.keywords], 'Dosya anahtar kelimelerinde', 'file');
  add(meta.layers || [], 'Katman adında', 'file');

  // ── AI tespiti (Ollama/Gemini thumbnail analizi) ────────────────────────
  add(meta.dwgDomainTerms || [], 'Alan terimi olarak tespit edildi', 'ai');
  add(meta.dwgElements || [], 'Eleman olarak tespit edildi', 'ai');
  add(meta.dwgSpaces || [], 'Mekan olarak tespit edildi', 'ai');
  add(meta.dwgKeywords || [], 'Anahtar kelime olarak tespit edildi', 'ai');
  add([meta.dwgDrawingType], 'Çizim türü olarak tespit edildi', 'ai');
  add([meta.dwgDescription], 'AI açıklamasında geçiyor', 'ai');

  // ── Genel metadata ──────────────────────────────────────────────────────
  add([asset.fileName.replace(/\.[^.]+$/, '').replace(/[_.-]/g, ' ')], 'Dosya adında', 'meta');
  add([asset.projectName], 'Proje adında', 'meta');
  add(meta.roomNames || [], 'Mekan adında', 'meta');

  return sources;
}
