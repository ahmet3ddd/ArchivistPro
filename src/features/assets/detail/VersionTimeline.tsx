import { useTranslation } from "react-i18next";

import { ipc, type VersionTimelineItem } from "../../../ipc/client";
import { useIpcQuery } from "../../../hooks/useIpcQuery";
import { useUiStore } from "../../../store/useUiStore";

/** H2 VersionTimeline paritesi: tum bagli `version` bilesenini tarih sirasiyla cizer. */
export function VersionTimeline({ assetId }: { assetId: number }) {
  const { t } = useTranslation();
  const select = useUiStore((s) => s.select);
  const { data } = useIpcQuery<VersionTimelineItem[]>(() => ipc.versionTimeline(assetId), [assetId]);
  if (!data || data.length < 2) return null;
  return <section className="mt-3 border-t border-border pt-3">
    <h3 className="text-[11px] font-semibold text-text-secondary">{t("relations.kind.version")}</h3>
    <ol className="mt-2 border-s border-border ps-3">
      {data.map((item, index) => <li key={item.id} className="relative pb-2 last:pb-0">
        <span className={`absolute -start-[17px] top-1 h-2.5 w-2.5 rounded-full border-2 border-bg-primary ${item.id === assetId ? "bg-accent" : "bg-text-muted"}`} />
        <button type="button" onClick={() => select(item.id)} disabled={item.id === assetId} title={item.path} className="block max-w-full truncate text-start text-xs text-text-primary hover:text-accent hover:underline disabled:cursor-default disabled:text-accent disabled:no-underline">{index + 1}. {item.file_name}</button>
        <time className="text-[10px] text-text-muted">{new Date(item.modified_at * 1000).toLocaleDateString()}</time>
      </li>)}
    </ol>
  </section>;
}
