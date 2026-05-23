/**
 * Version Detection — Otomatik Versiyon Tespiti
 *
 * Dosya adlarından versiyon bilgisini çıkarır ve aynı temel isme sahip
 * dosyaları versiyon zinciri olarak gruplar.
 *
 * Desteklenen kalıplar:
 *  - _v1, _v2, _V3, -v01        → "v1", "v2", "v3"
 *  - _Rev-A, _RevB, _rev-c      → "Rev-A", "Rev-B", "Rev-C"
 *  - _R01, _R02                  → "R01", "R02"
 *  - _FINAL, _final              → "FINAL"
 *  - _DRAFT, _draft, _TASLAK    → "DRAFT"
 *  - (1), (2), (Copy), (Kopya)  → "(1)", "(2)", "Copy"
 *  - - Copy, - Kopya             → "Copy"
 *  - _eski, _yeni, _son          → "eski", "yeni", "son"
 */

export interface VersionMatch {
    /** Versiyon eki çıkarılmış temel ad (lowercase, normalize) */
    baseName: string;
    /** Tespit edilen versiyon etiketi */
    versionLabel: string;
    /** Sıralama için sayısal değer (yoksa 0) */
    sortOrder: number;
}

/**
 * Versiyon kalıpları — sıra önemli, ilk eşleşen kazanır.
 * Her grup: [regex, label çıkarma fonksiyonu, sıralama fonksiyonu]
 *
 * Regex'ler stem'e (uzantısız, lowercase dosya adı) uygulanır.
 * Capture group 1 = baseName, geri kalanı versiyon bilgisi.
 */
const VERSION_PATTERNS: Array<{
    regex: RegExp;
    label: (match: RegExpMatchArray) => string;
    order: (match: RegExpMatchArray) => number;
}> = [
    // _v1, -v02, _V3, .v10, _v1.2
    {
        regex: /^(.+?)[-_.\s]v(\d+(?:\.\d+)?)$/i,
        label: (m) => `v${m[2]}`,
        order: (m) => parseFloat(m[2]),
    },
    // _Rev-A, _RevB, -rev_c, _REV-AA
    {
        regex: /^(.+?)[-_.\s]rev[-_.]?([a-z]{1,3})$/i,
        label: (m) => `Rev-${m[2].toUpperCase()}`,
        order: (m) => letterOrder(m[2]),
    },
    // _R01, _R02, -R1
    {
        regex: /^(.+?)[-_.\s]r(\d{1,3})$/i,
        label: (m) => `R${m[2].padStart(2, '0')}`,
        order: (m) => parseInt(m[2], 10),
    },
    // _FINAL, _final, _SON
    {
        regex: /^(.+?)[-_.\s](final|son)$/i,
        label: () => 'FINAL',
        order: () => 9999,
    },
    // _DRAFT, _draft, _TASLAK, _taslak
    {
        regex: /^(.+?)[-_.\s](draft|taslak)$/i,
        label: () => 'DRAFT',
        order: () => -1,
    },
    // _eski, _yeni
    {
        regex: /^(.+?)[-_.\s](eski|old)$/i,
        label: (m) => m[2].toUpperCase(),
        order: () => -2,
    },
    {
        regex: /^(.+?)[-_.\s](yeni|new)$/i,
        label: (m) => m[2].toUpperCase(),
        order: () => 9998,
    },
    // (1), (2), (3) — Windows copy pattern
    {
        regex: /^(.+?)\s*\((\d+)\)$/,
        label: (m) => `(${m[2]})`,
        order: (m) => parseInt(m[2], 10),
    },
    // (Copy), (Kopya), - Copy, - Kopya
    {
        regex: /^(.+?)(?:\s*\(|\s*-\s*)(copy|kopya)\)?$/i,
        label: () => 'Copy',
        order: () => -3,
    },
    // Sondaki sayı: plan2, plan3 (en az 1 karakter baseName)
    {
        regex: /^(.{2,}?)[-_.\s](\d{1,3})$/,
        label: (m) => `#${m[2]}`,
        order: (m) => parseInt(m[2], 10),
    },
];

/** A=1, B=2, ..., Z=26, AA=27 */
function letterOrder(s: string): number {
    const upper = s.toUpperCase();
    let n = 0;
    for (let i = 0; i < upper.length; i++) {
        n = n * 26 + (upper.charCodeAt(i) - 64);
    }
    return n;
}

/**
 * Dosya adından versiyon bilgisini çıkarır.
 * Eşleşme yoksa null döner.
 */
export function detectVersion(fileName: string): VersionMatch | null {
    // Uzantıyı kaldır
    const dot = fileName.lastIndexOf('.');
    const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).toLowerCase();

    for (const pattern of VERSION_PATTERNS) {
        const m = stem.match(pattern.regex);
        if (m) {
            return {
                baseName: m[1].trim().toLowerCase(),
                versionLabel: pattern.label(m),
                sortOrder: pattern.order(m),
            };
        }
    }
    return null;
}

/**
 * Asset listesinden versiyon gruplarını oluşturur.
 * Her grup: aynı klasör + aynı baseName + aynı fileType.
 * En az 2 üyeli gruplar döner.
 */
export function groupVersions(
    assets: Array<{ id: string; filePath: string; fileName: string; fileType: string; versionLabel?: string | null }>,
): Map<string, Array<{ id: string; versionLabel: string; sortOrder: number; hasExistingLabel: boolean }>> {
    const groups = new Map<string, Array<{ id: string; versionLabel: string; sortOrder: number; hasExistingLabel: boolean }>>();

    for (const asset of assets) {
        const detected = detectVersion(asset.fileName);
        if (!detected) continue;

        // Klasör yolunu normalize et
        const normalized = asset.filePath.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash).toLowerCase() : '';

        const groupKey = `${dir}|${detected.baseName}|${asset.fileType}`;
        const arr = groups.get(groupKey) ?? [];
        arr.push({
            id: asset.id,
            versionLabel: detected.versionLabel,
            sortOrder: detected.sortOrder,
            hasExistingLabel: !!(asset.versionLabel && asset.versionLabel.trim()),
        });
        groups.set(groupKey, arr);
    }

    // Tek üyeli grupları kaldır
    for (const [key, arr] of groups) {
        if (arr.length < 2) groups.delete(key);
    }

    return groups;
}
