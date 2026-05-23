/**
 * Archivist Pro — Favoriler & Koleksiyonlar
 *
 * Kullanıcı sık kullandığı dosyaları favorilere ekleyebilir,
 * koleksiyonlar oluşturup gruplandırabilir.
 *
 * DB tabloları:
 *   favorites      — asset_id (PK)
 *   collections    — id, name, color, created_at
 *   collection_items — collection_id, asset_id
 *
 * Disk yazımı: saveDatabase() yerine tablo-özel rusqlite invoke
 * (favorite_apply_changes / collection_apply_changes) — UI donmaz.
 */

import { getActiveArchive } from './database';
import { debugLog } from './logger';

/* ── Tipler ── */

export interface Collection {
  id: number;
  name: string;
  color: string;
  createdAt: string;
  itemCount?: number;
}

/* ── DB referansı ── */

type SqlJsDb = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => { bind: (params: unknown[]) => void; step: () => boolean; getAsObject: () => Record<string, unknown>; free: () => void };
};

let _db: SqlJsDb | null = null;

export function setFavoritesDb(db: SqlJsDb | null): void {
  _db = db;
}

/* ── Mirror helpers (sql.js → rusqlite, archive-aware) ──
 * Her CRUD sonrası saveDatabase() yerine tablo-özel invoke.
 * Fire-and-forget: ana thread bloklu değil, hata sessizce loglanır.
 */

interface FavoriteMirrorPayload {
  inserts?: string[];
  deletes?: string[];
}

async function mirrorFavoriteChangesToDisk(payload: FavoriteMirrorPayload): Promise<void> {
  if ((payload.inserts?.length ?? 0) === 0 && (payload.deletes?.length ?? 0) === 0) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('favorite_apply_changes', { payload, archiveAt: getActiveArchive() });
  } catch (err) {
    debugLog('Favorites', 'mirrorFavoriteChangesToDisk error', err);
  }
}

interface CollectionMirrorPayload {
  collection_inserts?: Array<{ id: number; name: string; color?: string; created_at?: string }>;
  collection_renames?: Array<{ id: number; name: string }>;
  collection_color_updates?: Array<{ id: number; color: string }>;
  collection_deletes?: number[];
  item_inserts?: Array<{ collection_id: number; asset_id: string }>;
  item_deletes?: Array<{ collection_id: number; asset_id: string }>;
}

async function mirrorCollectionChangesToDisk(payload: CollectionMirrorPayload): Promise<void> {
  const hasWork = (payload.collection_inserts?.length ?? 0) > 0
    || (payload.collection_renames?.length ?? 0) > 0
    || (payload.collection_color_updates?.length ?? 0) > 0
    || (payload.collection_deletes?.length ?? 0) > 0
    || (payload.item_inserts?.length ?? 0) > 0
    || (payload.item_deletes?.length ?? 0) > 0;
  if (!hasWork) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('collection_apply_changes', { payload, archiveAt: getActiveArchive() });
  } catch (err) {
    debugLog('Favorites', 'mirrorCollectionChangesToDisk error', err);
  }
}

/* ── Favoriler ── */

export function addFavorite(assetId: string): boolean {
  if (!_db) return false;
  try {
    _db.run(`INSERT OR IGNORE INTO favorites (asset_id, created_at) VALUES (?, datetime('now'))`, [assetId]);
    void mirrorFavoriteChangesToDisk({ inserts: [assetId] });
    return true;
  } catch { return false; }
}

export function removeFavorite(assetId: string): boolean {
  if (!_db) return false;
  try {
    _db.run(`DELETE FROM favorites WHERE asset_id = ?`, [assetId]);
    void mirrorFavoriteChangesToDisk({ deletes: [assetId] });
    return true;
  } catch { return false; }
}

export function isFavorite(assetId: string): boolean {
  if (!_db) return false;
  try {
    const stmt = _db.prepare(`SELECT 1 FROM favorites WHERE asset_id = ?`);
    stmt.bind([assetId]);
    const found = stmt.step();
    stmt.free();
    return found;
  } catch { return false; }
}

export function getAllFavoriteIds(): string[] {
  if (!_db) return [];
  try {
    const r = _db.exec(`SELECT asset_id FROM favorites ORDER BY created_at DESC`);
    return r.length > 0 ? r[0].values.map(row => row[0] as string) : [];
  } catch { return []; }
}

export function getFavoriteCount(): number {
  if (!_db) return 0;
  try {
    const r = _db.exec(`SELECT COUNT(*) FROM favorites`);
    return r.length > 0 ? (r[0].values[0][0] as number) : 0;
  } catch { return 0; }
}

