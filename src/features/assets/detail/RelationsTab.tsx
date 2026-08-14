// İlişkiler sekmesi — asset'in cift-yonlu iliskileri (asset_relations). H2 AssetRelationsPanel
// pariti: yon gostergesi (→ outgoing / ← incoming) + kind rozeti + bagli dosya (tiklaninca detay
// panelinde ACILIR: useUiStore.select) + (editor+) kaldir. Ekle formu (editor+): kind secici +
// dosya arama (ipc.listAssets; kendini + zaten-baglilari haric) → oneri → addRelation → tazele.
//
// Lazy: sekme acilinca yuklenir (useAssetRelations). Yazma yetkisi UI-only (canWrite); gercek
// kontrol Rust'ta (rbac). Viewer salt-okuma: ekle/kaldir gorunmez.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetRow, Relation, RelationKind } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { useAssetRelations } from "../../../hooks/useAssetRelations";
import { useSession } from "../../../hooks/useSession";
import { useUiStore } from "../../../store/useUiStore";
import { useToast } from "../../toast/useToast";
import { VersionTimeline } from "./VersionTimeline";

/** Urun-kumesi + form/rozet gosterim sirasi (backend ayni 4 degeri dogrular). */
const KINDS: RelationKind[] = ["duplicate", "version", "xref", "derived", "backup"];

export function RelationsTab({ assetId }: { assetId: number }) {
  const { t } = useTranslation();
  const { canWrite } = useSession();
  const { data, loading, error, refetch } = useAssetRelations(assetId);
  const relations = data ?? [];

  // Kendini + zaten-bagli karsi-uclari arama havuzundan disla (H2 deseni).
  const existingIds = useMemo(
    () => new Set<number>([assetId, ...relations.map((r) => r.otherId)]),
    [assetId, relations],
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Küçük hatırlatıcı: "iliski" nedir (kopya/surum/XREF/turetilmis) — kalici, sekme basinda. */}
      <p className="text-[10px] leading-snug text-text-muted">{t("relations.about")}</p>
      {loading ? (
        <p className="p-1 text-xs text-text-muted">{t("relations.loading")}</p>
      ) : error ? (
        <p className="p-1 text-xs text-danger">{t("relations.error")}</p>
      ) : relations.length === 0 ? (
        <p className="p-1 text-xs leading-relaxed text-text-muted">{t("relations.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {relations.map((rel) => (
            <RelationRow key={rel.id} rel={rel} canWrite={canWrite} onChanged={refetch} />
          ))}
        </ul>
      )}
      <VersionTimeline assetId={assetId} />

      {canWrite && (
        <AddRelationForm assetId={assetId} existingIds={existingIds} onAdded={refetch} />
      )}
    </div>
  );
}

/** Tek iliski satiri — yon + kind rozeti + bagli dosya (ac) + (editor+) kaldir. */
function RelationRow({
  rel,
  canWrite,
  onChanged,
}: {
  rel: Relation;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const select = useUiStore((s) => s.select); // bagli dosyaya tik → detay panelinde ac
  const [busy, setBusy] = useState(false);

  const dirHint = rel.outgoing ? "relations.outgoing_hint" : "relations.incoming_hint";

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.removeRelation(rel.id);
      toast.success(t("relations.removed"));
      onChanged();
    } catch {
      toast.error(t("relations.remove_error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-2 py-1.5">
      <span className="shrink-0 text-xs text-text-muted" title={t(dirHint)} aria-label={t(dirHint)}>
        {rel.outgoing ? "→" : "←"}
      </span>
      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
        {t(`relations.kind.${rel.kind}`)}
      </span>
      <button
        type="button"
        onClick={() => select(rel.otherId)}
        title={rel.otherPath}
        className="min-w-0 flex-1 truncate text-start text-[11px] text-text-primary hover:text-accent hover:underline"
      >
        {rel.otherFileName}
      </button>
      {canWrite && (
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          title={t("relations.remove")}
          aria-label={t("relations.remove")}
          className="shrink-0 rounded px-1 text-xs text-text-muted transition hover:text-danger disabled:opacity-50"
        >
          ✕
        </button>
      )}
    </li>
  );
}

/** Ekle formu (editor+) — kind secici + dosya arama (ipc.listAssets) → oneri → addRelation. */
function AddRelationForm({
  assetId,
  existingIds,
  onAdded,
}: {
  assetId: number;
  existingIds: Set<number>;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<RelationKind>("duplicate");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const results = useTargetSearch(query, existingIds, open);

  const close = () => {
    setQuery("");
    setOpen(false);
  };

  const add = async (target: AssetRow) => {
    if (busy) return;
    setBusy(true);
    try {
      await ipc.addRelation(assetId, target.id, kind);
      toast.success(t("relations.added"));
      close();
      onAdded();
    } catch {
      toast.error(t("relations.add_error"));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary transition hover:border-border-hover hover:bg-bg-tertiary hover:text-text-primary"
      >
        + {t("relations.add")}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-tertiary p-2">
      {/* kind secici */}
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("relations.kind_select")}>
        {KINDS.map((k) => {
          const active = k === kind;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={active}
              className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                active
                  ? "bg-accent/15 text-accent ring-1 ring-accent"
                  : "text-text-secondary hover:bg-bg-secondary"
              }`}
            >
              {t(`relations.kind.${k}`)}
            </button>
          );
        })}
      </div>

      {/* hedef dosya arama */}
      <input
        autoFocus
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        placeholder={t("relations.search_placeholder")}
        aria-label={t("relations.target_select")}
        className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent"
      />

      {/* oneri listesi */}
      {results.length === 0 ? (
        <p className="text-[11px] text-text-muted">{t("relations.search_empty")}</p>
      ) : (
        <ul className="max-h-40 overflow-auto rounded border border-border">
          {results.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => void add(a)}
                disabled={busy}
                title={a.path}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-start text-[11px] text-text-primary transition hover:bg-accent/10 disabled:opacity-50"
              >
                {a.ext && (
                  <span className="shrink-0 rounded bg-bg-secondary px-1 py-0.5 text-[9px] text-text-muted">
                    {a.ext}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate">{a.file_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={close}
        className="self-start text-[11px] text-text-muted hover:text-text-primary"
      >
        {t("relations.add_cancel")}
      </button>
    </div>
  );
}

/** Hedef-arama hook'u — `open` iken query'ye gore ipc.listAssets; kendini + zaten-baglilari
 *  ele; ilk 8. Bos query → ada gore ilk sonuclar (goz atma). Stale yaniti `active` yutar. */
function useTargetSearch(
  query: string,
  existingIds: Set<number>,
  open: boolean,
): AssetRow[] {
  const [results, setResults] = useState<AssetRow[]>([]);
  const q = query.trim();

  useEffect(() => {
    if (!open) {
      setResults([]);
      return;
    }
    let active = true;
    ipc
      .listAssets({
        page: 0,
        page_size: 24,
        sort: "name_asc",
        query: q === "" ? null : q,
        fuzzy: false,
        ext: [],
        tag: [],
        collection: [],
        project: [],
        modified_after: null,
        modified_before: null,
        favorites_only: false,
        approval_status: [],
        client_name: [],
        version_label: [],
        deadline_year: [],
        path_prefix: null,
      })
      .then((page) => {
        if (!active) return;
        setResults(page.items.filter((a) => !existingIds.has(a.id)).slice(0, 8));
      })
      .catch(() => {
        if (active) setResults([]);
      });
    return () => {
      active = false;
    };
  }, [open, q, existingIds]);

  return results;
}
