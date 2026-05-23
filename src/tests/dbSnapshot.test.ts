import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSnapshot,
  listSnapshots,
  restoreSnapshot,
  deleteSnapshot,
  getSnapshotCount,
  type SnapshotInfo,
} from '../services/dbSnapshot';

// Tauri invoke mock
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
}));

/* ── Yardımcılar ── */

const SAMPLE_SNAPSHOTS: SnapshotInfo[] = [
  { fileName: 'snapshot-2026-04-07T10-00-00.db', createdAt: '2026-04-07T10:00:00.000Z', fileSize: 50000 },
  { fileName: 'snapshot-2026-04-06T10-00-00.db', createdAt: '2026-04-06T10:00:00.000Z', fileSize: 48000 },
  { fileName: 'snapshot-2026-04-05T10-00-00.db', createdAt: '2026-04-05T10:00:00.000Z', fileSize: 47000 },
];

function setupInvokeMock(overrides: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd in overrides) return Promise.resolve(overrides[cmd]);
    switch (cmd) {
      case 'create_db_snapshot':
        return Promise.resolve(52000); // dosya boyutu
      case 'list_db_snapshots':
        return Promise.resolve([...SAMPLE_SNAPSHOTS]);
      case 'restore_db_snapshot':
        return Promise.resolve(true);
      case 'delete_db_snapshot':
        return Promise.resolve(true);
      default:
        return Promise.resolve(null);
    }
  });
}

/* ── Testler ── */

describe('DbSnapshot — Veritabanı Yedekleme', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    setupInvokeMock();
  });

  // ── createSnapshot ──

  it('createSnapshot başarılı — SnapshotInfo döner', async () => {
    const info = await createSnapshot();

    expect(info).not.toBeNull();
    expect(info!.fileName).toMatch(/^snapshot-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    expect(info!.fileName).toMatch(/\.db$/);
    expect(info!.fileSize).toBe(52000);
    expect(info!.createdAt).toBeTruthy();
  });

  it('createSnapshot — invoke hata dönerse null döner', async () => {
    setupInvokeMock({ create_db_snapshot: null });
    const info = await createSnapshot();
    expect(info).toBeNull();
  });

  it('createSnapshot — fileName ISO tarih formatında', async () => {
    const info = await createSnapshot();
    // snapshot-2026-04-07T14-30-00-000Z.db gibi bir format bekliyoruz
    const namePart = info!.fileName.replace('snapshot-', '').replace('.db', '');
    // Tire ile ayrılmış tarih bileşenleri — en az yıl-ay-gün-saat-dakika-saniye
    const parts = namePart.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(6);
  });

  // ── listSnapshots ──

  it('listSnapshots veri döner', async () => {
    const list = await listSnapshots();
    expect(list).toHaveLength(3);
    expect(list[0].fileName).toContain('snapshot-');
  });

  it('listSnapshots — invoke null dönerse boş array', async () => {
    setupInvokeMock({ list_db_snapshots: null });
    const list = await listSnapshots();
    expect(list).toEqual([]);
  });

  // ── restoreSnapshot ──

  it('restoreSnapshot başarılı', async () => {
    const result = await restoreSnapshot('snapshot-2026-04-07T10-00-00.db');
    expect(result).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith('restore_db_snapshot', {
      fileName: 'snapshot-2026-04-07T10-00-00.db',
      archiveType: 'main',
    });
  });

  it('restoreSnapshot — invoke false dönerse false', async () => {
    setupInvokeMock({ restore_db_snapshot: false });
    expect(await restoreSnapshot('x.db')).toBe(false);
  });

  it('restoreSnapshot — invoke null dönerse false', async () => {
    setupInvokeMock({ restore_db_snapshot: null });
    expect(await restoreSnapshot('x.db')).toBe(false);
  });

  // ── deleteSnapshot ──

  it('deleteSnapshot başarılı', async () => {
    expect(await deleteSnapshot('old.db')).toBe(true);
  });

  it('deleteSnapshot — invoke null dönerse false', async () => {
    setupInvokeMock({ delete_db_snapshot: null });
    expect(await deleteSnapshot('old.db')).toBe(false);
  });

  // ── pruneOldSnapshots (createSnapshot üzerinden dolaylı test) ──

  it('createSnapshot 5\'ten fazla snapshot varsa eski silinir', async () => {
    const sixSnapshots: SnapshotInfo[] = Array.from({ length: 6 }, (_, i) => ({
      fileName: `snapshot-${i}.db`,
      createdAt: new Date(2026, 3, 7 - i).toISOString(),
      fileSize: 10000,
    }));

    setupInvokeMock({ list_db_snapshots: sixSnapshots });

    await createSnapshot();

    // delete_db_snapshot en az 1 kez çağrılmış olmalı (6. snapshot silindi)
    const deleteCalls = invokeMock.mock.calls.filter(
      (c: unknown[]) => c[0] === 'delete_db_snapshot'
    );
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
    // Silinen dosya adı 6.'sı olmalı (index 5)
    expect(deleteCalls[0][1]).toEqual({ fileName: 'snapshot-5.db', archiveType: 'main' });
  });

  // ── getSnapshotCount ──

  it('getSnapshotCount doğru sayıyı döner', async () => {
    expect(await getSnapshotCount()).toBe(3);
  });

  it('getSnapshotCount — boş liste → 0', async () => {
    setupInvokeMock({ list_db_snapshots: [] });
    expect(await getSnapshotCount()).toBe(0);
  });
});
