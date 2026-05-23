import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setTrashDir,
  getTrashDir,
  moveToTrash,
  restoreFromTrash,
  listTrash,
  getTrashSize,
  emptyTrash,
} from '../services/trash';

// Tauri invoke mock — her komut için farklı dönüş değeri
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
}));

/* ── Yardımcılar ── */

const TRASH_DIR = '/tmp/.archivistpro-trash';

/** Manifest mock: read_trash_manifest çağrıldığında döndürülecek veri */
let manifestStore: string;

function setupInvokeMock(overrides: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd in overrides) {
      const val = overrides[cmd];
      return typeof val === 'function' ? (val as Function)(args) : Promise.resolve(val);
    }
    switch (cmd) {
      case 'read_trash_manifest':
        return Promise.resolve(manifestStore);
      case 'write_trash_manifest':
        manifestStore = (args as Record<string, string>).data;
        return Promise.resolve(null);
      case 'trash_move_file':
        return Promise.resolve(1024); // dosya boyutu
      case 'trash_restore_file':
        return Promise.resolve(true);
      case 'trash_empty':
        return Promise.resolve(null);
      default:
        return Promise.resolve(null);
    }
  });
}

/* ── Testler ── */

describe('Trash — Çöp Kutusu Servisi', () => {
  beforeEach(() => {
    manifestStore = JSON.stringify({ entries: [] });
    setTrashDir(TRASH_DIR);
    invokeMock.mockReset();
    setupInvokeMock();
  });

  // ── setTrashDir / getTrashDir ──

  it('setTrashDir ve getTrashDir doğru çalışır', () => {
    setTrashDir('/custom/path');
    expect(getTrashDir()).toBe('/custom/path');
  });

  // ── moveToTrash ──

  it('moveToTrash başarılı — entry döner ve manifest güncellenir', async () => {
    const entry = await moveToTrash('/project/plan.dwg');

    expect(entry).not.toBeNull();
    expect(entry!.originalPath).toBe('/project/plan.dwg');
    expect(entry!.trashName).toMatch(/^\d+_plan\.dwg$/);
    expect(entry!.fileSize).toBe(1024);

    // Manifest güncellendi mi?
    const manifest = JSON.parse(manifestStore);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].originalPath).toBe('/project/plan.dwg');
  });

  it('moveToTrash — trashDir null ise null döner', async () => {
    setTrashDir(null as unknown as string);
    // getTrashDir null olduğunda moveToTrash early return eder
    // Ancak setTrashDir tipi string — null atamak için cast gerekti
    // Gerçek davranışı test etmek için _trashDir'i sıfırlayalım:
    // trash.ts'de _trashDir = dir yapılır, dir null gelirse _trashDir null olur
    const entry = await moveToTrash('/any/file.txt');
    expect(entry).toBeNull();
  });

  it('moveToTrash — invoke hata dönerse null döner', async () => {
    setupInvokeMock({ trash_move_file: Promise.resolve(null) });
    const entry = await moveToTrash('/any/file.txt');
    expect(entry).toBeNull();
  });

  // ── restoreFromTrash ──

  it('restoreFromTrash başarılı — manifest güncellenir', async () => {
    // Önce bir dosya sil
    const entry = await moveToTrash('/project/facade.pdf');
    expect(entry).not.toBeNull();

    // Geri yükle
    const result = await restoreFromTrash(entry!);
    expect(result).toBe(true);

    // Manifest'ten kaldırılmış mı?
    const manifest = JSON.parse(manifestStore);
    expect(manifest.entries).toHaveLength(0);
  });

  it('restoreFromTrash — trashDir null ise false döner', async () => {
    setTrashDir(null as unknown as string);
    const fakeEntry = { trashName: 'x', originalPath: '/a', deletedAt: '', fileSize: 0 };
    expect(await restoreFromTrash(fakeEntry)).toBe(false);
  });

  // ── listTrash ──

  it('listTrash manifest içeriğini döner', async () => {
    await moveToTrash('/a.dwg');
    await moveToTrash('/b.pdf');
    const list = await listTrash();
    expect(list).toHaveLength(2);
  });

  it('listTrash boş manifest → boş array', async () => {
    const list = await listTrash();
    expect(list).toHaveLength(0);
  });

  // ── getTrashSize ──

  it('getTrashSize toplam boyutu hesaplar', async () => {
    await moveToTrash('/a.dwg'); // 1024
    await moveToTrash('/b.dwg'); // 1024
    const size = await getTrashSize();
    expect(size).toBe(2048);
  });

  // ── emptyTrash ──

  it('emptyTrash çöp kutusunu boşaltır ve sayı döner', async () => {
    await moveToTrash('/a.dwg');
    await moveToTrash('/b.dwg');

    const count = await emptyTrash();
    expect(count).toBe(2);

    // Manifest boşalmış mı?
    const manifest = JSON.parse(manifestStore);
    expect(manifest.entries).toHaveLength(0);
  });

  it('emptyTrash — trashDir null ise 0 döner', async () => {
    setTrashDir(null as unknown as string);
    expect(await emptyTrash()).toBe(0);
  });
});
