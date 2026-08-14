// Kayitli filtreler — surumlu ve kullanici + arsiv kapsamli localStorage kaliciligi.
// Renderer DB tutmaz; bu yalniz kullanici tercih anlik-goruntusudur. Backend gerekmez.

import type { FilterSnapshot } from "../../store/useUiStore";

export interface Preset {
  name: string;
  filters: FilterSnapshot;
}

export interface PresetScope {
  userId: number;
  archiveId: string;
}

export const LEGACY_PRESET_STORAGE_KEY = "archivist_filter_presets";
export const PRESET_STORAGE_KEY = "archivist_filter_presets_v2";

interface PresetEnvelope {
  version: 2;
  legacyClaimed: boolean;
  scopes: Record<string, Preset[]>;
}

const VALID_SORTS = new Set([
  "modified_desc",
  "modified_asc",
  "name_asc",
  "name_desc",
  "type_asc",
  "type_desc",
  "size_asc",
  "size_desc",
  "created_asc",
  "created_desc",
  "path_asc",
  "path_desc",
]);

export function presetScopeKey(scope: PresetScope): string {
  return JSON.stringify([scope.userId, scope.archiveId]);
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

function numbers(value: unknown): number[] {
  if (Array.isArray(value)) return value.filter((item): item is number => Number.isFinite(item));
  return typeof value === "number" && Number.isFinite(value) ? [value] : [];
}

function metadata(value: unknown): Record<string, string[]> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key, strings(raw)] as const)
      .filter(([, values]) => values.length > 0),
  );
}

/** Eski/bozuk snapshot'lari tam ve guvenli guncel semaya normalle. */
export function normalizeFilterSnapshot(value: unknown): FilterSnapshot | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const aiAnalyzed = typeof raw.aiAnalyzed === "boolean" ? raw.aiAnalyzed : null;
  return {
    query: typeof raw.query === "string" ? raw.query : "",
    semanticMode: raw.semanticMode === true,
    sort: VALID_SORTS.has(String(raw.sort))
      ? (raw.sort as FilterSnapshot["sort"])
      : "modified_desc",
    ext: strings(raw.ext),
    tag: strings(raw.tag),
    collection: numbers(raw.collection),
    project: numbers(raw.project),
    dateFrom: typeof raw.dateFrom === "string" ? raw.dateFrom : "",
    dateTo: typeof raw.dateTo === "string" ? raw.dateTo : "",
    favoritesOnly: raw.favoritesOnly === true,
    pathPrefix: typeof raw.pathPrefix === "string" ? raw.pathPrefix : null,
    approvalStatus: strings(raw.approvalStatus),
    clientName: strings(raw.clientName),
    versionLabel: strings(raw.versionLabel),
    deadlineYear: strings(raw.deadlineYear),
    aiAnalyzed,
    gorselTuru: typeof raw.gorselTuru === "string" ? raw.gorselTuru : null,
    metadata: metadata(raw.metadata),
  };
}

function normalizePresetList(value: unknown): Preset[] {
  if (!Array.isArray(value)) return [];
  const presets: Preset[] = [];
  for (const item of value) {
    if (item == null || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const filters = normalizeFilterSnapshot(raw.filters);
    if (name && filters) presets.push({ name, filters });
  }
  return presets.sort((a, b) => a.name.localeCompare(b.name));
}

function emptyEnvelope(): PresetEnvelope {
  return { version: 2, legacyClaimed: false, scopes: {} };
}

function readEnvelope(): PresetEnvelope {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) ?? "null");
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return emptyEnvelope();
    const candidate = raw as Record<string, unknown>;
    if (candidate.version !== 2 || candidate.scopes == null || typeof candidate.scopes !== "object") {
      return emptyEnvelope();
    }
    const scopes = Object.fromEntries(
      Object.entries(candidate.scopes as Record<string, unknown>).map(([key, list]) => [
        key,
        normalizePresetList(list),
      ]),
    );
    return { version: 2, legacyClaimed: candidate.legacyClaimed === true, scopes };
  } catch {
    return emptyEnvelope();
  }
}

function writeEnvelope(envelope: PresetEnvelope): void {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(envelope));
  } catch {
    // Kalicilik kritik degil; bellek-ici UI calismaya devam eder.
  }
}

/** Kapsamdaki kayitli filtreleri oku; eski global kayitlari yalnizca ilk kapsama tasi. */
export function loadPresets(scope: PresetScope): Preset[] {
  const envelope = readEnvelope();
  const key = presetScopeKey(scope);
  if (!envelope.legacyClaimed) {
    let legacy: Preset[] = [];
    try {
      legacy = normalizePresetList(
        JSON.parse(localStorage.getItem(LEGACY_PRESET_STORAGE_KEY) ?? "null"),
      );
    } catch {
      legacy = [];
    }
    envelope.legacyClaimed = true;
    if (legacy.length > 0 && envelope.scopes[key] == null) envelope.scopes[key] = legacy;
    writeEnvelope(envelope);
  }
  return envelope.scopes[key] ?? [];
}

/** Kapsamdaki kayitli filtre listesini kalici yaz (hata sessiz — kalicilik kritik degil). */
export function savePresets(scope: PresetScope, list: Preset[]): void {
  const envelope = readEnvelope();
  envelope.legacyClaimed = true;
  envelope.scopes[presetScopeKey(scope)] = normalizePresetList(list);
  writeEnvelope(envelope);
}
