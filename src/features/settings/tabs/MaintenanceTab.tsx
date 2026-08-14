// Ayarlar → "Bakim" sekmesi: DB saglik/onarim + iliski tespiti + denetim/crash/
// tarama raporlari (tumu yalniz admin). State yok; kartlar kendi durumunu yonetir.
// Denetim/Crash/Tarama kartlari "ac" dugmesiyle Ayarlar'i kapatip ilgili tam-genis
// paneli acar → onOpen* prop'lari kabuktan (SettingsModal → TopBar) gelir.

import { useSession } from "../../../hooks/useSession";
import { AuditLogCard } from "../AuditLogCard";
import { CrashLogCard } from "../CrashLogCard";
import { LanClientCard } from "../LanClientCard";
import { LanSharingCard } from "../LanSharingCard";
import { ScanReportsCard } from "../ScanReportsCard";
import { HealthDoctorCard } from "../HealthDoctorCard";
import { RelationDetectCard } from "../RelationDetectCard";
import { SystemInfoCard } from "../SystemInfoCard";

interface Props {
  /** "Denetim gunlugunu ac" → ebeveyn (TopBar) AuditLogPanel'i acar. */
  onOpenAudit: () => void;
  /** "Crash raporlarini ac" → ebeveyn (TopBar) CrashLogPanel'i acar. */
  onOpenCrash: () => void;
  /** "Tarama raporlarini ac" → ebeveyn (TopBar) ScanReportsPanel'i acar. */
  onOpenScanReports: () => void;
}

export function MaintenanceTab({ onOpenAudit, onOpenCrash, onOpenScanReports }: Props) {
  const { isAdmin } = useSession();
  return (
    <>
      {/* Veri Sagligi / Doctor (P3; yalniz admin) — DB butunluk + yetim satir onarimi.
          Yedekleme yaninda: her ikisi de DB bakim/kurtarma araci (admin). */}
      {isAdmin && <HealthDoctorCard />}
      {/* Ayni-kok OTO-iliski tespiti (admin) — plan.dwg <-> plan.pdf; Doctor yaninda bakim eylemi. */}
      {isAdmin && <RelationDetectCard />}

      {/* Makine tanisi (admin, salt-okuma): arşiv diski + yerel IP + derleme bilgisi. */}
      {isAdmin && <SystemInfoCard />}

      {/* LAN Paylasimi (S1-S2 MVP; admin) — salt-okuma dagitim/bildirim sunucusu. DEFAULT-KAPALI:
          yalniz acikca baslatilinca calisir → offline-pure varsayilan deneyim etkilenmez. */}
      {isAdmin && <LanSharingCard />}

      {/* LAN Istemci (Faz 2; admin) — bir host'a baglanip bildirimlerini poll eder (salt-okuma).
          LanSharingCard'in istemci karsiligi: host adres + 8-hane kodla baglanir, 15 sn poll. */}
      {isAdmin && <LanClientCard />}

      {/* Denetim gunlugu (yalniz admin) — yikici/yazma eylemlerinin izini goruntule (salt-okuma).
          backup.manage paritesi: kart + dugme → Ayarlar kapanir, tam-genis AuditLogPanel acilir. */}
      {isAdmin && <AuditLogCard onOpen={onOpenAudit} />}

      {/* Crash raporlari (P2.5; yalniz admin) — panik hook'un yakaladigi crash'ler (salt-okuma
          + Temizle). AuditLogCard paritesi: kart + dugme → Ayarlar kapanir, CrashLogPanel acilir. */}
      {isAdmin && <CrashLogCard onOpen={onOpenCrash} />}

      {/* Tarama raporlari (P2.5 ④; yalniz admin) — her taramanin (ingest) kalici raporu; usta-detay
          gecmis. CrashLogCard paritesi: kart + dugme → Ayarlar kapanir, ScanReportsPanel acilir. */}
      {isAdmin && <ScanReportsCard onOpen={onOpenScanReports} />}
    </>
  );
}
