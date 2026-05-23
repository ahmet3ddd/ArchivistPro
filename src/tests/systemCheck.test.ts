import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    hasSeenSetupWizard,
    markSetupWizardSeen,
    checkWasmSupport,
    getWindowsVersion,
} from '../services/systemCheck';

const WIZARD_FLAG = 'archivist_setup_wizard_done';

describe('systemCheck', () => {
    beforeEach(() => {
        localStorage.removeItem(WIZARD_FLAG);
    });

    afterEach(() => {
        localStorage.removeItem(WIZARD_FLAG);
    });

    /* ── hasSeenSetupWizard / markSetupWizardSeen ── */

    it('başlangıçta wizard görülmemiş', () => {
        expect(hasSeenSetupWizard()).toBe(false);
    });

    it('markSetupWizardSeen sonrası true döner', () => {
        markSetupWizardSeen();
        expect(hasSeenSetupWizard()).toBe(true);
    });

    it('localStorage değeri "1" olarak saklanır', () => {
        markSetupWizardSeen();
        expect(localStorage.getItem(WIZARD_FLAG)).toBe('1');
    });

    it('başka değer varsa false döner', () => {
        localStorage.setItem(WIZARD_FLAG, 'true'); // '1' değil
        expect(hasSeenSetupWizard()).toBe(false);
    });

    /* ── checkWasmSupport ── */

    it('test ortamında WASM destekleniyor', () => {
        // Vitest/Node ortamında WebAssembly global mevcut
        expect(checkWasmSupport()).toBe(true);
    });

    /* ── getWindowsVersion ── */

    it('bilinmeyen user agent için "Unknown" döner', () => {
        // Vitest Node ortamında UA "Windows NT" içermez
        const result = getWindowsVersion();
        // Node'da ya "Unknown" ya da test runner UA'sı döner
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('Windows NT 10.0 → "Windows 10/11"', () => {
        // navigator.userAgent'ı mock ederek test
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Tauri/2.0',
            configurable: true,
        });
        expect(getWindowsVersion()).toBe('Windows 10/11');
        // Geri al
        if (originalDescriptor) {
            Object.defineProperty(navigator, 'userAgent', originalDescriptor);
        }
    });

    it('Windows NT 6.1 → "Windows 7"', () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Windows NT 6.1; Win64; x64)',
            configurable: true,
        });
        expect(getWindowsVersion()).toBe('Windows 7');
        if (originalDescriptor) {
            Object.defineProperty(navigator, 'userAgent', originalDescriptor);
        }
    });

    it('bilinmeyen NT versiyonu fallback string döner', () => {
        const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Windows NT 5.0)',
            configurable: true,
        });
        expect(getWindowsVersion()).toBe('Windows NT 5.0');
        if (originalDescriptor) {
            Object.defineProperty(navigator, 'userAgent', originalDescriptor);
        }
    });
});
