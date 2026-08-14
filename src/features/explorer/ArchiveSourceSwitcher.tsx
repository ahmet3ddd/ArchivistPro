// Arsiv KAYNAK degistiricisi — LAN Faz 2 (kullanici karari: ayri gorunum DEGIL, gezgin icinde
// bir degistirici → grid/arama/sanallastirma yeniden kullanilir).
//
// KONUM (kullanici karari, 2026-07-19 canli testte): **ust cubugun 1. sirasi, arama kutusunun
// SOLU.** Ilk yerlesim grid'in icindeydi (siralama kutusunun altinda) — canli testte "zor
// gorunen bir yer" olarak olculdu; ustelik Ayarlar modali actikken tamamen ortuluyordu.
// Ust sirada durmasi ayrica anlamsal: "neyin ICINDE arama yapiyorum" sorusu arama kutusuna bitisik.
//
// DAR ALAN DISIPLINI: 1. sira kalabalik (baslik · arama · geri/ileri · cop). Bu yuzden bilesen
// KOMPAKT: iki sekme + tek renkli durum noktasi. Uzun durum metni (`Bagli (ip:port)`) noktanin
// `title` ipucuna tasindi; ekranda yalnizca hata durumunda metin/dugme cikar.
//
// Gorunurluk kurali: eslesme YOKSA hic render edilmez. Tek makineli kurulumda ust cubukta
// fazladan hicbir sey gorunmez — ozellik kendini dayatmaz.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useRemoteArchive } from "../../hooks/useRemoteArchive";
import type { AssetSource } from "../../store/useUiStore";
import { useUiStore } from "../../store/useUiStore";

export function ArchiveSourceSwitcher() {
  const { t } = useTranslation();
  const { status, checking, refresh } = useRemoteArchive();
  const assetSource = useUiStore((s) => s.assetSource);
  const setAssetSource = useUiStore((s) => s.setAssetSource);

  // Guvenlik agi: eslesme kaldirilirsa (Ayarlar → LAN Istemci → Baglantiyi kes) ve o an "Ana
  // arsiv" secili ise kaynagi YERELE dondur — yoksa degistirici gizlenir ama kaynak "remote"
  // takili kalir, grid uzak veriyi cekemeyip bos/hatali gorunurdu. `checking` sirasinda DOKUNMA
  // (durum onceki degerini korur → gecici yanlis-pozitif reset olmasin).
  useEffect(() => {
    if (!checking && !status.configured && assetSource === "remote") {
      setAssetSource("local");
    }
  }, [checking, status.configured, assetSource, setAssetSource]);

  // Eslesme yok (veya yetkisiz/viewer) → degistirici hic gorunmez.
  // NOT (kullanici karari): degistirici artik TUM gorunumlerde gorunur — Gezgin'de belirip
  // kaybolmasi "dengesiz" hissettiriyordu. Uzak arsiv verisini yalniz Gezgin ve Teknik gosterir
  // (ikisi de /assets'ten beslenir); 'remote' secimi gorunumu bunlara sabitler (`setAssetSource`)
  // ve ActivityBar digerlerini KILITLER → yerel veri "Ana arsiv" etiketiyle asla gosterilmez.
  if (!status.configured) return null;

  const pick = (src: AssetSource) => {
    // Uzaga gecerken durumu tazele: acilistan beri host kapanmis/acilmis olabilir.
    if (src === "remote") refresh();
    setAssetSource(src);
  };

  const remote = assetSource === "remote";
  const statusText = checking
    ? t("archive_source.checking")
    : status.reachable
      ? t("archive_source.connected", { host: status.hostLabel ?? "" })
      : t("archive_source.offline");

  const tabClass = (active: boolean) =>
    [
      "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition motion-reduce:transition-none",
      active
        ? "bg-bg-primary text-text-primary shadow-sm"
        : "text-text-secondary hover:text-text-primary",
    ].join(" ");

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-0.5">
        <button
          type="button"
          onClick={() => pick("local")}
          className={tabClass(!remote)}
          aria-pressed={!remote}
        >
          {t("archive_source.local")}
        </button>
        <button
          type="button"
          onClick={() => pick("remote")}
          className={tabClass(remote)}
          aria-pressed={remote}
          // Uzak sekmenin ipucu, secili OLMASA da baglanti durumunu tasir.
          title={statusText}
        >
          {t("archive_source.remote")}
        </button>
      </div>

      {/* Uzak secilikken: renkli durum noktasi (ayrinti `title`'da) + salt-okuma rozeti.
          Hata varsa metin + "tekrar dene" EKRANA cikar (sessiz basarisizlik olmasin). */}
      {remote && (
        <span className="flex items-center gap-1.5">
          <span
            title={statusText}
            aria-label={statusText}
            className={[
              "size-1.5 shrink-0 rounded-full",
              checking ? "bg-text-muted" : status.reachable ? "bg-success" : "bg-danger",
            ].join(" ")}
          />
          {!checking && !status.reachable && (
            <>
              <span className="text-xs text-danger">{t("archive_source.offline")}</span>
              <button
                type="button"
                onClick={refresh}
                className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:border-border-hover motion-reduce:transition-none"
              >
                {t("common.retry")}
              </button>
            </>
          )}
          {!checking && status.reachable && (
            // Salt-okuma isareti: uzakta facet cubugu + detay paneli KAYBOLUR; kullanici
            // bunun bir arıza degil mod oldugunu gormeli (sessiz kaybolma DEGIL).
            <span className="hidden text-xs text-text-muted lg:inline">
              {t("archive_source.read_only")}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
