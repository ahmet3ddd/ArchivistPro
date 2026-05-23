import { invoke } from '@tauri-apps/api/core';

export async function invokeWithTimeout<T>(
  cmd: string,
  args: Record<string, unknown>,
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Tauri invoke '${cmd}' ${timeoutMs}ms sonra zaman aşımına uğradı`)), timeoutMs)
    ),
  ]);
}
