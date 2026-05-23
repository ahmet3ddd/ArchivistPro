/**
 * keyboardShortcuts — kayıt/silme/aktifleştirme ve event dispatch testleri.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    registerShortcut,
    unregisterShortcut,
    setShortcutEnabled,
    getAllShortcuts,
    getShortcutsByCategory,
    startListening,
    stopListening,
    registerDefaultShortcuts,
    _resetForTesting,
} from '../services/keyboardShortcuts';

beforeEach(() => {
    _resetForTesting();
});

/* ── Kayıt / silme ── */

describe('registerShortcut / getAllShortcuts', () => {
    it('kayıt sonrası kısayol listede görünür', () => {
        registerShortcut({ id: 'test', label: 'Test', keys: ['Ctrl', 'T'], category: 'general', handler: vi.fn() });
        const all = getAllShortcuts();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('test');
    });

    it('varsayılan olarak enabled=true ile kaydedilir', () => {
        registerShortcut({ id: 'test', label: 'Test', keys: ['F2'], category: 'general', handler: vi.fn() });
        expect(getAllShortcuts()[0].enabled).toBe(true);
    });

    it('aynı id ile tekrar kayıt → üzerine yazar', () => {
        const h1 = vi.fn();
        const h2 = vi.fn();
        registerShortcut({ id: 'x', label: 'Eski', keys: ['F1'], category: 'general', handler: h1 });
        registerShortcut({ id: 'x', label: 'Yeni', keys: ['F2'], category: 'general', handler: h2 });
        const all = getAllShortcuts();
        expect(all).toHaveLength(1);
        expect(all[0].label).toBe('Yeni');
        expect(all[0].keys).toEqual(['F2']);
    });

    it('birden fazla farklı kısayol kaydedilebilir', () => {
        registerShortcut({ id: 'a', label: 'A', keys: ['Ctrl', 'A'], category: 'editing', handler: vi.fn() });
        registerShortcut({ id: 'b', label: 'B', keys: ['Ctrl', 'B'], category: 'editing', handler: vi.fn() });
        registerShortcut({ id: 'c', label: 'C', keys: ['Escape'], category: 'general', handler: vi.fn() });
        expect(getAllShortcuts()).toHaveLength(3);
    });
});

describe('unregisterShortcut', () => {
    it('mevcut kısayolu siler', () => {
        registerShortcut({ id: 'del', label: 'Del', keys: ['Delete'], category: 'editing', handler: vi.fn() });
        unregisterShortcut('del');
        expect(getAllShortcuts()).toHaveLength(0);
    });

    it('olmayan id için sessizce geçer', () => {
        expect(() => unregisterShortcut('nonexistent')).not.toThrow();
    });

    it('sadece belirtilen kısayolu siler, diğerleri korunur', () => {
        registerShortcut({ id: 'a', label: 'A', keys: ['F1'], category: 'general', handler: vi.fn() });
        registerShortcut({ id: 'b', label: 'B', keys: ['F2'], category: 'general', handler: vi.fn() });
        unregisterShortcut('a');
        const all = getAllShortcuts();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('b');
    });
});

/* ── Aktifleştirme ── */

describe('setShortcutEnabled', () => {
    it('enabled=false yapılabilir', () => {
        registerShortcut({ id: 'x', label: 'X', keys: ['F3'], category: 'general', handler: vi.fn() });
        setShortcutEnabled('x', false);
        expect(getAllShortcuts()[0].enabled).toBe(false);
    });

    it('tekrar enabled=true yapılabilir', () => {
        registerShortcut({ id: 'x', label: 'X', keys: ['F3'], category: 'general', handler: vi.fn() });
        setShortcutEnabled('x', false);
        setShortcutEnabled('x', true);
        expect(getAllShortcuts()[0].enabled).toBe(true);
    });

    it('olmayan id için sessizce geçer', () => {
        expect(() => setShortcutEnabled('nope', false)).not.toThrow();
    });
});

/* ── Kategori filtresi ── */

