/**
 * developerFeedback — getDevIp, isDevModeConfigured, sendFeedbackOverLan testleri.
 * database.getSetting mock'lanır, Tauri HTTP plugin mock'lanır.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSetting = vi.fn<[string], string | null>();
vi.mock('../services/database', () => ({
    getSetting: (key: string) => mockGetSetting(key),
}));

// Tauri HTTP plugin — top-level mock, test içinde mockImplementation ile özelleştirilir
const mockTauriFetch = vi.fn<[string, unknown], Promise<{ ok: boolean; status: number }>>();
vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: (...args: unknown[]) => mockTauriFetch(args[0] as string, args[1]),
}));

import { getDevIp, isDevModeConfigured, sendFeedbackOverLan } from '../services/developerFeedback';

beforeEach(() => {
    mockGetSetting.mockReset();
    mockTauriFetch.mockReset();
});

describe('getDevIp', () => {
    it('dev_ip ayarı yoksa null döner', () => {
        mockGetSetting.mockReturnValue(null);
        expect(getDevIp()).toBeNull();
    });

    it('dev_ip ayarı boş string ise null döner', () => {
        mockGetSetting.mockReturnValue('');
        expect(getDevIp()).toBeNull();
    });

    it('dev_ip ayarı varsa döner', () => {
        mockGetSetting.mockImplementation((key) => key === 'dev_ip' ? '192.168.1.5' : null);
        expect(getDevIp()).toBe('192.168.1.5');
    });
});

describe('isDevModeConfigured', () => {
    it('dev_ip ve dev_mode=true → true', () => {
        mockGetSetting.mockImplementation((key) => {
            if (key === 'dev_ip') return '192.168.1.5';
            if (key === 'dev_mode') return 'true';
            return null;
        });
        expect(isDevModeConfigured()).toBe(true);
    });

    it('dev_ip yok → false', () => {
        mockGetSetting.mockReturnValue(null);
        expect(isDevModeConfigured()).toBe(false);
    });

    it('dev_ip var ama dev_mode farklı → false', () => {
        mockGetSetting.mockImplementation((key) => {
            if (key === 'dev_ip') return '192.168.1.5';
            if (key === 'dev_mode') return 'false';
            return null;
        });
        expect(isDevModeConfigured()).toBe(false);
    });

    it('dev_ip var ama dev_mode null → false', () => {
        mockGetSetting.mockImplementation((key) => {
            if (key === 'dev_ip') return '192.168.1.5';
            return null;
        });
        expect(isDevModeConfigured()).toBe(false);
    });
});

describe('sendFeedbackOverLan', () => {
    it('dev_ip yoksa "no-config" döner', async () => {
        mockGetSetting.mockReturnValue(null);
        const result = await sendFeedbackOverLan('user', 'message');
        expect(result).toBe('no-config');
    });

    it('fetch başarısız (network error) → "offline" döner', async () => {
        mockGetSetting.mockImplementation((key) => key === 'dev_ip' ? '192.168.1.5' : null);
        mockTauriFetch.mockRejectedValue(new Error('ECONNREFUSED'));
        const result = await sendFeedbackOverLan('user', 'test message');
        expect(result).toBe('offline');
    });

    it('HTTP yanıtı not ok → "offline" döner', async () => {
        mockGetSetting.mockImplementation((key) => key === 'dev_ip' ? '192.168.1.5' : null);
        mockTauriFetch.mockResolvedValue({ ok: false, status: 403 });
        const result = await sendFeedbackOverLan('user', 'denied message');
        expect(result).toBe('offline');
    });

    it('HTTP yanıtı ok → "sent" döner', async () => {
        mockGetSetting.mockImplementation((key) => key === 'dev_ip' ? '192.168.1.5' : null);
        mockTauriFetch.mockResolvedValue({ ok: true, status: 200 });
        const result = await sendFeedbackOverLan('ahmet', 'feedback text', 'konu');
        expect(result).toBe('sent');
    });
});
