/**
 * Reranker ve Query-Rewrite toggle'larının localStorage ile kalıcı olduğunu doğrular.
 * Modül-seviyesi flag'ler önceden uygulama yeniden açılınca sıfırlanıyordu.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const LS_RERANKER_KEY = 'archivist_reranker_enabled';
const LS_QUERY_REWRITE_KEY = 'archivist_query_rewrite_enabled';

describe('ragService toggle kalıcılığı', () => {
    beforeEach(() => {
        localStorage.removeItem(LS_RERANKER_KEY);
        localStorage.removeItem(LS_QUERY_REWRITE_KEY);
    });

    afterEach(() => {
        localStorage.removeItem(LS_RERANKER_KEY);
        localStorage.removeItem(LS_QUERY_REWRITE_KEY);
    });

    it('setRerankerEnabled(true) → localStorage "true" yazar', async () => {
        const { setRerankerEnabled } = await import('../services/ragService');
        setRerankerEnabled(true);
        expect(localStorage.getItem(LS_RERANKER_KEY)).toBe('true');
    });

    it('setRerankerEnabled(false) → localStorage "false" yazar', async () => {
        const { setRerankerEnabled } = await import('../services/ragService');
        setRerankerEnabled(false);
        expect(localStorage.getItem(LS_RERANKER_KEY)).toBe('false');
    });

    it('setQueryRewriteEnabled(true) → localStorage "true" yazar', async () => {
        const { setQueryRewriteEnabled } = await import('../services/ragService');
        setQueryRewriteEnabled(true);
        expect(localStorage.getItem(LS_QUERY_REWRITE_KEY)).toBe('true');
    });

    it('isRerankerEnabled / isQueryRewriteEnabled set sonrası senkron döner', async () => {
        const { setRerankerEnabled, isRerankerEnabled, setQueryRewriteEnabled, isQueryRewriteEnabled } =
            await import('../services/ragService');

        setRerankerEnabled(true);
        expect(isRerankerEnabled()).toBe(true);
        setRerankerEnabled(false);
        expect(isRerankerEnabled()).toBe(false);

        setQueryRewriteEnabled(true);
        expect(isQueryRewriteEnabled()).toBe(true);
        setQueryRewriteEnabled(false);
        expect(isQueryRewriteEnabled()).toBe(false);
    });
});
