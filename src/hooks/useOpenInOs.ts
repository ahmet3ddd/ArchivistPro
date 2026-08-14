// OS entegrasyonu — asset dosyasini varsayilan uygulamada AC / dosya yoneticisinde GOSTER.
// Rust komutu (ipc.openPathOs / revealPathOs → `opener` crate = ShellExecuteW) kullanir; ARTIK
// tauri-plugin-opener DEGIL — o Windows'ta Unicode/bosluk iceren GECERLI yollarda (or. Turkce adli
// "Ekran goruntusu.jpg") sessizce BASARISIZ oluyordu. Hata SESSIZ YUTULMAZ → toast: "not_found" →
// dosya yok / bu makinede olmayabilir (cok-lokasyon); aksi → ham sebep. AssetContextMenu (sag-tik)
// + AssetDetailPanel (sag detay paneli) ortak kullanir.

import { useTranslation } from "react-i18next";

import { useToast } from "../features/toast/useToast";
import { ipc } from "../ipc/client";

export function useOpenInOs() {
  const { t } = useTranslation();
  const toast = useToast();

  // Ortak hata → toast. "not_found" ozel yerellestirme (dosya yok / bu makinede olmayabilir).
  const fail = (e: unknown, failKey: string): void => {
    const code = String(e);
    toast.error(
      code === "not_found" ? t("context.file_missing") : t(failKey, { message: code }),
    );
  };

  /** Dosyayi OS varsayilan uygulamasinda ac; hata → toast (SESSIZ YUTMA YOK). */
  const openFile = (path: string): void => {
    void ipc.openPathOs(path).catch((e: unknown) => fail(e, "context.open_failed"));
  };

  /** Dosyayi dosya yoneticisinde (klasorde) goster; hata → toast. */
  const showInFolder = (path: string): void => {
    void ipc.revealPathOs(path).catch((e: unknown) => fail(e, "context.reveal_failed"));
  };

  return { openFile, showInFolder };
}
