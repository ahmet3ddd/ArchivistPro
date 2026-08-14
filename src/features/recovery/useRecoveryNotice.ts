// Acilis kurtarma bildirimi (P2.6) — H2 "DB bozuk" modali pariti (H3'te toast).
//
// AppShell mount olunca backend `recovery_status`'u BIR KEZ okur; acilista bozuk-DB
// tespit edildiyse kullaniciyi bilgilendirir:
//   • "restored" → en yeni snapshot'tan OTO geri yuklendi (basari toast'i).
//   • "fresh"    → snapshot yoktu → temiz bos DB ile baslatildi; bozuk dosya korundu
//                  (hata toast'i + Ayarlar→Yedekler'den geri yukleme ipucu i18n metninde).
//   • "healthy"  → sessiz (hicbir sey gosterme).
//
// Modul-duzeyi `shown` bayragi: ayni process'te (or. cikis→tekrar-giris ile AppShell
// yeniden mount) bildirim TEKRARLANMAZ — kurtarma acilista bir kerelik gercektir.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";

let shown = false; // process-omru: bildirim bir kez

export function useRecoveryNotice(): void {
  const { t } = useTranslation();
  const toast = useToast();

  useEffect(() => {
    if (shown) return;
    shown = true;
    let active = true;
    void ipc
      .recoveryStatus()
      .then((info) => {
        if (!active) return;
        if (info.outcome === "restored") {
          toast.success(t("recovery.restored", { snapshot: info.snapshot ?? "" }));
        } else if (info.outcome === "fresh") {
          toast.error(t("recovery.fresh", { quarantined: info.quarantined ?? "" }));
        }
      })
      .catch(() => {
        /* recovery_status okunamadi → sessiz (kritik degil) */
      });
    return () => {
      active = false;
    };
  }, [t, toast]);
}
