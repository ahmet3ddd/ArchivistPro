/**
 * Archivist Pro — Kaynak Klasör Etiket Servisi
 *
 * Kullanıcının kaynak klasörlere etiket ataması (organizasyonel, dosyalara miras geçmez).
 * Mevcut `tags` tablosunu yeniden kullanır, `root_tags` junction tablosu üzerinden çalışır.
 *
 * DB tabloları:
 *   root_tags  — root_id, tag_id (many-to-many)
 *   tags       — mevcut tablo, değiştirilmez
 *
 * Disk yazımı: saveDatabase() yerine tagService'in mirrorTagChangesToDisk helper'ı
 * üzerinden tag_apply_changes invoke (root_tag_* alanları kullanılır).
 */

import { debugLog } from './logger';
import { mirrorTagChangesToDisk } from './tagService';
import type { Tag } from './tagService';

type SqlJsDb = {
    run: (sql: string, params?: unknown[]) => void;
    exec: (sql: string, params?: unknown[]) => Array<{ columns: string[]; values: unknown[][] }>;
    prepare: (sql: string) => { bind: (params: unknown[]) => void; step: () => boolean; getAsObject: () => Record<string, unknown>; free: () => void };
};

let _db: SqlJsDb | null = null;

/** Servisin kullanacağı DB referansını ayarlar (setActiveArchive tarafından çağrılır). */
export function setRootTagDb(db: SqlJsDb | null): void {
    _db = db;
}

/** Bir klasöre etiket atar. */
export function addTagToRoot(rootId: string, tagId: number): boolean {
    if (!_db) return false;
    try {
        _db.run(`INSERT OR IGNORE INTO root_tags (root_id, tag_id) VALUES (?, ?)`, [rootId, tagId]);
        void mirrorTagChangesToDisk({
            root_tag_inserts: [{ root_id: rootId, tag_id: tagId }],
        });
        return true;
    } catch (err) {
        debugLog('RootTagService', 'addTagToRoot error', err);
        return false;
    }
}

/** Bir klasörden etiket kaldırır. */
export function removeTagFromRoot(rootId: string, tagId: number): boolean {
    if (!_db) return false;
    try {
        _db.run(`DELETE FROM root_tags WHERE root_id = ? AND tag_id = ?`, [rootId, tagId]);
        void mirrorTagChangesToDisk({
            root_tag_deletes: [{ root_id: rootId, tag_id: tagId }],
        });
        return true;
    } catch (err) {
        debugLog('RootTagService', 'removeTagFromRoot error', err);
        return false;
    }
}

/** Bir klasörün tüm etiketlerini getirir. */
export function getTagsForRoot(rootId: string): Tag[] {
    if (!_db) return [];
    try {
        const stmt = _db.prepare(
            `SELECT t.id, t.name, t.color, t.created_at
             FROM tags t
             JOIN root_tags rt ON t.id = rt.tag_id
             WHERE rt.root_id = ?
             ORDER BY t.name`
        );
        stmt.bind([rootId]);
        const tags: Tag[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            tags.push({
                id: row.id as number,
                name: row.name as string,
                color: row.color as string,
                createdAt: row.created_at as string,
            });
        }
        stmt.free();
        return tags;
    } catch {
        return [];
    }
}

/** Birden fazla klasörün etiketlerini tek sorguda getirir (N+1 önler). */
export function getTagsForRoots(rootIds: string[]): Record<string, Tag[]> {
    if (!_db || rootIds.length === 0) return {};
    try {
        const result: Record<string, Tag[]> = {};
        const BATCH = 500;
        for (let i = 0; i < rootIds.length; i += BATCH) {
            const batch = rootIds.slice(i, i + BATCH);
            const placeholders = batch.map(() => '?').join(',');
            const stmt = _db.prepare(
                `SELECT rt.root_id, t.id, t.name, t.color, t.created_at
                 FROM tags t
                 JOIN root_tags rt ON t.id = rt.tag_id
                 WHERE rt.root_id IN (${placeholders})
                 ORDER BY t.name`
            );
            stmt.bind(batch);
            while (stmt.step()) {
                const row = stmt.getAsObject();
                const rid = row.root_id as string;
                if (!result[rid]) result[rid] = [];
                result[rid].push({
                    id: row.id as number,
                    name: row.name as string,
                    color: row.color as string,
                    createdAt: row.created_at as string,
                });
            }
            stmt.free();
        }
        return result;
    } catch {
        return {};
    }
}

/** Bir klasörün etiketlerini toplu olarak günceller (transaction korumalı). */
export function setTagsForRoot(rootId: string, tagIds: number[]): boolean {
    if (!_db) return false;
    try {
        _db.run('BEGIN TRANSACTION');
        _db.run(`DELETE FROM root_tags WHERE root_id = ?`, [rootId]);
        for (const tagId of tagIds) {
            _db.run(`INSERT INTO root_tags (root_id, tag_id) VALUES (?, ?)`, [rootId, tagId]);
        }
        _db.run('COMMIT');
        void mirrorTagChangesToDisk({
            root_tag_clear_for_roots: [rootId],
            root_tag_inserts: tagIds.map(tid => ({ root_id: rootId, tag_id: tid })),
        });
        return true;
    } catch (err) {
        try { _db.run('ROLLBACK'); } catch { /* ignore */ }
        debugLog('RootTagService', 'setTagsForRoot transaction error', err);
        return false;
    }
}
