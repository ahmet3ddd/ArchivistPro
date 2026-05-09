/**
 * Archivist Pro — Arama Geçmişi & Kayıtlı Aramalar
 *
 * Son aramaları otomatik kaydeder.
 * Kullanıcı sık kullandığı aramaları kalıcı olarak kaydedebilir.
 * localStorage'da tutulur (DB yükü gereksiz).
 */

/* ── Tipler ── */

export interface SearchHistoryEntry {
  query: string;
  timestamp: string;
  resultCount?: number;
}

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  filters?: Record<string, string[]>;
  createdAt: string;
}

/* ── Sabitler ── */

const HISTORY_KEY = 'archivist_search_history';
const SAVED_KEY = 'archivist_saved_searches';
const MAX_HISTORY = 50;

/* ── Arama Geçmişi ── */

/** Arama geçmişini yükler */
export function getSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Aramayı geçmişe ekler (duplicate varsa en üste taşır) */
export function addToSearchHistory(query: string, resultCount?: number): void {
  if (!query.trim()) return;

  const history = getSearchHistory();
  const filtered = history.filter(h => h.query !== query.trim());
  filtered.unshift({
    query: query.trim(),
    timestamp: new Date().toISOString(),
    resultCount,
  });

  // Limit
  if (filtered.length > MAX_HISTORY) filtered.length = MAX_HISTORY;

  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  } catch { /* quota */ }
}

/** Tek bir girişi geçmişten siler */
export function removeFromSearchHistory(query: string): void {
  const history = getSearchHistory().filter(h => h.query !== query);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch { /* quota */ }
}

/** Tüm arama geçmişini temizler */
export function clearSearchHistory(): void {
  localStorage.removeItem(HISTORY_KEY);
}

/** Geçmişte arama yapar (autocomplete için) */
export function searchInHistory(prefix: string): SearchHistoryEntry[] {
  if (!prefix.trim()) return getSearchHistory().slice(0, 10);
  const p = prefix.trim().toLowerCase();
  return getSearchHistory().filter(h => h.query.toLowerCase().includes(p)).slice(0, 10);
}

/* ── Kayıtlı Aramalar ── */

/** Tüm kayıtlı aramaları getirir */
export function getSavedSearches(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/** Aramayı kalıcı olarak kaydeder */
export function saveSearch(name: string, query: string, filters?: Record<string, string[]>): SavedSearch {
  const saved = getSavedSearches();
  const entry: SavedSearch = {
    id: `saved_${Date.now()}`,
    name: name.trim(),
    query: query.trim(),
    filters,
    createdAt: new Date().toISOString(),
  };
  saved.push(entry);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch { /* quota */ }
  return entry;
}

/** Kayıtlı aramayı siler */
export function deleteSavedSearch(id: string): void {
  const saved = getSavedSearches().filter(s => s.id !== id);
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  } catch { /* quota */ }
}

/** Kayıtlı aramayı yeniden adlandırır */
export function renameSavedSearch(id: string, newName: string): boolean {
  const saved = getSavedSearches();
  const entry = saved.find(s => s.id === id);
  if (!entry) return false;
  entry.name = newName.trim();
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    return true;
  } catch { return false; }
}
