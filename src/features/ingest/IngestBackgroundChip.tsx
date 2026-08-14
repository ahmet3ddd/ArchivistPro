// Arka plandaki klasor taramasinin ust cubuktaki gorunurlugu — tiklayinca pencere geri gelir.
//
// NEDEN VAR: tarama artik arka plana alinabiliyor (`IngestModal` minimize). Gorunur bir iz
// birakmadan gizlenen uzun bir is, kullanicinin "bir sey oluyor mu?" diye tahmin etmesine yol
// acar — bugun tam bunu yasadi (ilerleme penceresine bakip "belki de arkada islem yapiyor,
// bilmiyorum" dedi). Cip iki soruyu cevaplar: KOSUYOR MU + NE KADAR KALDI.
//
// Ayrica cip, yazma eylemlerinin neden kapali oldugunun GORUNUR gerekcesidir (bkz
// `useIngestLock`): kilitli dugmelerin ipucu metni "tarama suruyor" der, cip de taramayi
// gosterir — kullanici sebebi ekranda gorur, tahmin etmez.
//
// Kaynak: `useIngestStatus` (backend `ingest_status` yoklamasi). Modal'in kendi Channel
// ilerlemesinden BAGIMSIZ — pencere gizliyken de, hatta baska bir yerden baslatilmis bir
// taramada da dogru calisir.

import { useTranslation } from "react-i18next";

import { useIngestStatus } from "../../hooks/useIngestLock";
import { useUiStore } from "../../store/useUiStore";
import { progressPct } from "./progressActivity";
import { formatNumber } from "../../lib/format";

export function IngestBackgroundChip() {
  const { t, i18n } = useTranslation();
  const status = useIngestStatus();
  const ingestOpen = useUiStore((s) => s.ingestOpen);
  const ingestMinimized = useUiStore((s) => s.ingestMinimized);
  const setIngestMinimized = useUiStore((s) => s.setIngestMinimized);
  const openIngest = useUiStore((s) => s.openIngest);
  const finished = useUiStore((s) => s.ingestFinishedInBackground);

  // Pencere zaten ONDEyken cip cizilmez (ayni bilgi iki kez).
  if (ingestOpen && !ingestMinimized) return null;
  // Kosarken VEYA arka planda bitip raporu okunmamisken gorunur.
  // BITTI hali neden var: kosu bitince `active` false olur ve cip kaybolurdu; pencere gizli
  // oldugu icin RAPOR ulasilamaz kalirdi (kullanici bulgusu 2026-08-11).
  if (!status.active && !finished) return null;
  const done = !status.active && finished;

  const p = status.progress;
  const pct = p ? progressPct(p.processed, p.total) : null;
  const num = (n: number) => formatNumber(n, i18n.language);

  // Geri getir: pencere hala mountlu ise (arka planda) yalniz gorunurlugu ac — kosunun raporu
  // orada yasiyor. Mountlu DEGILSE (or. tarama baska bir yoldan basladi) pencereyi ac; modal
  // `ingest_status` yoklamasiyla calisan kosuya yeniden baglanir.
  const restore = () => {
    if (ingestOpen) setIngestMinimized(false);
    else openIngest(null);
  };

  // BITTI hali basarı rengiyle ve NABIZSIZ cizilir — "hala calisiyor" yanilgisi olmasin.
  return (
    <button
      type="button"
      onClick={restore}
      title={done ? t("ingest.chip_done_hint") : t("ingest.chip_hint")}
      className={`flex min-w-0 items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] transition ${
        done
          ? "border-success/40 bg-success/10 text-success hover:bg-success/20"
          : "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
      }`}
    >
      {done ? (
        <>
          <span className="shrink-0">✓</span>
          <span className="truncate font-medium">{t("ingest.chip_done")}</span>
        </>
      ) : (
        <>
          {/* Nabiz: "canli" oldugunu sayilar degismese de gosterir (buyuk dosyada sayac durur). */}
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
          <span className="truncate font-medium">{t("ingest.chip_label")}</span>
          {p && p.total > 0 ? (
            <span className="shrink-0 tabular-nums">
              {num(p.processed)}/{num(p.total)}
              {pct != null && ` · %${pct}`}
            </span>
          ) : (
            <span className="shrink-0">{t("ingest.chip_scanning")}</span>
          )}
        </>
      )}
    </button>
  );
}
