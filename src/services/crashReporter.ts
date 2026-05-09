/**
 * ArchivistPro — Crash Reporter Service
 *
 * Frontend wrapper for Rust crash_report Tauri commands.
 * Silently fails in web dev mode (no Tauri runtime).
 */

export interface CrashReport {
  id: string;
  timestamp: string;
  error_type: string;
  message: string;
  stack_trace: string;
  app_version: string;
  os_info: string;
  memory_usage: string;
  component: string;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '... [truncated]';
}

export async function writeCrashReport(
  errorType: string,
  message: string,
  stackTrace: string,
  component?: string,
): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_crash_report', {
      errorType,
      message: truncate(message, 2000),
      stackTrace: truncate(stackTrace, 50_000),
      component: component ?? 'unknown',
    });
  } catch {
    // Silent fail in web dev mode or if Tauri is unavailable
  }
}

export async function listCrashReports(): Promise<CrashReport[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<CrashReport[]>('list_crash_reports');
  } catch {
    return [];
  }
}

export async function deleteCrashReport(id: string): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('delete_crash_report', { id });
  } catch {
    return false;
  }
}

export async function clearAllCrashReports(): Promise<number> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number>('clear_crash_reports');
  } catch {
    return 0;
  }
}
