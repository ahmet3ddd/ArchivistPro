// Facet paneli gorunurluk/sira/ozel-baslik tercihi. Salt renderer tercihi:
// backend sorgusuna veya facet verisine dokunmaz; localStorage bozuksa guvenli varsayilana doner.

export const FACET_CONFIG_IDS = [
  "favorites",
  "aiAnalysis",
  "gorselTuru",
  "meta_unit_type",
  "meta_version",
  "date",
  "type",
  "tags",
  "approval",
  "client",
  "version",
  "deadlineYear",
  "collections",
] as const;

export type FacetConfigId = (typeof FACET_CONFIG_IDS)[number];

export interface FacetConfig {
  id: FacetConfigId;
  visible: boolean;
  order: number;
  /** Bos/yoksa o anki arayuz dilinin varsayilan basligi kullanilir. */
  label?: string;
}

const KEY = "archivist_facet_config";

export function defaultFacetConfig(): FacetConfig[] {
  return FACET_CONFIG_IDS.map((id, order) => ({ id, visible: true, order }));
}

/** Eski/bozuk kaydi tanimli id'lere daraltir; yeni facet'leri sona ekler. AI durum faceti,
 *  eski semaya eklenirken anlamsal komsusu olan gorsel turunun hemen onune yerlestirilir. */
export function normalizeFacetConfig(raw: unknown): FacetConfig[] {
  const defaults = defaultFacetConfig();
  if (!Array.isArray(raw)) return defaults;

  const seen = new Set<FacetConfigId>();
  const parsed: FacetConfig[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const candidate = item as Partial<FacetConfig>;
    const order = candidate.order;
    if (
      !FACET_CONFIG_IDS.includes(candidate.id as FacetConfigId) ||
      seen.has(candidate.id as FacetConfigId) ||
      typeof candidate.visible !== "boolean" ||
      typeof order !== "number" ||
      !Number.isFinite(order)
    ) {
      continue;
    }
    const label =
      typeof candidate.label === "string" && candidate.label.trim().length > 0
        ? candidate.label.trim()
        : undefined;
    const id = candidate.id as FacetConfigId;
    seen.add(id);
    parsed.push({ id, visible: candidate.visible, order, label });
  }

  const addFavoritesFirst = !seen.has("favorites");
  const addAiBesideImageType = !seen.has("aiAnalysis");

  // Kayit eskidiyse yeni facet'ler kullanicinin siralamasinin SONUNA gelir; varsayilan
  // order numaralariyla basa ziplamaz.
  let nextOrder = parsed.reduce((max, item) => Math.max(max, item.order), -1) + 1;
  for (const fallback of defaults) {
    if (!seen.has(fallback.id)) {
      parsed.push({ ...fallback, order: nextOrder });
      nextOrder += 1;
    }
  }

  const ordered = parsed.sort((a, b) => a.order - b.order);
  if (addAiBesideImageType) {
    const aiIndex = ordered.findIndex((item) => item.id === "aiAnalysis");
    const imageTypeIndex = ordered.findIndex((item) => item.id === "gorselTuru");
    if (aiIndex >= 0 && imageTypeIndex >= 0) {
      const [aiAnalysis] = ordered.splice(aiIndex, 1);
      const nextImageTypeIndex = ordered.findIndex((item) => item.id === "gorselTuru");
      ordered.splice(nextImageTypeIndex, 0, aiAnalysis);
    }
  }
  if (addFavoritesFirst) {
    const favoritesIndex = ordered.findIndex((item) => item.id === "favorites");
    if (favoritesIndex > 0) {
      const [favorites] = ordered.splice(favoritesIndex, 1);
      ordered.unshift(favorites);
    }
  }

  return ordered.map((item, order) => ({ ...item, order }));
}

export function loadFacetConfig(): FacetConfig[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeFacetConfig(JSON.parse(raw)) : defaultFacetConfig();
  } catch {
    return defaultFacetConfig();
  }
}

export function saveFacetConfig(config: FacetConfig[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(normalizeFacetConfig(config)));
  } catch {
    // Kalicilik bir kolayliktir; depolama erisilemezse panel calismaya devam eder.
  }
}
