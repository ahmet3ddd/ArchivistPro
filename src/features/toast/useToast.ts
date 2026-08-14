// Toast yardimci hook'u — yazma-yollarinda kisa cagri yuzeyi (success/error/info).
//
// Mesaj ZATEN cevrili gelir: cagiran kendi `useTranslation().t` ile uretir
// (`toast.success(t("toast.tag_added", { name }))`). Bu, interpolasyon + backend
// hata metnini tek tip ele alir. Donen nesne `push` (zustand'dan stabil) uzerine
// memoize — referans dengeli (useCallback bagimlilik listelerinde guvenli).

import { useMemo } from "react";

import type { ToastAction } from "./toastStore";
import { useToastStore } from "./toastStore";

export interface ToastApi {
  success: (message: string, action?: ToastAction) => void;
  error: (message: string, action?: ToastAction) => void;
  info: (message: string, action?: ToastAction) => void;
}

export function useToast(): ToastApi {
  const push = useToastStore((s) => s.push);
  return useMemo(
    () => ({
      success: (message, action) => push("success", message, action),
      error: (message, action) => push("error", message, action),
      info: (message, action) => push("info", message, action),
    }),
    [push],
  );
}
