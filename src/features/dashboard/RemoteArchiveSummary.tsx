// Uzak (ana) arsiv Pano — SALT-OKUMA "Ana arsiv ozeti" (LAN Faz 5). `remote_stats()` sayaclarini
// gosterir: embedli/toplam (semantik aranabilirlik), RAG-indeksli/toplam, chunk/klasor sayilari,
// model-hazir rozeti.
//
// ⚠️ H2 dersi (gorev karari): uzak Pano YALNIZ indeks sayaclari gosterir — TETIKLEYICI/grafik/
// onay-kuyrugu YOK (yerel Pano'daki embed/RAG/vision "calistir" kartlari uzakta ANLAMSIZ: indeksi
// host insa etti, istemci yazamaz). Yerel Pano (DashboardView) aynen kalir; bu yalniz remote dali.
//
// Renderer DB tutmaz; `useIpcQuery` ile `remote_stats` komutu cagrilir. Hata TIPLI token ise
// (network_error/timeout/...) kullaniciya ham token degil yonlendirici mesaj gosterilir.

import { useTranslation } from "react-i18next";

import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { ipc, remoteErrorMessage, type RemoteStatsDto } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { formatNumber } from "../../lib/format";
import { useUiStore } from "../../store/useUiStore";
import { StatCard } from "./DashboardCharts";
import { toRemoteSummary } from "./remoteStatsView";

/** Etiket + "X / N" + oran cubugu (SemanticIndexCard durum-cubugu deseni; salt-okuma). */
function IndexBar({
  label,
  done,
  total,
  pct,
  pending,
  pendingLabel,
}: {
  label: string;
  done: number;
  total: number;
  pct: number;
  pending: number;
  pendingLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-text-primary">{label}</span>
        <span className="text-xs tabular-nums text-text-muted">
          {formatNumber(done)} / {formatNumber(total)}
          {pending > 0 && <span className="ms-2">{pendingLabel}</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className="h-full rounded-full bg-accent transition-all duration-200 motion-reduce:transition-none"
          style={{ inlineSize: `${pct}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

export function RemoteArchiveSummary() {
  const { t } = useTranslation();
  // Eslesme degisince (baglan/kes) yeniden yokla — bayat sayac kalmasin.
  const remotePairingVersion = useUiStore((s) => s.remotePairingVersion);
  // `dataVersion`: Pano sag-tik menusundeki "Yenile" TUM Pano sorgularini tek yerden tazeler
  // (yerel istatistik + aktivite + bu ozet). Aksi halde menu ogesi burada SAHTE olurdu.
  const dataVersion = useUiStore((s) => s.dataVersion);
  const { data, loading, error, refetch } = useIpcQuery<RemoteStatsDto>(
    () => ipc.remoteStats(),
    [remotePairingVersion, dataVersion],
  );

  // Hata TIPLI token ise yonlendirici mesaj; degilse ham metin (sessiz yutma yok — proje dersi).
  const errorMsg = error ? remoteErrorMessage(error, t) : null;

  const summary = data ? toRemoteSummary(data) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Baslik cubugu — yerel Pano ile gorsel tutarli + salt-okuma rozeti (neden "eksik" degil). */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h2 className="font-display text-sm font-semibold text-text-primary">
          {t("remote_stats.title")}
        </h2>
        <span className="ms-auto rounded-md bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-muted">
          {t("archive_source.read_only")}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="p-4">
            <Spinner label={t("list.loading")} />
          </div>
        )}

        {errorMsg && !loading && (
          <div className="flex items-center gap-3 p-4 text-sm text-danger">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={refetch}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
            >
              {t("common.retry")}
            </button>
          </div>
        )}

        {!loading && !errorMsg && summary && summary.assetCount === 0 && (
          <div className="p-4">
            <EmptyState title={t("remote_stats.empty")} hint={t("remote_stats.empty_hint")} />
          </div>
        )}

        {!loading && !errorMsg && summary && summary.assetCount > 0 && (
          <div className="flex flex-col gap-6 p-4">
            {/* Ozet sayac kartlari */}
            <div className="flex flex-wrap gap-3">
              <StatCard
                label={t("remote_stats.total_assets")}
                value={formatNumber(summary.assetCount)}
              />
              <StatCard
                label={t("remote_stats.folders")}
                value={formatNumber(summary.folderCount)}
              />
              <StatCard
                label={t("remote_stats.chunks")}
                value={formatNumber(summary.chunkCount)}
              />
            </div>

            {/* Model hazir degil → net uyari (uzak semantik/RAG calismaz). */}
            {!summary.modelReady && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                {t("remote_stats.model_missing")}
              </p>
            )}

            <section className="flex flex-col gap-3">
              <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-muted">
                {t("remote_stats.index_section")}
              </h3>
              <div className="glass flex flex-col gap-4 p-4">
                <IndexBar
                  label={t("remote_stats.embedded")}
                  done={summary.embedded}
                  total={summary.assetCount}
                  pct={summary.embeddedPct}
                  pending={summary.pendingEmbed}
                  pendingLabel={t("remote_stats.pending", { count: summary.pendingEmbed })}
                />
                <IndexBar
                  label={t("remote_stats.rag_indexed")}
                  done={summary.chunkedAssets}
                  total={summary.assetCount}
                  pct={summary.chunkedPct}
                  pending={summary.pendingChunk}
                  pendingLabel={t("remote_stats.pending", { count: summary.pendingChunk })}
                />
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
