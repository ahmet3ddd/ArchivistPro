// Favori toggle hook'u — iyimser store override (anlik UI, grid+detay senkron) +
// IPC yazma + facet tazeleme + toast geri-bildirim; hata olursa override geri alinir.
// Liste SIFIRLANMAZ.

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../ipc/client";
import { useToast } from "../features/toast/useToast";
import { useUiStore } from "../store/useUiStore";

export function useToggleFavorite(): (id: number, current: boolean) => void {
  const { t } = useTranslation();
  const toast = useToast();
  const setOverride = useUiStore((s) => s.setFavoriteOverride);
  const bumpFacets = useUiStore((s) => s.bumpFacets);

  return useCallback(
    (id: number, current: boolean) => {
      const next = !current;
      setOverride(id, next); // iyimser
      // Faz 6 / B1: role gecmiyoruz — yetki sunucu oturumundan zorlanir.
      ipc
        .setFavorite(id, next)
        .then(() => {
          bumpFacets();
          toast.success(t(next ? "toast.favorite_added" : "toast.favorite_removed"));
        })
        .catch(() => {
          setOverride(id, current); // hata → geri al
          toast.error(t("toast.favorite_failed"));
        });
    },
    [setOverride, bumpFacets, toast, t],
  );
}
