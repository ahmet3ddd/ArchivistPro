// Görsel Türü Sınıflandırması karti (Katman 1 render/foto/doku) — Ayarlar→AI.
// H2 `fileScanner.ts` refineCategory DETERMINISTIK heuristiginin portu (EXIF/ad/klasor/boyut;
// model GEREKMEZ, TAM OFFLINE — llava render-vs-foto'da guvenilmez oldugu icin AI kullanilmaz).
// Yeni indekslenen gorseller ingest'te oto-siniflanir; bu kart admin'e MEVCUT gorselleri toplu
// siniflandirma (backfill) eylemi verir → `ai_gorsel_turu` EAV yazilir → sol "Gorsel turu" facet +
// kart hapi + detay rozeti dolar. Idempotent (ikinci kosu 0); sinyalsiz gorseller etiketsiz kalir
// (kalici — bu yuzden "kalan N" ilerleme cubugu YOK, yaniltici olurdu). Sonuc toast + facet/veri tazeleme.
//
// Yetki UI-only: buton yalniz admin'e gorunur; gercek kontrol Rust'ta (backfill_image_kind admin-gate).

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

export function ImageKindCard() {
  const { t } = useTranslation();
  const { isAdmin } = useSession(); // gorunum-only; gercek yetki Rust'ta
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);

  const [running, setRunning] = useState(false);
  const runningRef = useRef(false); // cift-tetik koruma

  const run = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const count = await ipc.backfillImageKind();
      if (count > 0) {
        toast.success(t("image_kind.done_toast", { count }));
        bumpData(); // yeni etiketler kart hapi/detayda gorunsun
        bumpFacets(); // "Gorsel turu" facet sayilari guncellensin
      } else {
        // Idempotent: yazacak yeni etiket yok (hepsi zaten etiketli veya sinyalsiz) → bilgi.
        toast.info(t("image_kind.none_toast"));
      }
    } catch (e: unknown) {
      toast.error(t("image_kind.failed", { message: String(e) }));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [t, toast, bumpData, bumpFacets]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("image_kind.title")}
      </h3>
      <div className="flex flex-col gap-4 rounded-md border border-border bg-bg-secondary p-4">
        <p className="text-xs leading-relaxed text-text-muted">{t("image_kind.hint")}</p>

        {/* Admin → toplu siniflandirma (viewer/editor gormez; gercek kontrol Rust'ta) */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="self-start rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {running ? t("image_kind.running") : t("image_kind.run")}
          </button>
        )}
      </div>
    </section>
  );
}
