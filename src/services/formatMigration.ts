/**
 * ArchivistPro — Format Migration Tracker
 *
 * Eski/legacy dosya formatlarını tespit eder ve önerilen modern karşılıklarını
 * gösterir. Otomatik dönüştürme YAPMAZ — sadece farkındalık/raporlama.
 *
 * Kullanım: ArchiveHealthModal içinde 4. kategori olarak gösterilir.
 *
 * Kapsam (muhafazakar):
 *  - MS Office binary formatları (.doc, .xls, .ppt) → modern OOXML (.docx, .xlsx, .pptx)
 *
 * NOT: DWG R-versiyon, 3dsMax versiyon eskimişliği yıl bazlı ve subjective olduğu
 * için bu listeye dahil edilmedi. Kullanıcı isterse ileride eklenebilir.
 */

import type { Asset, AssetType } from '../types';

export interface LegacyFormatRule {
    /** Eski format (uppercase, AssetType ile uyumlu) */
    legacyType: AssetType;
    /** Önerilen modern format (uppercase) */
    recommendedType: string;
    /** i18n reason key — health.modal.legacyFormat.reason.* altında */
    reasonKey: string;
}

/**
 * Legacy format kuralları. Yeni kural eklemek için bu listeye satır eklemek yeterli.
 * Anahtar: AssetType enum değeri (uppercase).
 */
export const LEGACY_FORMAT_RULES: Record<string, LegacyFormatRule> = {
    DOC: { legacyType: 'DOC', recommendedType: 'DOCX', reasonKey: 'legacyOffice' },
    XLS: { legacyType: 'XLS', recommendedType: 'XLSX', reasonKey: 'legacyOffice' },
    PPT: { legacyType: 'PPT', recommendedType: 'PPTX', reasonKey: 'legacyOffice' },
};

export interface LegacyFormatGroup {
    legacyType: AssetType;
    recommendedType: string;
    reasonKey: string;
    count: number;
    /** Eşleşen asset'ler — kullanıcı filter uygulayınca aynı listeye gider. */
    assets: Asset[];
}

/**
 * Verilen asset listesinde legacy format'larını tespit eder ve tip bazında gruplar.
 * Sıralama: en çok eşleşen ilk (kullanıcı odağı en büyük gruba).
 *
 * @param assets — kontrol edilecek asset listesi (genelde aktif arşivin tüm asset'leri)
 * @returns boş liste eğer hiçbir legacy format yoksa
 */
export function detectLegacyFormats(assets: Asset[]): LegacyFormatGroup[] {
    const groups = new Map<string, Asset[]>();

    for (const asset of assets) {
        const rule = LEGACY_FORMAT_RULES[asset.fileType];
        if (!rule) continue;
        const list = groups.get(asset.fileType) ?? [];
        list.push(asset);
        groups.set(asset.fileType, list);
    }

    const result: LegacyFormatGroup[] = [];
    for (const [fileType, assetList] of groups.entries()) {
        const rule = LEGACY_FORMAT_RULES[fileType];
        if (!rule) continue;
        result.push({
            legacyType: rule.legacyType,
            recommendedType: rule.recommendedType,
            reasonKey: rule.reasonKey,
            count: assetList.length,
            assets: assetList,
        });
    }

    return result.sort((a, b) => b.count - a.count);
}

/**
 * Toplam legacy asset sayısı — health badge'de özet için.
 */
export function countLegacyAssets(assets: Asset[]): number {
    let count = 0;
    for (const asset of assets) {
        if (LEGACY_FORMAT_RULES[asset.fileType]) count++;
    }
    return count;
}
