// Slice 2 — UZAK-LOKASYON banner. Kaynak dosyalar bu makinede erisilemiyorsa (location_status
// `likelyForeign`) TopBar altinda kalici uyari bari gosterir. Kapatilabilir (oturum-ici).
//
// Yikici Replace/Reset zaten backend'de kaynak-yokluk korumasiyla reddedilir; bu banner
// PROAKTIF bilgilendirme (kullanici denemeden once "kaynak burada yok, onizleme modu" bilir).
// i18n + logical CSS (RTL). archive_host bilinmiyorsa (eski arsiv) host'suz metin.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocationStatus } from "./useLocationStatus";

export function LocationBanner() {
  const { t } = useTranslation();
  const status = useLocationStatus();
  const [dismissed, setDismissed] = useState(false);

  if (!status || !status.likelyForeign || dismissed) return null;

  const msg = status.archiveHost
    ? t("location.foreign_with_host", {
        host: status.archiveHost,
        current: status.currentHost,
        accessible: status.accessible,
        sampled: status.sampled,
      })
    : t("location.foreign_no_host", {
        current: status.currentHost,
        accessible: status.accessible,
        sampled: status.sampled,
      });

  return (
    <div className="flex items-center gap-3 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
      <span aria-hidden className="text-base leading-none">
        ⚠
      </span>
      <span className="flex-1">{msg}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        title={t("location.dismiss")}
        className="rounded px-2 py-0.5 text-xs text-warning/80 transition hover:bg-warning/20"
      >
        ✕
      </button>
    </div>
  );
}
