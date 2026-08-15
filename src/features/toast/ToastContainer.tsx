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
      // w-96: eski `w-80` (320px) tek cumlelik bildirimler icin yeterliydi; analiz raporu gibi
      // cok cumleli metinlerde satirlar asiri kisaliyordu. max-w dar pencerede tasmayi onler.
      className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
