// CAD cikarim kalitesi rozeti — DWG verisi TEMIZ mi (ODA→DXF) yoksa YAKLASIK mi (raw-scan)?
//
// Neden gorunur olmali (2026-08-17 denetimi): ODA kurulu degilken DWG'lerin layer/metin
// adlari ikili tahminden gelir. Bu bilgi eskiden yalniz TARAMA RAPORUNDA yasiyordu; rapor
// kayit basina tavanli ve dosya kartiyla bagsiz oldugu icin kullanici bir cizimin katman
// listesine bakip onu KESIN sanabiliyordu. Artik backend kalici bir EAV anahtari yaziyor
// (`cad_extraction`) ve dosya detayinda burada gosteriliyor.
//
// Temiz (ODA) cikarimda hicbir sey gosterilmez — gurultu yapmaz, yalniz uyari degerlidir.

import { useTranslation } from "react-i18next";

import type { MetaEntry } from "../../../ipc/client";

/** Backend sozlesmesi: crates/archivist-extract-cad/src/dwg/mod.rs CAD_EXTRACTION_* */
const CAD_EXTRACTION_KEY = "cad_extraction";
const CAD_EXTRACTION_RAW = "raw_scan";

export function CadQualityNotice({ metadata }: { metadata: MetaEntry[] }) {
  const { t } = useTranslation();
  const source = metadata.find((m) => m.key === CAD_EXTRACTION_KEY)?.value_text;
  if (source !== CAD_EXTRACTION_RAW) return null;
  return (
    <p
      role="note"
      className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] leading-snug text-text-secondary"
    >
      {t("detail.cad_raw_scan")}
    </p>
  );
}
