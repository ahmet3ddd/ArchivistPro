// Etiket duzenleyici (detay paneli) — cipleri gosterir; editor user-tag ekler/kaldirir.
// auto/system etiketleri (turetilmis) salt-gosterim. Degisiklikte onChanged() cagrilir.

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { TagRef } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useTagFacets } from "../../hooks/useFacets";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../toast/useToast";

interface Props {
  assetId: number;
  tags: TagRef[];
  onChanged: () => void; // detay refetch + facet tazeleme
}

export function TagEditor({ assetId, tags, onChanged }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canWrite: canEdit } = useSession(); // rol sunucu oturumundan
  const allTags = useTagFacets(); // autocomplete kaynagi (mevcut etiketler)
  const listId = useId();
  const [input, setInput] = useState("");

  // ⚠️ VERI-RISKI: secili asset degisince giris kutusunu TEMIZLE. Bu bilesen
  // AssetDetailPanel'de `key` OLMADAN durur (sifirlayici key={selectedId} yalniz
  // DetailTabs'ta) → secim degisince remount OLMAZ, yalniz `assetId` prop'u sessizce
  // yeni dosyaya kayar. Temizlik olmazsa "cephe" yazip Enter'a basmadan baska dosyaya
  // tiklayan kullanicinin oradaki Enter'i etiketi YANLIS dosyaya ekler.
  // H2 pariti: C:\Arsiv-H2\src\components\AssetTagsPanel.tsx:43-49 → useEffect([assetId])
  // icinde setTagQuery('').
  useEffect(() => {
    setInput("");
  }, [assetId]);

  // Bu asset'te zaten olan etiketleri oneri-disi birak (gurultu azalt).
  const present = new Set(tags.map((tg) => tg.name));
  const suggestions = allTags
    .map((f) => f.value)
    .filter((v): v is string => v != null && !present.has(v));

  const add = () => {
    const name = input.trim();
    if (!name) return;
    void ipc
      .addTag(assetId, name)
      .then(() => {
        setInput("");
        onChanged();
        toast.success(t("toast.tag_added", { name }));
      })
      .catch(() => toast.error(t("toast.tag_failed")));
  };

  const remove = (name: string) =>
    void ipc
      .removeTag(assetId, name)
      .then(() => {
        onChanged();
        toast.success(t("toast.tag_removed", { name }));
      })
      .catch(() => toast.error(t("toast.tag_failed")));

  const setColor = (name: string, color: string | null) =>
    void ipc
      .setTagColor(name, color)
      .then(() => {
        onChanged();
        toast.success(t(color ? "toast.tag_color_set" : "toast.tag_color_cleared"));
      })
      .catch(() => toast.error(t("toast.tag_color_failed")));

  return (
    <div className="flex flex-col gap-2">
      {tags.length === 0 ? (
        <p className="text-xs text-text-muted">{t("detail.no_tags")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag.name}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary"
            >
              {tag.color && (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
              )}
              {tag.name}
              {canEdit && tag.kind === "user" && (
                <>
                  <input
                    type="color"
                    value={tag.color ?? "#64748b"}
                    onChange={(e) => setColor(tag.name, e.target.value)}
                    aria-label={t("detail.tag_color")}
                    className="h-3 w-3 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  {tag.color && (
                    <button
                      type="button"
                      onClick={() => setColor(tag.name, null)}
                      aria-label={t("detail.clear_tag_color")}
                      className="text-text-muted transition hover:text-danger"
                    >
                      ×
                    </button>
                  )}
                </>
              )}
              {canEdit && tag.kind === "user" && (
                <button
                  type="button"
                  onClick={() => remove(tag.name)}
                  aria-label={t("detail.remove_tag")}
                  className="text-text-muted transition hover:text-danger"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            list={listId}
            placeholder={t("detail.add_tag")}
            className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs
                       text-text-primary placeholder:text-text-muted transition focus:border-accent focus:outline-none"
          />
          <datalist id={listId}>
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
