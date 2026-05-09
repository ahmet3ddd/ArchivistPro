/**
 * Kullanım Senaryoları — Admin & Viewer × 3 Kademe
 *
 * Gerçek sql.js in-memory DB üzerinde entegrasyon testleri.
 * Senaryolar mimarlık ofisi bağlamında gerçekçi dosya tipleriyle çalışır.
 *
 * Kademe 1: Küçük Veri  — ~50 dosya  (tek proje, başlangıç)
 * Kademe 2: Orta Veri   — ~850 dosya (5+ proje, aktif kullanım)
 * Kademe 3: Büyük Veri  — 5000+ dosya (ofis çapında, uzun süreli arşiv)
 */

import { createTestDatabase } from './helpers/sqlJsTestDb';
import {
    _setDbForTesting,
    upsertAsset,
    getAllAssets,
    getAssetById,
    softDeleteAsset,
    restoreAsset,
    getDeletedAssets,
    permanentlyDeleteAsset,
    emptyTrashDb,
    getTrashCount,
    addScannedRoot,
    removeScannedRoot,
    reactivateScannedRoot,
    getScannedRoots,
    deleteScannedRootWithAssets,
    updateRootScanInfo,
    createRootGroup,
    getRootGroups,
    deleteRootGroup,
    setRootGroup,
    updateAssetFields,
    addAssetRelation,
    getRelationsForAsset,
    saveDatabase,
    setArchiveRegistry,
    purgeExpiredTrash,
    MAIN_ARCHIVE_ID,
} from '../services/database';
import { setRuntimeRole, hasPermission, setRuntimeDeveloper } from '../permissions/roles';
import {
    setTagDb,
    createTag,
    getAllTags,
    deleteTag,
    renameTag,
    addTagToAsset,
    removeTagFromAsset,
    getTagsForAsset,
    getTagsForAssets,
    mergeTags,
    updateTagColor,
} from '../services/tagService';
import {
    setFavoritesDb,
    addFavorite,
    removeFavorite,
    isFavorite,
    getAllFavoriteIds,
    getFavoriteCount,
    createCollection,
    getAllCollections,
    deleteCollection,
    renameCollection,
    addToCollection,
    removeFromCollection,
    getCollectionAssetIds,
    getCollectionsForAsset,
} from '../services/favorites';

/* ── Mock'lar ── */

vi.mock('../services/logger', () => ({
    auditLog: vi.fn(),
    debugLog: vi.fn(),
    setLoggerDb: vi.fn(),
}));

vi.mock('../services/database', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/database')>();
    return {
        ...actual,
        saveDatabase: vi.fn(),
        saveDatabaseDeferred: vi.fn(),
    };
});


vi.mock('../services/messageService', () => ({
    setMessageDb: vi.fn(),
}));

vi.mock('../services/userService', () => ({
    setUserDb: vi.fn(),
}));

vi.mock('../services/rootTagService', () => ({
    setRootTagDb: vi.fn(),
}));

/* ── Dosya Tipleri & Sabitler ── */

const FILE_TYPES = ['DWG', 'DXF', 'RVT', 'IFC', 'MAX', 'SKP', 'PDF', 'DOC', 'JPG', 'PNG', 'PSD', 'MP4', '3DS', 'FBX'];
const CATEGORIES = ['2D Çizim', '3D Model', 'Döküman', 'Render', 'Fotoğraf', 'Video'];
const PROJECTS = ['Konut-A', 'Ofis-B', 'AVM-C', 'Villa-D', 'Otel-E', 'Hastane-F', 'Okul-G', 'Fabrika-H'];
const PHASES = ['Konsept', 'Avan', 'Ruhsat', 'Uygulama'];
const MATERIALS = ['Beton', 'Cam', 'Metal', 'Ahşap', 'Taş', 'Seramik'];
const STYLES = ['Modern', 'Minimalist', 'Endüstriyel', 'Brütalist', 'Neoklasik'];

function pick<T>(arr: T[], i: number): T {
    return arr[i % arr.length];
}

