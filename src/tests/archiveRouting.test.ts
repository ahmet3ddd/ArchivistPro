/**
 * Arşiv Yönlendirme Testleri
 *
 * Rusqlite invoke çağrılarının (scan_write_batch, scan_clear_assets, vb.)
 * aktif arşive göre doğru archiveAt parametresini geçirdiğini doğrular.
 *
 * Kapsam: clearAssetsOnDisk, mirrorRagWriteToDisk, mirrorRagStatusToDisk,
 *         deleteScannedRootRowsOnDisk — main / local / custom arşiv senaryoları.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock'lar ────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn(() => Promise.resolve(null));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
vi.mock('../permissions/roles', () => ({ getAppRole: vi.fn(() => 'admin') }));
vi.mock('../services/logger', () => ({
    auditLog: vi.fn(),
    setLoggerDb: vi.fn(),
    debugLog: vi.fn(),
}));
vi.mock('../services/tagService',    () => ({ setTagDb:      vi.fn() }));
vi.mock('../services/favorites',     () => ({ setFavoritesDb: vi.fn() }));
vi.mock('../services/messageService',() => ({ setMessageDb:  vi.fn() }));
vi.mock('../services/userService',   () => ({ setUserDb:     vi.fn() }));

import {
    setActiveArchive,
    clearAssetsOnDisk,
    mirrorRagWriteToDisk,
    mirrorRagStatusToDisk,
    deleteScannedRootRowsOnDisk,
} from '../services/database';

// ── Test yardımcıları ────────────────────────────────────────────────────────

const RAG_PAYLOAD = {
    chunks: [{ id: 'c1', asset_id: 'a1', chunk_index: 0, page: null, text: 'test', lang: null }],
    embeddings: [],
    deleteChunksFor: [],
};

beforeEach(() => mockInvoke.mockClear());
afterEach(() => setActiveArchive('main')); // her testten sonra main'e geri dön

// ═══════════════════════════════════════════════════════════════════════════════
// clearAssetsOnDisk → scan_clear_assets
// ═══════════════════════════════════════════════════════════════════════════════

describe('clearAssetsOnDisk — archiveAt yönlendirmesi', () => {
    it('main arşivde "main" gönderir', async () => {
        setActiveArchive('main');
        await clearAssetsOnDisk('all');
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_clear_assets',
            expect.objectContaining({ archiveAt: 'main' }),
        );
    });

    it('local arşivde "local" gönderir', async () => {
        setActiveArchive('local');
        await clearAssetsOnDisk('all');
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_clear_assets',
            expect.objectContaining({ archiveAt: 'local' }),
        );
    });

    it('custom arşivde custom ID gönderir', async () => {
        setActiveArchive('archive_ofis_merkez');
        await clearAssetsOnDisk('trash_only');
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_clear_assets',
            expect.objectContaining({ archiveAt: 'archive_ofis_merkez' }),
        );
    });

    it('local arşiv main arşiv ile aynı archiveAt\'ı kullanmaz', async () => {
        setActiveArchive('local');
        await clearAssetsOnDisk('all');
        expect(mockInvoke).not.toHaveBeenCalledWith(
            'scan_clear_assets',
            expect.objectContaining({ archiveAt: 'main' }),
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// mirrorRagWriteToDisk → scan_write_batch
// ═══════════════════════════════════════════════════════════════════════════════

describe('mirrorRagWriteToDisk — archiveAt yönlendirmesi', () => {
    it('main arşivde "main" gönderir', async () => {
        setActiveArchive('main');
        await mirrorRagWriteToDisk(RAG_PAYLOAD);
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_write_batch',
            expect.objectContaining({ archiveAt: 'main' }),
        );
    });

    it('local arşivde "local" gönderir', async () => {
        setActiveArchive('local');
        await mirrorRagWriteToDisk(RAG_PAYLOAD);
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_write_batch',
            expect.objectContaining({ archiveAt: 'local' }),
        );
    });

    it('custom arşivde custom ID gönderir', async () => {
        setActiveArchive('proje_kule');
        await mirrorRagWriteToDisk(RAG_PAYLOAD);
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_write_batch',
            expect.objectContaining({ archiveAt: 'proje_kule' }),
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// mirrorRagStatusToDisk → update_asset_rag_status
// ═══════════════════════════════════════════════════════════════════════════════

describe('mirrorRagStatusToDisk — archiveAt yönlendirmesi', () => {
    const updates = [{ id: 'a1', status: 'indexed', reason: null }];

    it('main arşivde "main" gönderir', async () => {
        setActiveArchive('main');
        await mirrorRagStatusToDisk(updates);
        expect(mockInvoke).toHaveBeenCalledWith(
            'update_asset_rag_status',
            expect.objectContaining({ archiveAt: 'main' }),
        );
    });

    it('local arşivde "local" gönderir', async () => {
        setActiveArchive('local');
        await mirrorRagStatusToDisk(updates);
        expect(mockInvoke).toHaveBeenCalledWith(
            'update_asset_rag_status',
            expect.objectContaining({ archiveAt: 'local' }),
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteScannedRootRowsOnDisk → scan_write_batch
// ═══════════════════════════════════════════════════════════════════════════════

describe('deleteScannedRootRowsOnDisk — archiveAt yönlendirmesi', () => {
    it('main arşivde "main" gönderir', async () => {
        setActiveArchive('main');
        await deleteScannedRootRowsOnDisk(['root-1']);
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_write_batch',
            expect.objectContaining({ archiveAt: 'main' }),
        );
    });

    it('local arşivde "local" gönderir', async () => {
        setActiveArchive('local');
        await deleteScannedRootRowsOnDisk(['root-2']);
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_write_batch',
            expect.objectContaining({ archiveAt: 'local' }),
        );
    });

    it('custom arşivde custom ID gönderir', async () => {
        setActiveArchive('proje_kule');
        await deleteScannedRootRowsOnDisk(['root-3']);
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_write_batch',
            expect.objectContaining({ archiveAt: 'proje_kule' }),
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regresyon: arşiv geçişi sonrası parametre güncelleniyor mu?
// ═══════════════════════════════════════════════════════════════════════════════

describe('Arşiv geçişi sonrası parametre güncellenir', () => {
    it('main → local geçişinde sonraki çağrı "local" gönderir', async () => {
        setActiveArchive('main');
        await clearAssetsOnDisk('all');
        mockInvoke.mockClear();

        setActiveArchive('local');
        await clearAssetsOnDisk('all');
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_clear_assets',
            expect.objectContaining({ archiveAt: 'local' }),
        );
    });

    it('local → custom geçişinde sonraki çağrı custom ID gönderir', async () => {
        setActiveArchive('local');
        await clearAssetsOnDisk('all');
        mockInvoke.mockClear();

        setActiveArchive('archive_42');
        await clearAssetsOnDisk('all');
        expect(mockInvoke).toHaveBeenCalledWith(
            'scan_clear_assets',
            expect.objectContaining({ archiveAt: 'archive_42' }),
        );
    });
});
