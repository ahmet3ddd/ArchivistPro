// OS klasor surukle-birak overlay'i (Faz A) — useOsFolderDrop `dragActive` iken AppShell gosterir.
//
// Tam-ekran yari-saydam katman + kesikli cerceve + "buraya birakin" mesaji. Yalniz gorsel geri-
// bildirim (etkilesim yok; gercek drop olayi Tauri webview seviyesinde yakalanir). Portal(body)
// → TopBar backdrop-blur containing-block tuzagindan kacar; z-[60] ile modallarin da uzerinde.
// Tema token'lari (acik+koyu) + logical CSS (RTL). i18n: dropzone.drop_here + dropzone.desc.

import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

export function DropOverlay() {
  const { t } = useTranslation();

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-bg-primary/70 p-8 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-bg-secondary/90 px-10 py-12 text-center shadow-xl">
        <span aria-hidden className="text-5xl">
          📁
        </span>
        <p className="font-display text-lg font-bold text-accent">{t("dropzone.drop_here")}</p>
        <p className="max-w-xs text-sm text-text-secondary">{t("dropzone.desc")}</p>
      </div>
    </div>,
    document.body,
  );
}
