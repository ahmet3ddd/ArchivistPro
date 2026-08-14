// Ust arac cubugu (TopBar) — H2 bilgi-mimarisi pariti. Tum post-login ust kontrolleri
// burada toplanir; hicbir mevcut islev kaybolmaz. Tema revizyonu DEGIL (Faz 8) — mevcut
// koyu Tailwind stili korunur. Bilesen alt-parcalara bolunmustur (<500 satir kurali).
//
// Yerlesim (H2 TopBar sekli):
//   Sira 1: baslik · arama · (geri/ileri) · cop
//   Sira 2: kaynak · sonuc-sayaci · aktif-filtre cipleri · kart-boyutu
//   Arşiv yönetimi artık sol Arşiv panelindedir.
//
// Gorunum-secici (eski ViewSwitcher) + gelismis-arama araclari (eski AdvancedSearchMenu) +
// Ayarlar artik SOL SERIT'te (ActivityBar). Arac/Ayarlar modallari HALA burada render edilir
// (mevcut "Ayarlar'a geri don" mantigi ile) — serit yalniz `overlayRequest` sinyali birakir,
// asagidaki effect tuketip ilgili modal'i acar.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppVersion } from "../../hooks/useAppVersion";
import { useAssetTotal } from "../../hooks/useAssetTotal";
import { useUiStore } from "../../store/useUiStore";
import { ArchiveSourceSwitcher } from "../explorer/ArchiveSourceSwitcher";
import { SearchBar } from "../search/SearchBar";
import { BackupPanel } from "../backup/BackupPanel";
import { DuplicateFinderPanel } from "../dedup/DuplicateFinderPanel";
import { IngestBackgroundChip } from "../ingest/IngestBackgroundChip";
import { AuditLogPanel } from "../settings/AuditLogPanel";
import { CrashLogPanel } from "../settings/CrashLogPanel";
import { ScanReportsPanel } from "../settings/ScanReportsPanel";
import { SettingsModal } from "../settings/SettingsModal";
import { ShapeSearchModal } from "../shape/ShapeSearchModal";
import { TrashButton } from "../trash/TrashButton";
import { RedoButton, UndoButton } from "../undo/UndoButton";
import { VisualSearchModal } from "../visual/VisualSearchModal";
import { CardSizeSlider } from "./CardSizeSlider";
import { FilterChips } from "./FilterChips";
import { RemoteWriteGate } from "./RemoteWriteGate";

