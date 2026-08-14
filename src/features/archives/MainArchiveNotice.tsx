// "Bu ozellik ana arsivde yonetilir" notu — kimlik/yonetim panelleri (kullanici/mesaj/LAN)
// yalniz ANA arsivde calisir (backend `require_main_archive`). Aktif arsiv ek arsivken ilgili
// panel bu notu gosterir → ozellik SESSIZCE kaybolmaz (fazla-kapatma dersi: neden gorunmedigini
// soyle). Kullanici sol arsiv anahtarindan ANA'ya gecince panel geri gelir.

import { useTranslation } from "react-i18next";

export function MainArchiveNotice() {
  const { t } = useTranslation();
  return (
    <p className="rounded-md border border-border bg-bg-tertiary px-3 py-2 text-xs text-text-muted">
      {t("local_archive.main_only_notice")}
    </p>
  );
}
