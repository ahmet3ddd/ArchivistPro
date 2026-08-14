import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  defaultFacetConfig,
  type FacetConfig,
  type FacetConfigId,
} from "./facetConfig";

interface FacetConfigOption {
  id: FacetConfigId;
  defaultLabel: string;
}

interface Props {
  config: FacetConfig[];
  options: FacetConfigOption[];
  onClose: () => void;
  onSave: (config: FacetConfig[]) => void;
}

export function FacetConfigModal({ config, options, onClose, onSave }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => [...config].sort((a, b) => a.order - b.order));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const optionFor = (id: FacetConfigId) => options.find((option) => option.id === id);
  const update = (id: FacetConfigId, patch: Partial<FacetConfig>) =>
    setDraft((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const move = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= draft.length) return;
    const next = [...draft];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    setDraft(next.map((item, order) => ({ ...item, order })));
  };
  const save = () => {
    onSave(draft.map((item, order) => ({ ...item, order })));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("facet_config.title")}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-xl"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">{t("facet_config.title")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("facet_config.description")}</p>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="flex flex-col gap-2">
            {draft.map((item, index) => {
              const defaultLabel = optionFor(item.id)?.defaultLabel ?? item.id;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary/50 p-2"
                >
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label={t("facet_config.move_up", { name: defaultLabel })}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="rounded px-1 text-xs text-text-secondary hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={t("facet_config.move_down", { name: defaultLabel })}
                      disabled={index === draft.length - 1}
                      onClick={() => move(index, 1)}
                      className="rounded px-1 text-xs text-text-secondary hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    type="checkbox"
                    checked={item.visible}
                    onChange={(event) => update(item.id, { visible: event.target.checked })}
                    aria-label={t("facet_config.visible", { name: defaultLabel })}
                    className="h-4 w-4 shrink-0 accent-accent"
                  />
                  <input
                    value={item.label ?? ""}
                    placeholder={defaultLabel}
                    onChange={(event) => update(item.id, { label: event.target.value || undefined })}
                    aria-label={t("facet_config.rename", { name: defaultLabel })}
                    className="min-w-0 flex-1 rounded border border-border bg-bg-secondary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-bg-secondary px-5 py-3">
          <button
            type="button"
            onClick={() => setDraft(defaultFacetConfig())}
            className="rounded-md px-2 py-1.5 text-sm text-danger transition hover:bg-danger/15"
          >
            {t("facet_config.reset")}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover"
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
