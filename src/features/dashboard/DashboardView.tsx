// Pano gorunumu (Faz 7.3 — H2 DashboardView pariti). Arsiv ozet istatistikleri:
// ozet kartlari + basit grafikler. Bir uzanti cubuguna tiklayinca o uzantiyi
// filtreler (`setExt`) ve baglam-once gezinme explorer'a gecer (sonuc grid'de).
//
// SAG-TIK: Pano'nun kendi baglam menusu (`DashboardContextMenu`). Oncesinde burada HIC handler
// yoktu → WebView2'nin tarayici menusu aciliyordu ("Yeniden yukle / Farkli kaydet / Kaynagi
// goruntule"; kullanici bulgusu 2026-08-20). Menu UZAK arsiv ozetinde de calisir (ayni sarmalayici).
//
// Veri: `dashboardStats()` — toplam sayi/boyut + uzanti dagilimi + son-12-ay serisi.
// Renderer DB tutmaz; sorgu-hook (useIpcQuery) ile komut cagrilir; `dataVersion`
// artinca (ingest) tazelenir. Grafikler saf CSS/div (recharts YOK; yeni npm dep YOK).

import { useTranslation } from "react-i18next";

import type { ActivitySummary, DashboardStatsDto } from "../../ipc/client";
import { EmptyState } from "../../components/EmptyState";
import { Spinner } from "../../components/Spinner";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useSession } from "../../hooks/useSession";
import { basename, formatBytes, formatNumber } from "../../lib/format";
import { anyFilterActive, useUiStore } from "../../store/useUiStore";
import { approvalStatusLabel } from "../assets/detail/projectStatus";
import {
  ActivityPanel,
  AiFacetDistribution,
  ApprovalQueue,
  ExtDistribution,
  MonthlyGrowth,
  SizeByFormat,
  StatCard,
} from "./DashboardCharts";
import { ViewContextMenu, type ViewMenuItem } from "../shell/ViewContextMenu";
import { useViewContextMenu } from "../shell/useViewContextMenu";
import { RemoteArchiveSummary } from "./RemoteArchiveSummary";

