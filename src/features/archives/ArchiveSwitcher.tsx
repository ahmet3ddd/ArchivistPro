// Arsiv anahtari — adlandirilmis eszamanli YEREL arsivler (izole coklu DB). Sol facet
// cubugunun ustunde. Admin: arsivleri listeler, tiklayinca gecer (backend `db`/`read_db`'yi
// yeniden baglar), olustur/adlandir/sil. Non-admin: yalniz AKTIF arsivin adini gorur (gecis
// admin eylemidir). Silme non-destructive (dosya .trash'e). ANA arsiv adi i18n'den (isMain).

import { confirm } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LocalArchive } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";
import { formatNumber } from "../../lib/format";

/** Bilinen hata token'larini i18n'e esle; bilinmeyen → ham metin. */
function archiveError(t: (k: string) => string, raw: unknown): string {
  const s = String(raw);
  const known = ["archive_busy", "archive_not_main", "archive_missing", "archive_protected", "archive_active"];
  const hit = known.find((k) => s.includes(k));
  return hit ? t(`local_archive.err.${hit}`) : s;
}

/** Bir arsivin gorunur adi: ANA → i18n; digeri → kayitli ad. */
function archiveLabel(t: (k: string) => string, a: LocalArchive): string {
  return a.isMain ? t("local_archive.main") : a.name;
}

export function ArchiveSwitcher() {
  const { t } = useTranslation();
  const toast = useToast();
  const { isAdmin } = useSession();
  const activeArchiveId = useUiStore((s) => s.activeArchiveId);
  const dataVersion = useUiStore((s) => s.dataVersion);
  const applyArchiveSwitch = useUiStore((s) => s.applyArchiveSwitch);

  const [archives, setArchives] = useState<LocalArchive[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  // Eski-yanit korumasi: hizli ard-arda gecislerde onceki reload'in (yavas) yaniti YENISINI
  // EZMESIN → yalniz EN SON istegin sonucu uygulanir. Yoksa eski arsivin (yanlis aktif/sayac)
  // listesi son sozu soyleyip "aktif arsivde sayac yok" gibi tutarsizlik yaratabilir.
  const reqIdRef = useRef(0);
  const reload = useCallback(() => {
    const myReq = ++reqIdRef.current;
    ipc
      .listLocalArchives()
      // Savunma: backend beklenmedik bir sey dondurse de (or. test-mock null) grid patlamasin.
      .then((r) => {
        if (myReq === reqIdRef.current) setArchives(Array.isArray(r) ? r : []);
      })
      .catch(() => {
        if (myReq === reqIdRef.current) setArchives([]);
      });
  }, []);

  // Ilk yukleme + aktif arsiv degisince + veri degisince (ingest/silme sonrasi AKTIF arsivin
  // sayimi tazelensin — sayac yalniz aktif arsiv icin dolar; dataVersion ingest'te bump'lanir).
  useEffect(() => {
    reload();
  }, [reload, activeArchiveId, dataVersion]);

  const switchTo = async (a: LocalArchive) => {
    if (a.id === activeArchiveId || busy) return;
    setBusy(true);
    try {
      const next = await ipc.switchArchive(a.id);
      applyArchiveSwitch({ id: next.id, name: next.name, isMain: next.isMain });
      toast.success(t("local_archive.switched", { name: archiveLabel(t, next) }));
    } catch (e) {
      toast.error(archiveError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await ipc.createLocalArchive(name, null);
      toast.success(t("local_archive.created", { name }));
      setNewName("");
      setCreating(false);
      reload();
    } catch (e) {
      toast.error(archiveError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const saveRename = async (a: LocalArchive) => {
    const name = editDraft.trim();
    if (!name || name === a.name) {
      setEditingId(null);
      return;
    }
    setBusy(true);
    try {
      await ipc.renameLocalArchive(a.id, name);
      setEditingId(null);
      reload();
    } catch (e) {
      toast.error(archiveError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: LocalArchive) => {
    const ok = await confirm(t("local_archive.delete_confirm", { name: a.name }), {
      title: t("local_archive.delete_title"),
      kind: "warning",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await ipc.deleteLocalArchive(a.id);
      toast.success(t("local_archive.deleted", { name: a.name }));
      reload();
    } catch (e) {
      toast.error(archiveError(t, e));
    } finally {
      setBusy(false);
    }
  };

  // Non-admin: yalniz aktif arsiv adini goster (gecis/CRUD admin eylemidir).
  if (!isAdmin) {
    const active = archives.find((a) => a.active);
    if (!active || active.isMain) return null; // ANA'da ek gosterge gereksiz
    return (
      <div className="mb-2 flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-1 text-[11px] text-text-secondary">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: active.color ?? "var(--color-accent)" }}
          aria-hidden
        />
        <span className="truncate">{archiveLabel(t, active)}</span>
      </div>
    );
  }

  return (
    <section className="mb-2 border-b border-border pb-2">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-display text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
          {t("local_archive.section")}
        </h3>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          disabled={busy}
          title={t("local_archive.create")}
          className="rounded px-1.5 py-0.5 text-xs text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
        >
          +
        </button>
      </div>

      <ul className="flex flex-col gap-0.5">
        {archives.map((a) => {
          const isEditing = editingId === a.id;
          return (
            <li key={a.id}>
              {isEditing ? (
                <input
                  autoFocus
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveRename(a);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={() => void saveRename(a)}
                  className="w-full rounded border border-accent bg-bg-tertiary px-1.5 py-1 text-[11px] text-text-primary focus:outline-none"
                />
              ) : (
                <div
                  className={`group flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                    a.active
                      ? "bg-accent/15 text-text-primary"
                      : "text-text-secondary hover:bg-bg-tertiary"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void switchTo(a)}
                    disabled={busy}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-start disabled:cursor-default"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{
                        background: a.isMain
                          ? "var(--color-accent)"
                          : (a.color ?? "var(--color-text-muted)"),
                      }}
                      aria-hidden
                    />
                    <span className="truncate">{archiveLabel(t, a)}</span>
                    {a.active && a.assetCount != null && (
                      <span className="ms-auto shrink-0 text-[10px] text-text-muted">
                        {formatNumber(a.assetCount)}
                      </span>
                    )}
                  </button>
                  {/* Ek arsiv (ANA degil) yonetim eylemleri — hover'da gorunur. */}
                  {!a.isMain && (
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        title={t("local_archive.rename")}
                        onClick={() => {
                          setEditingId(a.id);
                          setEditDraft(a.name);
                        }}
                        className="rounded px-1 text-text-muted hover:text-text-primary"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title={t("local_archive.delete")}
                        disabled={a.active}
                        onClick={() => void remove(a)}
                        className="rounded px-1 text-text-muted hover:text-danger disabled:opacity-30"
                      >
                        🗑
                      </button>
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {creating && (
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void create();
            if (e.key === "Escape") {
              setCreating(false);
              setNewName("");
            }
          }}
          onBlur={() => void create()}
          placeholder={t("local_archive.new_placeholder")}
          className="mt-1 w-full rounded border border-accent bg-bg-tertiary px-1.5 py-1 text-[11px] text-text-primary focus:outline-none"
        />
      )}
    </section>
  );
}
