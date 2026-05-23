import { describe, it, expect, vi } from 'vitest';
import { assetsToCSV, assetsToJSON, exportAssets } from '../services/exportService';
import type { Asset } from '../types';

vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
}));

function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'test_1',
    fileName: 'plan.dwg',
    filePath: '/test/plan.dwg',
    fileSize: 1024000,
    fileType: 'dwg',
    category: 'CAD',
    createdAt: '2026-01-01',
    modifiedAt: '2026-03-15',
    projectName: 'Proje A',
    projectPhase: 'Tasarım',
    materialGroup: undefined,
    colorTheme: undefined,
    architecturalStyle: undefined,
    isIndexed: false,
    thumbnailUrl: '',
    ...overrides,
  } as Asset;
}

describe('ExportService — CSV', () => {
  it('CSV header ve satır üretir', () => {
    const assets = [createMockAsset()];
    const csv = assetsToCSV(assets);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('fileName');
    expect(lines[0]).toContain('filePath');
    expect(lines[1]).toContain('plan.dwg');
  });

  it('boş asset listesi sadece header döner', () => {
    const csv = assetsToCSV([]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1); // sadece header
  });

  it('özel alanlar seçilebilir', () => {
    const assets = [createMockAsset()];
    const csv = assetsToCSV(assets, ['fileName', 'fileType']);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('fileName,fileType');
    expect(lines[1]).toContain('plan.dwg');
    expect(lines[1]).toContain('dwg');
  });

  it('virgül içeren değerler çift tırnak ile sarılır', () => {
    const assets = [createMockAsset({ fileName: 'plan,v2.dwg' })];
    const csv = assetsToCSV(assets, ['fileName']);
    expect(csv).toContain('"plan,v2.dwg"');
  });

  it('çift tırnak içeren değerler escape edilir', () => {
    const assets = [createMockAsset({ fileName: 'plan"special.dwg' })];
    const csv = assetsToCSV(assets, ['fileName']);
    expect(csv).toContain('""');
  });

  it('null/undefined değerler boş string olur', () => {
    const assets = [createMockAsset({ materialGroup: undefined })];
    const csv = assetsToCSV(assets, ['materialGroup']);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('');
  });
});

describe('ExportService — JSON', () => {
  it('JSON tüm alanları içerir', () => {
    const assets = [createMockAsset()];
    const json = assetsToJSON(assets);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fileName).toBe('plan.dwg');
  });

  it('JSON alan filtresi ile çalışır', () => {
    const assets = [createMockAsset()];
    const json = assetsToJSON(assets, ['fileName', 'fileType']);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed[0])).toEqual(['fileName', 'fileType']);
  });

  it('boş liste boş dizi döner', () => {
    const json = assetsToJSON([]);
    expect(JSON.parse(json)).toEqual([]);
  });
});

describe('ExportService — exportAssets', () => {
  it('exportAssets CSV format — DOM manipülasyonu çalışır', () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const clickFn = vi.fn();
    const appendFn = vi.fn();
    const removeFn = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValueOnce({
      href: '',
      download: '',
      click: clickFn,
    } as any);
    vi.spyOn(document.body, 'appendChild').mockImplementationOnce(appendFn);
    vi.spyOn(document.body, 'removeChild').mockImplementationOnce(removeFn);

    exportAssets({ assets: [createMockAsset()], format: 'csv' });
    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('exportAssets JSON format — hata vermez', () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    vi.spyOn(document, 'createElement').mockReturnValueOnce({
      href: '',
      download: '',
      click: vi.fn(),
    } as any);
    vi.spyOn(document.body, 'appendChild').mockImplementationOnce(vi.fn());
    vi.spyOn(document.body, 'removeChild').mockImplementationOnce(vi.fn());

    exportAssets({ assets: [createMockAsset()], format: 'json' });
    expect(createObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