export function DashboardView() {
  const { t } = useTranslation();
  const setExt = useUiStore((s) => s.setExt);
  const setApprovalStatus = useUiStore((s) => s.setApprovalStatus);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const clearFilters = useUiStore((s) => s.clearFilters);
  const setPathPrefix = useUiStore((s) => s.setPathPrefix);
  const ignoredFilterActive = useUiStore((s) =>
    anyFilterActive({ ...s, pathPrefix: null }),
  );
  const dataVersion = useUiStore((s) => s.dataVersion);
  const bumpData = useUiStore((s) => s.bumpData);
  // Klasor kapsami (Klasorler → sag-tik → "Pano'da ac" pathPrefix ayarlar). null → tum arsiv.
  const pathPrefix = useUiStore((s) => s.pathPrefix);
  // LAN Faz 5: uzak (ana) arsivdeyken Pano SALT-OKUMA "Ana arsiv ozeti" cizer (remote_stats).
  // Yerel indeksleme/AI tetikleyici kartlari uzakta anlamsiz → ayri, sade sayac gorunumu.
  const remoteSource = useUiStore((s) => s.assetSource === "remote");

  const { isAdmin } = useSession(); // gorunum-only; gercek yetki Rust'ta (require_admin)

  const { data, loading, error, refetch } = useIpcQuery<DashboardStatsDto>(
    () => ipc.dashboardStats(pathPrefix),
    [dataVersion, pathPrefix],
  );

  // Son 7 gun aktivite ozeti — YALNIZ admin + yerel arsiv (backend require_admin; uzak arsivde
  // yerel audit anlamsiz). Aksi halde null → panel cizilmez (viewer/editor backend hatasi almaz).
  const { data: activity } = useIpcQuery<ActivitySummary | null>(
    () => (isAdmin && !remoteSource ? ipc.dashboardActivity() : Promise.resolve(null)),
    [isAdmin, remoteSource, dataVersion],
  );

  // Pano yalniz pathPrefix'i hesaplar. Diger filtreleri drill-down oncesi temizleyip
  // klasor kapsamını geri koyariz; grafik sayisi ile Explorer sonucu boyle ayni kalir.
  const clearNonScopeFilters = () => {
    const scope = useUiStore.getState().pathPrefix;
    clearFilters();
    if (scope != null) setPathPrefix(scope);
  };

  // Sag-tik menusu (konum + secim) — dort gorunumun paylastigi kanca.
  const { menu, open: openMenu, close: closeMenu } = useViewContextMenu();

  const selectExt = (value: string) => {
    clearNonScopeFilters();
    setExt([value]); // dashboard drill-down: filtreyi tek uzantiya AYARLA (cok-degerli → tek)
    setViewMode("explorer");
  };

  const selectApprovalStatus = (value: string) => {
    clearNonScopeFilters();
    setApprovalStatus([value]);
    setViewMode("explorer");
  };

  // Menu her iki dalda da ayni: Pano'nun yapabildikleri (gorunum degistir · yenile · kapsam/filtre
  // temizle) uzak ozet gorunumunde de gecerlidir. "Yenile" `bumpData` ile TUM Pano sorgularini
  // (yerel istatistik + aktivite + uzak ozet) tazeler.
  // Pano SALT-GOSTERIM: menude "sil/tasi/etiketle" gibi yazma ogesi YOK. Ucu de yalniz ANLAMLI
  // olduklarinda cizilir (kapsam yoksa "kapsami kaldir" yok — sahte oge yasak).
  const menuItems: ViewMenuItem[] = [
    { label: t("context.refresh"), testId: "dashboard-context-refresh", onClick: bumpData },
  ];
  if (pathPrefix) {
    menuItems.push({
      label: t("dashboard.ctx.clear_scope", { name: basename(pathPrefix) }),
      testId: "dashboard-context-clear-scope",
      onClick: () => setPathPrefix(null),
    });
  }
  if (ignoredFilterActive) {
    menuItems.push({
      label: t("dashboard.clear_other_filters"),
      testId: "dashboard-context-clear-filters",
      onClick: clearNonScopeFilters,
    });
  }
  const contextMenu = menu && (
    <ViewContextMenu
      x={menu.x}
      y={menu.y}
      selectedText={menu.text}
      onClose={closeMenu}
      sectionTitle={t("dashboard.title")}
      items={menuItems}
      testId="dashboard-context-menu"
      ariaLabel={t("dashboard.ctx.aria_label")}
    />
  );

  // Uzak arsivdeyken salt-okuma "Ana arsiv ozeti" (yukaridaki yerel `dashboardStats` sorgusu
  // remote'ta cizilmez — hook'lar kosulsuz cagrilir; yalniz RENDER dallanir → hook kurali korunur).
  if (remoteSource) {
    return (
      <div
        data-testid="dashboard-view"
        className="flex h-full flex-col"
        onContextMenu={openMenu}
      >
        <RemoteArchiveSummary />
        {contextMenu}
      </div>
    );
  }

  return (
    <div data-testid="dashboard-view" className="flex h-full flex-col" onContextMenu={openMenu}>
      {/* Baslik cubugu — FoldersView/AssetGrid arac cubugu ile gorsel tutarli */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h2 className="font-display text-sm font-semibold text-text-primary">{t("dashboard.title")}</h2>
        {/* Kapsam gostergesi: klasor-kapsamli mi (pathPrefix) yoksa tum arsiv mi. */}
        <span
          className="ms-auto truncate text-xs text-text-muted"
          dir={pathPrefix ? "ltr" : undefined}
          title={pathPrefix ?? undefined}
        >
          {pathPrefix
            ? t("dashboard.scope_folder", { name: basename(pathPrefix) })
            : t("dashboard.scope_global")}
        </span>
      </div>

      {ignoredFilterActive && (
        <div
          role="status"
          className="flex items-center gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-text-secondary"
        >
          <span>{t("dashboard.filters_ignored")}</span>
          <button
            type="button"
            onClick={clearNonScopeFilters}
            className="ms-auto shrink-0 rounded border border-warning/40 px-2 py-1 font-medium text-text-primary transition hover:bg-warning/10"
          >
            {t("dashboard.clear_other_filters")}
          </button>
        </div>
      )}

      {/* Govde (kaydirilabilir) */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <div className="p-4">
            <Spinner label={t("list.loading")} />
          </div>
        )}
        {error && !loading && (
          <div className="flex items-center gap-3 p-4 text-sm text-danger">
            <span>{t("list.error", { message: error })}</span>
            <button
              type="button"
              onClick={refetch}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary"
            >
              {t("common.retry")}
            </button>
          </div>
        )}
        {!loading && !error && data && data.total_assets === 0 && (
          <div className="p-4">
            <EmptyState title={t("dashboard.empty")} hint={t("dashboard.empty_hint")} />
          </div>
        )}
        {!loading && !error && data && data.total_assets > 0 && (
          <div className="flex flex-col gap-6 p-4">
            {/* Ozet kartlari (H2 5-kart satiri: toplam · aktif proje · boyut · indeks · tur) */}
            <div className="flex flex-wrap gap-3">
              <StatCard
                label={t("dashboard.total_assets")}
                value={formatNumber(data.total_assets)}
              />
              <StatCard
                label={t("dashboard.active_projects")}
                value={formatNumber(data.active_projects)}
              />
              <StatCard label={t("dashboard.total_size")} value={formatBytes(data.total_size)} />
              {/* Metin-kapsam: "N / M" (icerikten aranabilir / toplam) — recall gorunurlugu */}
              <StatCard
                label={t("dashboard.indexed")}
                value={`${formatNumber(data.indexed_assets)} / ${formatNumber(data.total_assets)}`}
              />
              <StatCard
                label={t("dashboard.file_types")}
                value={formatNumber(data.ext_counts.length)}
              />
            </div>

            {/* Uzanti dagilimi (tiklayinca explorer'a filtreli gec) */}
            <Section title={t("dashboard.by_ext")}>
              <ExtDistribution
                items={data.ext_counts}
                noExtLabel={t("dashboard.no_ext")}
                onSelectExt={selectExt}
              />
            </Section>

            {/* Format-bazli boyut (H2 sizeByFormat; tiklayinca explorer'a filtreli gec) */}
            {data.size_by_ext.length > 0 && (
              <Section title={t("dashboard.size_by_format")}>
                <SizeByFormat
                  items={data.size_by_ext}
                  noExtLabel={t("dashboard.no_ext")}
                  onSelectExt={selectExt}
                />
              </Section>
            )}

            {/* Aylik buyume (son 12 ay; tiklama yok — tarih kovasi filtresi yok) */}
            <Section title={t("dashboard.growth")}>
              {data.month_counts.length > 0 ? (
                <MonthlyGrowth items={data.month_counts} />
              ) : (
                <p className="text-xs text-text-muted">{t("dashboard.growth_empty")}</p>
              )}
            </Section>

            {data.approval_counts.length > 0 && (
              <Section title={t("dashboard.approval_queue")}>
                <p className="mb-3 text-xs text-text-muted">{t("dashboard.approval_queue_hint")}</p>
                <ApprovalQueue
                  items={data.approval_counts}
                  labelFor={(value) => approvalStatusLabel(value, t)}
                  onSelectStatus={selectApprovalStatus}
                />
              </Section>
            )}

            {(data.architectural_styles.length > 0 || data.material_groups.length > 0) && (
              <div className="grid gap-6 lg:grid-cols-2">
                {data.architectural_styles.length > 0 && (
                  <Section title={t("dashboard.architectural_styles")}>
                    <AiFacetDistribution items={data.architectural_styles} />
                  </Section>
                )}
                {data.material_groups.length > 0 && (
                  <Section title={t("dashboard.material_groups")}>
                    <AiFacetDistribution items={data.material_groups} />
                  </Section>
                )}
              </div>
            )}

            {/* Son 7 gun aktivite (H2 AdminActivityPanel) — YALNIZ admin + veri varsa. total_ops 0
                ise (H2 gibi) hic gosterilmez. Salt-gosterim (drill yok); backend admin-gate'li. */}
            {isAdmin && activity && activity.total_ops > 0 && (
              <Section title={t("dashboard.activity.title")}>
                <ActivityPanel
                  data={activity}
                  totalOpsText={t("dashboard.activity.total_ops", { count: activity.total_ops })}
                  usersTitle={t("dashboard.activity.top_users")}
                  actionsTitle={t("dashboard.activity.top_actions")}
                />
              </Section>
            )}

            {/* NOT: AI indeks/analiz kartlari (Semantik/Gorsel/RAG/Vision) Ayarlar → "AI" altina
                tasindi (arac/yonetim kontrolleri → Ayarlar'a ait; Pano = genel bakis). 2026-06-22. */}
          </div>
        )}
      </div>
      {contextMenu}
    </div>
  );
}

/** Pano bolumu — baslik + icerik (uzanti dagilimi / aylik buyume cercevesi). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
      <div className="glass p-4">{children}</div>
    </section>
  );
}
