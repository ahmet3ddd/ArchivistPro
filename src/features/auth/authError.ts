// Auth hata cevirisi — Rust'tan gelen ham hata dizgesini i18n anahtarina esler.
//
// Sunucu hatalari (auth_commands.rs / rbac.rs / db) sabit on-eklerle gelir:
//  - `DbError::Invalid` → "gecersiz: <kod>" (bad_credentials/locked/username_taken/…)
//  - `Forbidden`        → "yetki reddedildi: …"
//  - oturum yok         → "kimlik dogrulanmadi"
// Eslesme yoksa ham dizge gosterilir (sessiz-yutma yok). i18n: auth.error.*

import type { TFunction } from "i18next";

/** `DbError::Invalid` on-eki (commands → "gecersiz: <kod>"). */
const INVALID_PREFIX = "gecersiz: ";
const FORBIDDEN_PREFIX = "yetki reddedildi:";
const NO_SESSION = "kimlik dogrulanmadi";

/** Bilinen `gecersiz: <kod>` kodlari → auth.error.<kod> i18n anahtari. */
const INVALID_CODES = new Set([
  "bad_credentials",
  "locked",
  "username_taken",
  "username_required",
  "password_required",
  "password_too_short", // asgari uzunluk (bkz passwordPolicy.ts) — backend dayatir
  "invalid_role",
  "last_admin",
]);

/** Ham hata (string | Error | unknown) → kullaniciya gosterilecek yerel metin. */
export function authErrorMessage(err: unknown, t: TFunction): string {
  const raw = errToString(err).trim();

  if (raw.startsWith(INVALID_PREFIX)) {
    const code = raw.slice(INVALID_PREFIX.length).trim();
    if (INVALID_CODES.has(code)) return t(`auth.error.${code}`);
  }
  if (raw.startsWith(FORBIDDEN_PREFIX)) return t("auth.error.forbidden");
  if (raw === NO_SESSION) return t("auth.error.no_session");

  // Eslesmeyen → ham dizge (savunma; yine de gosterilir).
  return raw || t("auth.error.unknown");
}

function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
