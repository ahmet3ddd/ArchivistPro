/**
 * chatStorage.ts için kapsamlı unit testler.
 * chat_sessions ve chat_messages CRUD operasyonlarını kapsıyor.
 *
 * Strateji: gerçek sql.js in-memory DB, mocked saveDatabase + debugLog.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';
import { _setDbForTesting } from '../services/database';

// saveDatabase ağ/disk I/O yok — no-op stub
vi.mock('../services/database', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/database')>();
    return {
        ...actual,
        saveDatabase: vi.fn(),
        saveDatabaseDeferred: vi.fn(),
    };
});

// debugLog konsol kirliliği yaratmasın
vi.mock('../services/logger', () => ({
    debugLog: vi.fn(),
    auditLog: vi.fn(),
    setLoggerDb: vi.fn(),
}));

// Tauri invoke gerekmez ama chatStorage import zinciri tetikleyebilir
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.resolve(null)),
}));

import {
    createSession,
    listSessions,
    deleteSession,
    appendMessage,
    listMessages,
    snapshotSession,
    restoreSession,
    renameSession,
    type ChatScope,
    type ChatCitationRef,
} from '../services/chatStorage';

// ── Yardımcı ─────────────────────────────────────────────────────────────────

function makeCitation(overrides: Partial<ChatCitationRef> = {}): ChatCitationRef {
    return {
        index: 1,
        chunkId: 'chunk_1',
        assetId: 'asset_1',
        fileName: 'plan.dwg',
        filePath: 'C:/Projects/plan.dwg',
        page: null,
        score: 0.92,
        snippet: 'Zemin katta merdiven var.',
        ...overrides,
    };
}

// ── createSession ─────────────────────────────────────────────────────────────

describe('createSession', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('doğru alanlarla oturum oluşturur', () => {
        const session = createSession('Test Oturumu');
        expect(session.id).toMatch(/^cs_/);
        expect(session.title).toBe('Test Oturumu');
        expect(session.scope).toEqual({ type: 'all' });
        expect(session.model).toBeNull();
        expect(session.createdAt).toBeTruthy();
        expect(session.updatedAt).toBeTruthy();
        expect(session.createdAt).toBe(session.updatedAt);
    });

    it('scope parametresini doğru saklar — proje tipi', () => {
        const scope: ChatScope = { type: 'project', value: 'SapphireOtel' };
        const session = createSession('Proje Oturumu', scope);
        expect(session.scope).toEqual(scope);
    });

    it('scope parametresini doğru saklar — etiket tipi', () => {
        const scope: ChatScope = { type: 'tag', value: 'mimari' };
        const session = createSession('Etiket Oturumu', scope);
        expect(session.scope).toEqual(scope);
    });

    it('model parametresini kaydeder', () => {
        const session = createSession('Model Testi', { type: 'all' }, 'llama3.1');
        expect(session.model).toBe('llama3.1');
    });

    it('ardışık oluşturulan oturumların ID\'leri benzersizdir', () => {
        const s1 = createSession('A');
        const s2 = createSession('B');
        const s3 = createSession('C');
        const ids = new Set([s1.id, s2.id, s3.id]);
        expect(ids.size).toBe(3);
    });

    it('oluşturulan oturum DB\'ye kaydedilir ve listSessions\'da görünür', () => {
        const session = createSession('Kalıcılık Testi');
        const sessions = listSessions();
        const found = sessions.find((s) => s.id === session.id);
        expect(found).toBeDefined();
        expect(found!.title).toBe('Kalıcılık Testi');
    });

    it('createdAt geçerli ISO tarih formatındadır', () => {
        const session = createSession('Tarih Testi');
        const parsed = new Date(session.createdAt);
        expect(isNaN(parsed.getTime())).toBe(false);
    });
});

// ── listSessions ──────────────────────────────────────────────────────────────

describe('listSessions', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('boş DB\'de boş dizi döner', () => {
        expect(listSessions()).toEqual([]);
    });

    it('oturumları updated_at DESC sırasında döner', async () => {
        const s1 = createSession('Eski');
        // appendMessage çağrısı updated_at günceller; küçük gecikme sağlamak için timestamp farkı
        // Doğrudan SQL ile updated_at set edelim
        db.run(
            `UPDATE chat_sessions SET updated_at = ? WHERE id = ?`,
            ['2026-01-01T10:00:00.000Z', s1.id],
        );
        const s2 = createSession('Yeni');
        db.run(
            `UPDATE chat_sessions SET updated_at = ? WHERE id = ?`,
            ['2026-06-01T10:00:00.000Z', s2.id],
        );

        const sessions = listSessions();
        expect(sessions[0].id).toBe(s2.id);  // daha yeni
        expect(sessions[1].id).toBe(s1.id);  // daha eski
    });

    it('limit parametresini dikkate alır', () => {
        createSession('S1');
        createSession('S2');
        createSession('S3');
        const limited = listSessions(2);
        expect(limited).toHaveLength(2);
    });

    it('scope_json\'u doğru parse eder', () => {
        const scope: ChatScope = { type: 'project', value: 'Proje X' };
        createSession('Scope Test', scope);
        const sessions = listSessions();
        expect(sessions[0].scope).toEqual(scope);
    });

    it('bozuk scope_json için varsayılan scope döner', () => {
        const s = createSession('Bozuk Scope');
        // Doğrudan DB'ye bozuk JSON yaz
        db.run(`UPDATE chat_sessions SET scope_json = ? WHERE id = ?`, ['BOZUK{JSON', s.id]);
        const sessions = listSessions();
        const found = sessions.find((x) => x.id === s.id);
        expect(found).toBeDefined();
        expect(found!.scope).toEqual({ type: 'all' });
    });

    it('model null ise null döner', () => {
        createSession('Model Yok');
        const sessions = listSessions();
        expect(sessions[0].model).toBeNull();
    });
});

// ── deleteSession ─────────────────────────────────────────────────────────────

describe('deleteSession', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('oturumu siler ve listSessions\'dan kaldırır', () => {
        const session = createSession('Silinecek');
        deleteSession(session.id);
        const sessions = listSessions();
        expect(sessions.find((s) => s.id === session.id)).toBeUndefined();
    });

    it('CASCADE: oturum silinince mesajlar da silinir', () => {
        const session = createSession('Cascade Test');
        appendMessage(session.id, 'user', 'Merhaba');
        appendMessage(session.id, 'assistant', 'Merhaba!');
        expect(listMessages(session.id)).toHaveLength(2);

        deleteSession(session.id);
        expect(listMessages(session.id)).toHaveLength(0);
    });

    it('olmayan ID ile çağrılınca hata fırlatmaz', () => {
        expect(() => deleteSession('olmayan_id_xyz')).not.toThrow();
    });

    it('sadece hedef oturumu siler, diğerleri kalır', () => {
        const s1 = createSession('Kalacak');
        const s2 = createSession('Silinecek');
        deleteSession(s2.id);
        const sessions = listSessions();
        expect(sessions.find((s) => s.id === s1.id)).toBeDefined();
        expect(sessions.find((s) => s.id === s2.id)).toBeUndefined();
    });
});

// ── appendMessage ─────────────────────────────────────────────────────────────

describe('appendMessage', () => {
    let db: any;
    let sessionId: string;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        sessionId = createSession('Mesaj Test').id;
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('kullanıcı mesajını doğru alanlarla ekler', () => {
        const msg = appendMessage(sessionId, 'user', 'Merhaba dünya');
        expect(msg.id).toMatch(/^cm_/);
        expect(msg.sessionId).toBe(sessionId);
        expect(msg.role).toBe('user');
        expect(msg.content).toBe('Merhaba dünya');
        expect(msg.citations).toEqual([]);
        expect(msg.tokensIn).toBeNull();
        expect(msg.tokensOut).toBeNull();
        expect(msg.createdAt).toBeTruthy();
    });

    it('assistant mesajını role\'e göre ayırt eder', () => {
        const msg = appendMessage(sessionId, 'assistant', 'Merhaba!');
        expect(msg.role).toBe('assistant');
    });

    it('system mesajı ekleyebilir', () => {
        const msg = appendMessage(sessionId, 'system', 'Sistem mesajı');
        expect(msg.role).toBe('system');
    });

    it('citation\'ları doğru saklar', () => {
        const citations = [makeCitation({ index: 1 }), makeCitation({ index: 2, fileName: 'report.pdf' })];
        const msg = appendMessage(sessionId, 'assistant', 'Cevap', citations);
        expect(msg.citations).toHaveLength(2);
        expect(msg.citations[0].fileName).toBe('plan.dwg');
        expect(msg.citations[1].fileName).toBe('report.pdf');
    });

    it('tokensIn/tokensOut parametrelerini kaydeder', () => {
        const msg = appendMessage(sessionId, 'assistant', 'Token testi', [], 120, 450);
        expect(msg.tokensIn).toBe(120);
        expect(msg.tokensOut).toBe(450);
    });

    it('boş içerikli mesaj eklenebilir', () => {
        const msg = appendMessage(sessionId, 'user', '');
        expect(msg.content).toBe('');
    });

    it('özel karakter içeren mesaj doğru saklanır', () => {
        const content = 'Proje "Zemin Kat" <özel> & karakter\'li içerik';
        const msg = appendMessage(sessionId, 'user', content);
        const messages = listMessages(sessionId);
        expect(messages[0].content).toBe(content);
    });

    it('mesaj eklenmesi oturumun updated_at\'ini günceller', async () => {
        const before = listSessions().find((s) => s.id === sessionId)!.updatedAt;
        // Küçük zaman farkı için updated_at'i geri çekiyoruz
        db.run(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`, ['2000-01-01T00:00:00.000Z', sessionId]);
        appendMessage(sessionId, 'user', 'Zaman testi');
        const after = listSessions().find((s) => s.id === sessionId)!.updatedAt;
        expect(new Date(after).getTime()).toBeGreaterThan(new Date('2000-01-01').getTime());
    });

    it('ardışık mesajların ID\'leri benzersizdir', () => {
        const m1 = appendMessage(sessionId, 'user', 'A');
        const m2 = appendMessage(sessionId, 'assistant', 'B');
        const m3 = appendMessage(sessionId, 'user', 'C');
        const ids = new Set([m1.id, m2.id, m3.id]);
        expect(ids.size).toBe(3);
    });

    it('bozuk citations_json için boş dizi döner (listMessages üzerinden)', () => {
        appendMessage(sessionId, 'user', 'Mesaj');
        // Doğrudan DB'ye bozuk JSON yaz
        db.run(`UPDATE chat_messages SET citations_json = ? WHERE session_id = ?`, ['BOZUK', sessionId]);
        const messages = listMessages(sessionId);
        expect(messages[0].citations).toEqual([]);
    });
});

// ── listMessages ──────────────────────────────────────────────────────────────

describe('listMessages', () => {
    let db: any;
    let sessionId: string;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        sessionId = createSession('Listeleme Test').id;
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('mesajsız oturum için boş dizi döner', () => {
        expect(listMessages(sessionId)).toEqual([]);
    });

    it('olmayan session_id için boş dizi döner', () => {
        expect(listMessages('olmayan_id')).toEqual([]);
    });

    it('mesajları created_at ASC sırasında döner', () => {
        const m1 = appendMessage(sessionId, 'user', 'Birinci');
        db.run(`UPDATE chat_messages SET created_at = ? WHERE id = ?`, ['2026-01-01T08:00:00.000Z', m1.id]);
        const m2 = appendMessage(sessionId, 'assistant', 'İkinci');
        db.run(`UPDATE chat_messages SET created_at = ? WHERE id = ?`, ['2026-01-01T09:00:00.000Z', m2.id]);
        const m3 = appendMessage(sessionId, 'user', 'Üçüncü');
        db.run(`UPDATE chat_messages SET created_at = ? WHERE id = ?`, ['2026-01-01T10:00:00.000Z', m3.id]);

        const messages = listMessages(sessionId);
        expect(messages).toHaveLength(3);
        expect(messages[0].content).toBe('Birinci');
        expect(messages[1].content).toBe('İkinci');
        expect(messages[2].content).toBe('Üçüncü');
    });

    it('sadece belirli oturuma ait mesajları döner', () => {
        const otherId = createSession('Diğer Oturum').id;
        appendMessage(sessionId, 'user', 'Benim mesajım');
        appendMessage(otherId, 'user', 'Onların mesajı');

        const messages = listMessages(sessionId);
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe('Benim mesajım');
    });

    it('tüm alanları doğru deserialize eder', () => {
        const citations = [makeCitation()];
        appendMessage(sessionId, 'assistant', 'Detaylı mesaj', citations, 100, 200);
        const messages = listMessages(sessionId);
        const msg = messages[0];
        expect(msg.role).toBe('assistant');
        expect(msg.content).toBe('Detaylı mesaj');
        expect(msg.citations).toHaveLength(1);
        expect(msg.citations[0].fileName).toBe('plan.dwg');
        expect(msg.tokensIn).toBe(100);
        expect(msg.tokensOut).toBe(200);
        expect(msg.sessionId).toBe(sessionId);
    });
});

// ── snapshotSession / restoreSession ─────────────────────────────────────────

describe('snapshotSession / restoreSession', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('snapshotSession oturumu ve mesajlarını yakalar', () => {
        const session = createSession('Snapshot Testi', { type: 'project', value: 'ProjeA' }, 'llama3');
        appendMessage(session.id, 'user', 'Soru 1');
        appendMessage(session.id, 'assistant', 'Cevap 1', [makeCitation()]);

        const snap = snapshotSession(session.id);
        expect(snap).not.toBeNull();
        expect(snap!.session.id).toBe(session.id);
        expect(snap!.session.title).toBe('Snapshot Testi');
        expect(snap!.session.scope).toEqual({ type: 'project', value: 'ProjeA' });
        expect(snap!.session.model).toBe('llama3');
        expect(snap!.messages).toHaveLength(2);
        expect(snap!.messages[0].content).toBe('Soru 1');
        expect(snap!.messages[1].citations).toHaveLength(1);
    });

    it('snapshotSession olmayan ID için null döner', () => {
        const snap = snapshotSession('olmayan_id_xyz');
        expect(snap).toBeNull();
    });

    it('snapshotSession mesajsız oturum için boş messages dizisi döner', () => {
        const session = createSession('Boş Oturum');
        const snap = snapshotSession(session.id);
        expect(snap).not.toBeNull();
        expect(snap!.messages).toEqual([]);
    });

    it('restoreSession silinmiş oturumu geri yükler', () => {
        const session = createSession('Geri Yüklenecek');
        appendMessage(session.id, 'user', 'Geri mesaj');
        const snap = snapshotSession(session.id)!;

        deleteSession(session.id);
        expect(listSessions().find((s) => s.id === session.id)).toBeUndefined();

        restoreSession(snap);
        const restored = listSessions().find((s) => s.id === session.id);
        expect(restored).toBeDefined();
        expect(restored!.title).toBe('Geri Yüklenecek');
        expect(listMessages(session.id)).toHaveLength(1);
        expect(listMessages(session.id)[0].content).toBe('Geri mesaj');
    });

    it('restoreSession mevcut oturumu günceller (INSERT OR REPLACE)', () => {
        const session = createSession('Var Olan');
        const snap = snapshotSession(session.id)!;
        // Başlık değiştir
        snap.session.title = 'Değiştirilmiş';

        restoreSession(snap);
        const updated = listSessions().find((s) => s.id === session.id);
        expect(updated!.title).toBe('Değiştirilmiş');
    });

    it('restoreSession mesajları citation\'larla birlikte geri yükler', () => {
        const session = createSession('Citation Restore');
        const citations = [makeCitation({ index: 1, page: 5, score: 0.88 })];
        appendMessage(session.id, 'assistant', 'Kaynaklı cevap', citations, 50, 150);
        const snap = snapshotSession(session.id)!;

        deleteSession(session.id);
        restoreSession(snap);

        const messages = listMessages(session.id);
        expect(messages).toHaveLength(1);
        expect(messages[0].citations).toHaveLength(1);
        expect(messages[0].citations[0].page).toBe(5);
        expect(messages[0].citations[0].score).toBeCloseTo(0.88);
        expect(messages[0].tokensIn).toBe(50);
        expect(messages[0].tokensOut).toBe(150);
    });

    it('undo/redo senaryosu: snapshot → değişiklik → restore', () => {
        const session = createSession('Undo Test');
        appendMessage(session.id, 'user', 'İlk mesaj');
        const snap = snapshotSession(session.id)!;

        // Yeni mesaj ekle
        appendMessage(session.id, 'assistant', 'Sonraki mesaj');
        expect(listMessages(session.id)).toHaveLength(2);

        // Undo: mesajları sil ve snapshot'ı geri yükle
        db.run(`DELETE FROM chat_messages WHERE session_id = ?`, [session.id]);
        restoreSession(snap);

        const messages = listMessages(session.id);
        expect(messages).toHaveLength(1);
        expect(messages[0].content).toBe('İlk mesaj');
    });
});

// ── renameSession ─────────────────────────────────────────────────────────────

describe('renameSession', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('oturum başlığını günceller', () => {
        const session = createSession('Eski Başlık');
        renameSession(session.id, 'Yeni Başlık');
        const sessions = listSessions();
        const found = sessions.find((s) => s.id === session.id);
        expect(found!.title).toBe('Yeni Başlık');
    });

    it('yeniden adlandırma updated_at\'i günceller', () => {
        const session = createSession('Oturum');
        db.run(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`, ['2000-01-01T00:00:00.000Z', session.id]);
        renameSession(session.id, 'Yeni İsim');
        const found = listSessions().find((s) => s.id === session.id)!;
        expect(new Date(found.updatedAt).getFullYear()).toBeGreaterThan(2000);
    });
});

// ── Çoklu Oturum Kenar Durumları ───────────────────────────────────────────────

describe('Çoklu oturum kenar durumları', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
    });

    afterEach(() => {
        _setDbForTesting(null);
        db.close();
    });

    it('birden fazla oturum bağımsız mesaj listelerine sahip', () => {
        const s1 = createSession('Oturum 1');
        const s2 = createSession('Oturum 2');
        appendMessage(s1.id, 'user', 'S1 mesaj');
        appendMessage(s2.id, 'user', 'S2 mesaj A');
        appendMessage(s2.id, 'assistant', 'S2 mesaj B');

        expect(listMessages(s1.id)).toHaveLength(1);
        expect(listMessages(s2.id)).toHaveLength(2);
    });

    it('Türkçe özel karakterler içeren içerik doğru saklanır', () => {
        const session = createSession('Türkçe Test');
        const content = 'Şimdi çalışıyor mu? Ğ harfi: ğüşıöç';
        appendMessage(session.id, 'user', content);
        const messages = listMessages(session.id);
        expect(messages[0].content).toBe(content);
    });

    it('Unicode ve semboller içeren içerik saklanır', () => {
        const session = createSession('Unicode');
        const content = 'Mimari 🏛️ belge — "Plan A" ≥ 100m²';
        appendMessage(session.id, 'user', content);
        const messages = listMessages(session.id);
        expect(messages[0].content).toBe(content);
    });

    it('uzun içerikli mesaj tamamen saklanır', () => {
        const session = createSession('Uzun Mesaj');
        const longContent = 'A'.repeat(5000);
        appendMessage(session.id, 'assistant', longContent);
        const messages = listMessages(session.id);
        expect(messages[0].content).toHaveLength(5000);
    });

    it('birden fazla citation içeren mesaj doğru round-trip yapar', () => {
        const session = createSession('Çoklu Citation');
        const citations: ChatCitationRef[] = [
            makeCitation({ index: 1, chunkId: 'c1', fileName: 'a.dwg', page: 1, score: 0.95 }),
            makeCitation({ index: 2, chunkId: 'c2', fileName: 'b.pdf', page: 42, score: 0.72 }),
            makeCitation({ index: 3, chunkId: 'c3', fileName: 'c.doc', page: null, score: 0.61 }),
        ];
        appendMessage(session.id, 'assistant', 'Üç kaynak', citations);
        const messages = listMessages(session.id);
        expect(messages[0].citations).toHaveLength(3);
        expect(messages[0].citations[1].page).toBe(42);
        expect(messages[0].citations[2].page).toBeNull();
        expect(messages[0].citations[0].score).toBeCloseTo(0.95);
    });
});
