import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { authErrorMessage } from "./authError";
import { MIN_PASSWORD_LEN } from "./passwordPolicy";

/** Settings'teki gonullu parola degisimi. Zorunlu ekranla ayni komutu kullanir. */
export function ChangePasswordCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = oldPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LEN && newPassword === confirm;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.changePassword(oldPassword, newPassword);
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      toast.success(t("toast.password_changed"));
    } catch (err) {
      setError(authErrorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">{t("auth.change.title")}</h3>
      <p className="text-xs text-text-muted">{t("auth.change.subtitle")}</p>
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
        <input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" placeholder={t("auth.change.old")} aria-label={t("auth.change.old")} className="rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" placeholder={t("auth.change.new")} aria-label={t("auth.change.new")} className="rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" placeholder={t("auth.confirm_password")} aria-label={t("auth.confirm_password")} className="rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none" />
        {newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LEN && <p className="text-xs text-warning">{t("auth.error.too_short", { count: MIN_PASSWORD_LEN })}</p>}
        {confirm.length > 0 && confirm !== newPassword && <p className="text-xs text-warning">{t("auth.error.mismatch")}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
        <button type="submit" disabled={!valid || busy} className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50">{busy ? t("auth.change.busy") : t("auth.change.cta")}</button>
      </form>
    </section>
  );
}
