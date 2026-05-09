/**
 * Build-time feature flag'leri.
 *
 * Tauri (Rust) tarafında `#[cfg(feature = "admin")]` ile koşullu derlenen
 * komutlar viewer-only build'inde mevcut değildir. Bu modül runtime'da
 * Rust'tan bayrakları okur ve UI'nin ilgili butonları gizlemesini sağlar.
 */

export interface BuildFeatures {
  /** Admin-only komutlar derlemede dahil mi (3ds Max convert/export, refile_organize) */
  admin: boolean;
}

let _cache: BuildFeatures | null = null;
let _loading: Promise<BuildFeatures> | null = null;

/**
 * Build feature bayraklarını yükler (bir kez cache'lenir).
 * Tauri dışı ortamda (test, web preview) admin=true varsayar.
 */
export async function loadBuildFeatures(): Promise<BuildFeatures> {
  if (_cache) return _cache;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const flags = await invoke<BuildFeatures>('get_build_features');
      _cache = { admin: !!flags?.admin };
    } catch {
      // Tauri dışı ortam — varsayılan olarak tüm özellikler açık (test/dev)
      _cache = { admin: true };
    }
    return _cache;
  })();

  return _loading;
}

/** Senkron erişim — `loadBuildFeatures()` önceden çağrılmış olmalı. Yoksa true (güvenli varsayılan). */
export function hasAdminFeatures(): boolean {
  return _cache ? _cache.admin : true;
}

/** Yalnızca testler için: cache'i sıfırla. */
export function _resetBuildFeaturesForTest(): void {
  _cache = null;
  _loading = null;
}
