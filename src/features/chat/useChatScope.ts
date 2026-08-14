// RAG sohbet KAPSAM (scope) durumu — H2 ChatHeader scope-select pariti. Kapsam mantigini
// ChatView'den ayirir (dosya boyu + tek-sorumluluk). Retrieval'in NEREDE arayacagini belirler:
//  • "all"    → tum arsiv (eski davranis).
//  • "filter" → aktif facet filtresine uyanlar (VisionAnalysisCard ile AYNI buildListOpts).
//  • "ids"    → grid'de secili asset'ler (useUiStore.selectedIds).
//
// UI yalniz ScopeKind tutar; somut deger (filter/ids) GONDERIM aninda CANLI store'dan cozulur
// (`resolveScope`) → kalici oturumdaki snapshot bayatlamaz. Secim/filtre gecersizlesirse "all"a
// duser (kullaniciyi sessiz yaniltma). Renderer DB gormez; yalniz store okur + ipc'ye deger uretir.

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AnalysisScope } from "../../ipc/client";
import { buildListOpts, dateToEpoch } from "../../hooks/listOpts";
import { useUiStore } from "../../store/useUiStore";

/** UI-seviyesi kapsam turu (somut `AnalysisScope`'a `resolveScope` ile cozulur). */
export type ScopeKind = "all" | "filter" | "ids";

/** Kalici oturumun `scopeJson`'ini guvenli parse et → ScopeKind (bos/bozuk/uyumsuz → "all").
 *  Yalniz TUR yuklenir; somut filter/ids degerleri her sorguda canli store'dan cozulur. */
export function parseScopeKind(json?: string | null): ScopeKind {
  if (!json) return "all";
  try {
    const parsed = JSON.parse(json) as { kind?: unknown };
    if (parsed?.kind === "filter" || parsed?.kind === "ids") return parsed.kind;
  } catch {
    /* bozuk JSON → "all" */
  }
  return "all";
}

export interface ChatScope {
  scopeKind: ScopeKind;
  setScopeKind: (kind: ScopeKind) => void;
  /** Query-disi bir facet aktif mi → "Aktif filtre" secenegi etkin. */
  hasFilter: boolean;
  /** Grid'de secili asset sayisi → "Belirli dosyalar (N)" secenegi etkin (N>0). */
  selectedCount: number;
  /** Secili ScopeKind'i somut AnalysisScope'a coz (CANLI store; gecersizse "all"a duser). */
  resolveScope: () => AnalysisScope;
}

export function useChatScope(): ChatScope {
  // Aktif gorunum filtresi (store) — VisionAnalysisCard ile AYNI alanlar (tek dogruluk kaynagi
  // buildListOpts). FTS `query` HARIC (backend filtre kapsaminda yok sayar; sohbet metnine bagli degil).
  const sort = useUiStore((s) => s.sort);
  const ext = useUiStore((s) => s.ext);
  const tag = useUiStore((s) => s.tag);
  const collection = useUiStore((s) => s.collection);
  const project = useUiStore((s) => s.project);
  const dateFrom = useUiStore((s) => s.dateFrom);
  const dateTo = useUiStore((s) => s.dateTo);
  const favoritesOnly = useUiStore((s) => s.favoritesOnly);
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  const approvalStatus = useUiStore((s) => s.approvalStatus);
  const clientName = useUiStore((s) => s.clientName);
  const versionLabel = useUiStore((s) => s.versionLabel);
  const deadlineYear = useUiStore((s) => s.deadlineYear);
  const aiAnalyzed = useUiStore((s) => s.aiAnalyzed);
  const gorselTuru = useUiStore((s) => s.gorselTuru);
  const metadata = useUiStore((s) => s.metadata);
  const selectedIds = useUiStore((s) => s.selectedIds);

  // Query DISI herhangi bir facet aktif mi → "Aktif filtre" secenegi gorunur/etkin.
  const hasFilter =
    ext.length > 0 ||
    tag.length > 0 ||
    collection.length > 0 ||
    project.length > 0 ||
    dateFrom !== "" ||
    dateTo !== "" ||
    favoritesOnly ||
    pathPrefix != null ||
    approvalStatus.length > 0 ||
    clientName.length > 0 ||
    versionLabel.length > 0 ||
    deadlineYear.length > 0 ||
    aiAnalyzed != null ||
    gorselTuru != null;

  // Filtre kapsami ListOpts (facet-tabanli; query/sayfalama onemsiz → varsayilan; backend yok sayar).
  const filterOpts = useMemo(
    () =>
      buildListOpts({
        sort,
        ext,
        tag,
        collection,
        project,
        modifiedAfter: dateToEpoch(dateFrom, false),
        modifiedBefore: dateToEpoch(dateTo, true),
        favoritesOnly,
        pathPrefix,
        approvalStatus,
        clientName,
        versionLabel,
        deadlineYear,
        aiAnalyzed,
        gorselTuru,
        metadata,
      }),
    [
      sort,
      ext,
      tag,
      collection,
      project,
      dateFrom,
      dateTo,
      favoritesOnly,
      pathPrefix,
      approvalStatus,
      clientName,
      versionLabel,
      deadlineYear,
      aiAnalyzed,
      gorselTuru,
      metadata,
    ],
  );

  const [scopeKind, setScopeKind] = useState<ScopeKind>("all");

  // Secili kapsam gecersizlesirse (secim bosaldi / filtre kalkti) → "all"a dus. Kullaniciyi
  // sessiz yaniltma: "Belirli dosyalar" secili ama secim yok / "Aktif filtre" ama filtre yok olamaz.
  useEffect(() => {
    if (scopeKind === "ids" && selectedIds.length === 0) setScopeKind("all");
    else if (scopeKind === "filter" && !hasFilter) setScopeKind("all");
  }, [scopeKind, selectedIds.length, hasFilter]);

  // Somut kapsami GONDERIM aninda canli store'dan coz (snapshot bayatlamaz). Gecersiz → "all".
  const resolveScope = useCallback((): AnalysisScope => {
    if (scopeKind === "filter" && hasFilter) return { kind: "filter", filter: filterOpts };
    if (scopeKind === "ids" && selectedIds.length > 0) return { kind: "ids", ids: selectedIds };
    return { kind: "all" };
  }, [scopeKind, hasFilter, filterOpts, selectedIds]);

  return { scopeKind, setScopeKind, hasFilter, selectedCount: selectedIds.length, resolveScope };
}
