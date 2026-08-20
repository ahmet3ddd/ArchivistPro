// Sol dikey gezinme seridi (activity bar) — H2 "sol serit" pariti. Uygulamanin en solunda,
// tam yukseklik (TopBar + ana alan + StatusBar'in solunda; AppShell kok satir yerlesimi).
// Ikon + etiket dikey istif, uc grup:
//   GORUNUMLER (viewMode): Gezgin / Klasorler / Pano / Sohbet / Teknik → setViewMode (aktif vurgulu).
//   ARACLAR (modal): Gorsel Arama / Kopya Bulucu / Sekil Arama → store.requestOverlay (TopBar acar).
//   ALT (sabit, mt-auto): Yardım → genel yardım penceresi, Ayarlar → requestOverlay("settings").
//
// Serit araclari/Ayarlar'i DOGRUDAN acmaz — modallar TopBar'da render edilir (mevcut "Ayarlar'a
// geri don" mantigi orada). Serit yalniz `overlayRequest` sinyali birakir; TopBar tuketir. Yetki
// UI-only degil: bu araclar salt-okuma (her rol); Ayarlar icindeki admin eylemleri kendi gate'inde.

import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { isRemoteView } from "../../store/assetSource";
import type { OverlayKind, ViewMode } from "../../store/useUiStore";
import { useUiStore } from "../../store/useUiStore";

type IconComponent = () => ReactElement;

// Ikonlar: emoji DEGIL, tek-renkli cizgi SVG (Lucide/Feather stili — ChatSessionSidebar
// deseniyle ayni: viewBox 0 0 24 24, fill yok, stroke=currentColor, yuvarlak uc). `currentColor`
// oldugundan aktifte beyaza (text-white), pasifte serit metin rengine doner — sabit gri yuzeyle
// tutarli, "pro" gorunum (emoji'nin cok-renkli/platform-bagimli cocuksu havasi kalkti).
/** Ortak SVG govdesi — her ikon yalniz kendi cizgilerini verir. */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

// — Gorunum ikonlari —
/** Gezgin: ana varlik izgarasi (layout-grid). */
const ExplorerIcon: IconComponent = () => (
  <Glyph>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Glyph>
);
/** Klasorler: agac/dizin (folder). */
const FoldersIcon: IconComponent = () => (
  <Glyph>
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
  </Glyph>
);
/** Pano: ozet/istatistik (bar-chart). */
const DashboardIcon: IconComponent = () => (
  <Glyph>
    <path d="M3 3v18h18" />
    <rect x="7" y="12" width="3" height="6" rx="0.5" />
    <rect x="12" y="8" width="3" height="10" rx="0.5" />
    <rect x="17" y="5" width="3" height="13" rx="0.5" />
  </Glyph>
);
/** Sohbet: mesaj balonu (message-square). */
const MapIcon: IconComponent = () => <Glyph><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z" /><path d="M9 3v15M15 6v15" /></Glyph>;
const ChatIcon: IconComponent = () => (
  <Glyph>
    <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
  </Glyph>
);
/** Teknik: olcum/cizim (ruler). */
const TechnicalIcon: IconComponent = () => (
  <Glyph>
    <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
    <path d="m8.5 6.5 2 2" />
    <path d="m11.5 9.5 2 2" />
    <path d="m14.5 12.5 2 2" />
  </Glyph>
);

// — Arac ikonlari —
/** Arşiv yönetimi: saklama kutusu. */
const ArchiveIcon: IconComponent = () => (
  <Glyph>
    <path d="M4 7h16v13H4Z" />
    <path d="M3 3h18v4H3Z" />
    <path d="M9 11h6" />
  </Glyph>
);
/** Gorsel Arama: gorsel (image). */
const VisualIcon: IconComponent = () => (
  <Glyph>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.6" />
    <path d="m21 15-4.5-4.5a2 2 0 0 0-2.83 0L4 20" />
  </Glyph>
);
/** Kopya Bulucu: cift-kare (copy). */
const DuplicateIcon: IconComponent = () => (
  <Glyph>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Glyph>
);
/** Sekil Arama: ucgen+kare+daire (shapes). */
const ShapeIcon: IconComponent = () => (
  <Glyph>
    <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <circle cx="17.5" cy="17.5" r="3.5" />
  </Glyph>
);
/** Ayarlar: disli (settings). */
const SettingsIcon: IconComponent = () => (
  <Glyph>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
    <circle cx="12" cy="12" r="3" />
  </Glyph>
);
/** Yardım: soru işaretli daire. Genel yardım penceresini açar. */
const HelpIcon: IconComponent = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.8 9a2.35 2.35 0 1 1 3.66 1.96c-.9.63-1.46 1.05-1.46 2.04" />
    <path d="M12 16.5h.01" />
  </Glyph>
);

