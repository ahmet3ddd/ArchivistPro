// Ust cubuk YAZMA eylemlerinin uzak (ana arsiv) modunda kapisi — LAN salt-okuma durusunun
// atlanmis parcasi.
//
// BULGU (kullanici sorusundan dogdu, 2026-07-22): "Ana arşiv" secili ve "Salt okunur" rozeti
// gorunurken ust cubuktaki **İndeksle… · Kaynak Klasörler · Kural ile düzenle · Projeler ·
// Geri/İleri Al · Çöp** dugmeleri CANLIYDI (`TopBar` onlari kosulsuz render ediyordu). Grid
// tarafinda ayni sinif ZATEN kapaliydi (sag-tik · Delete · facet'ler), ust cubuk atlanmisti.
//
// ⚠️ NEDEN ONEMLI: bu eylemler daima YEREL arsive uygulanir. Tek makinede (loopback) zararsiz
// gorunur cunku host ayni DB'yi sunar; ama IKI GERCEK MAKINEDE kullanici "Ana arşiv"deyken
// İndeksle'ye basip dosyayi ANA ARSIVE ekledigini sanir — oysa kendi yerel arsivine girer.
// Veri bozulmaz (yazma host'a ulasamaz) ama zihinsel model sessizce yanlislanir.
//
// KARAR — gizlemek DEGIL, kilitlemek: ActivityBar deseni (gri + ipucu). Kaybolan dugme "ariza"
// gibi okunur; kullanici zaten kaynak degistiricinin belirip kaybolmasina "dengesiz" demisti.
// Ayrica kilit, eylemin NEREDE yapilabilecegini soyleyerek yol gosterir.
//
// UYGULAMA: `<fieldset disabled>` — icindeki TUM form denetimlerini (button/input/select) tarayici
// duzeyinde devre disi birakir ve odak sirasindan cikarir. Cocuk bilesenler degistirilmez
// (7 ayri dosyaya `assetSource` sizdirmak yerine tek sarmalayici) ve klavye ile de gecilemez —
// `pointer-events: none` bunu yapamazdi (Tab hala ulasirdi).

// IKINCI KILIT SEBEBI — KOSAN TARAMA (2026-08-11):
// Tarama artik arka plana alinabiliyor, yani kullanici tarama surerken bu dugmelere ULASABILIYOR.
// `ingest_folders` YAZMA kilidini (`AppState.db`) tum kosu boyunca tutar ve yazma komutlarinin
// cogu senkrondur → UI is parcaciginda kosarlar. Tarama sirasinda bir yazma tetiklenirse UI
// kilitte bekler, pencere donar, Windows uygulamayi `AppHang` ile oldurur (2026-08-11 12:39).
// Bu yuzden ayni kapi ikinci sebebi de tasir. Kilit ACIK kalmali degil: "gorunur bekleme" yerine
// "gorunmez donma" almak kotu bir takas olurdu.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useIngestWriteLock } from "../../hooks/useIngestLock";
import { useUiStore } from "../../store/useUiStore";

/** YEREL arsive yazan eylemleri kilitler: uzak arsiv modunda **veya** tarama kosarken.
 *  Kilit yokken cocuklari aynen gecirir. */
export function RemoteWriteGate({
  children,
  className = "flex items-center gap-3",
}: {
  children: ReactNode;
  /** Sarmalayicinin yerlesim siniflari — kilit acikken de kapaliyken de AYNI (ust cubuk
   *  duzeni kaynak degisiminde kaymaz). */
  className?: string;
}) {
  const { t } = useTranslation();
  const remote = useUiStore((s) => s.assetSource === "remote");
  const scanning = useIngestWriteLock();

  if (!remote && !scanning) return <div className={className}>{children}</div>;

  // Uzak mod once: kullanici uzaktayken tarama da kosuyorsa, gidermesi gereken ilk kosul odur.
  const hint = remote ? t("archive_source.write_locked_hint") : t("ingest.write_locked_hint");

  return (
    <div title={hint}>
      {/* fieldset varsayilan kenarlik/bosluklarini sifirla → gorsel olarak saf sarmalayici. */}
      <fieldset disabled className={`${className} m-0 border-0 p-0 opacity-40`}>
        {children}
      </fieldset>
    </div>
  );
}
