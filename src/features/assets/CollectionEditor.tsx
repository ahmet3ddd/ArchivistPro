// Koleksiyon editoru (detay paneli) — asset'in uyesi oldugu koleksiyonlari cip olarak
// gosterir; editor mevcut koleksiyona ekler (datalist) ya da yeni ad yazip olusturur
// (find-or-create) ve cikarir. Degisiklikte onChanged() (detay refetch + facet tazeleme).

import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CollectionRef } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useCollections } from "../../hooks/useFacets";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../toast/useToast";

interface Props {
  assetId: number;
  collections: CollectionRef[]; // bu asset'in uye oldugu koleksiyonlar
  onChanged: () => void;
}

export function CollectionEditor({ assetId, collections, onChanged }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canWrite: canEdit } = useSession(); // rol sunucu oturumundan
  const all = useCollections();
  const listId = useId();
  const [input, setInput] = useState("");

  // ⚠️ VERI-RISKI: secili asset degisince giris kutusunu TEMIZLE (TagEditor ile ayni gerekce).
  // Bilesen AssetDetailPanel'de `key` OLMADAN durur → secim degisince remount olmaz, yalniz
  // `assetId` prop'u kayar; kalan yazi Enter'da YANLIS dosyayi koleksiyona ekler.
  // H2 pariti: C:\Arsiv-H2\src\components\AssetTagsPanel.tsx:43-49 (useEffect([assetId]) → temizle).
  useEffect(() => {
    setInput("");
  }, [assetId]);

  // find-or-create: ada gore koleksiyon olustur/bul → asset'i ekle.
  const add = () => {
    const name = input.trim();
    if (!name) return;
    void ipc
      .createCollection(name)
      .then((id) => ipc.addToCollection(id, assetId))
      .then(() => {
        setInput("");
        onChanged();
        toast.success(t("toast.collection_added", { name }));
      })
      .catch(() => toast.error(t("toast.collection_failed")));
  };

  const remove = (id: number) =>
    void ipc
      .removeFromCollection(id, assetId)
      .then(() => {
        onChanged();
        toast.success(t("toast.collection_removed"));
      })
      .catch(() => toast.error(t("toast.collection_failed")));

  return (
    <div className="flex flex-col gap-2">
      {collections.length === 0 ? (
        <p className="text-xs text-text-muted">{t("detail.no_collections")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {collections.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary"
            >
              {c.color ? (
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
              ) : (
                "📁"
              )}
              {c.name}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  aria-label={t("detail.remove_from_collection")}
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
            placeholder={t("detail.add_to_collection")}
            className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs
                       text-text-primary placeholder:text-text-muted transition focus:border-accent focus:outline-none"
          />
          <datalist id={listId}>
            {all.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}
