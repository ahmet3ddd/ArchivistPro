import { describe, it, expect, vi } from 'vitest';

const mockListSessions = vi.fn();
const mockListMessages = vi.fn();

vi.mock('../services/chatStorage', () => ({
    listSessions: (...a: unknown[]) => mockListSessions(...a),
    listMessages: (...a: unknown[]) => mockListMessages(...a),
}));

import { exportSessionToMarkdown, downloadMarkdown } from '../services/chatExport';

/* ── Test verileri ── */

const SESSION_1 = {
    id: 's1',
    title: 'Test Sohbet',
    model: 'qwen3:4b',
    createdAt: '2026-04-19T10:30:00Z',
    scope: { type: 'all' },
};

const SESSION_PROJECT = {
    id: 's2',
    title: 'Proje Sohbeti',
    model: 'llama3',
    createdAt: '2026-04-19T12:00:00Z',
    scope: { type: 'project', value: 'ProjeX' },
};

const SESSION_TAG = {
    id: 's3',
    title: 'Etiket Sohbeti',
    model: null,
    createdAt: '2026-04-19T14:00:00Z',
    scope: { type: 'tag', value: 'cephe' },
};

const MSG_USER = { id: 'm1', role: 'user', content: 'DWG dosyaları hakkında bilgi ver' };
const MSG_ASSISTANT = {
    id: 'm2',
    role: 'assistant',
    content: 'DWG dosyaları AutoCAD formatıdır.',
    citations: [
        { index: 1, fileName: 'plan.dwg', page: 3, score: 0.85 },
        { index: 2, fileName: 'cephe.dwg', page: null, score: 0.72 },
    ],
};
const MSG_SYSTEM = { id: 'm0', role: 'system', content: 'System prompt' };
const MSG_ASSISTANT_NO_CITE = { id: 'm3', role: 'assistant', content: 'Basit cevap.', citations: [] };

describe('chatExport — exportSessionToMarkdown', () => {
    it('oturum bulunamazsa boş string döner', () => {
        mockListSessions.mockReturnValue([]);
        const result = exportSessionToMarkdown('non-existent');
        expect(result).toBe('');
    });

    it('mesaj yoksa boş string döner', () => {
        mockListSessions.mockReturnValue([SESSION_1]);
        mockListMessages.mockReturnValue([]);
        const result = exportSessionToMarkdown('s1');
        expect(result).toBe('');
    });

    it('sadece system mesajları varsa boş string döner', () => {
        mockListSessions.mockReturnValue([SESSION_1]);
        mockListMessages.mockReturnValue([MSG_SYSTEM]);
        const result = exportSessionToMarkdown('s1');
        expect(result).toBe('');
    });

    it('başlık, tarih, model ve kapsam içeren header üretir', () => {
        mockListSessions.mockReturnValue([SESSION_1]);
        mockListMessages.mockReturnValue([MSG_USER]);
        const result = exportSessionToMarkdown('s1');
        expect(result).toContain('# Test Sohbet');
        expect(result).toContain('**Model:** qwen3:4b');
        expect(result).toContain('**Kapsam:** Tüm Arşiv');
        expect(result).toContain('**Tarih:**');
    });

    it('kullanıcı mesajını doğru render eder', () => {
        mockListSessions.mockReturnValue([SESSION_1]);
        mockListMessages.mockReturnValue([MSG_USER]);
        const result = exportSessionToMarkdown('s1');
        expect(result).toContain('## Kullanıcı');
        expect(result).toContain('DWG dosyaları hakkında bilgi ver');
    });

    it('asistan mesajını citation ile render eder', () => {
        mockListSessions.mockReturnValue([SESSION_1]);
        mockListMessages.mockReturnValue([MSG_USER, MSG_ASSISTANT]);
        const result = exportSessionToMarkdown('s1');
        expect(result).toContain('## Asistan');
        expect(result).toContain('**Kaynaklar:**');
        expect(result).toContain('[1] plan.dwg (s.3)');
        expect(result).toContain('skor: 0.850');
        expect(result).toContain('[2] cephe.dwg');
    });

    it('citation olmayan asistan mesajında kaynaklar bölümü yok', () => {
        mockListSessions.mockReturnValue([SESSION_1]);
        mockListMessages.mockReturnValue([MSG_ASSISTANT_NO_CITE]);
        const result = exportSessionToMarkdown('s1');
        expect(result).not.toContain('**Kaynaklar:**');
    });

    it('project scope doğru gösterilir', () => {
        mockListSessions.mockReturnValue([SESSION_PROJECT]);
        mockListMessages.mockReturnValue([MSG_USER]);
        const result = exportSessionToMarkdown('s2');
        expect(result).toContain('**Kapsam:** Proje: ProjeX');
    });

    it('tag scope doğru gösterilir', () => {
        mockListSessions.mockReturnValue([SESSION_TAG]);
        mockListMessages.mockReturnValue([MSG_USER]);
        const result = exportSessionToMarkdown('s3');
        expect(result).toContain('**Kapsam:** Etiket: cephe');
    });

    it('model null ise "Bilinmiyor" yazar', () => {
        mockListSessions.mockReturnValue([SESSION_TAG]);
        mockListMessages.mockReturnValue([MSG_USER]);
        const result = exportSessionToMarkdown('s3');
        expect(result).toContain('**Model:** Bilinmiyor');
    });
});

describe('chatExport — downloadMarkdown', () => {
    it('Blob oluşturur ve anchor click tetikler', () => {
        const mockClick = vi.fn();
        const mockAppendChild = vi.fn();
        const mockRemoveChild = vi.fn();
        const mockCreateObjectURL = vi.fn(() => 'blob:test-url');
        const mockRevokeObjectURL = vi.fn();

        const mockAnchor = {
            href: '',
            download: '',
            click: mockClick,
        };

        vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement);
        vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
        vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
        vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

        downloadMarkdown('# Test', 'test.md');

        expect(mockCreateObjectURL).toHaveBeenCalled();
        expect(mockAnchor.download).toBe('test.md');
        expect(mockClick).toHaveBeenCalled();
        expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:test-url');

        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
});
