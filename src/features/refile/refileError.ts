// Refile hata cevirisi — Rust'tan gelen ham hata kodunu i18n mesajina esler.
//
// Backend refile hatalari SABIT kod dizgeleriyle gelir (rename → thrown; batch → rapor icindeki
// `skipped.reason` / `failed.error`):
//   invalid_name · source_missing · target_exists · db_conflict · not_found · same_dir · io:<detay>
// `io:` on-ekli → detay gosterilir; bilinen kod → refile.err.<kod>; bilinmeyen → ham dizge
// (sessiz-yutma yok). i18n: refile.err.*

import type { TFunction } from "i18next";

/** Bilinen refile hata kodlari → refile.err.<kod> i18n anahtari. */
const KNOWN_CODES = new Set([
  "invalid_name",
  "source_missing",
  "target_exists",
  "db_conflict",
  "not_found",
  "same_dir",
]);

const IO_PREFIX = "io:";

/** Ham hata/kod (string | Error | unknown) → kullaniciya gosterilecek yerel metin. */
export function refileErrorMessage(err: unknown, t: TFunction): string {
  const raw = errToString(err).trim();

  if (raw.startsWith(IO_PREFIX)) {
    return t("refile.err.io", { detail: raw.slice(IO_PREFIX.length).trim() });
  }
  if (KNOWN_CODES.has(raw)) return t(`refile.err.${raw}`);

  // Eslesmeyen → ham dizge (savunma; yine de gosterilir).
  return raw || t("refile.err.io", { detail: "" });
}

function errToString(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err);
}
