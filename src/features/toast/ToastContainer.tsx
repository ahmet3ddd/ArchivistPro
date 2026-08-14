// Toast yiginti — uygulama kokunde tek sefer monte edilir (App.tsx), z-index modal/
// menulerin (z-50) USTUNDE (z-[100]). Alt-bitis kosesinde (RTL-guvenli: bottom + end);
// pointer-events kapsayicida kapali, satirlarda acik (altindaki UI tiklanabilir kalir).
// aria-live=polite → ekran okuyucu yeni bildirimleri okur.

import { useToastStore } from "./toastStore";
import { ToastItem } from "./ToastItem";

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
