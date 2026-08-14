// Detay paneli sekme cubugu + aktif sekme govdesi (H2 DetailPanel 6-sekme pariti).
// Sekme durumu YEREL (useState); secili asset degisince varsayilana (Onizleme) sifirlanir
// — sifirlama ust panelde `key={selectedId}` ile saglanir (bu bilesen her asset icin
// yeniden monte edilir). Tum 6 sekme (Iliskiler/Parcalar dahil) gercek veri ceker.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetDetail } from "../../../ipc/client";
import { ChunksTab } from "./ChunksTab";
import { MetadataTab } from "./MetadataTab";
import { PreviewTab } from "./PreviewTab";
import { RelationsTab } from "./RelationsTab";
import { TechnicalTab } from "./TechnicalTab";

// "info" (Bilgi) sekmesi kaldirildi → icerigi "preview" (Onizleme) sekmesine birlestirildi.
type TabKey = "preview" | "metadata" | "relations" | "chunks" | "technical";

const TABS: TabKey[] = ["preview", "metadata", "relations", "chunks", "technical"];

/// UZAK arsivde gosterilen sekmeler (LAN Faz 3).
///
/// 🔑 `relations` ve `chunks` DISARIDA: ikisi de asset id'siyle **YEREL** DB'ye sorgu atar
/// (`RelationsTab` iliskileri, `ChunksTab` parcalari + RAG anahtarini). Uzak id ayni numaradaki
/// BASKA bir yerel dosyanin iliskilerini/parcalarini gosterirdi — sessizce yanlis veri.
/// Kalan uc sekme (`preview`/`metadata`/`technical`) yalnizca elimizdeki `detail` nesnesini
/// okur; o da host'tan geldigi icin DOGRUDUR.
const REMOTE_TABS: TabKey[] = ["preview", "metadata", "technical"];

interface Props {
  detail: AssetDetail;
  thumb: string | undefined;
  /** Detay panelinin get_asset refetch'i (AiVisionSection analiz sonrasi ai_ alanlarini tazeler). */
  onRefetch: () => void;
  /** UZAK arsiv (salt-okuma): yerel-id'ye dayanan sekmeler ve yazma bolumleri gizlenir. */
  readOnly?: boolean;
}

export function DetailTabs({ detail, thumb, onRefetch, readOnly }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabKey>("preview");
  const tabs = readOnly ? REMOTE_TABS : TABS;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sekme cubugu — yatay kaydirilabilir (dar panelde tasma) */}
      <div
        role="tablist"
        aria-label={t("detail.tabs.preview")}
        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2"
      >
        {tabs.map((key) => {
          const active = key === tab;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`whitespace-nowrap border-b-2 px-2 py-1.5 text-[11px] font-medium transition-colors ${
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              {t(`detail.tabs.${key}`)}
            </button>
          );
        })}
      </div>

      {/* Aktif sekme govdesi (kaydirilabilir) */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {tab === "preview" && (
          <PreviewTab detail={detail} thumb={thumb} onRefetch={onRefetch} readOnly={readOnly} />
        )}
        {tab === "metadata" && <MetadataTab metadata={detail.metadata} />}
        {/* relations/chunks uzakta sekme listesinde YOK; `!readOnly` ikinci kapi (aktif sekme
            uzaga gecmeden once bunlardan biriyse tek render icin sizabilirdi). */}
        {tab === "relations" && !readOnly && <RelationsTab assetId={detail.asset.id} />}
        {tab === "chunks" && !readOnly && (
          <ChunksTab assetId={detail.asset.id} ragExcluded={detail.rag_excluded} />
        )}
        {tab === "technical" && <TechnicalTab detail={detail} />}
      </div>
    </div>
  );
}