/** Gorunum ogeleri (setViewMode ile aktif-vurgulu; MainViewContainer yonlendirir). */
const VIEWS: { mode: ViewMode; Icon: IconComponent; labelKey: string }[] = [
  { mode: "explorer", Icon: ExplorerIcon, labelKey: "view.explorer" },
  { mode: "folders", Icon: FoldersIcon, labelKey: "view.folders" },
  { mode: "dashboard", Icon: DashboardIcon, labelKey: "view.dashboard" },
  // ⚠️ SIRA KULLANICI KARARIDIR (2026-08-20: Teknik ↔ Harita yer degistirdi) — "mantikli" bir
  // siralamaya gore yeniden duzenlenmemeli. Serit sirasi kas hafizasidir; degistirmek kullaniciyi
  // yavaslatir.
  { mode: "technical", Icon: TechnicalIcon, labelKey: "view.technical" },
  { mode: "chat", Icon: ChatIcon, labelKey: "view.chat" },
  { mode: "map", Icon: MapIcon, labelKey: "view.map" },
];

/** Arac ogeleri (modal acan; overlay istegi birakir → TopBar acar). */
const TOOLS: { kind: OverlayKind; Icon: IconComponent; labelKey: string }[] = [
  { kind: "visual", Icon: VisualIcon, labelKey: "rail.tool_visual" },
  { kind: "dedup", Icon: DuplicateIcon, labelKey: "rail.tool_duplicate" },
  { kind: "shape", Icon: ShapeIcon, labelKey: "rail.tool_shape" },
];

const ITEM_BASE =
  "flex w-full flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";
// Sabit-renkli serit: metin de sabit (tema-token'i DEGIL) → orta-gri uzerinde her iki temada okunur.
const ITEM_INACTIVE =
  "text-[var(--color-rail-text)] hover:bg-bg-rail-hover hover:text-[var(--color-rail-text-strong)]";

