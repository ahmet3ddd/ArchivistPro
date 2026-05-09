/**
 * Archivist Pro — Etiket (Tag) Servisi
 *
 * Kullanıcının kendi etiketlerini oluşturup asset'lere ataması.
 * AI tag'lerinin yanında, kullanıcı tanımlı etiketler.
 *
 * DB tabloları:
 *   tags       — id, name, color, created_at
 *   asset_tags — asset_id, tag_id, created_at (many-to-many)
 */

import { auditLog, debugLog } from './logger';
import { saveDatabaseDeferred, getChunksByAssetId } from './database';
import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import { chatModel, normalizeOllamaGenerateUrl } from './ollamaService';
import type { AIConfig } from '../components/AISettingsModal';

/* ── Tipler ── */

export interface Tag {
  id: number;
  name: string;
  color: string;
  createdAt: string;
}

export interface AssetTag {
  assetId: string;
  tagId: number;
  tagName: string;
  tagColor: string;
}

/* ── DB referansı ── */

type SqlJsDb = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => { bind: (params: unknown[]) => void; step: () => boolean; getAsObject: () => Record<string, unknown>; free: () => void };
};

let _db: SqlJsDb | null = null;

/** Tag servisinin kullanacağı DB referansını set eder */
export function setTagDb(db: SqlJsDb | null): void {
  _db = db;
}

/* ── Tag CRUD ── */

/** Yeni etiket oluşturur */
export function createTag(name: string, color = '#6366f1'): Tag | null {
  if (!_db || !name.trim()) return null;

  const trimmed = name.trim();
  try {
    _db.run(`INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)`, [trimmed, color]);
    saveDatabaseDeferred();

    const stmt = _db.prepare(`SELECT id, name, color, created_at FROM tags WHERE name = ?`);
    stmt.bind([trimmed]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject();
    stmt.free();
    return {
      id: row.id as number,
      name: row.name as string,
      color: row.color as string,
      createdAt: row.created_at as string,
    };
  } catch (err) {
    debugLog('TagService', 'createTag error', err);
    return null;
  }
}

/** Tüm etiketleri getirir (isme göre sıralı) */
export function getAllTags(): Tag[] {
  if (!_db) return [];

  try {
    const result = _db.exec(`SELECT id, name, color, created_at FROM tags ORDER BY name`);
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      id: row[0] as number,
      name: row[1] as string,
      color: row[2] as string,
      createdAt: row[3] as string,
    }));
  } catch {
    return [];
  }
}

/** Etiket adını değiştirir */
export function renameTag(tagId: number, newName: string): boolean {
  if (!_db || !newName.trim()) return false;

  try {
    _db.run(`UPDATE tags SET name = ? WHERE id = ?`, [newName.trim(), tagId]);
    saveDatabaseDeferred();
    return true;
  } catch {
    return false;
  }
}

/** Etiket rengini değiştirir */
export function updateTagColor(tagId: number, color: string): boolean {
  if (!_db) return false;

  try {
    _db.run(`UPDATE tags SET color = ? WHERE id = ?`, [color, tagId]);
    saveDatabaseDeferred();
    return true;
  } catch {
    return false;
  }
}

/** Etiket + ilişkilerinin snapshot'ını alır (undo için) */
export function snapshotTag(tagId: number): { tag: Tag; assetIds: string[] } | null {
  if (!_db) return null;
  try {
    const stmt = _db.prepare(`SELECT id, name, color, created_at FROM tags WHERE id = ?`);
    stmt.bind([tagId]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject();
    stmt.free();
    const tag: Tag = {
      id: row.id as number,
      name: row.name as string,
      color: row.color as string,
      createdAt: row.created_at as string,
    };
    const assetIds = getAssetIdsByTag(tagId);
    return { tag, assetIds };
  } catch {
    return null;
  }
}

/** Snapshot'tan etiketi ve ilişkilerini geri yükler */
export function restoreTag(snap: { tag: Tag; assetIds: string[] }): boolean {
  if (!_db) return false;
  try {
    _db.run(`INSERT OR IGNORE INTO tags (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
      [snap.tag.id, snap.tag.name, snap.tag.color, snap.tag.createdAt]);
    for (const assetId of snap.assetIds) {
      _db.run(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)`, [assetId, snap.tag.id]);
    }
    saveDatabaseDeferred();
    return true;
  } catch {
    return false;
  }
}

