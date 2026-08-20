// Bağlam menülerinde sunulan GÖRÜNÜM listesi — tek kaynak.
//
// Gezgin boş-alan menüsü ile Pano menüsü aynı üçlüyü sunar (H2 pariti: gezgin · teknik · pano).
// Liste iki yerde ayrı yazılsaydı biri genişleyip öteki eskirdi; menüler arası tutarsız bir
// "nereye gidebilirim" listesi kullanıcı için kırık görünür.
//
// ⚠️ `folders`/`chat`/`map` bilinçli olarak YOK: bu üçü sol kenar çubuğunun kendi girişleridir ve
// bağlam menüsünde "içerik görünümü değiştir" anlamı taşımazlar.

import type { ViewMode } from "../../store/useUiStore";

export const MENU_VIEW_MODES: { mode: ViewMode; labelKey: string }[] = [
  { mode: "explorer", labelKey: "view.explorer" },
  { mode: "technical", labelKey: "view.technical" },
  { mode: "dashboard", labelKey: "view.dashboard" },
];
