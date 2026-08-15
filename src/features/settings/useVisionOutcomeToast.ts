// Analiz kosusu bitince gosterilecek bildirim — TEK cagri yuzeyi (secim arac cubugu + detay paneli).
//
// Metni `visionOutcomeNotice` uretir (saf, test edilebilir); burasi yalnizca i18n + toast + eylem
// butonunu baglar. Eleme durumunda butona basmak filtreyi "denendi, sonuc alinamadi"ya getirir →
// kullanici tam o gorselleri gorur, secer ve daha yetenekli bir modelle yeniden dener.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import type { ImageAnalysisReport } from "../../ipc/client";
import { useFailedAttemptFilter } from "../facets/aiAttempt";
import { useToast } from "../toast/useToast";
import { visionOutcomeNotice } from "./visionErrors";

export function useVisionOutcomeToast(): (report: ImageAnalysisReport) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const { show } = useFailedAttemptFilter();

  return useCallback(
    (report) => {
      const notice = visionOutcomeNotice(report);
      const prefix = notice.prefixKey ? `${t(notice.prefixKey, notice.params)} ` : "";
      const advice = notice.adviceKey ? ` ${t(notice.adviceKey, notice.params)}` : "";
      const message = `${prefix}${t(notice.key, notice.params)}${advice}`;
      const action = notice.markedForRetry
        ? { label: t("vision_index.unusable.show_action"), onClick: show }
        : undefined;
      if (notice.kind === "error") toast.error(message, action);
      else toast.info(message, action);
    },
    [t, toast, show],
  );
}
