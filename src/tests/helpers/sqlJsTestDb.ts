/**
 * Test Helper — Gerçek sql.js in-memory veritabanı fabrikası.
 *
 * Production `_applySchema` ve `_applyMigrations` çağırır — schema drift yok.
 * sql.js npm paketi Node.js'te WASM dosyası gerekmeden çalışır.
 */
import initSqlJs from 'sql.js';
import { _applySchemaForTesting, _applyMigrationsForTesting } from '../../services/database';

type SqlJsDatabase = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => {
    bind: (params: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
  export: () => Uint8Array;
  close: () => void;
};

export async function createTestDatabase(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const db = new SQL.Database() as unknown as SqlJsDatabase;
  db.run('PRAGMA foreign_keys = ON');

  // Production şeması + migration'ları uygula
  _applySchemaForTesting(db as any);
  _applyMigrationsForTesting(db as any);

  return db;
}
