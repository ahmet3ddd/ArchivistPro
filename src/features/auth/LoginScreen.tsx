// Giris ekrani — oturum yokken gosterilir. Basari → sunucu oturumu kurulur +
// store'a yazilir; `onLoggedIn(session)` ile App gate'i ilerletir (must_change
// → zorunlu parola-degistir; aksi → uygulama).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Session } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useSessionStore } from "../../store/useSessionStore";
import { AuthCard, AuthField, AuthSubmit } from "./AuthCard";
import { authErrorMessage } from "./authError";

interface Props {
  onLoggedIn: (session: Session) => void;
}

export function LoginScreen({ onLoggedIn }: Props) {
  const { t } = useTranslation();
  const setSession = useSessionStore((s) => s.setSession);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const session = await ipc.login(username.trim(), password);
      setSession(session);
      onLoggedIn(session);
    } catch (err) {
      setError(authErrorMessage(err, t));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t("auth.login.title")} subtitle={t("auth.login.subtitle")}>
      <form onSubmit={submit}>
        <AuthField
          label={t("auth.username")}
          value={username}
          onChange={setUsername}
          autoFocus
          autoComplete="username"
          testId="login-username"
        />
        <AuthField
          label={t("auth.password")}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          testId="login-password"
        />
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <AuthSubmit
          label={t("auth.login.cta")}
          busyLabel={t("auth.login.busy")}
          busy={busy}
          disabled={!username.trim() || !password}
          testId="login-submit"
        />
      </form>
    </AuthCard>
  );
}
