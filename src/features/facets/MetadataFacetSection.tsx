// GENEL metadata (EAV) facet bolumu — cikarici-uretimi anahtarlar (`unit_type`, `version`...).
//
// NEDEN TEK BILESEN (2026-07-19): her metadata facet'i icin ayri bir sidebar blogu + ayri store
// alani + ayri hook yazmak, facet basina ~20 dokunus noktasi demekti (`gorselTuru` deseni).
// Burada anahtar bir PROP; backend filtresi de parametrik (`ListOpts.metadata`) ⇒ yeni bir
// metadata facet'i eklemek = `METADATA_FACETS`'e BIR SATIR + 5 dilde bir i18n anahtari.
// Rust/store/IPC/cip/hook DOKUNULMAZ.

import { useTranslation } from "react-i18next";

import { useMetadataFacets } from "../../hooks/useFacets";
import { useUiStore } from "../../store/useUiStore";
import { FacetEmptyState, FacetRow, FacetSection } from "./FacetSection";

/** Sidebar'da gosterilecek metadata facet'leri — **yeni facet eklemenin TEK yeri**.
 *
 *  ⚠️ `scale` BILEREK YOK (2026-07-19 olcumu): DWG olçek degeri sezgisel bir string
 *  taramasindan gelir (`dwg/fields/mod.rs:253`) — ikilideki `1/`|`1:` ile baslayan HER metni
 *  olçek sayar, son eslesen kazanir. Dev DB'de 60/60 DWG'de deger var ve 3B modellerde bile
 *  olçek cikiyor ⇒ veri facet-kalitesinde DEGIL. Cikarim duzelene kadar listelenmez
 *  (yanlis veriyi yetkili gorunen bir filtreye cevirmemek icin). */
export const METADATA_FACETS: { key: string; titleKey: string }[] = [
  { key: "unit_type", titleKey: "facet.unit_type" },
  // Dikkat: bu `version` metadata anahtaridir (cikarici; "AutoCAD 2007") — sidebar'daki
  // "Versiyon" bolumunun KULLANICI-tanimli `version_label`'i DEGIL. Basligi da bu yuzden
  // ayri: `facet.software_version` ("Yazılım sürümü"). Deger uzantiya gore anlam degistirir
  // (.dwg → AutoCAD, .max → 3ds Max) → urun-notrl bir baslik secildi.
  { key: "version", titleKey: "facet.software_version" },
];

/** Tek bir metadata anahtari icin facet bolumu. Deger yoksa kullanicinin gorunurluk tercihi
 *  korunur ve bolum neden bos oldugunu aciklar. */
export function MetadataFacetSection({
  facetKey,
  titleKey,
  title,
  collapsed,
  onToggle,
  clearLabel,
}: {
  facetKey: string;
  titleKey: string;
  /** Kullanici ozellestirmesi yoksa titleKey cevirisi kullanilir. */
  title?: string;
  collapsed: boolean;
  onToggle: () => void;
  clearLabel: string;
}) {
  const { t } = useTranslation();
  const facets = useMetadataFacets(facetKey);
  const selected = useUiStore((s) => s.metadata[facetKey]);
  const toggleMetadata = useUiStore((s) => s.toggleMetadata);
  const clearMetadataKey = useUiStore((s) => s.clearMetadataKey);

  const rows = facets.filter((f) => f.value != null && f.count > 0);
  const active = selected ?? [];
  return (
    <FacetSection
      title={title ?? t(titleKey)}
      collapsed={collapsed}
      onToggle={onToggle}
      activeCount={active.length}
      onClear={() => clearMetadataKey(facetKey)}
      clearLabel={clearLabel}
    >
      {rows.length === 0 ? (
        <FacetEmptyState label={t("facet.no_values")} />
      ) : (
        rows.map((f) => {
          const v = f.value as string;
          return (
            <FacetRow
              key={v}
              label={v}
              count={f.count}
              active={active.includes(v)}
              onClick={() => toggleMetadata(facetKey, v)}
            />
          );
        })
      )}
    </FacetSection>
  );
}
