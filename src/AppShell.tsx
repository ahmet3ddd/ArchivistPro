// Kabuk yerlesimi (Faz 7.1) — H2 bilgi-mimarisi sekli:
//   [ ActivityBar (sol dikey serit: gorunumler + araclar + Ayarlar) |
//     dikey [ TopBar (arama + sonuc/cip/kart-boyutu) · ana sira [ FacetSidebar |
//             MainViewContainer | DetailPanel ] · StatusBar ] ]
//
// Kok yerlesim SATIR: en solda tam-yukseklik ActivityBar; kalani dikey kolon. ActivityBar
// gorunum-secici (eski TopBar ViewSwitcher) + arac tetiklerini (eski AdvancedSearchMenu) +
// Ayarlar'i toplar; MainViewContainer aktif viewMode'a gore gorunumu yonlendirir. FacetSidebar
// yalniz filtrelenebilir sonuc gorunumlerinde, DetailPanel ise yalniz gercek bir secim varken acilir.
//
// Renderer ince: state burada DEGIL (Zustand store + sorgu-hook'lari), DB yok. Yalniz
// kimlik-dogrulanmis + (varsa) parola-degistirme tamamlanmis oturumda render edilir
// (gate App.tsx'te). Rol gorunurluk kararlari sunucu oturumundan (useSession).

import { useEffect } from "react";

import { AssetDetailPanel } from "./features/assets/AssetDetailPanel";
import { useBackupScheduler } from "./features/backup/useBackupScheduler";
import { BgTaskBanner } from "./features/bgtask/BgTaskBanner";
import { FacetSidebar } from "./features/facets/FacetSidebar";
import { AutoIndexBanner } from "./features/indexer/AutoIndexBanner";
import { useAutoIndex } from "./features/indexer/useAutoIndex";
import { DropOverlay } from "./features/ingest/DropOverlay";
import { useOsFolderDrop } from "./features/ingest/useOsFolderDrop";
import { LocationBanner } from "./features/location/LocationBanner";
import { useRecoveryNotice } from "./features/recovery/useRecoveryNotice";
import { migrateWatchRootsToDb } from "./features/roots/migrateWatchRootsToDb";
import { getProcessPriority } from "./features/settings/processPrioritySettings";
import { useStalenessMonitor } from "./features/health/useStalenessMonitor";
import { OnboardingTour } from "./features/onboarding/OnboardingTour";
import { useLanClientBadge } from "./features/settings/useLanClientBadge";
import { ActivityBar } from "./features/shell/ActivityBar";
import { ArchiveManagementPanel } from "./features/shell/ArchiveManagementPanel";
import { IngestHost } from "./features/ingest/IngestHost";
import { MainViewContainer } from "./features/shell/MainViewContainer";
import { HelpCenterPanel } from "./features/shell/HelpCenterPanel";
import { StatusBar } from "./features/shell/StatusBar";
import { TopBar } from "./features/shell/TopBar";
import { useFolderWatcher } from "./features/watch/useFolderWatcher";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useSession } from "./hooks/useSession";
import { ipc } from "./ipc/client";
import { useUiStore } from "./store/useUiStore";

