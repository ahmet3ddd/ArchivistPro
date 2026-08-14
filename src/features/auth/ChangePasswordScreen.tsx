// Parola degistir ekrani — iki baglam:
//  - ZORUNLU (forced): login `must_change:true` dondurdu → tam-ekran gate, atlanamaz.
//  - GONULLU: hesap menusunden (forced=false → "iptal" gosterilir).
// Eski parola sunucuda dogrulanir. Basari → onDone(); zorunlu akista App gate'i
// must_change'i temizleyip uygulamaya gecer.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { AuthCard, AuthField, AuthSubmit } from "./AuthCard";
import { authErrorMessage } from "./authError";
import { MIN_PASSWORD_LEN } from "./passwordPolicy";

interface Props {
  forced: boolean;
  onDone: () => void;
  onCancel?: () => void; // yalniz gonullu akista
}

export function ChangePasswordScreen({ forced, onDone, onCancel }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && newPassword !== confirm;
  // Asgari uzunluk — SetupScreen ile ayni kural (bkz passwordPolicy.ts). Zorunlu-degisim
  // akisinda da gecerli, aksi halde kural ilk kurulumdan sonra delinirdi.
  const tooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LEN;
  const valid =
    oldPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LEN && newPassword === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.changePassword(oldPassword, newPassword);
      toast.success(t("toast.password_changed"));
      onDone();
    } catch (err) {
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      title={t("auth.change.title")}
      subtitle={forced ? t("auth.change.forced_hint") : t("auth.change.subtitle")}
    >
      <form onSubmit={submit}>
        <AuthField
          label={t("auth.change.old")}
          type="password"
          value={oldPassword}
          onChange={setOldPassword}
          autoFocus
          autoComplete="current-password"
        />
        <AuthField
          label={t("auth.change.new")}
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
        />
        <AuthField
          label={t("auth.confirm_password")}
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        {tooShort && (
          <p className="mb-3 text-sm text-warning">
            {t("auth.error.too_short", { count: MIN_PASSWORD_LEN })}
          </p>
        )}
        {mismatch && <p className="mb-3 text-sm text-warning">{t("auth.error.mismatch")}</p>}
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <AuthSubmit
          label={t("auth.change.cta")}
          busyLabel={t("auth.change.busy")}
          busy={busy}
          disabled={!valid}
        />
        {!forced && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm text-text-secondary
                       transition hover:bg-bg-tertiary hover:border-border-hover"
          >
            {t("common.close")}
          </button>
        )}
      </form>
    </AuthCard>
  );
}
