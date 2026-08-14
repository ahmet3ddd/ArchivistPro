// Kart boyutu kaydiraci — explorer grid sutun genisligini (px) ayarlar (store.cardSize).
// H2 pariti: TopBar kart-boyutu kaydiraci. Yalniz explorer gorunumunde anlamli, ama
// TopBar'da hep gosterilir (kullanici onceden ayarlayabilir). Mevcut koyu Tailwind stili.

import { useTranslation } from "react-i18next";

import { useUiStore } from "../../store/useUiStore";

const MIN = 140; // kucuk
const MAX = 320; // buyuk

export function CardSizeSlider() {
  const { t } = useTranslation();
  const cardSize = useUiStore((s) => s.cardSize);
  const setCardSize = useUiStore((s) => s.setCardSize);

  return (
    <label className="flex items-center gap-1.5 text-xs text-text-secondary" title={t("topbar.card_size")}>
      <span aria-hidden className="text-[10px]">▪</span>
      <input
        type="range"
        min={MIN}
        max={MAX}
        step={20}
        value={cardSize}
        onChange={(e) => setCardSize(Number(e.target.value))}
        aria-label={t("topbar.card_size")}
        className="h-1 w-24 cursor-pointer accent-accent"
      />
      <span aria-hidden className="text-base">▪</span>
    </label>
  );
}
