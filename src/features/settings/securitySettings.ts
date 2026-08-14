// Guvenlik tercihleri (localStorage) — odaSettings/scanSettings deseni.
//
// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu): H2'de bostakalma (idle) oturum kilidi
// VARDI — `useSessionTimeout.ts` + `authSlice.ts:53` varsayilan **30 dk**, Ayarlar→Guvenlik'ten
// 5/15/30/60/120 dk veya "asla" secilebiliyordu. H3'te bunun hicbiri yoktu: oturum uygulama
// kapanana kadar SURESIZ acik kaliyordu (`src-tauri/src/auth_commands.rs` oturumu bellek-ici
// tutar, sona-erme alani yok). Ofiste masada birakilan makinede yoldan gecen herkes admin
// yetkisiyle silme/tasima/kullanici-yonetimi yapabilirdi.
//
// Makine-YEREL (localStorage): H3'te `app_settings` KV tablosu yok + bu bir makine/konum
// tercihidir (evdeki tek-kullanici makinesi ile paylasimli ofis makinesi ayni degeri istemez).

const KEY = "archivist_session_timeout_min";

/** H2 varsayilani (`authSlice.ts:53` `sessionTimeoutMinutes: 30`). */
export const SESSION_TIMEOUT_DEFAULT_MIN = 30;

/** H2 ile ayni on-ayarlar; `0` = asla kilitleme. */
export const SESSION_TIMEOUT_PRESETS = [0, 5, 15, 30, 60, 120] as const;

/** Kilitten kac saniye ONCE uyarilir (H2 `WARNING_ADVANCE_MS = 60_000`). */
export const SESSION_WARNING_SECS = 60;

/** Ham localStorage degerini dakikaya cevir. SAF (test edilebilir): gecersiz/eksik/negatif
 *  → varsayilan. `0` gecerlidir ("asla") — varsayilana DUSMEZ. */
export function parseTimeoutMin(raw: string | null): number {
  if (raw == null) return SESSION_TIMEOUT_DEFAULT_MIN;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return SESSION_TIMEOUT_DEFAULT_MIN;
  return n;
}

/** Secili bostakalma suresi (dakika). Gecersiz/eksik → 30. `0` = asla. */
export function getSessionTimeoutMin(): number {
  return parseTimeoutMin(localStorage.getItem(KEY));
}

/** Bostakalma asamasi — zamanlayicinin TEK karar noktasi. SAF (test edilebilir).
 *  `idleMs` = son aktiviteden bu yana gecen sure. */
export type IdlePhase = "active" | "warning" | "lock";

export function idlePhase(
  idleMs: number,
  timeoutMin: number,
): { phase: IdlePhase; secondsLeft: number } {
  if (timeoutMin <= 0) return { phase: "active", secondsLeft: 0 }; // "asla"
  const timeoutMs = timeoutMin * 60_000;
  if (idleMs >= timeoutMs) return { phase: "lock", secondsLeft: 0 };
  const warnMs = SESSION_WARNING_SECS * 1000;
  if (idleMs >= timeoutMs - warnMs) {
    return { phase: "warning", secondsLeft: Math.max(0, Math.ceil((timeoutMs - idleMs) / 1000)) };
  }
  return { phase: "active", secondsLeft: 0 };
}

/** Bostakalma suresini yaz (dakika; `0` = asla). */
export function setSessionTimeoutMin(minutes: number): void {
  localStorage.setItem(KEY, String(Math.max(0, Math.trunc(minutes))));
}
