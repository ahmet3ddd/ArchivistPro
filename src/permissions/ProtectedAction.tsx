// Izin-gating bileseni (P2; H2 pariti — H3 rol kademesine uyarlandi).
//
// H3 modeli ince-grenli Permission YERINE basit rol kademesidir: viewer < editor < admin.
// `useSession()` rolu okur; GERCEK yetki Rust'ta (rbac.rs) zorlanir — bu YALNIZ UI gorunumu.
//
// require="admin" → isAdmin; require="editor" (varsayilan) → isEditor (admin|editor).
// Yetki VARSA children aynen render edilir (sarmalayici span YOK → layout notr).
// Yetki YOKSA:
//   mode="hidden"  (varsayilan): fallback (varsayilan null) gosterilir.
//   mode="disabled": children soluk + tiklanamaz sarilir; i18n tooltip (admin/editor'e gore).
// RTL-guvenli: yon-bagimsiz Tailwind token'lari; mantiksal akis korunur.

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../hooks/useSession";

interface ProtectedActionProps {
  /** Gereken minimum rol. Varsayilan "editor". */
  require?: "editor" | "admin";
  /** Yetki varsa gosterilecek icerik. */
  children: ReactNode;
  /** Yetki yoksa (yalniz mode="hidden") gosterilecek icerik. Varsayilan null. */
  fallback?: ReactNode;
  /** Yetki yoksa gorunum: gizle (varsayilan) ya da soluk+pasif goster. */
  mode?: "hidden" | "disabled";
}

export function ProtectedAction({
  require = "editor",
  children,
  fallback = null,
  mode = "hidden",
}: ProtectedActionProps) {
  const { t } = useTranslation();
  const { isAdmin, isEditor } = useSession();

  const allowed = require === "admin" ? isAdmin : isEditor;
  if (allowed) return <>{children}</>;

  if (mode === "disabled") {
    const hint = t(require === "admin" ? "permission.admin_required" : "permission.editor_required");
    return (
      // span: pointer-events acik → cursor-not-allowed + native tooltip gorunur.
      // [&>*]:pointer-events-none → children tiklanamaz (olaylar span'a gecer, inert kalir).
      <span
        title={hint}
        aria-disabled="true"
        className="inline-block cursor-not-allowed opacity-40 [&>*]:pointer-events-none"
      >
        {children}
      </span>
    );
  }

  return <>{fallback}</>;
}
