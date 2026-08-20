// Cop kutusu paneli (§O) — overlay/modal (UserAdminPanel scrim+kart deseni pariti).
// Soft-delete edilmis asset'leri listeler; satir basina geri-yukle (editor+) ya da
// KALICI sil (yalniz admin, onayli). Baslikta "Cop kutusunu bosalt" (tum listeyi purge;
// admin, onayli). Liste acilista + her eylem sonrasi yeniden cekilir; ardindan bumpData()
// ile ana liste/sayac/rozet tazelenir.
//
// Yetki UI-only: editor Geri-yukle gorur; Purge/Bosalt yalniz admin'e gorunur. Gercek
// kontrol Rust'ta (purge=admin, trash/restore=editor+) — UI yalniz gorunum.

import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { AssetRow } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";
import { TrashRow } from "./TrashRow";

interface Props {
  onClose: () => void;
}

export function TrashPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canWrite, isAdmin } = useSession(); // rol sunucu oturumundan (gorunum-only)
  const bumpData = useUiStore((s) => s.bumpData);
  const { data, loading, error, refetch } = useIpcQuery<AssetRow[]>(() => ipc.listTrash(), []);
  const [actionError, setActionError] = useState<string | null>(null);
  // Su an islem altindaki id (cift-tik/yaris onleme + satir gorsel geri-bildirim).
  const [busyId, setBusyId] = useState<number | null>(null);

  const items = data ?? [];

  // Ortak eylem sarmalayicisi: islem → listeyi yeniden cek + ana gorunumu tazele.
  // Basari/hata'yi boolean dondurur (cagiran toast mesajini secsin); hata ayrica
  // panel-ici actionError ile gosterilir (panel acik kalir).
  const run = useCallback(
    async (id: number | null, action: () => Promise<unknown>): Promise<boolean> => {
      setActionError(null);
      setBusyId(id);
      try {
        await action();
        refetch();
        bumpData(); // ana liste + sonuc-sayaci + TopBar cop rozeti tazele
        return true;
      } catch (err) {
        setActionError(String(err));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [refetch, bumpData],
  );

  const restore = (id: number) =>
    void run(id, () => ipc.restoreAssets([id])).then((ok) => {
      if (ok) toast.success(t("toast.restored"));
    });

  // KALICI sil (geri-alinamaz) → onay iste. Yalniz admin gorur; backend yine zorlar.
  const purge = (id: number) =>
    void (async () => {
      const ok = await confirm(t("trash.purge_confirm", { count: 1 }), {
        title: t("trash.purge"),
        kind: "warning",
      });
      if (ok && (await run(id, () => ipc.purgeAssets([id])))) {
        toast.success(t("toast.purged", { count: 1 }));
      }
    })();

  // Cop kutusunu bosalt: listelenen TUM id'leri kalici sil (admin, onayli).
  const emptyTrash = () =>
    void (async () => {
      const ids = items.map((a) => a.id);
      if (ids.length === 0) return;
      const ok = await confirm(t("trash.purge_confirm", { count: ids.length }), {
        title: t("trash.empty_trash"),
        kind: "warning",
      });
      // busyId = -1 → toplu islem isareti (tum satirlar + Bosalt butonu disabled).
      if (ok && (await run(-1, () => ipc.purgeAssets(ids)))) {
        toast.success(t("toast.purged", { count: ids.length }));
      }
    })();

  // Portal: TopBar `backdrop-blur-md` ataji `fixed` icin containing-block yapar → scrim'i
  // body'ye tasi (yoksa header kutusuna hapsolup ekrandan tasar; gercek viewport'a otursun).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("trash.title")}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Baslik + (admin) Bosalt + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("trash.title")}
            {items.length > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("trash.count", { count: items.length })}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {isAdmin && items.length > 0 && (
              <button
                type="button"
                onClick={emptyTrash}
                disabled={busyId !== null}
                className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("trash.empty_trash")}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>

        {actionError && <p className="px-5 py-2 text-sm text-danger">{actionError}</p>}

        {/* Icerik: yukleniyor / hata / bos / liste */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-text-muted">{t("list.loading")}</p>
          ) : error ? (
            <div className="text-sm text-danger">
              <p>{t("list.error", { message: error })}</p>
              <button
                type="button"
                onClick={refetch}
                className="mt-2 rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:bg-bg-tertiary"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-text-secondary">{t("trash.empty")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("trash.empty_hint")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((a) => (
                <TrashRow
                  key={a.id}
                  asset={a}
                  canRestore={canWrite}
                  canPurge={isAdmin}
                  busy={busyId === a.id || busyId === -1}
                  onRestore={() => restore(a.id)}
                  onPurge={() => purge(a.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
