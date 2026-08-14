// Ayarlar → Genel → admin "Giriş kilidi" kartı.
//
// Oturum boşta-kilidi makine-yereldir; buna karşılık kaba-kuvvet eşiği tüm kullanıcıları
// etkileyen arşiv-geneli politikadır. Değerler backend'de app_meta'da doğrulanıp saklanır.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useIpcQuery } from "../../hooks/useIpcQuery";
import { ipc, type LockoutPolicy } from "../../ipc/client";

const MIN_ATTEMPTS = 3;
const MAX_ATTEMPTS = 20;
const MIN_MINUTES = 1;
const MAX_MINUTES = 120;

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function LoginLockoutCard() {
  const { t } = useTranslation();
  const { data, loading, error: loadError, refetch } = useIpcQuery<LockoutPolicy>(
    () => ipc.getAuthLockoutPolicy(),
    [],
  );
  const [threshold, setThreshold] = useState(5);
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setThreshold(data.threshold);
    setDurationMinutes(data.duration_minutes);
  }, [data]);

  const valid =
    inRange(threshold, MIN_ATTEMPTS, MAX_ATTEMPTS) &&
    inRange(durationMinutes, MIN_MINUTES, MAX_MINUTES);
  const changed =
    data != null &&
    (threshold !== data.threshold || durationMinutes !== data.duration_minutes);

  const save = async () => {
    setError(null);
    setSaved(false);
    if (!valid) {
      setError(t("settings.login_lockout_invalid"));
      return;
    }
    setSaving(true);
    try {
      await ipc.setAuthLockoutPolicy(threshold, durationMinutes);
      setSaved(true);
      refetch();
    } catch {
      setError(t("settings.login_lockout_failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("settings.login_lockout")}
      </h3>
      <p className="text-xs text-text-muted">{t("settings.login_lockout_hint")}</p>

      {loading && <p className="text-xs text-text-muted">{t("settings.login_lockout_loading")}</p>}
      {loadError && <p className="text-xs text-danger">{t("settings.login_lockout_failed")}</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              <span>{t("settings.login_lockout_attempts")}</span>
              <input
                type="number"
                min={MIN_ATTEMPTS}
                max={MAX_ATTEMPTS}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-20 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-secondary">
              <span>{t("settings.login_lockout_duration")}</span>
              <input
                type="number"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-20 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!changed || !valid || saving}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? t("auth.change.busy") : t("settings.login_lockout_save")}
            </button>
          </div>
          <p className="text-[11px] text-text-muted">{t("settings.login_lockout_range")}</p>
        </>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      {saved && <p className="text-xs text-success">{t("settings.login_lockout_saved")}</p>}
    </section>
  );
}
