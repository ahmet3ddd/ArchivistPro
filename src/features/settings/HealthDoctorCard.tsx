// Veri Sagligi / Doctor karti (P3; yalniz admin) — DB butunluk + yetim satir onarimi.
//
// db_health (SNAKE_CASE istisna) okur → sema surumu / butunluk / aktif asset / yetim satir
// gosterir. "Onar" (repair_db; admin, camelCase) yetim satirlari temizler → toast ozet +
// sagligi tazele. Yetim yokken (0) buton pasif + "temiz" ipucu (no-op'tan kacin).
//
// Desen: AiModelsCard (Settings admin karti — durum sorgusu + admin eylem + toast + tazele).
// Kart yalniz admin'e render edilir (SettingsModal `{isAdmin && ...}`); gercek yetki Rust'ta.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";
import { FixitySection } from "./FixitySection";
import { OfficeFormatSection } from "./OfficeFormatSection";
import { StalenessSection } from "./StalenessSection";

export function HealthDoctorCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const dataVersion = useUiStore((s) => s.dataVersion);
  const bumpData = useUiStore((s) => s.bumpData);

  // Saglik durumu (db_health; HealthBadge ile ayni sorgu). dataVersion artinca (onarim/tarama) tazelenir.
  const { data, loading, error, refetch } = useIpcQuery(() => ipc.dbHealth(), [dataVersion]);

  // Onarim durumu (cift-tetik koruma) — surerken buton pasif + "Onariliyor…".
  const [repairing, setRepairing] = useState(false);
  const repairingRef = useRef(false);

  const runRepair = useCallback(async () => {
    if (repairingRef.current) return;
    repairingRef.current = true;
    setRepairing(true);
    try {
      const report = await ipc.repairDb();
      toast.success(t("health.repair_done", { removed: report.removed }));
    } catch (e: unknown) {
      // Yetki (non-admin) / onarim hatasi → backend Err mesaji.
      toast.error(t("health.repair_failed", { message: String(e) }));
    } finally {
      repairingRef.current = false;
      setRepairing(false);
      bumpData(); // saglik + liste/facet tazele (onarim sonrasi yetim → 0)
    }
  }, [t, toast, bumpData]);

  const orphans = data?.orphan_count ?? 0;
  const hasOrphans = orphans > 0;

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("health.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("health.hint")}</p>

      {loading && <p className="text-xs text-text-muted">{t("list.loading")}</p>}

      {error && !loading && (
        <div className="flex items-center gap-2 text-xs text-danger">
          <span>{t("list.error", { message: error })}</span>
          <button
            type="button"
            onClick={refetch}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary"
          >
            {t("common.retry")}
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Butunluk + sema + aktif asset (kompakt ozet satiri; mevcut self-describing anahtarlar) */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${data.integrity_ok ? "bg-success" : "bg-danger"}`}
            />
            <span className={data.integrity_ok ? "text-success" : "font-semibold text-danger"}>
              {data.integrity_ok ? t("health.ok") : t("health.broken")}
            </span>
            <span className="text-text-muted" aria-hidden>
              ·
            </span>
            <span className="text-text-secondary">
              {t("health.schema", { v: data.schema_version })}
            </span>
            <span className="text-text-muted" aria-hidden>
              ·
            </span>
            <span className="text-text-secondary">
              {t("health.assets", { count: data.asset_count })}
            </span>
          </div>

          {/* Yetim satir: >0 uyari (vurgu), 0 notr "temiz" */}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <span className="text-text-secondary">{t("health.orphans")}</span>
            {hasOrphans ? (
              <span className="font-semibold tabular-nums text-warning">{orphans}</span>
            ) : (
              <span className="text-text-muted">{t("health.clean")}</span>
            )}
          </div>

          {/* Onar (admin) — yetim varsa etkin; yokken pasif + "temiz" ipucu. Surerken pasif. */}
          <button
            type="button"
            onClick={() => void runRepair()}
            disabled={repairing || !hasOrphans}
            title={!hasOrphans ? t("health.clean") : undefined}
            className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {repairing ? t("health.repairing") : t("health.repair")}
          </button>
        </>
      )}

      {/* Dosya-sistemi ayaklari (db_health'ten bagimsiz; her zaman render — kendi busy/result state'i).
          (A) Arsiv Guncelligi (staleness) · (B) Icerik Butunlugu (fixity). v1 REPORT-ONLY. */}
      <StalenessSection />
      <FixitySection />
      <OfficeFormatSection />
    </section>
  );
}
