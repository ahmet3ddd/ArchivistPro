// Parçalar (Chunk) sekmesi — asset'in RAG metin parcalari (text_chunks). Metadata chunk (-1)
// once (dosya/proje/etiket/EAV ozeti rozetiyle), sonra govde parcalari (sira numarali).
// Lazy: sekme acilinca yuklenir (useAssetChunks). Chunk yoksa → "henuz indekslenmedi" ipucu.
// Ust kisimda (A1 hassasiyet) MANUEL "RAG'den disla" toggle'i — editor+; isaretli asset sohbette
// gizlenir (kalici). Bu, bir dosyanin RAG durumunu gordugu yerde (bu sekme) en dogru baglam.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetChunkRow } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { useAssetChunks } from "../../../hooks/useAssetChunks";
import { useSession } from "../../../hooks/useSession";
import { useToast } from "../../toast/useToast";

const META_CHUNK_INDEX = -1;

export function ChunksTab({ assetId, ragExcluded }: { assetId: number; ragExcluded: boolean }) {
  const { t } = useTranslation();
  const { data, loading, error } = useAssetChunks(assetId);

  return (
    <div className="flex h-full flex-col">
      <RagExcludeToggle assetId={assetId} initial={ragExcluded} />
      {loading ? (
        <p className="p-1 text-xs text-text-muted">{t("detail.chunks_loading")}</p>
      ) : error ? (
        <p className="p-1 text-xs text-danger">{t("detail.chunks_error")}</p>
      ) : (data ?? []).length === 0 ? (
        <p className="p-1 text-xs leading-relaxed text-text-muted">{t("detail.chunks_empty")}</p>
      ) : (
        <div className="space-y-2 p-1">
          <p className="text-[11px] text-text-muted">
            {t("detail.chunks_total", { count: (data ?? []).length })}
          </p>
          {(data ?? []).map((c) => (
            <ChunkCard key={c.chunkId} chunk={c} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Manuel RAG-disla toggle (A1) — editor+; viewer'da salt-bilgi rozet. Optimistik yerel durum
 *  (kalici deger get_asset ile bir sonraki yuklemede gelir). */
function RagExcludeToggle({ assetId, initial }: { assetId: number; initial: boolean }) {
  const { t } = useTranslation();
  const { isEditor } = useSession();
  const toast = useToast();
  const [excluded, setExcluded] = useState(initial);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !excluded;
    setBusy(true);
    try {
      await ipc.setRagExcluded([assetId], next);
      setExcluded(next);
      toast.success(next ? t("detail.rag_excluded_on") : t("detail.rag_excluded_off"));
    } catch (e: unknown) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1.5">
      <span className="text-[11px] text-text-muted">
        {excluded ? t("detail.rag_excluded_state") : t("detail.rag_included_state")}
      </span>
      {isEditor && (
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy}
          className={`rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
            excluded
              ? "border-accent bg-accent/15 text-accent hover:bg-accent/25"
              : "border-border text-text-secondary hover:bg-bg-tertiary hover:border-border-hover"
          }`}
        >
          {excluded ? t("detail.rag_include_action") : t("detail.rag_exclude_action")}
        </button>
      )}
    </div>
  );
}

function ChunkCard({ chunk }: { chunk: AssetChunkRow }) {
  const { t } = useTranslation();
  const isMeta = chunk.chunkIndex === META_CHUNK_INDEX;
  const label = isMeta
    ? t("detail.chunk_meta")
    : t("detail.chunk_body", { n: chunk.chunkIndex + 1 });

  return (
    <div className="rounded-md border border-border bg-bg-tertiary">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            isMeta ? "bg-accent/15 text-accent" : "bg-bg-secondary text-text-secondary"
          }`}
        >
          {label}
        </span>
        {chunk.page != null && (
          <span className="text-[10px] text-text-muted">
            {t("detail.chunk_page", { n: chunk.page })}
          </span>
        )}
      </div>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 text-[11px] leading-relaxed text-text-primary">
        {chunk.text}
      </pre>
    </div>
  );
}