export function TopBar() {
  const { t } = useTranslation();
  const total = useAssetTotal();
  const version = useAppVersion();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Yedek paneli — Ayarlar icindeki "Yedekleri yonet" ile acilir (ayri TopBar dugmesi YOK).
  const [backupOpen, setBackupOpen] = useState(false);
  // Denetim gunlugu paneli (#8) — Ayarlar icindeki "Denetim gunlugunu ac" ile acilir (admin).
  const [auditOpen, setAuditOpen] = useState(false);
  // Crash raporu paneli (P2.5) — Ayarlar icindeki "Crash raporlarini ac" ile acilir (admin).
  const [crashOpen, setCrashOpen] = useState(false);
  // Tarama raporlari paneli (P2.5 ④) — Ayarlar icindeki "Tarama raporlarini ac" ile acilir (admin).
  const [scanReportsOpen, setScanReportsOpen] = useState(false);
  // Kopya Bulucu paneli (P3) — YALNIZ sol serit (ActivityBar) acar (Ayarlar'daki gereksiz kart
  // kaldirildi). Kapaninca "geri don" yok → ayri bir "nereden acildi" bayragi gerekmez.
  const [dedupOpen, setDedupOpen] = useState(false);
  const [dedupSeed, setDedupSeed] = useState(useUiStore.getState().dedupSeed);
  // Sekil Arama modali (Dilim 4) — TopBar'daki ⬡ dugmesiyle acilir (gelismis ARAC; ana aramayi
  // kirletmez — proje ilkesi). Salt-okuma (her rol); gercek gate backend'de yok (arama serbest).
  const [shapeOpen, setShapeOpen] = useState(false);
  // Gorsel Arama modali (CLIP metin→gorsel) — TopBar'daki 🖼️ dugmesiyle acilir (amacli ARAC;
  // ana FTS kutusundan AYRI — H2 disiplini: gorsel/metin harmani ayrildir). Salt-okuma (her rol).
  const [visualOpen, setVisualOpen] = useState(false);

  // Sol serit (ActivityBar) overlay istegini tuket → ilgili modal'i ac. Modal render + "Ayarlar'a
  // geri don" mantigi BURADA kalir; serit yalniz sinyal birakir. Tuketilince istek null'a doner.
  const overlayRequest = useUiStore((s) => s.overlayRequest);
  const consumeOverlayRequest = useUiStore((s) => s.consumeOverlayRequest);
  useEffect(() => {
    if (overlayRequest == null) return;
    switch (overlayRequest) {
      case "settings":
        setSettingsOpen(true);
        break;
      case "visual":
        setVisualOpen(true);
        break;
      case "shape":
        setShapeOpen(true);
        break;
      case "dedup":
        setDedupSeed(useUiStore.getState().dedupSeed);
        setDedupOpen(true);
        break;
    }
    consumeOverlayRequest();
  }, [overlayRequest, consumeOverlayRequest]);

  return (
    <header className="relative z-20 shrink-0 border-b border-border bg-bg-secondary/80 backdrop-blur-md">
      {/* Sira 1: kimlik + gorunum + arama + eylemler + saglik/dil/oturum */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2">
        <h1 className="font-display text-lg font-bold text-accent">{t("app.title")}</h1>
        {/* Soluk surum etiketi — "hangi surum kurulu?" ilk bakista okunur (2026-08-12
            0.1.12/0.1.13 karisikliginin dersi). Cozulmeden/Tauri disinda hic cizilmez. */}
        {version != null && (
          <span className="self-start text-[10px] leading-5 text-text-muted" dir="ltr">
            v{version}
          </span>
        )}
        <div className="min-w-[12rem] flex-1">
          <SearchBar />
        </div>

        {/* Geri Al + Ileri Al (P2.5 — ETKIN). Gorunum-secici + gelismis-arama araclari + Ayarlar
            artik sol serit'te (ActivityBar); arac/Ayarlar modallari asagida burada render edilir. */}
        {/* Geri/Ileri Al + Cop YEREL arsive isler → uzakta kilitli (RemoteWriteGate). */}
        <RemoteWriteGate className="flex items-center gap-1">
          <UndoButton />
          <RedoButton />
        </RemoteWriteGate>

        <div className="ms-auto flex items-center gap-3">
          {/* Arka plandaki tarama — yalniz kosarken ve pencere gizliyken cizilir. Kilitli
              yazma dugmelerinin GORUNUR gerekcesi de budur (ipucu "tarama suruyor" der). */}
          <IngestBackgroundChip />
          <RemoteWriteGate>
            <TrashButton />
          </RemoteWriteGate>
        </div>
      </div>

      {/* Sira 2: kaynak + sonuc-sayaci + aktif-filtre cipleri + kart-boyutu */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pb-2">
        {/* LAN Faz 2 — arsiv kaynagi (Bu makine / Ana arsiv). KONUM: 2. siranin basi
            (kullanici karari, canli testte iki kez olculdu: grid icindeyken "zor gorunen bir
            yer" cikti, 1. sirada ise "iyi olmadi"). Burada sonuc sayacinin hemen solunda —
            kaynakla birlikte DEGISEN sayinin yani. Eslesme yoksa VEYA gezgin disindaysak
            render edilmez → tek-makineli kurulumda ust cubuk hic degismez. */}
        <ArchiveSourceSwitcher />
        <span className="shrink-0 text-xs font-medium text-text-secondary">
          {total == null ? t("topbar.counting") : t("topbar.result_count", { count: total })}
        </span>
        <span className="hidden h-4 w-px bg-border sm:inline-block" />
        <FilterChips />
        <div className="ms-auto flex items-center gap-3">
          {/* Kart boyutu bir GORUNUM denetimi (arsive yazmaz) → uzakta da acik kalir. */}
          <CardSizeSlider />
        </div>
      </div>

      {/* Merkezi Ayarlar modali (portal'li — header backdrop-blur tuzagindan kacar). */}
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenBackup={() => {
            setSettingsOpen(false);
            setBackupOpen(true);
          }}
          onOpenAudit={() => {
            setSettingsOpen(false);
            setAuditOpen(true);
          }}
          onOpenCrash={() => {
            setSettingsOpen(false);
            setCrashOpen(true);
          }}
          onOpenScanReports={() => {
            setSettingsOpen(false);
            setScanReportsOpen(true);
          }}
        />
      )}
      {/* Ayarlar'dan acilan tam-genislik paneller: kapaninca Ayarlar'a GERI don (kullanici
          oradan geldi; ⑨ sekme-durumu localStorage'da kalici → birakilan sekmede acilir).
          Bu instance'lar YALNIZ Ayarlar'dan acilir → kosulsuz geri-donus dogru. (Kopya Bulucu
          ISTISNA: yalniz sol serit/ActivityBar acar → geri-donus YOK; asagidaki instance kosulsuz
          kapanir.) */}
      {/* Yedek yonetim paneli — Ayarlar'daki "Yedekleri yonet" acar. */}
      {backupOpen && (
        <BackupPanel
          onClose={() => {
            setBackupOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {/* Denetim gunlugu paneli (#8) — Ayarlar'daki "Denetim gunlugunu ac" acar (admin). */}
      {auditOpen && (
        <AuditLogPanel
          onClose={() => {
            setAuditOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {/* Crash raporu paneli (P2.5) — Ayarlar'daki "Crash raporlarini ac" acar (admin). */}
      {crashOpen && (
        <CrashLogPanel
          onClose={() => {
            setCrashOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {/* Tarama raporlari paneli (P2.5 ④) — Ayarlar'daki "Tarama raporlarini ac" acar (admin). */}
      {scanReportsOpen && (
        <ScanReportsPanel
          onClose={() => {
            setScanReportsOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {/* Kopya Bulucu paneli (P3) — sol serit (ActivityBar) acar; kapaninca kosulsuz kapanir. */}
      {dedupOpen && (
        <DuplicateFinderPanel seed={dedupSeed} onClose={() => setDedupOpen(false)} />
      )}
      {/* Sekil Arama modali (Dilim 4) — TopBar ⬡ dugmesi acar (gelismis arac). */}
      {shapeOpen && <ShapeSearchModal onClose={() => setShapeOpen(false)} />}
      {/* Gorsel Arama modali (CLIP metin→gorsel) — Gelismis Arama menusunun 🖼️ ogesi acar. */}
      {visualOpen && <VisualSearchModal onClose={() => setVisualOpen(false)} />}
    </header>
  );
}