/* ── Koleksiyonlar ── */

export function createCollection(name: string, color = '#a855f7'): Collection | null {
  if (!_db || !name.trim()) return null;
  try {
    _db.run(`INSERT INTO collections (name, color) VALUES (?, ?)`, [name.trim(), color]);
    const stmt = _db.prepare(`SELECT id, name, color, created_at FROM collections WHERE name = ?`);
    stmt.bind([name.trim()]);
    if (!stmt.step()) { stmt.free(); return null; }
    const row = stmt.getAsObject();
    stmt.free();
    const collection: Collection = {
      id: row.id as number,
      name: row.name as string,
      color: row.color as string,
      createdAt: row.created_at as string,
    };
    void mirrorCollectionChangesToDisk({
      collection_inserts: [{
        id: collection.id, name: collection.name,
        color: collection.color, created_at: collection.createdAt,
      }],
    });
    return collection;
  } catch { return null; }
}

export function getAllCollections(): Collection[] {
  if (!_db) return [];
  try {
    const r = _db.exec(
      `SELECT c.id, c.name, c.color, c.created_at, COUNT(ci.asset_id) as cnt
       FROM collections c LEFT JOIN collection_items ci ON c.id = ci.collection_id
       GROUP BY c.id ORDER BY c.name`
    );
    if (r.length === 0) return [];
    return r[0].values.map(row => ({
      id: row[0] as number, name: row[1] as string, color: row[2] as string,
      createdAt: row[3] as string, itemCount: row[4] as number,
    }));
  } catch { return []; }
}

export function deleteCollection(collectionId: number): boolean {
  if (!_db) return false;
  try {
    _db.run('BEGIN TRANSACTION');
    _db.run(`DELETE FROM collection_items WHERE collection_id = ?`, [collectionId]);
    _db.run(`DELETE FROM collections WHERE id = ?`, [collectionId]);
    _db.run('COMMIT');
    void mirrorCollectionChangesToDisk({ collection_deletes: [collectionId] });
    return true;
  } catch (err) {
    try { _db.run('ROLLBACK'); } catch { /* ignore */ }
    debugLog('Favorites', 'deleteCollection transaction error', err);
    return false;
  }
}

export function renameCollection(collectionId: number, newName: string): boolean {
  if (!_db || !newName.trim()) return false;
  try {
    _db.run(`UPDATE collections SET name = ? WHERE id = ?`, [newName.trim(), collectionId]);
    void mirrorCollectionChangesToDisk({
      collection_renames: [{ id: collectionId, name: newName.trim() }],
    });
    return true;
  } catch { return false; }
}

export function addToCollection(collectionId: number, assetId: string): boolean {
  if (!_db) return false;
  try {
    _db.run(`INSERT OR IGNORE INTO collection_items (collection_id, asset_id) VALUES (?, ?)`, [collectionId, assetId]);
    void mirrorCollectionChangesToDisk({
      item_inserts: [{ collection_id: collectionId, asset_id: assetId }],
    });
    return true;
  } catch { return false; }
}

export function removeFromCollection(collectionId: number, assetId: string): boolean {
  if (!_db) return false;
  try {
    _db.run(`DELETE FROM collection_items WHERE collection_id = ? AND asset_id = ?`, [collectionId, assetId]);
    void mirrorCollectionChangesToDisk({
      item_deletes: [{ collection_id: collectionId, asset_id: assetId }],
    });
    return true;
  } catch { return false; }
}

export function getCollectionAssetIds(collectionId: number): string[] {
  if (!_db) return [];
  try {
    const stmt = _db.prepare(`SELECT asset_id FROM collection_items WHERE collection_id = ?`);
    stmt.bind([collectionId]);
    const ids: string[] = [];
    while (stmt.step()) ids.push(stmt.getAsObject().asset_id as string);
    stmt.free();
    return ids;
  } catch { return []; }
}

export function getCollectionsForAsset(assetId: string): Collection[] {
  if (!_db) return [];
  try {
    const stmt = _db.prepare(
      `SELECT c.id, c.name, c.color, c.created_at FROM collections c
       JOIN collection_items ci ON c.id = ci.collection_id
       WHERE ci.asset_id = ?
       ORDER BY c.name`
    );
    stmt.bind([assetId]);
    const results: Collection[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({ id: row.id as number, name: row.name as string, color: row.color as string, createdAt: row.created_at as string });
    }
    stmt.free();
    return results;
  } catch { return []; }
}
