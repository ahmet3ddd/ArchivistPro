// Kullanici yonetimi paneli (yalniz admin) — liste + ekle/sil/rol-degistir/parola-sifirla.
// Tum islemler sunucu-tarafi admin-gate'inden gecer (rol oturumdan; istemci secemez).
// Overlay olarak acilir (App'teki HeaderBar dugmesinden). Satir alt-bilesene bolundu
// (dosya yalin tutulur; <500 satir).

import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { Role, UserRow } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";
import { MainArchiveNotice } from "../archives/MainArchiveNotice";
import { authErrorMessage } from "./authError";
import { UserAdminRow } from "./UserAdminRow";
import { UserCsvImport } from "./UserCsvImport";

interface Props {
  /** Aktif oturum kullanici id'si — kendini silme/rol-dususurmeyi UI'da engellemek icin. */
  currentUserId: number;
  onClose: () => void;
}

export function UserAdminPanel({ currentUserId, onClose }: Props) {
  const { t } = useTranslation();
  const activeIsMain = useUiStore((s) => s.activeArchiveIsMain);
  const { data, refetch } = useIpcQuery<UserRow[]>(() => ipc.listUsers(), []);
  const [error, setError] = useState<string | null>(null);

  // Yeni kullanici formu.
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<Role>("viewer");
  const [newPass, setNewPass] = useState("");

  // Ortak islem sarmalayicisi: hata cevir + listeyi tazele.
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      setError(null);
      try {
        await action();
        refetch();
      } catch (err) {
        setError(authErrorMessage(err, t));
      }
    },
    [refetch, t],
  );

  const create = () =>
    void run(async () => {
      await ipc.adminCreateUser(newName.trim(), newRole, newPass);
      setNewName("");
      setNewPass("");
      setNewRole("viewer");
    });

  const canCreate = newName.trim().length > 0 && newPass.length > 0;

  // Kimlik yalniz ANA arsivde yonetilir (cok-arsiv): ek arsivdeyken panel yalniz "ana arsive
  // gecin" notunu gosterir (kullanici/rol/parola ek arsivin izole users tablosuna yazilmaz).
  if (!activeIsMain) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md rounded-lg border border-border bg-bg-primary p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-accent">{t("users.title")}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          </div>
          <MainArchiveNotice />
        </div>
      </div>,
      document.body,
    );
  }

  // Portal: TopBar `backdrop-blur-md` ataji `fixed` icin containing-block yapar → scrim'i
  // body'ye tasi (yoksa header kutusuna hapsolup ekrandan tasar; gercek viewport'a otursun).
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">{t("users.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Yeni kullanici olustur */}
        <div className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-3">
          <label className="flex flex-col text-xs text-text-secondary">
            <span className="mb-1">{t("auth.username")}</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-40 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col text-xs text-text-secondary">
            <span className="mb-1">{t("auth.password")}</span>
            <input
              type="password"
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              autoComplete="new-password"
              className="w-40 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col text-xs text-text-secondary">
            <span className="mb-1">{t("role.label")}</span>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as Role)}
              className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="admin">{t("role.admin")}</option>
              <option value="editor">{t("role.editor")}</option>
              <option value="viewer">{t("role.viewer")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={create}
            disabled={!canCreate}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("users.add")}
          </button>
        </div>

        <UserCsvImport onDone={refetch} />
        {error && <p className="px-5 py-2 text-sm text-danger">{error}</p>}

        {/* Kullanici listesi */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {!data ? (
            <p className="text-sm text-text-muted">{t("list.loading")}</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-text-muted">{t("users.empty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs uppercase tracking-wide text-text-muted">
                  <th className="pb-2 text-start font-semibold">{t("users.col_username")}</th>
                  <th className="pb-2 text-start font-semibold">{t("users.col_role")}</th>
                  <th className="pb-2 text-end font-semibold">{t("users.col_actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <UserAdminRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === currentUserId}
                    onSetRole={(role) => run(() => ipc.adminSetRole(u.id, role))}
                    onDelete={() => run(() => ipc.adminDeleteUser(u.id))}
                    onResetPassword={(pw) => run(() => ipc.adminResetPassword(u.id, pw))}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
