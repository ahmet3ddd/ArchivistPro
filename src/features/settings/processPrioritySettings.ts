// Uygulama-islem onceligi tercihi (makine-yerel localStorage). Tercihin kendisi
// burada saklanir; GERCEK Windows SetPriorityClass cagrisi Rust `set_process_priority`
// komutundadir. AppShell, admin oturumunda kayitli tercihi yeniden uygular.

const KEY = "archivist_process_priority";

export type ProcessPriority = "normal" | "background";

export const PROCESS_PRIORITY_DEFAULT: ProcessPriority = "normal";

/** Bozuk/değiştirilmiş localStorage → güvenli varsayılan normal. */
export function parseProcessPriority(raw: string | null): ProcessPriority {
  return raw === "background" || raw === "normal" ? raw : PROCESS_PRIORITY_DEFAULT;
}

export function getProcessPriority(): ProcessPriority {
  return parseProcessPriority(localStorage.getItem(KEY));
}

export function setProcessPriority(priority: ProcessPriority): void {
  localStorage.setItem(KEY, priority);
}
