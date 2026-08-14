// Metadata sekmesi — EAV anahtar/deger listesi (get_asset.metadata). Bos ise not.
// Tek-panel detayindan tasindi (Faz 7.6); davranis ayni.

import { useTranslation } from "react-i18next";

import type { MetaEntry } from "../../../ipc/client";
import { DOMINANT_COLORS_METADATA_KEY } from "../dominantColors";
import { Field } from "./Field";

/** Bir EAV girisinin gosterilecek degeri (metin > sayi > "—"). */
function metaValue(m: MetaEntry): string {
  if (m.value_text != null) return m.value_text;
  if (m.value_num != null) return String(m.value_num);
  return "—";
}

export function MetadataTab({ metadata }: { metadata: MetaEntry[] }) {
  const { t } = useTranslation();
  // JSON tasima alani kart/onizlemede gercek palet olarak sunulur; ham JSON'u metadata
  // listesinde ikinci kez gostermek kullaniciya anlamli degildir.
  const visible = metadata.filter((m) => m.key !== DOMINANT_COLORS_METADATA_KEY);
  if (visible.length === 0) {
    return <p className="p-1 text-xs text-text-muted">{t("detail.no_metadata")}</p>;
  }
  return (
    <dl className="space-y-1 p-1 text-xs">
      {visible.map((m) => (
        <Field key={m.key} label={m.key} value={metaValue(m)} />
      ))}
    </dl>
  );
}
