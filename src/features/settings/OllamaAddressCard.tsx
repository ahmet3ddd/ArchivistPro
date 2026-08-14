// Ollama adres/port yapilandirma karti (AI ayarlari) — Ollama'nin etkin (cozulmus) adresini
// gosterir + kaynagi (env / kalici ayar / OLLAMA_HOST / varsayilan). Admin elle adres girip
// KAYDET/TEMIZLE yapabilir, veya "Tespit et" ile aday adresleri (127.0.0.1 varyantlari, yaygin
// portlar) yoklayip erisileni tek tikla kullanabilir. Non-admin yalniz etkin adres + kaynagi gorur
// (salt-okuma; diger admin kartlari deseni).
//
// Adres degisince ebeveyn (SettingsModal) ai_status'u tazeler (onChanged) → "Ollama calisiyor/
// calismiyor" gostergesi + model listeleri guncellenir. Desen: AiModelsCard (durum + admin eylem +
// toast) pariti. i18n zorunlu (ollama_addr.*); adresler dir="ltr".

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OllamaConfig, OllamaDetect } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../toast/useToast";

/** Adres kaynagi → i18n okunur etiket anahtari. */
const SOURCE_KEY: Record<OllamaConfig["source"], string> = {
  env: "ollama_addr.source_env",
  setting: "ollama_addr.source_setting",
  ollama_host: "ollama_addr.source_ollama_host",
  default: "ollama_addr.source_default",
};

interface Props {
  /** Adres degisince ebeveyn ai_status'u tazeler (Ollama up + chat/vision model listeleri). */
  onChanged: () => void;
}

export function OllamaAddressCard({ onChanged }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { isAdmin } = useSession();

  const [cfg, setCfg] = useState<OllamaConfig | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false); // kaydet/temizle/kullan sirasinda (cift-tetik koruma)
  const [detecting, setDetecting] = useState(false);
  const [detect, setDetect] = useState<OllamaDetect | null>(null);

  // Etkin yapilandirmayi cek; input'u kullanicinin kalici ayariyla doldur (yoksa bos = oto).
  const loadConfig = useCallback(async () => {
    const c = await ipc.ollamaConfig();
    setCfg(c);
    setInput(c.setting ?? "");
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // Bir adresi uygula (null → temizle/oto). Kalici yaz → config + ai_status tazele → toast.
  const applyBase = useCallback(
    async (base: string | null) => {
      if (busy) return;
      setBusy(true);
      try {
        await ipc.setOllamaBase(base);
        await loadConfig();
        onChanged(); // ebeveyn ai_status'u yeniden ceker (up gostergesi + modeller)
        setDetect(null);
        toast.success(base === null ? t("ollama_addr.cleared_toast") : t("ollama_addr.saved_toast"));
      } catch (e: unknown) {
        // Yetki (non-admin) / gecersiz adres → backend Err mesaji.
        toast.error(t("ollama_addr.failed", { message: String(e) }));
      } finally {
        setBusy(false);
      }
    },
    [busy, loadConfig, onChanged, t, toast],
  );

  // Kaydet: bos input → temizle (oto); dolu → kalici ayarla.
  const save = () => {
    const v = input.trim();
    void applyBase(v === "" ? null : v);
  };
  const clear = () => void applyBase(null);
  const useDetected = (base: string) => void applyBase(base);

  // Aday adresleri yokla (ag cagrisi; birkac sn). Sonuclar listelenir; erisilebilir olan kullanilabilir.
  const runDetect = useCallback(async () => {
    if (detecting) return;
    setDetecting(true);
    setDetect(null);
    try {
      const d = await ipc.detectOllama();
      setDetect(d);
    } catch (e: unknown) {
      toast.error(t("ollama_addr.failed", { message: String(e) }));
    } finally {
      setDetecting(false);
    }
  }, [detecting, t, toast]);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("ollama_addr.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("ollama_addr.hint")}</p>

      {cfg == null ? (
        <p className="text-xs text-text-muted">{t("list.loading")}</p>
      ) : (
        <>
          {/* Etkin (cozulmus) adres + kaynagi — her rol gorur */}
          <div className="flex flex-col gap-0.5 rounded border border-border bg-bg-tertiary px-2 py-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
              {t("ollama_addr.effective")}
            </span>
            <span dir="ltr" title={cfg.base} className="truncate text-xs text-text-primary">
              {cfg.base}
            </span>
            <span className="text-[10px] text-text-muted">
              {t("ollama_addr.source", { source: t(SOURCE_KEY[cfg.source]) })}
            </span>
          </div>

          {/* OLLAMA_HOST ham env (varsa) — ipucu */}
          {cfg.ollamaHostEnv && (
            <p dir="ltr" className="text-[10px] text-text-muted">
              {t("ollama_addr.ollama_host_hint", { value: cfg.ollamaHostEnv })}
            </p>
          )}

          {/* Admin duzenleme: elle adres + kaydet/temizle + oto-tespit. Non-admin → gizli. */}
          {isAdmin && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">{t("ollama_addr.input_label")}</span>
                <input
                  dir="ltr"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={cfg.base || t("ollama_addr.input_ph")}
                  className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  {t("ollama_addr.save")}
                </button>
                {cfg.setting && (
                  <button
                    type="button"
                    onClick={clear}
                    disabled={busy}
                    className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:border-border-hover disabled:opacity-50 motion-reduce:transition-none"
                  >
                    {t("ollama_addr.clear")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void runDetect()}
                  disabled={detecting || busy}
                  className="rounded-md border border-border px-3 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                >
                  {detecting ? t("ollama_addr.detecting") : t("ollama_addr.detect")}
                </button>
              </div>

              {/* Oto-tespit sonuclari: adaylar (durum + model sayisi) + erisilebilirse "Bunu kullan" */}
              {detect && (
                <div className="flex flex-col gap-1.5 border-t border-border pt-2">
                  {!detect.best && (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      {t("ollama_addr.none_found")}
                    </p>
                  )}
                  {detect.candidates.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {detect.candidates.map((c) => (
                        <li
                          key={c.base}
                          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded border border-border bg-bg-tertiary px-2 py-1.5"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span aria-hidden className={c.reachable ? "text-success" : "text-danger"}>
                              {c.reachable ? "✓" : "✗"}
                            </span>
                            <span
                              dir="ltr"
                              title={c.base}
                              className="truncate text-xs text-text-primary"
                            >
                              {c.base}
                            </span>
                            <span className="shrink-0 text-[10px] text-text-muted">
                              {c.reachable
                                ? t("ollama_addr.candidate_models", { n: c.modelCount })
                                : t("ollama_addr.candidate_unreachable")}
                            </span>
                            {c.base === detect.best && (
                              <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                                {t("ollama_addr.recommended")}
                              </span>
                            )}
                          </div>
                          {c.reachable && (
                            <button
                              type="button"
                              onClick={() => useDetected(c.base)}
                              disabled={busy}
                              className="shrink-0 rounded border border-border px-2 py-0.5 text-[11px] text-accent transition hover:bg-bg-secondary disabled:opacity-50"
                            >
                              {t("ollama_addr.use_this")}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
