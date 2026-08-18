// Auth hata cevirisi — Rust'tan gelen KARARLI hata kodunu i18n anahtarina esler.
//
// Sunucu hatalari sabit, dil-notr on-eklerle gelir (2026-08-17 denetimi: on-ekler eskiden
// Turkce'ydi ve `map_err(|e| e.to_string())` zinciriyle EN/AR/JA/ZH oturumlarinda ekrana
// cikiyordu — artik ASCII kod):
//  - `DbError::Invalid` → "invalid: <kod>"   (bad_credentials/locked/username_taken/…)
//  - `DbError::Cancelled` → "cancelled"
//  - `rbac::Forbidden`  → "forbidden: <kod>" (no_session/admin_required/editor_required/…)
// Eslesme yoksa ham dizge gosterilir (sessiz-yutma yok). i18n: auth.error.*

import type { TFunction } from "i18next";

/** `DbError::Invalid` on-eki (commands → "invalid: <kod>"). */
const INVALID_PREFIX = "invalid: ";
/** `rbac::Forbidden` on-eki (commands → "forbidden: <kod>"). */
const FORBIDDEN_PREFIX = "forbidden: ";

/** Bilinen `invalid: <kod>` kodlari → auth.error.<kod> i18n anahtari. */
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

/**
 * Bilinen `forbidden: <kod>` kodlari → auth.error.<kod>. Listede olmayan kod (or.
 * `session_unreadable`) jenerik `auth.error.forbidden`'a duser — yeni bir backend kodu
 * eklendiginde kullanici ham ASCII gormez.
 */
const FORBIDDEN_CODES = new Set([
  "no_session",
  "admin_required",
  "founder_required",
  "editor_required",
]);

/** Ham hata (string | Error | unknown) → kullaniciya gosterilecek yerel metin. */
export function authErrorMessage(err: unknown, t: TFunction): string {
  const raw = errToString(err).trim();

  if (raw.startsWith(INVALID_PREFIX)) {
    const code = raw.slice(INVALID_PREFIX.length).trim();
    if (INVALID_CODES.has(code)) return t(`auth.error.${code}`);
  }
  if (raw.startsWith(FORBIDDEN_PREFIX)) {
    const code = raw.slice(FORBIDDEN_PREFIX.length).trim();
    return FORBIDDEN_CODES.has(code) ? t(`auth.error.${code}`) : t("auth.error.forbidden");
  }

  // Eslesmeyen → ham dizge (savunma; yine de gosterilir).
  return raw || t("auth.error.unknown");
}

function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
