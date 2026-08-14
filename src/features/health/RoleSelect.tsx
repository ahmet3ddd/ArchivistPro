// Oturum cubugu — rol rozeti (SALT-OKUNUR) + cikis + (admin) kullanici yonetimi.
//
// Faz 6 / B1: istemci ARTIK rol secemez. Rol sunucu-tarafi kimlik-dogrulanmis
// oturumdan gelir (useSession). Burada yalniz gosterilir; degistirme yok.
// Cikis → ipc.logout() + oturum store temizlenir (App gate login'e doner).

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { useSessionStore } from "../../store/useSessionStore";
import { UserAdminPanel } from "../auth/UserAdminPanel";

const BADGE_CLS: Record<string, string> = {
  admin: "bg-accent/20 text-accent",
  editor: "bg-success/20 text-success",
  viewer: "bg-bg-tertiary text-text-secondary",
};

export function RoleSelect() {
  const { t } = useTranslation();
  const { session, role, isAdmin } = useSession();
  const clear = useSessionStore((s) => s.clear);
  const [panelOpen, setPanelOpen] = useState(false);

  if (!session || !role) return null;

  const logout = async () => {
    try {
      await ipc.logout();
    } finally {
      clear(); // sunucu hatasi olsa da istemci oturumunu birak
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      {/* Kullanici adi + rol rozeti (salt-okunur) */}
      <span className="hidden text-text-secondary sm:inline">{session.username}</span>
      <span className={`rounded px-1.5 py-0.5 font-medium ${BADGE_CLS[role] ?? BADGE_CLS.viewer}`}>
        {t(`role.${role}`)}
      </span>

      {isAdmin && (
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="rounded-md border border-border px-2 py-1 text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
        >
          {t("users.title")}
        </button>
      )}

      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-md border border-border px-2 py-1 text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
      >
        {t("auth.logout")}
      </button>

      {panelOpen && (
        <UserAdminPanel currentUserId={session.user_id} onClose={() => setPanelOpen(false)} />
      )}
    </div>
  );
}