export function ActivityBar() {
  const { t } = useTranslation();
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const archivePanelOpen = useUiStore((s) => s.archivePanelOpen);
  const setArchivePanelOpen = useUiStore((s) => s.setArchivePanelOpen);
  const assetSource = useUiStore((s) => s.assetSource);
  const requestOverlay = useUiStore((s) => s.requestOverlay);
  const setShortcutHelp = useUiStore((s) => s.setShortcutHelp);
  const lanClientNewCount = useUiStore((s) => s.lanClientNewCount);

  return (
    <nav
      aria-label={t("rail.aria")}
      className="flex h-full w-20 shrink-0 flex-col gap-1 overflow-y-auto border-e border-[var(--color-rail-border)] bg-bg-rail px-1.5 py-2"
    >
      {/* GORUNUMLER */}
      <span className="pt-1 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--color-rail-text-muted)]">
        {t("rail.section_views")}
      </span>
      {VIEWS.map(({ mode, Icon, labelKey }) => {
        const active = viewMode === mode;
        // Uzak (ana) arsiv verisini yalniz REMOTE_ALLOWED_VIEWS gosterebilir → listede olmayan
        // gorunum 'remote' iken KILITLI (gri + ipucu). LAN Faz 5'te Sohbet + Pano da uzaklastigi
        // icin su an TUM gorunumler uzak-uyumlu (kilit tetiklenmez); mekanizma ileride uzak-disi bir
        // gorunum eklenirse guvenli kalsin diye durur. Bkz useUiStore.setAssetSource invariant'i.
        const remoteLocked = assetSource === "remote" && !isRemoteView(mode);
        return (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setViewMode(mode);
              setArchivePanelOpen(false);
            }}
            disabled={remoteLocked}
            aria-current={active ? "page" : undefined}
            title={remoteLocked ? t("view.remote_only_hint") : t(labelKey)}
            className={`${ITEM_BASE} ${active ? "bg-accent text-white" : ITEM_INACTIVE} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
          >
            <Icon />
            <span className="w-full break-words text-center">{t(labelKey)}</span>
          </button>
        );
      })}

      <div className="mt-2 border-t border-[var(--color-rail-border)] pt-2">
        <button
          type="button"
          onClick={() => setArchivePanelOpen(!archivePanelOpen)}
          aria-expanded={archivePanelOpen}
          aria-controls="archive-management-panel"
          title={t("archive_panel.rail_label")}
          className={`${ITEM_BASE} ${archivePanelOpen ? "bg-accent text-white" : ITEM_INACTIVE}`}
        >
          <ArchiveIcon />
          <span className="w-full break-words text-center">{t("archive_panel.rail_label")}</span>
        </button>
      </div>
      {/* ARACLAR — gorunumlerden ince cizgi ile ayrilir */}
      <span className="mt-2 border-t border-[var(--color-rail-border)] pt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-[var(--color-rail-text-muted)]">
        {t("rail.section_tools")}
      </span>
      {/* Araclar YEREL arsivde calisir (gorsel kNN · kopya gruplari · sekil) — host'ta karsilik
          ucu YOK. Uzakta acik birakilirsa sonuclar yerel arsivden gelir AMA sonuca tiklaninca
          `AssetDetailPanel` → `useAssetDetail` global kaynaga gore cozer ⇒ YEREL id ANA ARSIVE
          sorulur → yanlis dosya (sohbet atiflarinda kapatilan sinifin aynisi). Bu yuzden gizlemek
          degil KILITLEMEK: gorunumlerdeki desenin ayni (gri + ipucu).
          ⚠️ Ana arsivin durdugu makinede bu program YEREL kurulur (ana arsiv = yerel arsiv) →
          orada kilit HIC devreye girmez; araclar tam calisir. Kilit yalniz "baskasinin arsivine
          bakan istemci" durumuna aittir. Host'a araç uclari eklenirse kendiliginden kalkar. */}
      {TOOLS.map(({ kind, Icon, labelKey }) => (
        <button
          key={kind}
          type="button"
          onClick={() => {
            setArchivePanelOpen(false);
            requestOverlay(kind);
          }}
          disabled={assetSource === "remote"}
          title={assetSource === "remote" ? t("rail.tools_remote_hint") : t(labelKey)}
          className={`${ITEM_BASE} ${ITEM_INACTIVE} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent`}
        >
          <Icon />
          <span className="w-full break-words text-center">{t(labelKey)}</span>
        </button>
      ))}

      {/* YARDIM — gorunur giris; '?' kisayoluyla ayni genel pencereyi acar. */}
      <button
        type="button"
        onClick={() => {
          setArchivePanelOpen(false);
          setShortcutHelp(true);
        }}
        title={t("rail.help")}
        className={`${ITEM_BASE} ${ITEM_INACTIVE} mt-auto border-t border-[var(--color-rail-border)] pt-3`}
      >
        <HelpIcon />
        <span className="w-full break-words text-center">{t("rail.help")}</span>
      </button>

      {/* AYARLAR — Yardımın altında, seridin sonunda. */}
      <button
        type="button"
        onClick={() => {
          setArchivePanelOpen(false);
          requestOverlay("settings");
        }}
        title={t("rail.settings")}
        className={`${ITEM_BASE} ${ITEM_INACTIVE} relative`}
      >
        <SettingsIcon />
        <span className="w-full break-words text-center">{t("rail.settings")}</span>
        {lanClientNewCount > 0 && (
          <span
            className="absolute end-1 top-1 rounded-full bg-accent px-1.5 text-[10px] font-bold leading-4 text-white"
            aria-label={t("lan_client.global_new_badge", { count: lanClientNewCount })}
          >
            {lanClientNewCount > 99 ? "99+" : lanClientNewCount}
          </span>
        )}
      </button>
    </nav>
  );
}