describe('getShortcutsByCategory', () => {
    beforeEach(() => {
        registerShortcut({ id: 'undo', label: 'Geri Al', keys: ['Ctrl', 'Z'], category: 'editing', handler: vi.fn() });
        registerShortcut({ id: 'redo', label: 'Yinele', keys: ['Ctrl', 'Y'], category: 'editing', handler: vi.fn() });
        registerShortcut({ id: 'help', label: 'Yardım', keys: ['F1'], category: 'general', handler: vi.fn() });
        registerShortcut({ id: 'search', label: 'Ara', keys: ['Ctrl', 'K'], category: 'search', handler: vi.fn() });
    });

    it('editing kategorisindekiler döner', () => {
        const editing = getShortcutsByCategory('editing');
        expect(editing).toHaveLength(2);
        expect(editing.map(s => s.id)).toContain('undo');
        expect(editing.map(s => s.id)).toContain('redo');
    });

    it('general kategorisindekiler döner', () => {
        const general = getShortcutsByCategory('general');
        expect(general).toHaveLength(1);
        expect(general[0].id).toBe('help');
    });

    it('boş kategori için boş dizi döner', () => {
        expect(getShortcutsByCategory('navigation')).toEqual([]);
    });
});

/* ── Keyboard event dispatch ── */

describe('startListening / stopListening / handler dispatch', () => {
    it('startListening → keydown tetiklenince handler çağrılır', () => {
        const handler = vi.fn();
        registerShortcut({ id: 'ctrl-t', label: 'Test', keys: ['Ctrl', 'T'], category: 'general', handler });
        startListening();

        // Ctrl+T keydown event dispatch et
        const event = new KeyboardEvent('keydown', {
            key: 't', ctrlKey: true, bubbles: true,
        });
        document.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce();
        stopListening();
    });

    it('stopListening → keydown artık tetiklenmez', () => {
        const handler = vi.fn();
        registerShortcut({ id: 'f5', label: 'F5', keys: ['F5'], category: 'general', handler });
        startListening();
        stopListening();

        const event = new KeyboardEvent('keydown', { key: 'F5', bubbles: true });
        document.dispatchEvent(event);

        expect(handler).not.toHaveBeenCalled();
    });

    it('devre dışı kısayol tetiklenmez (enabled=false)', () => {
        const handler = vi.fn();
        registerShortcut({ id: 'f9', label: 'F9', keys: ['F9'], category: 'general', handler });
        setShortcutEnabled('f9', false);
        startListening();

        const event = new KeyboardEvent('keydown', { key: 'F9', bubbles: true });
        document.dispatchEvent(event);

        expect(handler).not.toHaveBeenCalled();
        stopListening();
    });

    it('startListening iki kez çağrılınca duplike listener yok', () => {
        const handler = vi.fn();
        registerShortcut({ id: 'f7', label: 'F7', keys: ['F7'], category: 'general', handler });
        startListening();
        startListening(); // İkinci çağrı — guard sayesinde ignore edilmeli

        const event = new KeyboardEvent('keydown', { key: 'F7', bubbles: true });
        document.dispatchEvent(event);

        expect(handler).toHaveBeenCalledOnce(); // Sadece 1 kez
        stopListening();
    });
});

/* ── registerDefaultShortcuts ── */

describe('registerDefaultShortcuts', () => {
    it('undo handler kayıtlanır', () => {
        const undo = vi.fn();
        registerDefaultShortcuts({ undo });
        const all = getAllShortcuts();
        expect(all.some(s => s.id === 'undo')).toBe(true);
    });

    it('redo iki kısayolda kaydedilir (Ctrl+Y ve Ctrl+Shift+Z)', () => {
        const redo = vi.fn();
        registerDefaultShortcuts({ redo });
        const all = getAllShortcuts();
        expect(all.some(s => s.id === 'redo')).toBe(true);
        expect(all.some(s => s.id === 'redo2')).toBe(true);
    });

    it('search iki kısayolda kaydedilir (Ctrl+K ve Ctrl+F)', () => {
        const search = vi.fn();
        registerDefaultShortcuts({ search });
        const all = getAllShortcuts();
        expect(all.filter(s => s.category === 'search')).toHaveLength(2);
    });

    it('handler verilmeyen kısayol kaydedilmez', () => {
        registerDefaultShortcuts({ undo: vi.fn() }); // sadece undo
        const all = getAllShortcuts();
        expect(all.some(s => s.id === 'redo')).toBe(false);
        expect(all.some(s => s.id === 'search')).toBe(false);
    });

    it('help F1\'e bağlanır', () => {
        const help = vi.fn();
        registerDefaultShortcuts({ help });
        const s = getAllShortcuts().find(x => x.id === 'help');
        expect(s?.keys).toContain('F1');
    });

    it('escape kısayolu Escape tuşuna bağlanır', () => {
        const escape = vi.fn();
        registerDefaultShortcuts({ escape });
        const s = getAllShortcuts().find(x => x.id === 'escape');
        expect(s?.keys).toContain('Escape');
    });
});
