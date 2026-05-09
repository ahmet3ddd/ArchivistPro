/**
 * Chat oturum ve mesaj kalıcılığı.
 * chat_sessions ve chat_messages tabloları üzerinde CRUD.
 */

import { runSql, queryAll, writeChatMirror } from './database';
import { debugLog } from './logger';

export type ChatScope =
    | { type: 'all' }
    | { type: 'project'; value: string }
    | { type: 'tag'; value: string };

export type ChatSession = {
    id: string;
    title: string;
    scope: ChatScope;
    model: string | null;
    createdAt: string;
    updatedAt: string;
};

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatCitationRef = {
    index: number;
    chunkId: string;
    assetId: string;
    fileName: string;
    filePath: string;
    page: number | null;
    score: number;
    snippet: string;
};

export type ChatMessage = {
    id: string;
    sessionId: string;
    role: ChatRole;
    content: string;
    citations: ChatCitationRef[];
    tokensIn: number | null;
    tokensOut: number | null;
    createdAt: string;
};

function genId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso(): string {
    return new Date().toISOString();
}

export function createSession(title: string, scope: ChatScope = { type: 'all' }, model: string | null = null): ChatSession {
    const id = genId('cs');
    const now = nowIso();
    const scopeJson = JSON.stringify(scope);
    runSql(
        `INSERT INTO chat_sessions (id, title, scope_json, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, title, scopeJson, model, now, now],
    );
    // Targeted mirror — saveDatabase yerine ~1ms doğrudan rusqlite, donma yok.
    void writeChatMirror({
        sessionsUpsert: [{ id, title, scopeJson, model, createdAt: now, updatedAt: now }],
    });
    return { id, title, scope, model, createdAt: now, updatedAt: now };
}

export function listSessions(limit: number = 100): ChatSession[] {
    const rows = queryAll(
        `SELECT id, title, scope_json, model, created_at, updated_at
         FROM chat_sessions ORDER BY updated_at DESC LIMIT ?`,
        [limit],
    );
    return rows.map((r) => {
        let scope: ChatScope = { type: 'all' };
        try { if (r[2]) scope = JSON.parse(r[2] as string) as ChatScope; } catch { /* ignore */ }
        return {
            id: r[0] as string,
            title: r[1] as string,
            scope,
            model: (r[3] as string) ?? null,
            createdAt: r[4] as string,
            updatedAt: r[5] as string,
        };
    });
}

export function deleteSession(sessionId: string): void {
    try {
        runSql(`DELETE FROM chat_sessions WHERE id = ?`, [sessionId]);
        // sql.js'te FK CASCADE chat_messages'ı siler. Targeted mirror Rust tarafında
        // PRAGMA foreign_keys=OFF olduğundan mesajları manuel cascade eder.
        void writeChatMirror({ deleteSessionIds: [sessionId] });
    } catch (err) {
        debugLog('chatStorage', 'deleteSession error', err);
    }
}

export type ChatSessionSnapshot = {
    session: ChatSession;
    messages: ChatMessage[];
};

/** Sohbeti silmeden önce session + tüm mesajları snapshot alır.
 *  Direkt ID ile tek sorgu — eskiden 1000 sohbet çekip JS'te filter ediyordu (2-4sn yavaşlık). */
export function snapshotSession(sessionId: string): ChatSessionSnapshot | null {
    const rows = queryAll(
        `SELECT id, title, scope_json, model, created_at, updated_at
         FROM chat_sessions WHERE id = ?`,
        [sessionId],
    );
    if (rows.length === 0) return null;
    const r = rows[0] as unknown[];
    let scope: ChatScope = { type: 'all' };
    try { if (r[2]) scope = JSON.parse(r[2] as string) as ChatScope; } catch { /* ignore */ }
    const session: ChatSession = {
        id: r[0] as string,
        title: r[1] as string,
        scope,
        model: (r[3] as string) ?? null,
        createdAt: r[4] as string,
        updatedAt: r[5] as string,
    };
    const messages = listMessages(sessionId);
    return { session, messages };
}

/** Snapshot'tan sohbeti ve mesajları geri yükler. */
export function restoreSession(snap: ChatSessionSnapshot): void {
    const { session, messages } = snap;
    const scopeJson = JSON.stringify(session.scope);
    runSql(
        `INSERT OR REPLACE INTO chat_sessions (id, title, scope_json, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [session.id, session.title, scopeJson, session.model, session.createdAt, session.updatedAt],
    );
    for (const m of messages) {
        runSql(
            `INSERT OR REPLACE INTO chat_messages (id, session_id, role, content, citations_json, tokens_in, tokens_out, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.id, m.sessionId, m.role, m.content, JSON.stringify(m.citations), m.tokensIn, m.tokensOut, m.createdAt],
        );
    }
    void writeChatMirror({
        sessionsUpsert: [{
            id: session.id, title: session.title, scopeJson,
            model: session.model, createdAt: session.createdAt, updatedAt: session.updatedAt,
        }],
        messagesUpsert: messages.map((m) => ({
            id: m.id, sessionId: m.sessionId, role: m.role, content: m.content,
            citationsJson: JSON.stringify(m.citations),
            tokensIn: m.tokensIn, tokensOut: m.tokensOut, createdAt: m.createdAt,
        })),
    });
}

export function renameSession(sessionId: string, title: string): void {
    const now = nowIso();
    runSql(
        `UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?`,
        [title, now, sessionId],
    );
    // Targeted mirror için tam session satırını oku (UPSERT için)
    const rows = queryAll(
        `SELECT scope_json, model, created_at FROM chat_sessions WHERE id = ?`,
        [sessionId],
    );
    if (rows.length > 0) {
        const r = rows[0] as unknown[];
        void writeChatMirror({
            sessionsUpsert: [{
                id: sessionId,
                title,
                scopeJson: (r[0] as string) ?? null,
                model: (r[1] as string) ?? null,
                createdAt: r[2] as string,
                updatedAt: now,
            }],
        });
    }
}

export function appendMessage(
    sessionId: string,
    role: ChatRole,
    content: string,
    citations: ChatCitationRef[] = [],
    tokensIn: number | null = null,
    tokensOut: number | null = null,
): ChatMessage {
    const id = genId('cm');
    const now = nowIso();
    const citationsJson = JSON.stringify(citations);
    runSql(
        `INSERT INTO chat_messages (id, session_id, role, content, citations_json, tokens_in, tokens_out, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, sessionId, role, content, citationsJson, tokensIn, tokensOut, now],
    );
    runSql(`UPDATE chat_sessions SET updated_at = ? WHERE id = ?`, [now, sessionId]);
    // Targeted mirror — yeni mesaj + session timestamp güncelle (full session veri okumadan)
    void writeChatMirror({
        messagesUpsert: [{
            id, sessionId, role, content, citationsJson,
            tokensIn, tokensOut, createdAt: now,
        }],
        sessionTimestamps: [{ id: sessionId, updatedAt: now }],
    });
    return { id, sessionId, role, content, citations, tokensIn, tokensOut, createdAt: now };
}

export function listMessages(sessionId: string): ChatMessage[] {
    const rows = queryAll(
        `SELECT id, session_id, role, content, citations_json, tokens_in, tokens_out, created_at
         FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
        [sessionId],
    );
    return rows.map((r) => {
        let citations: ChatCitationRef[] = [];
        try { if (r[4]) citations = JSON.parse(r[4] as string) as ChatCitationRef[]; } catch { /* ignore */ }
        return {
            id: r[0] as string,
            sessionId: r[1] as string,
            role: r[2] as ChatRole,
            content: r[3] as string,
            citations,
            tokensIn: (r[5] as number) ?? null,
            tokensOut: (r[6] as number) ?? null,
            createdAt: r[7] as string,
        };
    });
}
