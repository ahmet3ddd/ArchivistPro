// Merkezi Ayarlar modali (Faz UX/Kontrol) — H2 "ayarlar paneli" pariti. Bu dosya artik
// KABUK: portal + scrim + header + sekme cubugu + rol/kalicilik mantigi. Sekme icerikleri
// alt bilesenlere bolunmustur (tabs/GeneralTab, AiTab, ScanningTab, DataTab, MaintenanceTab)
// — her sekme kendi state kumesini yonetir.
//
// PORTAL ZORUNLU: bu modal TopBar (`<header backdrop-blur-md>`) ICINDEN acilir; `backdrop-
// filter` bir containing-block kurar → `fixed inset-0` scrim viewport yerine header kutusuna
// oturur (IngestModal/TrashPanel/UserAdminPanel dersi). `createPortal(document.body)` ile
// header'dan kacar, gercek viewport'a oturur. Esc + disari-tik kapatir.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
import { useModalDialog } from "../../hooks/useModalDialog";
import { GeneralTab } from "./tabs/GeneralTab";
import { AiTab } from "./tabs/AiTab";
import { ScanningTab } from "./tabs/ScanningTab";
import { DataTab } from "./tabs/DataTab";
import { MaintenanceTab } from "./tabs/MaintenanceTab";

interface Props {
  onClose: () => void;
  /** "Yedekleri yonet" → ebeveyn (TopBar) BackupPanel'i acar (Ayarlar kapanir; panel kapaninca geri acilir). */
  onOpenBackup: () => void;
  /** "Denetim gunlugunu ac" → ebeveyn (TopBar) AuditLogPanel'i acar (Ayarlar kapanir; panel kapaninca geri acilir). */
  onOpenAudit: () => void;
  /** "Crash raporlarini ac" → ebeveyn (TopBar) CrashLogPanel'i acar (Ayarlar kapanir; panel kapaninca geri acilir). */
  onOpenCrash: () => void;
  /** "Tarama raporlarini ac" → ebeveyn (TopBar) ScanReportsPanel'i acar (Ayarlar kapanir; panel kapaninca geri acilir). */
  onOpenScanReports: () => void;
}

/** Ayarlar sekmeleri (H2 4-sekme IA paritesi) — kalabalik tek-scroll yerine konu gruplari. */
type SettingsTab = "general" | "ai" | "data" | "maintenance" | "scanning";
const SETTINGS_TABS: readonly SettingsTab[] = ["general", "ai", "data", "maintenance", "scanning"];
const SETTINGS_TAB_KEY = "arsiv.settings.tab";
function initialSettingsTab(): SettingsTab {
  const v = localStorage.getItem(SETTINGS_TAB_KEY) ?? "";
  return (SETTINGS_TABS as readonly string[]).includes(v) ? (v as SettingsTab) : "general";
}

export function SettingsModal({
  onClose,
  onOpenBackup,
  onOpenAudit,
  onOpenCrash,
  onOpenScanReports,
}: Props) {
  const { t } = useTranslation();
  const dialogRef = useModalDialog<HTMLDivElement>(onClose);
  const { isAdmin, isEditor } = useSession();
  // Aktif sekme (H2 4-sekme paritesi; localStorage kalici — oturumlar arasi ayni sekme acilir).
  const [tab, setTab] = useState<SettingsTab>(initialSettingsTab);
  useEffect(() => {
    localStorage.setItem(SETTINGS_TAB_KEY, tab);
  }, [tab]);
  // Rol'e gore gorunur sekmeler — Bakim/Tarama admin, Veri editor+ (Kopya Bulucu); Genel/AI herkes.
  // Tamamen role-gate'li sekme (viewer'a admin-only) gizlenir → bos sekme yok.
  const visibleTabs = SETTINGS_TABS.filter(
    (tb) => tb === "general" || tb === "ai" || (tb === "data" ? isEditor : isAdmin),
  );
  // Kayitli sekme mevcut rol icin gecersizse (or. localStorage'da "maintenance" ama viewer) → Genel.
  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab("general");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, isEditor]);

  // Escape + odak geri-donusu ortak modal hook'unda yonetilir.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border-hover bg-bg-tertiary shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-bg-secondary px-4 py-3">
          <h2 className="font-display text-sm font-bold text-accent">{t("settings.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Sekme cubugu (H2 4-sekme IA paritesi; localStorage kalici). Dar ekranda yatay kaydirilir. */}
        <div className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border bg-bg-secondary px-2 py-1.5">
          {visibleTabs.map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              aria-pressed={tab === tb}
              className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition ${
                tab === tb
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
              }`}
            >
              {t(`settings.tab_${tb}`)}
            </button>
          ))}
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {tab === "general" && <GeneralTab />}
          {tab === "ai" && <AiTab />}
          {tab === "scanning" && <ScanningTab />}
          {tab === "data" && <DataTab onOpenBackup={onOpenBackup} />}
          {tab === "maintenance" && (
            <MaintenanceTab
              onOpenAudit={onOpenAudit}
              onOpenCrash={onOpenCrash}
              onOpenScanReports={onOpenScanReports}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
