// TopBar cop kutusu dugmesi (§O) — 🗑 + sayi rozeti (yalniz count>0). Tiklayinca
// TrashPanel'i acar (yerel useState). Sayi `trash_count`'tan; `dataVersion` degisince
// (cop'e at / geri-yukle / kalici-sil sonrasi bumpData) yeniden cekilir.
//
// Her rol gorur (cop salt-okuma listelenebilir; eylemlerin yetkisi panel + Rust'ta).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";
import { TrashPanel } from "./TrashPanel";
import { formatNumber } from "../../lib/format";

export function TrashButton() {
  const { t } = useTranslation();
  const dataVersion = useUiStore((s) => s.dataVersion);
  const { data } = useIpcQuery<number>(() => ipc.trashCount(), [dataVersion]);
  const [open, setOpen] = useState(false);

  const count = data ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("trash.title")}
        title={t("trash.title")}
        className="relative flex h-7 items-center gap-1 rounded-md border border-border px-2 text-sm text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
      >
        <span aria-hidden>🗑</span>
        {count > 0 && (
          <span className="min-w-[1.25rem] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-5 text-white">
            {formatNumber(count)}
          </span>
        )}
      </button>

      {open && <TrashPanel onClose={() => setOpen(false)} />}
    </>
  );
}
