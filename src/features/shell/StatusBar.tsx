// Alt durum cubugu (footer) — ekranin en altinda, sag-hizali. Saglik rozeti + oturum
// (rol/Kullanicilar/Cikis). TopBar sag-ustunden buraya tasindi (2026-07-09 UI revizyonu;
// kullanici istegi): hesap/durum ogelerini alta almak yaygin masaustu deseni (VS Code/Slack).
// TopBar ust-cubuk stiliyle tutarli (bg-bg-secondary/80 + blur), yalniz border ustte (border-t).

import { HealthBadge } from "../health/HealthBadge";
import { RoleSelect } from "../health/RoleSelect";

export function StatusBar() {
  return (
    <footer
      className="flex shrink-0 items-center justify-end gap-3 border-t border-border
                 bg-bg-secondary/80 px-4 py-1.5 backdrop-blur-md"
    >
      <HealthBadge />
      <RoleSelect />
    </footer>
  );
}
