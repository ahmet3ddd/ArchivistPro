// Klasor Copu sekmesi (RootsPanel ici) — soft-delete edilmis kokler. Her biri: etiket · yol ·
// cope atilma tarihi · dosya sayisi + "Geri yukle" (restore; asset'ler de geri gelir) / "Kalici sil"
// (purge; SERT onay ebeveynde). Yazma editor+ (ProtectedAction). Sunum-odakli: IPC/onay ebeveynde.

import { useTranslation } from "react-i18next";

import type { ScannedRoot } from "../../ipc/client";
import { formatDate } from "../../lib/format";
import { ProtectedAction } from "../../permissions";

interface Props {
  trashed: ScannedRoot[];
  onRestore: (root: ScannedRoot) => void;
  onPurge: (root: ScannedRoot) => void;
}

export function RootTrashList({ trashed, onRestore, onPurge }: Props) {
  const { t } = useTranslation();

  if (trashed.length === 0) {
    return <p className="py-10 text-center text-sm text-text-muted">{t("roots.trash.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {trashed.map((root) => (
        <div
          key={root.id}
          className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-text-primary">{root.label}</p>
              <p dir="ltr" title={root.path} className="truncate text-xs text-text-muted">
                {root.path}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
              {t("roots.file_count", { count: root.fileCount })}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-text-secondary">
              {root.deletedAt != null
                ? t("roots.trash.deleted_at", { date: formatDate(root.deletedAt) })
                : ""}
            </span>
            <ProtectedAction require="editor" mode="disabled">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onRestore(root)}
                  className="rounded border border-border px-2 py-1 text-xs text-text-secondary
                             transition hover:border-border-hover hover:text-text-primary"
                >
                  {t("roots.trash.restore")}
                </button>
                <button
                  type="button"
                  onClick={() => onPurge(root)}
                  className="rounded border border-danger/40 px-2 py-1 text-xs text-danger
                             transition hover:border-danger hover:bg-danger/10"
                >
                  {t("roots.trash.purge")}
                </button>
              </div>
            </ProtectedAction>
          </div>
        </div>
      ))}
    </div>
  );
}