/** N adet gerçekçi asset objesi üretir */
function generateAssets(count: number, rootPath = 'C:/Arsiv') {
    const assets = [];
    for (let i = 0; i < count; i++) {
        const project = pick(PROJECTS, i);
        const fileType = pick(FILE_TYPES, i);
        const ext = fileType.toLowerCase();
        const category = pick(CATEGORIES, i);
        const phase = pick(PHASES, i);
        assets.push({
            id: `asset-${String(i).padStart(5, '0')}`,
            fileName: `${project}_${phase}_${i}.${ext}`,
            filePath: `${rootPath}/${project}/${project}_${phase}_${i}.${ext}`,
            fileSize: 1024 * (i + 1),
            fileType,
            category,
            createdAt: `2026-0${(i % 9) + 1}-01T00:00:00Z`,
            modifiedAt: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T12:00:00Z`,
            projectName: project,
            projectPhase: phase,
            materialGroup: pick(MATERIALS, i),
            architecturalStyle: pick(STYLES, i),
            hash: `sha256-${i}`,
        });
    }
    return assets;
}

/** Asset listesini DB'ye toplu ekle — transaction ile hızlı */
function bulkInsertAssets(db: any, assets: ReturnType<typeof generateAssets>) {
    db.run('BEGIN TRANSACTION');
    for (const a of assets) {
        db.run(
            `INSERT INTO assets (id, file_name, file_path, file_size, file_type, category,
             created_at, modified_at, project_name, project_phase, material_group,
             architectural_style, is_indexed, hash, is_deleted)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0)`,
            [a.id, a.fileName, a.filePath, a.fileSize, a.fileType, a.category,
             a.createdAt, a.modifiedAt, a.projectName, a.projectPhase,
             a.materialGroup, a.architecturalStyle, a.hash]
        );
    }
    db.run('COMMIT');
}

/** Paylaşımlı arşiv registry'sini ayarla (assertWriteAccess için) */
function setupSharedArchive() {
    setArchiveRegistry([{
        id: MAIN_ARCHIVE_ID,
        name: 'Ana Arşiv',
        type: 'shared',
        createdAt: '2026-01-01T00:00:00Z',
    }]);
}

/** SQL ile asset sayısı (getAllAssets'ten çok daha hafif) */
function countAssets(db: any): number {
    const r = db.exec('SELECT COUNT(*) FROM assets WHERE is_deleted = 0');
    return r[0]?.values[0]?.[0] as number ?? 0;
}

/** SQL ile root status sorgula (getScannedRoots sadece active döndürür) */
function getRootStatus(db: any, rootId: string): string | null {
    const r = db.exec(`SELECT status FROM scanned_roots WHERE id = '${rootId}'`);
    return r[0]?.values[0]?.[0] as string ?? null;
}

// ═════════════════════════════════════════════════════════════════════
// ADMIN SENARYOLARI
// ═════════════════════════════════════════════════════════════════════

describe('Admin Senaryoları', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        setTagDb(db);
        setFavoritesDb(db);
        setRuntimeRole('admin');
        setRuntimeDeveloper(false);
        setupSharedArchive();
        vi.clearAllMocks();
    });

    afterEach(() => {
        _setDbForTesting(null);
        setTagDb(null);
        setFavoritesDb(null);
        setRuntimeRole(null);
        setArchiveRegistry([]);
        db.close();
    });

    // ─────────────────────────────────────────────────────────────────
    // KADEME 1: KÜÇÜK VERİ — 50 Dosya
    // Senaryo: Küçük mimarlık ofisi, tek proje, ilk kurulum
    // ─────────────────────────────────────────────────────────────────

    describe('Kademe 1 — Küçük Veri (50 dosya)', () => {
        const ASSET_COUNT = 50;
        let assets: ReturnType<typeof generateAssets>;

        beforeEach(() => {
            assets = generateAssets(ASSET_COUNT);
            bulkInsertAssets(db, assets);
        });

        describe('S1.1: İlk Kurulum ve Tarama Simülasyonu', () => {
            it('kaynak klasör ekler ve durum doğrular', () => {
                const rootId = addScannedRoot('C:/Arsiv/Konut-A', 'Konut Projesi A');
                expect(rootId).toBeTruthy();

                const roots = getScannedRoots();
                const root = roots.find(r => r.id === rootId);
                expect(root).toBeDefined();
                expect(root!.label).toBe('Konut Projesi A');
                expect(root!.status).toBe('active');
                // fileCount canlı hesaplanır — Konut-A path'li asset sayısı
                expect(root!.fileCount).toBeGreaterThan(0);
            });

            it('50 asset başarıyla eklenir ve sorgulanır', () => {
                const all = getAllAssets();
                expect(all).toHaveLength(ASSET_COUNT);
            });

            it('tekil asset ID ile sorgulanır', () => {
                const asset = getAssetById('asset-00000');
                expect(asset).not.toBeNull();
                expect(asset!.fileName).toContain('Konut-A');
                expect(asset!.fileType).toBe('DWG');
            });
        });

        describe('S1.2: Etiketleme ve Organizasyon', () => {
            it('etiket oluşturur ve asset\'e atar', () => {
                const tag = createTag('Ruhsat Dosyası', '#ef4444');
                expect(tag).not.toBeNull();
                expect(tag!.name).toBe('Ruhsat Dosyası');

                const ok = addTagToAsset('asset-00000', tag!.id);
                expect(ok).toBe(true);

                const tags = getTagsForAsset('asset-00000');
                expect(tags).toHaveLength(1);
                expect(tags[0].name).toBe('Ruhsat Dosyası');
            });

            it('birden fazla asset\'e aynı etiketi atar', () => {
                const tag = createTag('Önemli');
                for (let i = 0; i < 10; i++) {
                    addTagToAsset(`asset-${String(i).padStart(5, '0')}`, tag!.id);
                }
                const map = getTagsForAssets(assets.slice(0, 10).map(a => a.id));
                for (let i = 0; i < 10; i++) {
                    expect(map[`asset-${String(i).padStart(5, '0')}`]).toHaveLength(1);
                }
            });

            it('etiket yeniden adlandırır', () => {
                const tag = createTag('Eski İsim');
                renameTag(tag!.id, 'Yeni İsim');
                const all = getAllTags();
                expect(all.find(t => t.id === tag!.id)?.name).toBe('Yeni İsim');
            });

            it('etiket rengi günceller', () => {
                const tag = createTag('Renkli', '#000000');
                updateTagColor(tag!.id, '#ff6600');
                const all = getAllTags();
                expect(all.find(t => t.id === tag!.id)?.color).toBe('#ff6600');
            });

            it('etiketi asset\'ten kaldırır', () => {
                const tag = createTag('Geçici');
                addTagToAsset('asset-00005', tag!.id);
                expect(getTagsForAsset('asset-00005')).toHaveLength(1);

                removeTagFromAsset('asset-00005', tag!.id);
                expect(getTagsForAsset('asset-00005')).toHaveLength(0);
            });
        });

        describe('S1.3: Favori ve Koleksiyon Yönetimi', () => {
            it('favorilere ekler/çıkarır/sorgular', () => {
                addFavorite('asset-00001');
                addFavorite('asset-00002');
                expect(isFavorite('asset-00001')).toBe(true);
                expect(getFavoriteCount()).toBe(2);

                removeFavorite('asset-00001');
                expect(isFavorite('asset-00001')).toBe(false);
                expect(getFavoriteCount()).toBe(1);
            });

            it('koleksiyon oluşturur, asset ekler, listeler', () => {
                const col = createCollection('Ruhsat Belgeleri', '#3b82f6');
                expect(col).not.toBeNull();

                addToCollection(col!.id, 'asset-00010');
                addToCollection(col!.id, 'asset-00011');

                const ids = getCollectionAssetIds(col!.id);
                expect(ids).toHaveLength(2);
                expect(ids).toContain('asset-00010');
            });

            it('asset hangi koleksiyonlarda olduğunu sorgular', () => {
                const c1 = createCollection('Koleksiyon-1');
                const c2 = createCollection('Koleksiyon-2');
                addToCollection(c1!.id, 'asset-00020');
                addToCollection(c2!.id, 'asset-00020');

                const cols = getCollectionsForAsset('asset-00020');
                expect(cols).toHaveLength(2);
            });
        });

        describe('S1.4: Çöp Kutusu Yönetimi', () => {
            it('asset\'i çöpe atar ve geri yükler', () => {
                expect(softDeleteAsset('asset-00003')).toBe(true);

                // getAllAssets çöpteki asset'i göstermez
                const all = getAllAssets();
                expect(all.find(a => a.id === 'asset-00003')).toBeUndefined();

                // Çöp kutusunda görünür
                const trash = getDeletedAssets();
                expect(trash.find(a => a.id === 'asset-00003')).toBeDefined();

                // Geri yükleme
                expect(restoreAsset('asset-00003')).toBe(true);
                expect(getAssetById('asset-00003')).not.toBeNull();
            });

            it('kalıcı silme tüm ilişkileri temizler', () => {
                const tag = createTag('SilinecekTag');
                addTagToAsset('asset-00004', tag!.id);
                addFavorite('asset-00004');

                softDeleteAsset('asset-00004');
                permanentlyDeleteAsset('asset-00004');

                expect(getAssetById('asset-00004')).toBeNull();
                expect(isFavorite('asset-00004')).toBe(false);
                expect(getTagsForAsset('asset-00004')).toHaveLength(0);
            });
        });

        describe('S1.5: Asset Alan Güncelleme', () => {
            it('müşteri adı ve onay durumu günceller', () => {
                updateAssetFields('asset-00000', {
                    clientName: 'Yılmaz İnşaat',
                    approvalStatus: 'approved',
                    versionLabel: 'v2.1',
                });
                const asset = getAssetById('asset-00000');
                expect(asset!.clientName).toBe('Yılmaz İnşaat');
                expect(asset!.approvalStatus).toBe('approved');
                expect(asset!.versionLabel).toBe('v2.1');
            });
        });

        describe('S1.6: Asset İlişkileri', () => {
            it('iki asset arasında ilişki kurar', () => {
                const rel = addAssetRelation({
                    sourceId: 'asset-00000',
                    targetId: 'asset-00001',
                    relationType: 'version_of',
                    notes: 'Revize edilmiş plan',
                    createdAt: '2026-04-19T00:00:00Z',
                    createdBy: 'admin',
                });
                expect(rel).not.toBeNull();

                const rels = getRelationsForAsset('asset-00000');
                expect(rels.length).toBeGreaterThanOrEqual(1);
                expect(rels[0].relationType).toBe('version_of');
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // KADEME 2: ORTA VERİ — 850 Dosya
    // Senaryo: Orta ölçekli ofis, 5+ aktif proje, günlük kullanım
    // ─────────────────────────────────────────────────────────────────

    describe('Kademe 2 — Orta Veri (850 dosya)', () => {
        const ASSET_COUNT = 850;
        let assets: ReturnType<typeof generateAssets>;

        beforeEach(() => {
            assets = generateAssets(ASSET_COUNT);
            bulkInsertAssets(db, assets);
        });

        describe('S2.1: Çoklu Proje Klasörü Yönetimi', () => {
            it('birden fazla kaynak klasör ekler ve grup oluşturur', () => {
                const rootIds: string[] = [];
                for (const project of ['Konut-A', 'Ofis-B', 'AVM-C', 'Villa-D', 'Otel-E']) {
                    const id = addScannedRoot(`C:/Arsiv/${project}`, project);
                    rootIds.push(id);
                }
                expect(getScannedRoots()).toHaveLength(5);

                // Grup oluştur
                const groupId = createRootGroup('Aktif Projeler', '#22c55e');
                expect(groupId).toBeTruthy();

                // İlk 3 klasörü gruba ata
                for (let i = 0; i < 3; i++) {
                    setRootGroup(rootIds[i], groupId);
                }

                const groups = getRootGroups();
                expect(groups).toHaveLength(1);
                expect(groups[0].name).toBe('Aktif Projeler');
            });

            it('kaynak klasörü kaldırır (soft) ve geri aktifleştirir', () => {
                const rootId = addScannedRoot('C:/Arsiv/Konut-A');
                removeScannedRoot(rootId);

                // getScannedRoots sadece active döndürür — doğrudan DB'den kontrol
                const status = getRootStatus(db, rootId);
                expect(status).toBe('removed');

                reactivateScannedRoot(rootId);
                const roots = getScannedRoots();
                const reactivated = roots.find(r => r.id === rootId);
                expect(reactivated).toBeDefined();
                expect(reactivated!.status).toBe('active');
            });

            it('kaynak klasörü ile birlikte tüm asset\'leri siler', () => {
                const rootId = addScannedRoot('C:/Arsiv/Konut-A');
                const konutCount = assets.filter(a => a.filePath.startsWith('C:/Arsiv/Konut-A/')).length;
                const beforeCount = countAssets(db);

                const deleted = deleteScannedRootWithAssets(rootId);
                expect(deleted).toBe(konutCount);

                const afterCount = countAssets(db);
                expect(afterCount).toBe(beforeCount - konutCount);
            });
        });

        describe('S2.2: Toplu Etiketleme ve Organizasyon', () => {
            it('proje bazlı toplu etiketleme (100+ asset)', () => {
                const tag = createTag('Konut Projesi', '#8b5cf6');
                const konutAssets = assets.filter(a => a.projectName === 'Konut-A');
                expect(konutAssets.length).toBeGreaterThan(50);

                // Toplu etiketleme
                db.run('BEGIN TRANSACTION');
                for (const a of konutAssets) {
                    db.run('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)', [a.id, tag!.id]);
                }
                db.run('COMMIT');

                // Toplu sorgu
                const map = getTagsForAssets(konutAssets.map(a => a.id));
                expect(Object.keys(map)).toHaveLength(konutAssets.length);
            }, 15000);

            it('etiket birleştirme (merge) — iki etiketi tek etikette birleştirir', () => {
                const tagA = createTag('Ruhsat');
                const tagB = createTag('İzin Belgeleri');

                addTagToAsset('asset-00000', tagA!.id);
                addTagToAsset('asset-00001', tagA!.id);
                addTagToAsset('asset-00002', tagB!.id);

                const ok = mergeTags(tagB!.id, tagA!.id);
                expect(ok).toBe(true);

                // tagA artık 3 asset'e sahip
                const map = getTagsForAssets(['asset-00000', 'asset-00001', 'asset-00002']);
                expect(map['asset-00002']?.[0]?.name).toBe('Ruhsat');

                // tagB silindi
                const all = getAllTags();
                expect(all.find(t => t.id === tagB!.id)).toBeUndefined();
            });

            it('çoklu koleksiyon yönetimi', () => {
                const cols = [
                    createCollection('Sunum Dosyaları', '#f59e0b'),
                    createCollection('Keşif Metrajı', '#10b981'),
                    createCollection('Statik Hesaplar', '#6366f1'),
                ];

                // Toplu ekleme — doğrudan SQL (performans)
                db.run('BEGIN TRANSACTION');
                for (let c = 0; c < cols.length; c++) {
                    for (let i = 0; i < 20; i++) {
                        db.run('INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)',
                            [cols[c]!.id, assets[c * 100 + i].id]);
                    }
                }
                db.run('COMMIT');

                const allCols = getAllCollections();
                expect(allCols).toHaveLength(3);
                for (const col of allCols) {
                    expect(col.itemCount).toBe(20);
                }

                // Koleksiyon sil
                deleteCollection(cols[2]!.id);
                expect(getAllCollections()).toHaveLength(2);
            });
        });

        describe('S2.3: Çöp Kutusu Toplu İşlemler', () => {
            it('30 asset\'i çöpe atar ve toplu boşaltır', () => {
                for (let i = 0; i < 30; i++) {
                    softDeleteAsset(`asset-${String(i).padStart(5, '0')}`);
                }
                expect(getTrashCount()).toBe(30);

                const purged = emptyTrashDb();
                expect(purged).toBe(30);
                expect(getTrashCount()).toBe(0);
            });
        });

        describe('S2.4: Asset İlişki Ağı', () => {
            it('proje içi ilişkiler kurar (plan → render → PDF)', () => {
                addAssetRelation({
                    sourceId: 'asset-00000',
                    targetId: 'asset-00008',
                    relationType: 'render_of',
                    createdAt: '2026-04-19T00:00:00Z',
                    createdBy: 'admin',
                });

                addAssetRelation({
                    sourceId: 'asset-00000',
                    targetId: 'asset-00006',
                    relationType: 'pdf_export',
                    createdAt: '2026-04-19T00:00:00Z',
                    createdBy: 'admin',
                });

                const rels = getRelationsForAsset('asset-00000');
                expect(rels.length).toBe(2);
                const types = rels.map(r => r.relationType).sort();
                expect(types).toEqual(['pdf_export', 'render_of']);
            });
        });

        describe('S2.5: Grup Yönetimi', () => {
            it('birden fazla grup oluşturur ve klasörleri atar', () => {
                const g1 = createRootGroup('Devam Eden', '#22c55e');
                const g2 = createRootGroup('Tamamlanan', '#6b7280');

                const r1 = addScannedRoot('C:/Arsiv/Konut-A');
                const r2 = addScannedRoot('C:/Arsiv/Ofis-B');
                const r3 = addScannedRoot('C:/Arsiv/AVM-C');

                setRootGroup(r1, g1);
                setRootGroup(r2, g1);
                setRootGroup(r3, g2);

                const roots = getScannedRoots();
                expect(roots.find(r => r.id === r1)!.groupId).toBe(g1);
                expect(roots.find(r => r.id === r3)!.groupId).toBe(g2);

                // Grubu sil — atanan klasörler grupsuz kalır
                deleteRootGroup(g1);
                const afterDelete = getScannedRoots();
                expect(afterDelete.find(r => r.id === r1)!.groupId).toBeNull();
            });
        });

        describe('S2.6: Veri Bütünlüğü Kontrolleri', () => {
            it('aynı ID ile upsert mevcut kaydı günceller', () => {
                upsertAsset({
                    id: 'asset-00000',
                    fileName: 'guncellenmis.dwg',
                    filePath: 'C:/Arsiv/Konut-A/guncellenmis.dwg',
                    fileSize: 999999,
                    fileType: 'DWG',
                    category: '2D Çizim',
                    createdAt: '2026-01-01T00:00:00Z',
                    modifiedAt: '2026-04-19T00:00:00Z',
                    projectName: 'Konut-A',
                    projectPhase: 'Uygulama',
                });
                const updated = getAssetById('asset-00000');
                expect(updated!.fileName).toBe('guncellenmis.dwg');
                expect(updated!.fileSize).toBe(999999);
            });

            it('koleksiyondan asset çıkarılınca koleksiyon bozulmaz', () => {
                const col = createCollection('Test');
                addToCollection(col!.id, 'asset-00010');
                addToCollection(col!.id, 'asset-00011');

                removeFromCollection(col!.id, 'asset-00010');

                const ids = getCollectionAssetIds(col!.id);
                expect(ids).toEqual(['asset-00011']);

                const allCols = getAllCollections();
                expect(allCols.find(c => c.id === col!.id)).toBeDefined();
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // KADEME 3: BÜYÜK VERİ — 5000+ Dosya
    // Senaryo: Büyük mimarlık ofisi, 10+ yıllık arşiv, ofis çapında
    // ─────────────────────────────────────────────────────────────────

    // Not: 5000 yerine 2000 kullanılıyor — donanım limitleri nedeniyle ölçeklendirildi.
    // Gerçek ofis ortamında 5000+ dosya beklenir; bu testler oransal senaryoları doğrular.
    describe('Kademe 3 — Büyük Veri (5000+ dosya, test: 2000)', () => {
        const ASSET_COUNT = 2000;
        let assets: ReturnType<typeof generateAssets>;

        beforeEach(() => {
            assets = generateAssets(ASSET_COUNT);
            bulkInsertAssets(db, assets);
        });

        describe('S3.1: Büyük Ölçek Veri Yükleme', () => {
            it('2000 asset başarıyla eklenir (SQL count)', () => {
                expect(countAssets(db)).toBe(ASSET_COUNT);
            });

            it('son eklenen asset doğru veriye sahiptir', () => {
                const last = getAssetById('asset-01999');
                expect(last).not.toBeNull();
                expect(last!.fileType).toBeTruthy();
            });

            it('proje bazlı asset dağılımı kontrol edilir', () => {
                const r = db.exec(
                    `SELECT project_name, COUNT(*) as cnt FROM assets
                     WHERE is_deleted = 0 GROUP BY project_name`
                );
                expect(r[0].values.length).toBe(PROJECTS.length);
                for (const row of r[0].values) {
                    expect(row[1] as number).toBe(250); // 2000 / 8
                }
            });
        });

        describe('S3.2: Büyük Ölçek Etiketleme', () => {
            it('300 asset\'e etiket atar ve toplu sorgular', () => {
                const tag = createTag('Arşivlendi', '#6b7280');
                const targetIds = assets.slice(0, 300).map(a => a.id);

                db.run('BEGIN TRANSACTION');
                for (const id of targetIds) {
                    db.run('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)', [id, tag!.id]);
                }
                db.run('COMMIT');

                const map = getTagsForAssets(targetIds);
                expect(Object.keys(map)).toHaveLength(300);
            });

            it('20 farklı etiket oluşturur', () => {
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 20; i++) {
                    db.run('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)', [`Etiket-${i}`, '#666666']);
                }
                db.run('COMMIT');

                const all = getAllTags();
                expect(all).toHaveLength(20);
            });
        });

        describe('S3.3: Büyük Ölçek Çöp Kutusu', () => {
            it('100 asset\'i çöpe atar ve boşaltır', () => {
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 100; i++) {
                    db.run(
                        `UPDATE assets SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?`,
                        [`asset-${String(i).padStart(5, '0')}`]
                    );
                }
                db.run('COMMIT');

                expect(getTrashCount()).toBe(100);
                expect(countAssets(db)).toBe(ASSET_COUNT - 100);

                const purged = emptyTrashDb();
                expect(purged).toBe(100);
                expect(countAssets(db)).toBe(ASSET_COUNT - 100);
            });

            it('süresi dolmuş çöp kutusunu temizler (purgeExpiredTrash)', () => {
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 10; i++) {
                    db.run(
                        `UPDATE assets SET is_deleted = 1, deleted_at = datetime('now', '-45 days') WHERE id = ?`,
                        [`asset-${String(i).padStart(5, '0')}`]
                    );
                }
                for (let i = 10; i < 15; i++) {
                    db.run(
                        `UPDATE assets SET is_deleted = 1, deleted_at = datetime('now') WHERE id = ?`,
                        [`asset-${String(i).padStart(5, '0')}`]
                    );
                }
                db.run('COMMIT');

                expect(getTrashCount()).toBe(15);
                const purged = purgeExpiredTrash(30);
                expect(purged).toBe(10);
                expect(getTrashCount()).toBe(5);
            });
        });

        describe('S3.4: Büyük Koleksiyonlar', () => {
            it('tek koleksiyona 100 asset ekler', () => {
                const col = createCollection('Dev Koleksiyon');
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 100; i++) {
                    db.run('INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)',
                        [col!.id, assets[i].id]);
                }
                db.run('COMMIT');

                const ids = getCollectionAssetIds(col!.id);
                expect(ids).toHaveLength(100);
            });

            it('bir asset 10 koleksiyona aittir', () => {
                for (let i = 0; i < 10; i++) {
                    const col = createCollection(`Kol-${i}`);
                    addToCollection(col!.id, 'asset-00000');
                }

                const belonging = getCollectionsForAsset('asset-00000');
                expect(belonging).toHaveLength(10);
            });
        });

        describe('S3.5: Büyük Ölçek Favori', () => {
            it('80 favori ekler ve tümünü listeler', () => {
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 80; i++) {
                    db.run(`INSERT OR IGNORE INTO favorites (asset_id, created_at) VALUES (?, datetime('now'))`,
                        [assets[i].id]);
                }
                db.run('COMMIT');

                expect(getFavoriteCount()).toBe(80);
                const ids = getAllFavoriteIds();
                expect(ids).toHaveLength(80);
            });
        });

        describe('S3.6: Çoklu Kaynak Klasörü Ölçeği', () => {
            it('8 kaynak klasör + 3 grup oluşturur', () => {
                const g1 = createRootGroup('Konut');
                const g2 = createRootGroup('Ticari');
                const g3 = createRootGroup('Kamu');

                for (let i = 0; i < PROJECTS.length; i++) {
                    const rootId = addScannedRoot(`C:/Arsiv/${PROJECTS[i]}`, PROJECTS[i]);
                    if (i < 3) setRootGroup(rootId, g1);
                    else if (i < 6) setRootGroup(rootId, g2);
                    else setRootGroup(rootId, g3);
                }

                expect(getScannedRoots()).toHaveLength(8);
                expect(getRootGroups()).toHaveLength(3);
            });
        });
    });
});

// ═════════════════════════════════════════════════════════════════════
// KULLANICI (VIEWER) SENARYOLARI
// ═════════════════════════════════════════════════════════════════════

describe('Viewer (Kullanıcı) Senaryoları', () => {
    let db: any;

    // Not: Shared archive varsayılan olarak AYARLANMAZ.
    // saveDatabase() → assertWriteAccess() zinciri shared archive'da viewer'ı engeller.
    // Kişisel işlemler (etiket, koleksiyon, favori) bu engelden bağımsız test edilir.
    // Yazma engeli testleri (S4.5 vb.) setupSharedArchive() ile açıkça aktifleştirir.

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        setTagDb(db);
        setFavoritesDb(db);
        setRuntimeRole('viewer');
        setRuntimeDeveloper(false);
        vi.clearAllMocks();
    });

    afterEach(() => {
        _setDbForTesting(null);
        setTagDb(null);
        setFavoritesDb(null);
        setRuntimeRole(null);
        setArchiveRegistry([]);
        db.close();
    });

    /** Viewer testlerinde asset eklemek için geçici admin rolü */
    function seedAssets(count: number) {
        setRuntimeRole('admin');
        const assets = generateAssets(count);
        bulkInsertAssets(db, assets);
        setRuntimeRole('viewer');
        return assets;
    }

    // ─────────────────────────────────────────────────────────────────
    // KADEME 1: KÜÇÜK VERİ — 50 Dosya
    // Senaryo: Yeni katılan mimar, salt-okunur ana arşiv erişimi
    // ─────────────────────────────────────────────────────────────────

    describe('Kademe 1 — Küçük Veri (50 dosya)', () => {
        let assets: ReturnType<typeof generateAssets>;

        beforeEach(() => {
            assets = seedAssets(50);
        });

        describe('S4.1: Göz Atma ve Arama', () => {
            it('tüm asset\'leri listeler (okuma yetkisi var)', () => {
                const all = getAllAssets();
                expect(all).toHaveLength(50);
            });

            it('tekil asset detayını görüntüler', () => {
                const asset = getAssetById('asset-00000');
                expect(asset).not.toBeNull();
                expect(asset!.projectName).toBeTruthy();
            });

            it('filtreleme — sadece DWG dosyaları', () => {
                const all = getAllAssets();
                const dwgFiles = all.filter(a => a.fileType === 'DWG');
                expect(dwgFiles.length).toBeGreaterThan(0);
                for (const f of dwgFiles) {
                    expect(f.fileType).toBe('DWG');
                }
            });
        });

        describe('S4.2: Favori Yönetimi (izin var)', () => {
            it('favori ekler ve listeler', () => {
                addFavorite('asset-00003');
                addFavorite('asset-00007');
                expect(getFavoriteCount()).toBe(2);
                expect(isFavorite('asset-00003')).toBe(true);
            });

            it('favoriyi kaldırır', () => {
                addFavorite('asset-00005');
                removeFavorite('asset-00005');
                expect(isFavorite('asset-00005')).toBe(false);
            });
        });

        describe('S4.3: Kişisel Koleksiyon (izin var)', () => {
            it('koleksiyon oluşturur ve asset ekler', () => {
                const col = createCollection('Referanslarım', '#a855f7');
                expect(col).not.toBeNull();

                addToCollection(col!.id, 'asset-00010');
                addToCollection(col!.id, 'asset-00020');

                const ids = getCollectionAssetIds(col!.id);
                expect(ids).toHaveLength(2);
            });

            it('koleksiyon yeniden adlandırır', () => {
                const col = createCollection('Eski');
                renameCollection(col!.id, 'Güncel Referanslar');
                const all = getAllCollections();
                expect(all[0].name).toBe('Güncel Referanslar');
            });
        });

        describe('S4.4: Etiket Yönetimi (izin var)', () => {
            it('kendi etiketi oluşturur ve asset\'e atar', () => {
                const tag = createTag('Beğendim', '#ec4899');
                addTagToAsset('asset-00002', tag!.id);

                const tags = getTagsForAsset('asset-00002');
                expect(tags).toHaveLength(1);
                expect(tags[0].name).toBe('Beğendim');
            });
        });

        describe('S4.5: Yazma Engeli — Paylaşımlı Arşiv İşlemleri', () => {
            // Her test önce shared archive kaydeder — assertWriteAccess aktif olur
            beforeEach(() => setupSharedArchive());

            it('asset silme engellenir (softDeleteAsset)', () => {
                expect(() => softDeleteAsset('asset-00000')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('asset geri yükleme engellenir (restoreAsset)', () => {
                expect(() => restoreAsset('asset-00000')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('kalıcı silme engellenir (permanentlyDeleteAsset)', () => {
                expect(() => permanentlyDeleteAsset('asset-00000')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('çöp kutusu boşaltma engellenir (emptyTrashDb)', () => {
                expect(() => emptyTrashDb()).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('kaynak klasör ekleme engellenir (addScannedRoot)', () => {
                expect(() => addScannedRoot('C:/Yeni')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('kaynak klasör silme engellenir (removeScannedRoot)', () => {
                expect(() => removeScannedRoot('root-1')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('asset alan güncelleme engellenir (updateAssetFields)', () => {
                expect(() => updateAssetFields('asset-00000', { clientName: 'X' })).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('asset ilişki ekleme engellenir (addAssetRelation)', () => {
                expect(() => addAssetRelation({
                    sourceId: 'asset-00000',
                    targetId: 'asset-00001',
                    relationType: 'version_of',
                    createdAt: '2026-04-19T00:00:00Z',
                    createdBy: 'viewer',
                })).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });

            it('root grup oluşturma engellenir (createRootGroup)', () => {
                expect(() => createRootGroup('Test')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
            });
        });

        describe('S4.6: Yetki Matrisi Doğrulama', () => {
            it('viewer temel okuma yetkilerine sahiptir', () => {
                expect(hasPermission('viewer', 'archive.read')).toBe(true);
                expect(hasPermission('viewer', 'local.read')).toBe(true);
                expect(hasPermission('viewer', 'ai.use')).toBe(true);
            });

            it('viewer yönetim yetkilerine sahip değildir', () => {
                expect(hasPermission('viewer', 'archive.write')).toBe(false);
                expect(hasPermission('viewer', 'archive.delete')).toBe(false);
                expect(hasPermission('viewer', 'archive.scan')).toBe(false);
                expect(hasPermission('viewer', 'users.manage')).toBe(false);
                expect(hasPermission('viewer', 'settings.manage')).toBe(false);
                expect(hasPermission('viewer', 'logs.view')).toBe(false);
            });

            it('developer bayrağı ek yetkiler verir', () => {
                expect(hasPermission('viewer', 'archive.scan', true)).toBe(true);
                expect(hasPermission('viewer', 'archive.refile', true)).toBe(true);
                expect(hasPermission('viewer', 'settings.manage', true)).toBe(true);
                expect(hasPermission('viewer', 'logs.view', true)).toBe(true);
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // KADEME 2: ORTA VERİ — 850 Dosya
    // Senaryo: Aktif mimar, günlük çalışma — arama, koleksiyon, favori
    // ─────────────────────────────────────────────────────────────────

    describe('Kademe 2 — Orta Veri (850 dosya)', () => {
        let assets: ReturnType<typeof generateAssets>;

        beforeEach(() => {
            assets = seedAssets(850);
        });

        describe('S5.1: Gelişmiş Filtreleme', () => {
            it('proje bazlı filtreleme (SQL ile)', () => {
                const r = db.exec(
                    `SELECT COUNT(*) FROM assets WHERE project_name = 'Konut-A' AND is_deleted = 0`
                );
                const count = r[0].values[0][0] as number;
                expect(count).toBeGreaterThan(50);
            });

            it('dosya tipi + proje çapraz filtre', () => {
                const r = db.exec(
                    `SELECT COUNT(*) FROM assets WHERE file_type = 'DWG' AND project_name = 'Konut-A' AND is_deleted = 0`
                );
                expect(r[0].values[0][0] as number).toBeGreaterThan(0);
            });

            it('faz bazlı filtreleme', () => {
                const r = db.exec(
                    `SELECT COUNT(*) FROM assets WHERE project_phase = 'Ruhsat' AND is_deleted = 0`
                );
                expect(r[0].values[0][0] as number).toBeGreaterThan(100);
            });
        });

        describe('S5.2: Çoklu Koleksiyon Yönetimi', () => {
            it('3 koleksiyon oluşturur, farklı projelerden asset ekler', () => {
                const c1 = createCollection('Sunum Dosyaları');
                const c2 = createCollection('Detay Çizimleri');
                const c3 = createCollection('İş Bitirme');

                // Toplu ekleme — doğrudan SQL (performans)
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 15; i++) {
                    db.run('INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)', [c1!.id, assets[i].id]);
                    db.run('INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)', [c2!.id, assets[100 + i].id]);
                    db.run('INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)', [c3!.id, assets[200 + i].id]);
                }
                db.run('COMMIT');

                const all = getAllCollections();
                expect(all).toHaveLength(3);
                expect(all.every(c => c.itemCount === 15)).toBe(true);
            });

            it('aynı asset birden fazla koleksiyonda olabilir', () => {
                const c1 = createCollection('A');
                const c2 = createCollection('B');
                const c3 = createCollection('C');

                addToCollection(c1!.id, 'asset-00050');
                addToCollection(c2!.id, 'asset-00050');
                addToCollection(c3!.id, 'asset-00050');

                const cols = getCollectionsForAsset('asset-00050');
                expect(cols).toHaveLength(3);
            });
        });

        describe('S5.3: Etiket Bazlı Organizasyon', () => {
            it('5 etiket oluşturur ve farklı asset gruplarına atar', () => {
                // Etiket oluşturma
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 5; i++) {
                    db.run('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)', [`Kategori-${i}`, '#6366f1']);
                }
                db.run('COMMIT');

                const tags = getAllTags();
                expect(tags).toHaveLength(5);

                // Toplu atama — doğrudan SQL
                db.run('BEGIN TRANSACTION');
                for (let t = 0; t < 5; t++) {
                    for (let a = 0; a < 10; a++) {
                        db.run('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)',
                            [assets[t * 50 + a].id, tags[t].id]);
                    }
                }
                db.run('COMMIT');

                const targetIds = assets.slice(0, 10).map(a => a.id);
                const map = getTagsForAssets(targetIds);
                for (const id of targetIds) {
                    expect(map[id]).toHaveLength(1);
                    expect(map[id][0].name).toBe('Kategori-0');
                }
            });
        });

        describe('S5.4: Favori Bazlı Çalışma Akışı', () => {
            it('favorileri kullanarak kısa liste oluşturur', () => {
                for (let i = 0; i < 20; i++) {
                    addFavorite(assets[i * 10].id);
                }
                expect(getFavoriteCount()).toBe(20);

                const favIds = getAllFavoriteIds();
                expect(favIds).toHaveLength(20);

                // Rastgele favoriyi doğrula
                const asset = getAssetById(favIds[0]);
                expect(asset).not.toBeNull();
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // KADEME 3: BÜYÜK VERİ — 5000+ Dosya
    // Senaryo: Ofis çapında arşiv, büyük veri setinde okuma işlemleri
    // ─────────────────────────────────────────────────────────────────

    // Not: 5000 yerine 2000 kullanılıyor — donanım limitleri nedeniyle ölçeklendirildi.
    describe('Kademe 3 — Büyük Veri (5000+ dosya, test: 2000)', () => {
        let assets: ReturnType<typeof generateAssets>;

        beforeEach(() => {
            assets = seedAssets(2000);
        });

        describe('S6.1: Büyük Veri Setinde Okuma', () => {
            it('2000 asset sayısı doğrulanır', () => {
                expect(countAssets(db)).toBe(2000);
            });

            it('rastgele erişim — ortadaki asset\'i sorgular', () => {
                const mid = getAssetById('asset-01000');
                expect(mid).not.toBeNull();
                expect(mid!.id).toBe('asset-01000');
            });

            it('kategoriye göre asset dağılımı', () => {
                const r = db.exec(
                    `SELECT category, COUNT(*) as cnt FROM assets
                     WHERE is_deleted = 0 GROUP BY category`
                );
                let total = 0;
                for (const row of r[0].values) {
                    total += row[1] as number;
                }
                expect(total).toBe(2000);
            });
        });

        describe('S6.2: Büyük Ölçek Favori', () => {
            it('80 favori ekler ve doğrular', () => {
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 80; i++) {
                    db.run(`INSERT OR IGNORE INTO favorites (asset_id, created_at) VALUES (?, datetime('now'))`,
                        [assets[i * 5].id]);
                }
                db.run('COMMIT');

                expect(getFavoriteCount()).toBe(80);
                expect(isFavorite(assets[50].id)).toBe(true);
                expect(isFavorite(assets[51].id)).toBe(false);
            });
        });

        describe('S6.3: Büyük Ölçek Koleksiyon', () => {
            it('5 koleksiyon, her biri 30 asset', () => {
                for (let c = 0; c < 5; c++) {
                    const col = createCollection(`Koleksiyon-${c}`);
                    db.run('BEGIN TRANSACTION');
                    for (let i = 0; i < 30; i++) {
                        db.run('INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)',
                            [col!.id, assets[c * 100 + i].id]);
                    }
                    db.run('COMMIT');
                }
                const allCols = getAllCollections();
                expect(allCols).toHaveLength(5);
                for (const col of allCols) {
                    expect(col.itemCount).toBe(30);
                }
            });
        });

        describe('S6.4: Büyük Ölçek Etiketleme', () => {
            it('5 etiket, her biri 50 asset', () => {
                db.run('BEGIN TRANSACTION');
                for (let i = 0; i < 5; i++) {
                    db.run('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)', [`Tag-${i}`, '#666666']);
                }
                db.run('COMMIT');

                const tags = getAllTags();
                db.run('BEGIN TRANSACTION');
                for (let t = 0; t < 5; t++) {
                    for (let a = 0; a < 50; a++) {
                        db.run('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)',
                            [assets[t * 50 + a].id, tags[t].id]);
                    }
                }
                db.run('COMMIT');

                const targetIds = assets.slice(0, 50).map(a => a.id);
                const map = getTagsForAssets(targetIds);
                expect(Object.keys(map).length).toBe(50);
            });
        });

        describe('S6.5: Yazma Engeli Büyük Veri Setinde', () => {
            it('2000 asset okuma başarılı, silme engellenmiş', () => {
                setupSharedArchive();
                expect(countAssets(db)).toBe(2000);
                expect(getAssetById('asset-01500')).not.toBeNull();

                expect(() => softDeleteAsset('asset-01500')).toThrow('Paylaşımlı arşive yazma yetkiniz yok');
                expect(() => updateAssetFields('asset-01500', { clientName: 'X' })).toThrow();
            });
        });

        describe('S6.6: Çapraz İstatistik Kontrolü', () => {
            it('dosya tipi dağılımı doğru', () => {
                const r = db.exec(
                    `SELECT file_type, COUNT(*) as cnt FROM assets
                     WHERE is_deleted = 0 GROUP BY file_type`
                );
                expect(r[0].values.length).toBe(FILE_TYPES.length);
                for (const row of r[0].values) {
                    // 2000 / 14 ≈ 142-143
                    expect(row[1] as number).toBeGreaterThanOrEqual(142);
                }
            });

            it('faz dağılımı dengeli', () => {
                const r = db.exec(
                    `SELECT project_phase, COUNT(*) as cnt FROM assets
                     WHERE is_deleted = 0 GROUP BY project_phase`
                );
                expect(r[0].values.length).toBe(PHASES.length);
                for (const row of r[0].values) {
                    expect(row[1] as number).toBe(500); // 2000 / 4
                }
            });
        });
    });
});
