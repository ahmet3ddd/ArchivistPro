// Ayarlar > AI: turetilmis yerel AI indekslerini yonetici onayiyla sifirlama.
// Kaynak asset/metadata/thumbnail/klasik FTS ve istege bagli vision analizi KORUNUR; yalniz
// metin embedding, CLIP gorsel embedding, RAG chunk ve bu asamalarin skip izleri temizlenir.

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

export function AiIndexResetCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resettingRef = useRef(false);

  const reset = useCallback(async () => {
    if (resettingRef.current) return;
    resettingRef.current = true;
    setResetting(true);
    try {
      const report = await ipc.resetLocalAiIndexes();
      bumpData();
      toast.success(
        t("aiIndexReset.done", {
          textVectors: report.textVectors,
          imageVectors: report.imageVectors,
          chunks: report.chunks,
          skipped: report.skipped,
        }),
      );
    } catch (e: unknown) {
      toast.error(t("aiIndexReset.failed", { message: String(e) }));
    } finally {
      resettingRef.current = false;
      setResetting(false);
    }
  }, [bumpData, t, toast]);

  return (
    <section className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("aiIndexReset.title")}
      </h3>
      <p className="text-xs leading-relaxed text-text-muted">{t("aiIndexReset.hint")}</p>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={resetting}
        className="self-start rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger/10 disabled:cursor-wait disabled:opacity-60"
      >
        {resetting ? t("aiIndexReset.resetting") : t("aiIndexReset.reset")}
      </button>
      {confirming && (
        <ConfirmDialog
          title={t("aiIndexReset.confirm_title")}
          message={t("aiIndexReset.confirm_message")}
          confirmLabel={t("aiIndexReset.reset")}
          danger
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void reset();
          }}
        />
      )}
    </section>
  );
}
