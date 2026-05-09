/**
 * Archivist Pro — Sistem Kontrol Servisi
 *
 * İlk çalışma wizard'ı için WASM, Windows versiyon, disk alanı kontrolleri.
 */

const WIZARD_FLAG = 'archivist_setup_wizard_done';

/** Wizard daha önce tamamlandı mı? */
export function hasSeenSetupWizard(): boolean {
  return localStorage.getItem(WIZARD_FLAG) === '1';
}

/** Wizard tamamlandı olarak işaretle */
export function markSetupWizardSeen(): void {
  localStorage.setItem(WIZARD_FLAG, '1');
}

/** WebAssembly desteği var mı? */
export function checkWasmSupport(): boolean {
  return typeof WebAssembly !== 'undefined';
}

/** Navigator userAgent'dan Windows NT versiyonunu parse et */
export function getWindowsVersion(): string {
  const ua = navigator.userAgent;
  const match = ua.match(/Windows NT (\d+\.\d+)/);
  if (!match) return 'Unknown';
  const ntMap: Record<string, string> = {
    '10.0': 'Windows 10/11',
    '6.3': 'Windows 8.1',
    '6.2': 'Windows 8',
    '6.1': 'Windows 7',
    '6.0': 'Windows Vista',
  };
  return ntMap[match[1]] || `Windows NT ${match[1]}`;
}

/** Tahmini kullanılabilir disk alanını döndür (bytes). Desteklenmiyorsa null. */
export async function estimateDiskSpace(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  } catch {
    return null;
  }
}
