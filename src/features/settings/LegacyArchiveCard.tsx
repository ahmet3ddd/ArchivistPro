// Ayarlar > Genel: **Onceki surum (H2 / ArchivistPro) bulundu** — algila, soyle ve
// (admin icin) AKTAR. Kullanici karari 2026-08-10: H2→H3 kayipsiz veri aktarimi VAR;
// karttaki "aktarma secenegi cikacak" sozu H2ImportWizard ile yerine getirildi.
// H2 yine de KALDIRILMAZ: aktarim bitip kullanici dogrulayana kadar kaynak yerinde durur.
//
// Neden AI "Kurulum kontrolu" kartinda DEGIL: orada genel sonuc en KOTU satirdir; onceki surumun
// varligi bir ariza degildir, o karti gereksiz yere sariya/kirmiziya cekerdi.
//
// Kart, bulunacak bir sey yoksa HIC gorunmez (temiz makinede gurultu uretmez).

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LegacyArchive } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { formatBytes, formatNumber } from "../../lib/format";
import { useSession } from "../../hooks/useSession";
import { H2ImportWizard } from "./H2ImportWizard";

export function LegacyArchiveCard() {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useSession();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [data, setData] = useState<LegacyArchive | null>(null);

  // Teshis basarisizligi kullaniciya hata olarak gosterilmez: kart yoksa yoktur.
  const refresh = useCallback(() => {
    void ipc
      .legacyArchiveStatus()
      .then(setData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Ne kurulum ne veri → gosterecek bir sey yok.
  const hasData = data != null && data.archiveCount > 0;
  if (data == null || (!data.installed && !hasData)) return null;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-accent/30 bg-accent/5 p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("legacy.title")}
      </h3>

      {/* Iki bagimsiz olgu: program kurulu mu · verisi duruyor mu. */}
      <ul className="flex flex-col gap-1 text-xs text-text-secondary">
        {data.installed && (
          <li>{t("legacy.installed", { version: data.version ?? t("legacy.version_unknown") })}</li>
        )}
        {hasData && (
          <li>
            {t("legacy.data_found", {
              archives: data.archiveCount,
              size: formatBytes(data.totalBytes, i18n.language),
              // Sayilamadiysa sayi UYDURULMAZ; cumle "kayit sayisi okunamadi" der.
              assets:
                data.assetCount == null
                  ? t("legacy.assets_unknown")
                  : formatNumber(data.assetCount, i18n.language),
            })}
          </li>
        )}
        {data.dataDir && (
          <li dir="ltr" className="truncate text-text-muted" title={data.dataDir}>
            {data.dataDir}
          </li>
        )}
      </ul>

      {/* Yapilmis is HAFIZASI (2026-08-13 kullanici bulgusu): aktarim bittiginde kart eskisiyle
          birebir ayni gorunuyordu → "sanki hic islem yapmamis". Son aktarimin kalici ozeti
          burada; ipucu metni de "neden hala gorunuyorum"u anlatan surume gecer. */}
      {data.lastImport != null && (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-xs leading-relaxed text-success">
          {t("legacy.last_import", {
            when: new Date(data.lastImport.ts * 1000).toLocaleString(i18n.language),
            inserted: formatNumber(data.lastImport.inserted, i18n.language),
            existing: formatNumber(data.lastImport.existing, i18n.language),
            ai: formatNumber(data.lastImport.ai, i18n.language),
          })}
        </p>
      )}

      {/* Asil mesaj: SAKIN kaldirma. Kullanici "yeni surum kuruldu, eskisi gitsin" diye
          dusunecegi icin bunu acikca yaziyoruz. */}
      <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
        {t("legacy.keep_warning")}
      </p>
      <p className="text-[11px] leading-relaxed text-text-muted">
        {data.lastImport != null ? t("legacy.hint_done") : t("legacy.hint")}
      </p>

      {/* Aktarim (yalniz admin; veri varsa). Sihirbaz kapali → tek buton; aktarim yapildiysa
          "Yeniden aktar" (tekrar kosmak guvenlidir: mevcut kayitlar atlanir, kopya uretmez). */}
      {isAdmin && hasData && !wizardOpen && (
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
        >
          {data.lastImport != null ? t("legacy.import.again") : t("legacy.import.start")}
        </button>
      )}
      {/* Sihirbaz kapaninca durum TAZELENIR → yeni "son aktarim" satiri hemen gorunur. */}
      {isAdmin && wizardOpen && (
        <H2ImportWizard
          onClose={() => {
            setWizardOpen(false);
            refresh();
          }}
        />
      )}
    </section>
  );
}
