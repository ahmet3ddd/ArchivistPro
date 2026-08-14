// Ana gorunum yonlendiricisi — aktif `viewMode`'a gore gorunumu render eder.
//   explorer  → mevcut sanallastirilmis AssetGrid (cardSize store'dan okunur)
//   folders   → FoldersView (STUB · Faz 7.2)
//   dashboard → DashboardView (STUB · Faz 7.3)
//   technical → TechnicalView (STUB · Faz 7.4)
//
// Baglam-once gezinme (H2 pariti): bir filtre/arama AKTIFLESINCE explorer'a otomatik
// gecilir (filtreli sonuc her zaman grid'de gosterilir). Filtre temizlenince kullaniciyi
// zorla baska gorunume tasimayiz — secici ile istedigi gorunumde kalir.

import { lazy, Suspense, useEffect, useRef } from "react";

import { AssetGrid } from "../assets/AssetGrid";
import { Spinner } from "../../components/Spinner";
import { anyFilterActive, useUiStore } from "../../store/useUiStore";

const ChatView = lazy(() =>
  import("../chat/ChatView").then((module) => ({ default: module.ChatView })),
);
const DashboardView = lazy(() =>
  import("../dashboard/DashboardView").then((module) => ({ default: module.DashboardView })),
);
const FoldersView = lazy(() =>
  import("../folders/FoldersView").then((module) => ({ default: module.FoldersView })),
);
const TechnicalView = lazy(() =>
  import("../technical/TechnicalView").then((module) => ({ default: module.TechnicalView })),
);
const MapView = lazy(() =>
  import("../map/MapView").then((module) => ({ default: module.MapView })),
);
export function MainViewContainer() {
  const viewMode = useUiStore((s) => s.viewMode);
  const setViewMode = useUiStore((s) => s.setViewMode);
  const filterActive = useUiStore(anyFilterActive);

  // Baglam-once: filtre/arama "kapali → acik" gecisinde explorer'a gec (yalniz yukselen
  // kenar; aksi halde kullanici explorer'dayken stub'a tikladiginda filtre acikken geri
  // zorlanirdi). prev ref ile yalniz gecis aninda tetiklenir.
  //
  // ANCAK yalniz "sonuc GOSTERMEYEN" gorunumlerden (folders/chat) kacir. explorer/technical/
  // dashboard zaten pathPrefix+filtreleri yansitir → Klasorler sag-tik menusunden "Teknik/Pano'da
  // ac" secilince (setPathPrefix + setViewMode ayni tikta) bu efekt secili gorunumu explorer'a
  // GERI zorlamamali. Efekt-ani viewMode'u store'dan taze okunur (o tikta zaten commit'li).
  const prevActive = useRef(filterActive);
  useEffect(() => {
    const current = useUiStore.getState().viewMode;
    const escapable = current === "folders" || current === "chat";
    if (filterActive && !prevActive.current && escapable) {
      setViewMode("explorer");
    }
    prevActive.current = filterActive;
  }, [filterActive, setViewMode]);

  let view;
  switch (viewMode) {
    case "folders":
      view = <FoldersView />;
      break;
    case "dashboard":
      view = <DashboardView />;
      break;
    case "map":
      view = <MapView />;
      break;
    case "technical":
      view = <TechnicalView />;
      break;
    case "chat":
      view = <ChatView />;
      break;
    case "explorer":
    default:
      return <AssetGrid />;
  }

  return (
    <Suspense fallback={<Spinner />}>
      {view}
    </Suspense>
  );
}
