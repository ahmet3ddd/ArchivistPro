/**
 * ArchivistPro — Extract Filtre Preset'leri
 *
 * Sık kullanılan ExtractFilter konfigürasyonlarını localStorage'a kaydeder.
 * Genel store'a eklenmez — özellik kapsamı dar, sadece ArchiveExtractModal kullanır.
 */

import type { ExtractFilter } from './archiveOps';

export interface FilterPreset {
  id: string;
  name: string;
  filter: ExtractFilter;
  createdAt: string;
}

const STORAGE_KEY = 'archivist_extract_filter_presets';

/** Tüm kayıtlı preset'leri yükler. Bozuk JSON güvenli — boş liste döner. */
export function getAllPresets(): FilterPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is FilterPreset =>
      typeof p === 'object' && p !== null &&
      typeof p.id === 'string' && typeof p.name === 'string' &&
      typeof p.filter === 'object' && p.filter !== null
    );
  } catch {
    return [];
  }
}

/**
 * Yeni preset kaydeder (aynı isimde varsa üzerine yazar).
 * Boş isim reddedilir.
 */
export function savePreset(name: string, filter: ExtractFilter): FilterPreset | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const existing = getAllPresets();
  const sameName = existing.find(p => p.name.toLowerCase() === trimmed.toLowerCase());
  const preset: FilterPreset = {
    id: sameName?.id ?? crypto.randomUUID(),
    name: trimmed,
    filter,
    createdAt: sameName?.createdAt ?? new Date().toISOString(),
  };

  const next = sameName
    ? existing.map(p => (p.id === sameName.id ? preset : p))
    : [...existing, preset];

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return preset;
  } catch {
    return null;
  }
}

/** Preset siler. Bulunamazsa false döner. */
export function deletePreset(id: string): boolean {
  const existing = getAllPresets();
  const next = existing.filter(p => p.id !== id);
  if (next.length === existing.length) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** Test için: tüm preset'leri sıfırla. */
export function _resetPresetsForTest(): void {
  localStorage.removeItem(STORAGE_KEY);
}
