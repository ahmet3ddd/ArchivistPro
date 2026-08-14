// Etiket YONETIMI (varlik duzeyinde: yeniden adlandir / sil) — H2 `TagManagerModal` karsiligi.
//
// NEDEN AYRI BIR YUZEY: `TagEditor` (detay paneli) asset-BAGI islemidir — "bu dosyaya etiket ekle/
// kaldir". Buradaki islemler etiketin KENDISINI degistirir ve TUM asset'leri birden etkiler; ayni
// yere konsaydi "bu dosyadan kaldir" ile "her yerden sil" gorsel olarak karisirdi (yanlis-silme
// riski). H2'de de ayri bir modaldi ve sol serit etiket filtresinden aciliyordu.
//
// 2026-07-26 davranis-sadakati turu §8: H3'te bu yuzey HIC YOKTU (yalniz renk vardi) → yanlis
// yazilmis bir etiket ne duzeltilebiliyor ne silinebiliyordu; etiket kirliligi kalici oluyordu.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useModalDialog } from "../../hooks/useModalDialog";
import type { Facet } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { formatNumber } from "../../lib/format";

interface Props {
  /** Mevcut kullanici etiketleri (facet: value = ad, count = dosya sayisi). */
  tags: Facet[];
  /** Kapat. */
  onClose: () => void;
  /** Degisiklikten sonra tazeleme. `affected` = ARTIK VAR OLMAYAN ad (silinen ya da yeniden
   *  adlandirilanin eskisi) → cagiran onu aktif filtreden dusurur; yoksa filtre cipi bayat
   *  kalir ve 0 sonuc verir (sessiz "yanlis veri" yuzeyi). */
  onChanged: (affected: string) => void;
}

export function TagManagerModal({ tags, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const dialogRef = useModalDialog<HTMLDivElement>(onClose);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /** Yeniden adlandirilan etiket (null = hicbiri duzenlenmiyor). */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** Silme onayi bekleyen etiket (dosya sayisi onay metninde gosterilir). */
  const [pendingDelete, setPendingDelete] = useState<Facet | null>(null);

  const startEdit = (name: string) => {
    setEditing(name);
    setDraft(name);
  };

  const commitRename = () => {
    const oldName = editing;
    const newName = draft.trim();
    if (!oldName || busy) return;
    // Degismedi ya da bosaltildi → sessizce vazgec (backend de no-op ederdi; gereksiz cagri yok).
    if (newName === "" || newName === oldName) {
      setEditing(null);
      return;
    }
    setBusy(true);
    void ipc
      .renameTag(oldName, newName)
      .then(() => {
        setEditing(null);
        onChanged(oldName);
        toast.success(t("tag_manager.renamed", { old: oldName, new: newName }));
      })
      // Hedef ad kullanimdaysa backend reddeder — mesaji AYNEN gosteriyoruz ki
      // "neden olmadi" belirsiz kalmasin (sessiz birlestirme yok).
      .catch((e: unknown) => toast.error(t("tag_manager.rename_failed", { message: String(e) })))
      .finally(() => setBusy(false));
  };

  const commitDelete = () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target?.value || busy) return;
    setBusy(true);
    void ipc
      .deleteTag(target.value)
      .then((affected) => {
        onChanged(target.value ?? "");
        // Geri-alinabilir oldugunu SOYLE: kullanici "Geri Al"i aramasin diye.
        toast.success(t("tag_manager.deleted", { name: target.value, count: affected }));
      })
      .catch((e: unknown) => toast.error(t("tag_manager.delete_failed", { message: String(e) })))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t("tag_manager.title")}
          className="flex max-h-[80vh] w-full max-w-md flex-col rounded-lg border border-border bg-bg-secondary shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-text-primary">
              {t("tag_manager.title")}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="text-text-muted transition hover:text-text-primary"
            >
              ×
            </button>
          </div>

          <p className="px-4 pt-3 text-[11px] leading-snug text-text-muted">
            {t("tag_manager.hint")}
          </p>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {tags.length === 0 ? (
              <p className="text-xs text-text-muted">{t("tag_manager.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {tags.map((f) => (
                  <li
                    key={f.value ?? ""}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary/40 px-2.5 py-1.5"
                  >
                    {editing === f.value ? (
                      <>
                        <input
                          data-escape-local
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename();
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                            }
                          }}
                          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-0.5 text-xs text-text-primary outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={commitRename}
                          disabled={busy}
                          className="shrink-0 rounded bg-accent px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
                        >
                          {t("common.save")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="shrink-0 text-[11px] text-text-muted hover:text-text-primary"
                        >
                          {t("common.cancel")}
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
                          {f.value}
                        </span>
                        {/* Kac dosyada kullanildigi — silmeden ONCE etkiyi gormek icin. */}
                        <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                          {formatNumber(f.count)}
                        </span>
                        <button
                          type="button"
                          onClick={() => f.value != null && startEdit(f.value)}
                          disabled={busy}
                          className="shrink-0 text-[11px] text-text-secondary transition hover:text-accent disabled:opacity-50"
                        >
                          {t("tag_manager.rename")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(f)}
                          disabled={busy}
                          className="shrink-0 text-[11px] text-text-secondary transition hover:text-danger disabled:opacity-50"
                        >
                          {t("tag_manager.delete")}
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Silme ONAYI: kac dosyadan kalkacagi + geri-alinabilir oldugu yazili (yikici ama kurtarilabilir). */}
      {pendingDelete && (
        <ConfirmDialog
          title={t("tag_manager.delete_confirm_title", { name: pendingDelete.value })}
          message={t("tag_manager.delete_confirm_message", { count: pendingDelete.count })}
          confirmLabel={t("tag_manager.delete")}
          danger
          onConfirm={commitDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