export function AppShell() {
  // Otomatik yedekleme zamanlayicisi — yalniz admin girisliyken aktif (ayar Ayarlar'da).
  const { isAdmin } = useSession();
  const bumpWatchConfig = useUiStore((s) => s.bumpWatchConfig);
  // LAN Faz 2: uzak (ana) arsiv listeleniyor mu — yerel-id'ye dayanan yuzeyleri kapatir.
  const remoteMode = useUiStore((s) => s.assetSource === "remote");
  const viewMode = useUiStore((s) => s.viewMode);
  const archivePanelOpen = useUiStore((s) => s.archivePanelOpen);
  const selectedId = useUiStore((s) => s.selectedId);
  const showFacets = !archivePanelOpen && !remoteMode && (viewMode === "explorer" || viewMode === "technical");
  const showDetail =
    !archivePanelOpen &&
    selectedId != null &&
    (viewMode === "explorer" || viewMode === "technical" || viewMode === "chat" || viewMode === "map");
  useBackupScheduler(isAdmin);
  // Canli izleme (klasor watcher) — yalniz admin; izlenen koklerde degisiklik → toast/oto-tara.
  useFolderWatcher(isAdmin);
  useStalenessMonitor(!remoteMode);
  useLanClientBadge(isAdmin);

  // Makine-yerel süreç önceliği: uygulama yeniden başladıktan sonra kaydedilmiş tercih,
  // ilk admin oturumunda tekrar Windows sürecine uygulanır. Hata burada sessizdir; Ayarlar
  // kartı kullanıcı eyleminde hatayı görünür verir. StrictMode'daki ikinci çağrı zararsızdır.
  useEffect(() => {
    if (!isAdmin) return;
    void ipc.setProcessPriority(getProcessPriority()).catch(() => undefined);
  }, [isAdmin]);

  // localStorage → DB tek-seferlik goc (eski izlenen-kok listesi → scanned_roots). Yalniz admin,
  // bayrakla bir kez; bir sey tasiniysa watcher'i yeni kok kumesiyle yeniden kur (bumpWatchConfig).
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    void migrateWatchRootsToDb().then((migrated) => {
      if (!cancelled && migrated) bumpWatchConfig();
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, bumpWatchConfig]);
  // Acilis kurtarma bildirimi (P2.6) — bozuk-DB tespit/onarim olduysa toast (her rol).
  useRecoveryNotice();
  // P1: tarama-sonrasi otomatik AI indeks olaylarini dinle → banner durumu + ozet toast (her rol).
  useAutoIndex();
  // Faz A: merkezi klavye kisayollari (Ctrl+K // · Ctrl+A · Delete · ? · Escape-fallback).
  useGlobalShortcuts();
  // Faz A: OS klasor surukle-birak (yalniz admin) → IngestModal; suruklerken drop overlay gorunur.
  const dragActive = useOsFolderDrop();

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      {/* Sol dikey gezinme seridi — tam yukseklik, en solda (H2 pariti): gorunumler + araclar + Ayarlar. */}
      <ActivityBar />
      <ArchiveManagementPanel />
      {/* Tarama penceresi UYGULAMA DUZEYINDE yasar: sol panel/gorunum degisimleri kosan
          taramayi (ve raporunu) olduremesin — bkz IngestHost gerekcesi. */}
      <IngestHost />

      {/* Kalan her sey dikey kolon: ust cubuk + banner'lar + ana sira + durum cubugu. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        {/* Slice 2: kaynak dosyalar bu makinede yoksa "uzak lokasyon / onizleme" uyari bari. */}
        <LocationBanner />
        {/* P1: otomatik AI indeksleme kosarken kalici ilerleme bari (isSizken render olmaz). */}
        <AutoIndexBanner />
        {/* Arka-plan tarama/yeniden-indeksleme kosarken global ilerleme bari (her gorunumden gorunur;
            isSizken render olmaz). Oto-rescan/klasor-rescan/reindex burada gorunur. */}
        <BgTaskBanner />

        <main className="flex flex-1 overflow-hidden">
          {/* UZAK arsivdeyken facet kenar cubugu RENDER EDILMEZ: sayimlar YEREL DB'den gelir,
              uzak listenin yaninda gosterilseydi baska bir arsivin sayilarini bu listeye aitmis
              gibi sunardi. (Uzak facet'ler — kullanici karariyla — sonraki is.)

              ⚠️ DETAY PANELI Faz 3'te GERI GELDI: Faz 2'de kapatilmisti cunku `get_asset(id)`
              yerel DB'yi okuyordu (uzak id → BASKA yerel dosya). Artik `useAssetDetail` kaynaga
              gore `remote_get_asset`'e yonleniyor ⇒ panel dogru veriyi gosterir. Uzakta
              SALT-OKUMA acilir (duzenleme alanlari kapali) — yazma komutlari hala yerele gider. */}
          {showFacets && <FacetSidebar />}
          <div className="flex-1 overflow-hidden">
            <MainViewContainer />
          </div>
          {showDetail && <AssetDetailPanel />}
        </main>

        {/* Alt durum cubugu (2026-07-09 UI revizyonu): saglik rozeti + oturum (rol/Kullanicilar/
            Cikis) TopBar sag-ustunden buraya tasindi → ust-cubuk sadeleşti, hesap/durum alta. */}
        <StatusBar />
      </div>

      {/* Yardım Merkezi: sol seritteki Yardım ve '?' ile açılır. */}
      <HelpCenterPanel />
      <OnboardingTour />
      {dragActive && <DropOverlay />}
    </div>
  );
}
