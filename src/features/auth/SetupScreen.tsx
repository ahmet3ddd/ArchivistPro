// İlk kurulum ekrani — hic kullanici yokken gosterilir (ilk admin hesabini kurar).
// `setup_admin` oturum ACMAZ → ardindan otomatik `login` ile oturumu kurarız;
// boylece kullanici tek formla uygulamaya girer. Basari → onReady(session).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useSessionStore } from "../../store/useSessionStore";
import { AuthCard, AuthField, AuthSubmit } from "./AuthCard";
import { authErrorMessage } from "./authError";
import { MIN_PASSWORD_LEN } from "./passwordPolicy";

interface Props {
  onReady: (session: Session) => void;
}

export function SetupScreen({ onReady }: Props) {
  const { t } = useTranslation();
  const setSession = useSessionStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  // Asgari parola uzunlugu (H2 `FirstRunSetup.tsx:46-47` paritesi — H3'te sessizce dusmustu,
  // tek karakterlik admin parolasi kabul ediliyordu). Backend de ayni kurali dayatir
  // (`archivist-db/src/auth.rs` → `password_too_short`); buradaki yalniz ANINDA geri bildirim.
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LEN;
  const valid =
    username.trim().length > 0 && password.length >= MIN_PASSWORD_LEN && password === confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await ipc.setupAdmin(username.trim(), password);
      // Kurulum oturum acmaz → ayni kimlikle giris yap (tek-form akisi).
      const session = await ipc.login(username.trim(), password);
      setSession(session);
      onReady(session);
    } catch (err) {
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("auth.setup.title")} subtitle={t("auth.setup.subtitle")}>
      <form onSubmit={submit}>
        <AuthField
          label={t("auth.username")}
          value={username}
          onChange={setUsername}
          autoFocus
          autoComplete="username"
        />
        <AuthField
          label={t("auth.password")}
          type="password"
          value={password}
          onChange={setPassword}
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
          label={t("auth.setup.cta")}
          busyLabel={t("auth.setup.busy")}
          busy={busy}
          disabled={!valid}
        />
      </form>
    </AuthCard>
  );
}
