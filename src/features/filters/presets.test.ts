import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FilterSnapshot } from "../../store/useUiStore";
import {
  LEGACY_PRESET_STORAGE_KEY,
  PRESET_STORAGE_KEY,
  loadPresets,
  normalizeFilterSnapshot,
  savePresets,
  type PresetScope,
} from "./presets";

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
});

const MAIN_ADMIN: PresetScope = { userId: 1, archiveId: "main" };
const MAIN_EDITOR: PresetScope = { userId: 2, archiveId: "main" };
const SECONDARY_ADMIN: PresetScope = { userId: 1, archiveId: "archive-2" };

function snapshot(overrides: Partial<FilterSnapshot> = {}): FilterSnapshot {
  return {
    query: "villa",
    semanticMode: true,
    sort: "modified_desc",
    ext: ["dwg"],
    tag: [],
    collection: [],
    project: [],
    dateFrom: "",
    dateTo: "",
    favoritesOnly: false,
    pathPrefix: null,
    approvalStatus: [],
    clientName: [],
    versionLabel: [],
    deadlineYear: [],
    aiAnalyzed: null,
    gorselTuru: null,
    metadata: {},
    ...overrides,
  };
}

describe("saved filter storage", () => {
  beforeEach(() => memory.clear());

  it("isolates saved filters by user and archive", () => {
    savePresets(MAIN_ADMIN, [{ name: "Admin main", filters: snapshot() }]);
    savePresets(MAIN_EDITOR, [{ name: "Editor main", filters: snapshot({ query: "kesit" }) }]);
    savePresets(SECONDARY_ADMIN, [
      { name: "Admin secondary", filters: snapshot({ query: "cephe" }) },
    ]);

    expect(loadPresets(MAIN_ADMIN).map((item) => item.name)).toEqual(["Admin main"]);
    expect(loadPresets(MAIN_EDITOR).map((item) => item.name)).toEqual(["Editor main"]);
    expect(loadPresets(SECONDARY_ADMIN).map((item) => item.name)).toEqual(["Admin secondary"]);
  });

  it("migrates the legacy global list exactly once to the first active scope", () => {
    localStorage.setItem(
      LEGACY_PRESET_STORAGE_KEY,
      JSON.stringify([{ name: "Eski", filters: { query: "plan", sort: "name_asc", ext: "pdf" } }]),
    );

    const migrated = loadPresets(MAIN_ADMIN);
    expect(migrated).toHaveLength(1);
    expect(migrated[0].filters.ext).toEqual(["pdf"]);
    expect(migrated[0].filters.semanticMode).toBe(false);
    expect(loadPresets(MAIN_EDITOR)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(PRESET_STORAGE_KEY) ?? "null").legacyClaimed).toBe(true);
  });

  it("normalizes malformed and old snapshots to a safe complete schema", () => {
    const normalized = normalizeFilterSnapshot({
      query: 42,
      semanticMode: "yes",
      sort: "DROP TABLE assets",
      ext: ["dwg", 7],
      collection: 3,
      aiAnalyzed: "true",
      metadata: { unit_type: ["Metre", null], empty: [] },
    });

    expect(normalized).toMatchObject({
      query: "",
      semanticMode: false,
      sort: "modified_desc",
      ext: ["dwg"],
      collection: [3],
      aiAnalyzed: null,
      metadata: { unit_type: ["Metre"] },
    });
  });

  it("preserves semantic mode in the current schema", () => {
    savePresets(MAIN_ADMIN, [{ name: "Anlamlı", filters: snapshot({ semanticMode: true }) }]);
    expect(loadPresets(MAIN_ADMIN)[0].filters.semanticMode).toBe(true);
  });
});
