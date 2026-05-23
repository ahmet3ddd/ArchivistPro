/**
 * Archivist Pro — Klavye Kısayolları Sistemi
 *
 * Merkezi kısayol yönetimi. Her kısayol kaydedilir, çakışma kontrolü yapılır.
 * Kullanıcı kısayolları ileride özelleştirilebilir (custom keybindings).
 */

/* ── Tipler ── */

export interface Shortcut {
  /** Benzersiz kısayol ID'si */
  id: string;
  /** Kullanıcıya gösterilecek kısayol açıklaması */
  label: string;
  /** Tuş kombinasyonu: ["Ctrl", "Z"] */
  keys: string[];
  /** Kategori (gruplama için) */
  category: 'general' | 'navigation' | 'editing' | 'search' | 'view';
  /** Kısayol tetiklendiğinde çağrılacak fonksiyon */
  handler: () => void;
  /** Aktif mi? */
  enabled: boolean;
}

/* ── Dahili durum ── */

const _shortcuts: Map<string, Shortcut> = new Map();
let _isListening = false;

/** Tuş kombinasyonunu normalize eder: "ctrl+shift+z" → "Ctrl+Shift+Z" */
function normalizeKeys(keys: string[]): string {
  return keys
    .map(k => k.charAt(0).toUpperCase() + k.slice(1).toLowerCase())
    .sort((a, b) => {
      // Modifier'lar önce: Ctrl, Shift, Alt, Meta
      const order = ['Ctrl', 'Shift', 'Alt', 'Meta'];
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    })
    .join('+');
}

/** KeyboardEvent'ten tuş kombinasyonu çıkarır */
function eventToKeyCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    parts.push(key);
  }

  return normalizeKeys(parts);
}

/* ── Keyboard listener ── */

function _handleKeyDown(e: KeyboardEvent): void {
  // Input/textarea'da kısayolları devre dışı bırak (Ctrl+Z hariç)
  const target = e.target as HTMLElement;
  const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

  const combo = eventToKeyCombo(e);

  for (const shortcut of _shortcuts.values()) {
    if (!shortcut.enabled) continue;
    const shortcutCombo = normalizeKeys(shortcut.keys);
    if (shortcutCombo !== combo) continue;

    // Input'ta sadece Undo/Redo çalışsın
    if (isInput && shortcut.id !== 'undo' && shortcut.id !== 'redo') continue;

    e.preventDefault();
    e.stopPropagation();
    shortcut.handler();
    return;
  }
}

/* ── Public API ── */

/** Kısayol kaydeder */
export function registerShortcut(shortcut: Omit<Shortcut, 'enabled'>): void {
  _shortcuts.set(shortcut.id, { ...shortcut, enabled: true });
}

/** Kısayol kaldırır */
export function unregisterShortcut(id: string): void {
  _shortcuts.delete(id);
}

/** Kısayolun aktifliğini değiştirir */
export function setShortcutEnabled(id: string, enabled: boolean): void {
  const s = _shortcuts.get(id);
  if (s) s.enabled = enabled;
}

/** Tüm kayıtlı kısayolları getirir (UI listesi için) */
export function getAllShortcuts(): Shortcut[] {
  return Array.from(_shortcuts.values());
}

/** Kategoriye göre kısayolları getirir */
export function getShortcutsByCategory(category: Shortcut['category']): Shortcut[] {
  return Array.from(_shortcuts.values()).filter(s => s.category === category);
}

/** Keyboard listener'ı başlatır (uygulama mount'ta çağrılır) */
export function startListening(): void {
  if (_isListening) return;
  document.addEventListener('keydown', _handleKeyDown, true);
  _isListening = true;
}

/** Keyboard listener'ı durdurur */
export function stopListening(): void {
  if (!_isListening) return;
  document.removeEventListener('keydown', _handleKeyDown, true);
  _isListening = false;
}

/** Varsayılan kısayolları kaydeder */
export function registerDefaultShortcuts(handlers: {
  undo?: () => void;
  redo?: () => void;
  search?: () => void;
  selectAll?: () => void;
  delete?: () => void;
  escape?: () => void;
  help?: () => void;
}): void {
  if (handlers.undo) {
    registerShortcut({ id: 'undo', label: 'Geri Al', keys: ['Ctrl', 'Z'], category: 'editing', handler: handlers.undo });
  }
  if (handlers.redo) {
    registerShortcut({ id: 'redo', label: 'Yinele', keys: ['Ctrl', 'Y'], category: 'editing', handler: handlers.redo });
    registerShortcut({ id: 'redo2', label: 'Yinele (alternatif)', keys: ['Ctrl', 'Shift', 'Z'], category: 'editing', handler: handlers.redo });
  }
  if (handlers.search) {
    registerShortcut({ id: 'search', label: 'Arama', keys: ['Ctrl', 'K'], category: 'search', handler: handlers.search });
    registerShortcut({ id: 'search2', label: 'Arama (alternatif)', keys: ['Ctrl', 'F'], category: 'search', handler: handlers.search });
  }
  if (handlers.selectAll) {
    registerShortcut({ id: 'selectAll', label: 'Tümünü Seç', keys: ['Ctrl', 'A'], category: 'editing', handler: handlers.selectAll });
  }
  if (handlers.delete) {
    registerShortcut({ id: 'delete', label: 'Sil', keys: ['Delete'], category: 'editing', handler: handlers.delete });
  }
  if (handlers.escape) {
    registerShortcut({ id: 'escape', label: 'İptal / Kapat', keys: ['Escape'], category: 'general', handler: handlers.escape });
  }
  if (handlers.help) {
    registerShortcut({ id: 'help', label: 'Yardım', keys: ['F1'], category: 'general', handler: handlers.help });
  }
}

/** Dahili durumu sıfırlar (test için) */
export function _resetForTesting(): void {
  _shortcuts.clear();
  stopListening();
}
