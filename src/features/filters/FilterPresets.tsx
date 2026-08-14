// Kayitli filtreler (kenar cubugu ustu) — mevcut filtre/arama anlik-goruntusunu adla
// kaydet, tikla-uygula ve sil. Kayitlar kullanici + arsiv kapsaminda localStorage'da tutulur.

import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
import { basename, formatNumber } from "../../lib/format";
import type { FilterSnapshot } from "../../store/useUiStore";
import { useUiStore } from "../../store/useUiStore";
import { gorselTuruLabelKey } from "../facets/gorselTuruMeta";
import {
  loadPresets,
  presetScopeKey,
  savePresets,
  type Preset,
  type PresetScope,
} from "./presets";

export function FilterPresets() {
  const { t } = useTranslation();
  const { session } = useSession();
  const applyPreset = useUiStore((s) => s.applyPreset);
  const activeArchiveId = useUiStore((s) => s.activeArchiveId);
  const scope = useMemo<PresetScope>(
    () => ({ userId: session?.user_id ?? 0, archiveId: activeArchiveId }),
    [activeArchiveId, session?.user_id],
  );
  const scopeKey = presetScopeKey(scope);
  const [loadedScope, setLoadedScope] = useState(scopeKey);
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets(scope));
  const [name, setName] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setPresets(loadPresets(scope));
    setLoadedScope(scopeKey);
    setName("");
    setEditing(false);
  }, [scope, scopeKey]);

  // Arsiv/kullanici degisiminin tek renderlik araliginda onceki kapsamin kisayollarini gosterme.
  const scopedPresets = loadedScope === scopeKey ? presets : [];

  // Mevcut filtre durumu (tekil selector'lar → Zustand esitlik tuzagindan kacin).
  const query = useUiStore((s) => s.query);
  const semanticMode = useUiStore((s) => s.semanticMode);
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

  const save = () => {
    const n = name.trim();
    if (!n) return;
    const snapshot: FilterSnapshot = {
      query,
      semanticMode,
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
    };
    // Ayni ad UI'da acikca "uzerine yaz" diye gosterilir; ada gore sirali tut.
    const next = [
      ...scopedPresets.filter((p) => !samePresetName(p.name, n)),
      { name: n, filters: snapshot },
    ].sort(
      (a, b) => a.name.localeCompare(b.name),
    );
    setPresets(next);
    setLoadedScope(scopeKey);
    savePresets(scope, next);
    setName("");
    setEditing(false);
  };

  const remove = (n: string) => {
    const next = scopedPresets.filter((p) => p.name !== n);
    setPresets(next);
    setLoadedScope(scopeKey);
    savePresets(scope, next);
  };

  const replacing = scopedPresets.some((preset) => samePresetName(preset.name, name.trim()));
  const startEditing = () => {
    setCollapsed(false);
    setEditing(true);
  };
  const cancelEditing = () => {
    setName("");
    setEditing(false);
  };

  return (
    <section className="mb-1 border-y border-border/40 py-1" data-testid="saved-filters">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-text-secondary transition hover:bg-bg-tertiary"
        >
          <span
            aria-hidden
            className={`text-[9px] text-text-muted transition-transform ${collapsed ? "" : "rotate-90"}`}
          >
            ▶
          </span>
          <h3 className="min-w-0 truncate font-display text-xs font-semibold uppercase tracking-wide">
            {t("presets.title")}
          </h3>
          {scopedPresets.length > 0 && (
            <span className="shrink-0 rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">
              {formatNumber(scopedPresets.length)}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={startEditing}
          aria-label={t("presets.save_current")}
          title={t("presets.save_current")}
          className="me-1 shrink-0 rounded px-1.5 py-0.5 text-sm text-text-muted transition hover:bg-bg-tertiary hover:text-accent"
        >
          +
        </button>
      </div>

      {!collapsed && (
        <div className="pb-1">
          {scopedPresets.map((preset) => {
            const summary = presetSummary(preset.filters, t);
            return (
              <div key={preset.name} className="group flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => applyPreset(preset.filters)}
                  title={t("presets.apply")}
                  className="flex min-w-0 flex-1 items-start gap-1.5 rounded-md px-2 py-1.5 text-start transition hover:bg-bg-tertiary"
                >
                  <span className="mt-0.5 shrink-0 text-accent" aria-hidden>☆</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-text-secondary">{preset.name}</span>
                    <span className="line-clamp-2 text-[10px] leading-4 text-text-muted">{summary}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => remove(preset.name)}
                  aria-label={t("presets.delete_named", { name: preset.name })}
                  title={t("presets.delete")}
                  className="shrink-0 rounded px-1 text-text-muted opacity-60 transition hover:text-danger hover:opacity-100 focus:opacity-100"
                >
                  ×
                </button>
              </div>
            );
          })}

          {!editing && (
            <button
              type="button"
              onClick={startEditing}
              className="mx-1 mt-1 w-[calc(100%_-_0.5rem)] rounded-md border border-dashed border-border px-2 py-1.5 text-start text-xs text-text-secondary transition hover:border-accent hover:text-accent"
            >
              + {t("presets.save_current")}
            </button>
          )}

          {editing && (
            <div className="mx-1 mt-1 rounded-md border border-border bg-bg-tertiary/50 p-2">
              <label
                htmlFor="saved-filter-name"
                className="mb-1 block text-[10px] font-medium text-text-secondary"
              >
                {t("presets.name_label")}
              </label>
              <input
                id="saved-filter-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") save();
                  if (event.key === "Escape") cancelEditing();
                }}
                placeholder={t("presets.name_placeholder")}
                className="w-full rounded-md border border-border bg-bg-secondary px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              {replacing && (
                <p className="mt-1 text-[10px] leading-4 text-warning" role="status">
                  {t("presets.overwrite_hint")}
                </p>
              )}
              <div className="mt-2 flex justify-end gap-1">
                <button
                  type="button"
                  onClick={cancelEditing}
                  className="rounded px-2 py-1 text-xs text-text-muted hover:bg-bg-secondary"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!name.trim()}
                  className={`rounded px-2 py-1 text-xs font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    replacing ? "bg-warning hover:brightness-110" : "bg-accent hover:bg-accent-hover"
                  }`}
                >
                  {t(replacing ? "presets.replace" : "presets.save")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function samePresetName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function presetSummary(filters: FilterSnapshot, t: TFunction): string {
  const parts: string[] = [];
  const query = filters.query.trim();
  if (query) parts.push(`${filters.semanticMode ? "✨" : "⌕"} ${query}`);
  if (filters.ext.length > 0) parts.push(filters.ext.map((value) => `.${value}`).join(", "));
  if (filters.tag.length > 0) parts.push(filters.tag.map((value) => `#${value}`).join(", "));
  if (filters.collection.length > 0) {
    parts.push(t("presets.collection_summary", { count: filters.collection.length }));
  }
  if (filters.project.length > 0) {
    parts.push(t("presets.project_summary", { count: filters.project.length }));
  }
  if (filters.dateFrom || filters.dateTo) {
    parts.push(
      filters.dateFrom && filters.dateTo
        ? `${filters.dateFrom} → ${filters.dateTo}`
        : filters.dateFrom
          ? `≥ ${filters.dateFrom}`
          : `≤ ${filters.dateTo}`,
    );
  }
  if (filters.favoritesOnly) parts.push(`★ ${t("facet.favorites")}`);
  if (filters.pathPrefix) parts.push(`📂 ${basename(filters.pathPrefix)}`);
  if (filters.approvalStatus.length > 0) {
    parts.push(t("presets.approval_summary", { count: filters.approvalStatus.length }));
  }
  if (filters.clientName.length > 0) {
    parts.push(`${t("project.client")}: ${filters.clientName.join(", ")}`);
  }
  if (filters.versionLabel.length > 0) {
    parts.push(`${t("project.version")}: ${filters.versionLabel.join(", ")}`);
  }
  if (filters.deadlineYear.length > 0) parts.push(`📅 ${filters.deadlineYear.join(", ")}`);
  if (filters.aiAnalyzed != null) {
    parts.push(`✨ ${t(filters.aiAnalyzed ? "facet.ai_yes" : "facet.ai_no")}`);
  }
  if (filters.gorselTuru) {
    const labelKey = gorselTuruLabelKey(filters.gorselTuru);
    parts.push(`🖼️ ${labelKey ? t(labelKey) : filters.gorselTuru}`);
  }
  const metadataCount = Object.values(filters.metadata).reduce((sum, values) => sum + values.length, 0);
  if (metadataCount > 0) parts.push(t("presets.metadata_summary", { count: metadataCount }));
  if (parts.length === 0) parts.push(t("presets.all_assets"));
  parts.push(`↕ ${t(`sort.${filters.sort}`)}`);

  const visible = parts.slice(0, 3);
  if (parts.length > visible.length) visible.push(t("presets.more", { count: parts.length - visible.length }));
  return visible.join(" · ");
}
