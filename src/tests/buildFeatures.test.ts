import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock top-level'da olmalı (Vitest hoisting kuralı)
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.reject(new Error('Tauri not available'))),
}));

import {
    loadBuildFeatures,
    hasAdminFeatures,
    _resetBuildFeaturesForTest,
} from '../services/buildFeatures';

describe('buildFeatures', () => {
    beforeEach(() => {
        _resetBuildFeaturesForTest();
    });

    it('Tauri dışı ortamda (invoke başarısız) admin=true varsayar', async () => {
        const features = await loadBuildFeatures();
        expect(features.admin).toBe(true);
    });

    it('hasAdminFeatures cache yokken true döner (güvenli varsayılan)', () => {
        expect(hasAdminFeatures()).toBe(true);
    });

    it('loadBuildFeatures tekrar çağrılınca cache döner', async () => {
        const first = await loadBuildFeatures();
        const second = await loadBuildFeatures();
        expect(first).toBe(second); // Aynı obje referansı — cache kullanıldı
    });

    it('concurrent çağrılarda sonuçlar aynı (race condition yok)', async () => {
        const p1 = loadBuildFeatures();
        const p2 = loadBuildFeatures();
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toBe(r2);
    });

    it('_resetBuildFeaturesForTest sonrası hasAdminFeatures güvenli varsayılan döner', async () => {
        await loadBuildFeatures();
        _resetBuildFeaturesForTest();
        expect(hasAdminFeatures()).toBe(true);
    });
});