/** Etiketi siler (tüm asset ilişkileri de silinir) */
export function deleteTag(tagId: number): boolean {
  if (!_db) return false;

  try {
    _db.run(`DELETE FROM asset_tags WHERE tag_id = ?`, [tagId]);
    _db.run(`DELETE FROM tags WHERE id = ?`, [tagId]);
    saveDatabaseDeferred();
    return true;
  } catch {
    return false;
  }
}

/** İki etiketi birleştirir: sourceTag'deki tüm asset'ler targetTag'e taşınır, sourceTag silinir */
export function mergeTags(sourceTagId: number, targetTagId: number): boolean {
  if (!_db || sourceTagId === targetTagId) return false;

  try {
    _db.run('BEGIN TRANSACTION');
    _db.run(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id)
      SELECT asset_id, ? FROM asset_tags WHERE tag_id = ?`, [targetTagId, sourceTagId]);
    _db.run(`DELETE FROM asset_tags WHERE tag_id = ?`, [sourceTagId]);
    _db.run(`DELETE FROM tags WHERE id = ?`, [sourceTagId]);
    _db.run('COMMIT');
    saveDatabaseDeferred();
    return true;
  } catch (err) {
    try { _db.run('ROLLBACK'); } catch { /* ignore */ }
    debugLog('TagService', 'mergeTags transaction error', err);
    return false;
  }
}

/* ── Asset-Tag İlişkisi ── */

/** Bir asset'e etiket atar */
export function addTagToAsset(assetId: string, tagId: number): boolean {
  if (!_db) return false;

  try {
    _db.run(`INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)`, [assetId, tagId]);
    saveDatabaseDeferred();
    auditLog('SETTINGS_CHANGE', assetId, { action: 'tag_add', tagId });
    return true;
  } catch (err) {
    debugLog('TagService', 'addTagToAsset save failed', err);
    return false;
  }
}

/** Bir asset'ten etiket kaldırır */
export function removeTagFromAsset(assetId: string, tagId: number): boolean {
  if (!_db) return false;

  try {
    _db.run(`DELETE FROM asset_tags WHERE asset_id = ? AND tag_id = ?`, [assetId, tagId]);
    saveDatabaseDeferred();
    auditLog('SETTINGS_CHANGE', assetId, { action: 'tag_remove', tagId });
    return true;
  } catch (err) {
    debugLog('TagService', 'removeTagFromAsset save failed', err);
    return false;
  }
}

/** Birden fazla asset'in etiketlerini tek seferde getirir (N+1 sorgu önleme) */
export function getTagsForAssets(assetIds: string[]): Record<string, Tag[]> {
  if (!_db || !assetIds.length) return {};
  try {
    const result: Record<string, Tag[]> = {};
    const BATCH_SIZE = 500;
    for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
      const batch = assetIds.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map(() => '?').join(',');
      const stmt = _db.prepare(
        `SELECT at.asset_id, t.id, t.name, t.color, t.created_at
         FROM tags t JOIN asset_tags at ON t.id = at.tag_id
         WHERE at.asset_id IN (${placeholders})
         ORDER BY t.name`
      );
      stmt.bind(batch);
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const aid = row.asset_id as string;
        if (!result[aid]) result[aid] = [];
        result[aid].push({ id: row.id as number, name: row.name as string, color: row.color as string, createdAt: row.created_at as string });
      }
      stmt.free();
    }
    return result;
  } catch { return {}; }
}

/** Bir asset'in tüm etiketlerini getirir */
export function getTagsForAsset(assetId: string): Tag[] {
  if (!_db) return [];

  try {
    const stmt = _db.prepare(
      `SELECT t.id, t.name, t.color, t.created_at
       FROM tags t
       JOIN asset_tags at ON t.id = at.tag_id
       WHERE at.asset_id = ?
       ORDER BY t.name`
    );
    stmt.bind([assetId]);
    const tags: Tag[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      tags.push({ id: row.id as number, name: row.name as string, color: row.color as string, createdAt: row.created_at as string });
    }
    stmt.free();
    return tags;
  } catch {
    return [];
  }
}

/** Belirli bir etiketin atandığı tüm asset ID'lerini getirir */
export function getAssetIdsByTag(tagId: number): string[] {
  if (!_db) return [];

  try {
    const stmt = _db.prepare(`SELECT asset_id FROM asset_tags WHERE tag_id = ?`);
    stmt.bind([tagId]);
    const ids: string[] = [];
    while (stmt.step()) ids.push(stmt.getAsObject().asset_id as string);
    stmt.free();
    return ids;
  } catch {
    return [];
  }
}

/** Her etiketin kaç asset'e atandığını döndürür */
export function getTagCounts(): Array<{ tagId: number; tagName: string; count: number }> {
  if (!_db) return [];

  try {
    const result = _db.exec(
      `SELECT t.id, t.name, COUNT(at.asset_id) as cnt
       FROM tags t
       LEFT JOIN asset_tags at ON t.id = at.tag_id
       GROUP BY t.id
       ORDER BY cnt DESC, t.name`
    );
    if (result.length === 0) return [];

    return result[0].values.map((row) => ({
      tagId: row[0] as number,
      tagName: row[1] as string,
      count: row[2] as number,
    }));
  } catch {
    return [];
  }
}

/** Bir asset'e birden fazla etiket toplu atar (transaction korumalı) */
export function setTagsForAsset(assetId: string, tagIds: number[]): boolean {
  if (!_db) return false;

  try {
    _db.run('BEGIN TRANSACTION');
    _db.run(`DELETE FROM asset_tags WHERE asset_id = ?`, [assetId]);
    for (const tagId of tagIds) {
      _db.run(`INSERT INTO asset_tags (asset_id, tag_id) VALUES (?, ?)`, [assetId, tagId]);
    }
    _db.run('COMMIT');
    saveDatabaseDeferred();
    return true;
  } catch (err) {
    try { _db.run('ROLLBACK'); } catch { /* ignore */ }
    debugLog('TagService', 'setTagsForAsset transaction error', err);
    return false;
  }
}

/** Etiket adıyla arama (autocomplete için) */
export function searchTags(query: string): Tag[] {
  if (!_db || !query.trim()) return getAllTags();

  const q = query.trim().toLowerCase();
  try {
    const stmt = _db.prepare(
      `SELECT id, name, color, created_at FROM tags WHERE LOWER(name) LIKE ? ORDER BY name`
    );
    stmt.bind(['%' + q + '%']);
    const results: Tag[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({ id: row.id as number, name: row.name as string, color: row.color as string, createdAt: row.created_at as string });
    }
    stmt.free();
    return results;
  } catch {
    return [];
  }
}

/**
 * Ollama LLM ile indexli bir asset için tag önerisi üret.
 * İlk 8 chunk'ı oku, Ollama'ya gönder, 3-5 Türkçe etiket öner.
 */
export async function suggestTagsForAsset(assetId: string, aiConfig: AIConfig): Promise<string[]> {
  if (aiConfig.apiProvider !== 'ollama' || !aiConfig.apiUrl) return [];

  const chunks = getChunksByAssetId(assetId, 8);
  if (chunks.length === 0) return [];

  const chunksText = chunks.map(c => c.text).join('\n\n').slice(0, 3000);
  const model = chatModel(aiConfig);
  const url = normalizeOllamaGenerateUrl(aiConfig.apiUrl);

  const prompt = `/no_think
Aşağıdaki metin bir arşiv dosyasından alınmıştır. İçeriği en iyi özetleyen 3-5 adet Türkçe etiket öner.
Kurallar: Sadece virgülle ayrılmış etiket adlarını yaz. Her etiket 1-3 kelime. Açıklama yok.
Örnek: zemin kat planı, beton detayı, cephe

METİN:
${chunksText}

ETİKETLER:`;

  const reqBody = JSON.stringify({
    model,
    prompt,
    stream: false,
    options: { temperature: 0.3, num_ctx: 2048, num_predict: 80 },
  });

  try {
    const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url, body: reqBody }, 30_000);
    const data = JSON.parse(responseStr) as { response?: string };
    const raw = (data.response ?? '').trim();

    // Virgülle ayrılmış listeyi parse et; kirli sonuçları filtrele
    return raw
      .split(',')
      .map(s => s.trim().replace(/^[-–•*]\s*/, ''))
      .filter(s => s.length >= 2 && s.length <= 50)
      .slice(0, 6);
  } catch (err) {
    debugLog('tagService', 'suggestTagsForAsset failed', { assetId, err });
    return [];
  }
}
