// Tarama penceresinin UYGULAMA-DUZEYI barinagi.
//
// NEDEN AYRI BIR BILESEN (kullanici bulgusu 2026-08-11 20:09 — "yine iki pencere cikiyor"):
// `IngestModal` eskiden `IngestButton`'in icinde render ediliyordu, o da sol Arsiv panelinde
// (`ArchiveManagementPanel`). O panel `if (!open) return null` ile KAPANINCA tum alt agac
// sokuluyordu → KOSAN taramanin penceresi yok oluyordu. Tarama backend'de devam ediyor, ama:
//   · ilerleme/Durdur erisilemez hale geliyor,
//   · `ingestFolders` sozunu bekleyen bilesen olmadigi icin RAPOR kayboluyor,
//   · panel yeniden acilinca SIFIRDAN bir pencere kuruluyor (`stage="options"`) ve kullanici
//     bunu "ikinci pencere" / "tarama bitmis" diye okuyordu.
// Ayrica panelin Escape dinleyicisi "acik diyalog var mi" diye DOM'da `[role="dialog"]` ariyor;
// pencere ARKA PLANDAYKEN hicbir sey cizmedigi icin bulamiyor → Escape paneli kapatiyor →
// arka plandaki tarama penceresi de birlikte olurdu. Iki kusur da ayni kokten: uzun-omurlu bir
// modal, katlanabilir bir yan panelin cocugu olamaz.
//
// COZUM: pencere `AppShell`'de (uygulama koku) yasar; TETIK panelde kalir (`IngestButton`).
// Boylece panel/gorunum degisimleri pencereyi ETKILEMEZ — omru yalniz store'daki `ingestOpen`
// belirler. Tek ornek garantisi de buradan gelir: tek barinak → tek `IngestModal`.

import { useUiStore } from "../../store/useUiStore";
import { IngestModal } from "./IngestModal";

export function IngestHost() {
  const ingestOpen = useUiStore((s) => s.ingestOpen);
  const pendingIngestPaths = useUiStore((s) => s.pendingIngestPaths);
  const closeIngest = useUiStore((s) => s.closeIngest);
  const ingestMinimized = useUiStore((s) => s.ingestMinimized);
  const setIngestMinimized = useUiStore((s) => s.setIngestMinimized);

  if (!ingestOpen) return null;

  // Arka plandayken de MOUNTLU kalir (yalniz `minimized` ile gizlenir) — kosan taramanin
  // sozu/zamanlayicilari ve raporu bu bilesende yasar; sokup takmak raporu kaybettirir.
  return (
    <IngestModal
      initialPaths={pendingIngestPaths ?? undefined}
      onClose={closeIngest}
      minimized={ingestMinimized}
      onMinimize={() => setIngestMinimized(true)}
    />
  );
}
