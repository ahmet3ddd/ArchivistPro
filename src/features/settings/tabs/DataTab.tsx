// Ayarlar → "Veri" sekmesi: arsiv tasima + otomatik yedekleme (admin). Otomatik-yedek
// ayarlari yerel state; degisince store'a bump → scheduler taze okur. "Yedekleri yonet"
// dugmesi Ayarlar'i kapatip BackupPanel'i acar → onOpenBackup kabuktan (SettingsModal →
// TopBar) gelir. (Kopya Bulucu ARTIK yalniz sol serit/ActivityBar'dan acilir → buradaki
// gereksiz kart kaldirildi.)

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../../hooks/useSession";
import { useUiStore } from "../../../store/useUiStore";
import {
  BACKUP_INTERVALS,
  getBackupIntervalHours,
  getMaxSnapshots,
  setBackupIntervalHours,
  setMaxSnapshots,
} from "../../backup/backupSettings";
import { ArchiveShareCard } from "../../archive/ArchiveShareCard";

interface Props {
  /** "Yedekleri yonet" → ebeveyn (TopBar) BackupPanel'i acar. */
  onOpenBackup: () => void;
}

export function DataTab({ onOpenBackup }: Props) {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const bumpBackupConfig = useUiStore((s) => s.bumpBackupConfig);
  // Otomatik-yedek ayarlari (localStorage) — yerel state; degisince store'a bump → scheduler taze.
  const [interval, setInterval] = useState(() => getBackupIntervalHours());
  const [maxSnap, setMaxSnap] = useState(() => getMaxSnapshots());

  const changeInterval = (h: number) => {
    setInterval(h);
    setBackupIntervalHours(h);
    bumpBackupConfig();
  };
  const changeMax = (n: number) => {
    const v = Math.max(1, Math.min(50, Math.floor(n) || 1));
    setMaxSnap(v);
    setMaxSnapshots(v);
    bumpBackupConfig();
  };

  return (
    <>
      {/* Arsiv Tasima (cok-arsiv; yalniz admin) — tum arsivi .archivistpro dosyasina disa aktar /
          baska makineden ice aktar (YOL-REMAP). Yedekleme/Doctor ile ayni Veri/Yedekleme bolumu. */}
      {isAdmin && <ArchiveShareCard />}

      {/* Yedekleme (yalniz admin) — otomatik yedek araligi + retention + yonetim paneli. */}
      {isAdmin && (
        <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-secondary p-3">
          <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
            {t("backup.title")}
          </h3>
          <p className="text-xs text-text-muted">{t("backup.auto_hint")}</p>

          {/* Otomatik yedek araligi (kapali/1/4/8/24 saat) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-text-secondary">{t("backup.schedule")}</span>
            <div className="flex flex-wrap gap-1.5">
              {BACKUP_INTERVALS.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => changeInterval(h)}
                  className={`rounded-md border px-2 py-1 text-xs transition ${
                    interval === h
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-text-secondary hover:bg-bg-tertiary hover:border-border-hover"
                  }`}
                >
                  {h === 0 ? t("backup.schedule_off") : t("backup.hours", { count: h })}
                </button>
              ))}
            </div>
          </div>

          {/* Retention: saklanacak en fazla otomatik yedek */}
          <label className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-secondary">{t("backup.max_label")}</span>
            <input
              type="number"
              min={1}
              max={50}
              value={maxSnap}
              onChange={(e) => changeMax(Number(e.target.value))}
              className="w-20 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary
                         focus:border-accent focus:outline-none"
            />
          </label>

          {/* Yedekleri yonet (al/geri-yukle/disa-aktar/sil) → BackupPanel */}
          <button
            type="button"
            onClick={onOpenBackup}
            className="self-start rounded-md border border-border px-3 py-1 text-xs text-text-secondary
                       transition hover:bg-bg-tertiary hover:border-border-hover focus:border-accent
                       focus:outline-none motion-reduce:transition-none"
          >
            {t("backup.manage")}
          </button>
        </section>
      )}
    </>
  );
}
