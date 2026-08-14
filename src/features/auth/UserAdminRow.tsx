// Kullanici satiri (admin paneli) — rol secici (anlik) + parola-sifirla + sil.
// Kendi hesabin icin sil gizlenir (UI savunmasi; "son admin" korumasi yine sunucuda).
// Parola sifirlama satir-ici kucuk form ile (acilir/kapanir).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Role, UserRow } from "../../ipc/client";

interface Props {
  user: UserRow;
  isSelf: boolean;
  onSetRole: (role: Role) => void;
  onDelete: () => void;
  onResetPassword: (newPassword: string) => void;
}

export function UserAdminRow({ user, isSelf, onSetRole, onDelete, onResetPassword }: Props) {
  const { t } = useTranslation();
  const [resetting, setResetting] = useState(false);
  const [pw, setPw] = useState("");

  const doReset = () => {
    if (!pw) return;
    onResetPassword(pw);
    setPw("");
    setResetting(false);
  };

  return (
    <>
      <tr className="border-t border-border">
        <td className="py-2 text-text-primary">
          {user.username}
          {isSelf && <span className="ms-1 text-xs text-text-muted">({t("users.you")})</span>}
          {user.is_founder && (
            <span className="ms-1 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] text-accent">
              {t("users.founder")}
            </span>
          )}
        </td>
        <td className="py-2">
          <select
            value={user.role}
            onChange={(e) => onSetRole(e.target.value as Role)}
            disabled={user.is_founder}
            className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="admin">{t("role.admin")}</option>
            <option value="editor">{t("role.editor")}</option>
            <option value="viewer">{t("role.viewer")}</option>
          </select>
        </td>
        <td className="py-2 text-end">
          {!user.is_founder && (
            <button
              type="button"
              onClick={() => setResetting((v) => !v)}
              className="me-2 rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:bg-bg-tertiary hover:border-border-hover"
            >
              {t("users.reset_password")}
            </button>
          )}
          {!isSelf && !user.is_founder && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10"
            >
              {t("users.delete")}
            </button>
          )}
        </td>
      </tr>
      {resetting && (
        <tr className="border-t border-border bg-bg-tertiary/40">
          <td colSpan={3} className="py-2">
            <div className="flex items-center gap-2 ps-2">
              <input
                type="password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doReset()}
                placeholder={t("users.new_password")}
                autoComplete="new-password"
                autoFocus
                className="w-48 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={doReset}
                disabled={!pw}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("users.reset_confirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setResetting(false);
                  setPw("");
                }}
                className="rounded px-2 py-1 text-xs text-text-secondary transition hover:text-text-primary"
              >
                {t("common.close")}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
