/**
 * crashReporter — Tauri invoke wrapper testleri.
 * Tauri başarısız → sessiz fallback davranışları test edilir.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.reject(new Error('Tauri not available'))),
}));

import { writeCrashReport, listCrashReports, deleteCrashReport } from '../services/crashReporter';

describe('crashReporter (Tauri unavailable)', () => {
    it('writeCrashReport Tauri yoksa sessizce geçer (exception atmaz)', async () => {
        await expect(writeCrashReport('js_error', 'Test error', 'at Component:42')).resolves.toBeUndefined();
    });

    it('listCrashReports Tauri yoksa boş dizi döner', async () => {
        const result = await listCrashReports();
        expect(result).toEqual([]);
    });

    it('deleteCrashReport Tauri yoksa false döner', async () => {
        const result = await deleteCrashReport('some-id');
        expect(result).toBe(false);
    });

    it('writeCrashReport boş mesaj ile çalışır', async () => {
        await expect(writeCrashReport('unknown', '', '')).resolves.toBeUndefined();
    });

    it('writeCrashReport component opsiyonel (undefined geçilebilir)', async () => {
        await expect(writeCrashReport('ui_crash', 'err', 'stack')).resolves.toBeUndefined();
    });

    it('deleteCrashReport boş id ile çalışır', async () => {
        expect(await deleteCrashReport('')).toBe(false);
    });
});

describe('crashReporter (Tauri available mock)', () => {
    it('writeCrashReport Tauri invoke çağrılır', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        vi.mocked(invoke).mockResolvedValueOnce(undefined);
        await writeCrashReport('test_type', 'msg', 'stack', 'TestComponent');
        expect(invoke).toHaveBeenCalledWith('write_crash_report', {
            errorType: 'test_type',
            message: 'msg',
            stackTrace: 'stack',
            component: 'TestComponent',
        });
    });

    it('listCrashReports Tauri invoke listesi döner', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        const mockReports = [
            { id: 'r1', timestamp: '2026-01-01', error_type: 'js_error', message: 'err',
              stack_trace: '', app_version: '2.3.1', os_info: '', memory_usage: '', component: 'App' },
        ];
        vi.mocked(invoke).mockResolvedValueOnce(mockReports);
        const result = await listCrashReports();
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('r1');
    });

    it('deleteCrashReport Tauri invoke true döner', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        vi.mocked(invoke).mockResolvedValueOnce(true);
        expect(await deleteCrashReport('r1')).toBe(true);
    });

    it('uzun mesaj 2000 karakterde kesilir', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        vi.mocked(invoke).mockResolvedValueOnce(undefined);
        const longMessage = 'x'.repeat(3000);
        await writeCrashReport('type', longMessage, '');
        const call = vi.mocked(invoke).mock.calls[vi.mocked(invoke).mock.calls.length - 1];
        const args = call[1] as Record<string, unknown>;
        expect((args.message as string).length).toBeLessThanOrEqual(2017); // 2000 + '... [truncated]'
        expect(args.message as string).toContain('[truncated]');
    });
});
