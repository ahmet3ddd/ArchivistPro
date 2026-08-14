// AI oto-indeks ayar karti (P1; yalniz admin — SettingsModal `{isAdmin && ...}` ile gate'lenir).
// Tarama-sonrasi otomatik AI indekslemeyi (yerel 3 stage) yonetir:
//   • Aç/kapa toggle → set_auto_index_enabled (baslangic: auto_index_status().enabled; iyimser
//     yansitma → backend dogrulama ile uzlasir).
//   • active → "su anda calisiyor" gostergesi.
//   • skipped > 0 → "N dosya atlandi" + "Yeniden dene" → retry_skipped_index() (stage'siz = hepsi)
//     → toast + durum tazele.
//
// Desen: AiModelsCard/SemanticIndexCard (useIpcQuery + tick tazele + toast + admin eylem). Yetki
// UI-only (gercek kontrol Rust'ta: set/stop/retry ADMIN). i18n zorunlu (autoIndex.*); RTL token'lar.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AutoIndexStatus } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useToast } from "../toast/useToast";

export function AutoIndexCard() {
  const { t } = useTranslation();
  const toast = useToast();

  // Durum sorgusu (enabled + active + skipped). `tick` ile toggle/retry sonrasi yeniden cek.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((x) => x + 1), []);
  const { data, loading, error, refetch } = useIpcQuery<AutoIndexStatus>(
    () => ipc.autoIndexStatus(),
    [tick],
  );

  // İyimser toggle: tik cevabi gelene dek kullanicinin secimini goster; backend dogrulamasi
  // ile uzlasinca (data.enabled === optimistic) temizlenir. Hata → geri al (null → data'ya dus).
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (optimistic !== null && data && data.enabled === optimistic) setOptimistic(null);
  }, [data, optimistic]);

  const enabled = optimistic ?? data?.enabled ?? true;

  const toggle = useCallback(
    async (on: boolean) => {
      setOptimistic(on);
      setSaving(true);
      try {
        await ipc.setAutoIndexEnabled(on);
      } catch (e: unknown) {
        setOptimistic(null); // geri al
        toast.error(t("autoIndex.enable_failed", { message: String(e) }));
      } finally {
        setSaving(false);
        refresh();
      }
    },
    [t, toast, refresh],
  );

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const cleared = await ipc.retrySkippedIndex(); // stage'siz → TUM adimlar (v1)
      toast.success(
        cleared > 0 ? t("autoIndex.retry_done", { count: cleared }) : t("autoIndex.retry_none"),
      );
    } catch (e: unknown) {
      toast.error(t("autoIndex.retry_failed", { message: String(e) }));
    } finally {
      setRetrying(false);
      refresh();
    }
  }, [t, toast, refresh]);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("autoIndex.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("autoIndex.hint")}</p>

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
          {/* Aç/kapa (watch toggle deseni) */}
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saving}
              onChange={(e) => void toggle(e.target.checked)}
              className="mt-0.5 accent-accent disabled:opacity-50"
            />
            <span className="flex flex-col">
              <span className="text-text-secondary">{t("autoIndex.toggle")}</span>
              <span className="text-text-muted">{t("autoIndex.toggle_hint")}</span>
            </span>
          </label>

          {/* Su an calisiyor (surucu aktif) — gorunur geri bildirim */}
          {data.active && (
            <div className="flex items-center gap-2 text-xs text-accent">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse"
              />
              <span>{t("autoIndex.active")}</span>
            </div>
          )}

          {/* Atlanan (kalici-basarisiz) → uyari + "Yeniden dene" (stage'siz = hepsi) */}
          {data.skipped > 0 && (
            <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2">
              <span className="text-xs text-warning">
                {t("autoIndex.skipped", { count: data.skipped })}
              </span>
              <button
                type="button"
                onClick={() => void retry()}
                disabled={retrying}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:border-border-hover focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                {retrying ? t("autoIndex.retrying") : t("autoIndex.retry")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
