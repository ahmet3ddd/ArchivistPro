// Ayni-kok iliski tespiti karti (P3; yalniz admin) — istek-uzeri OTO-iliskilendirme.
//
// `detect_relations` (admin): ayni-kok + farkli-uzantili asset gruplarini (plan.dwg ↔ plan.pdf ↔
// plan.jpg) `derived` iliskiyle bagler; mevcut/manuel baglari EZMEZ (idempotent). Ingest'i
// DEGISTIRMEZ — istek-uzeri bakim eylemi (dedup/reindex deseni). Bitince ozet toast + bumpData
// (acik detayin "Iliskiler" sekmesi tazelensin). HealthDoctorCard paritesi: tek buton + toast.
//
// Kart yalniz admin'e render edilir (SettingsModal `{isAdmin && ...}`); gercek yetki Rust'ta.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

export function RelationDetectCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);

  // Cift-tetik koruma — surerken buton pasif + "Taraniyor…".
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const rep = await ipc.detectRelations();
      toast.success(t("relations.detect_done", { created: rep.created, groups: rep.groups }));
    } catch (e: unknown) {
      // Yetki (non-admin) / hata → backend Err mesaji.
      toast.error(t("relations.detect_failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
      bumpData(); // acik detayin Iliskiler sekmesi + liste tazelensin
    }
  }, [t, toast, bumpData]);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("relations.detect_title")}
      </h3>
      <p className="text-xs text-text-muted">{t("relations.detect_hint")}</p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={running}
        className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
      >
        {running ? t("relations.detecting") : t("relations.detect")}
      </button>
    </section>
  );
}
