// Favori yildizi — kart + detay paylasimi (DRY). Editor: tikla-degistir; viewer: gosterge.
// İyimser override store'da; gerçek yetki Rust command'da.

import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
import { useToggleFavorite } from "../../hooks/useToggleFavorite";
import { useUiStore } from "../../store/useUiStore";

interface Props {
  assetId: number;
  favorite: boolean; // server degeri (override store'da uygulanir)
  className?: string;
}

export function FavoriteButton({ assetId, favorite, className = "" }: Props) {
  const { t } = useTranslation();
  const { canWrite: canEdit } = useSession(); // rol sunucu oturumundan
  const override = useUiStore((s) => s.favoriteOverrides[assetId]);
  const toggle = useToggleFavorite();
  const on = override ?? favorite;

  if (!canEdit) {
    return on ? (
      <span className={`leading-none text-warning ${className}`} aria-hidden="true">
        ★
      </span>
    ) : null;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle(assetId, on);
      }}
      aria-label={t(on ? "detail.remove_favorite" : "detail.add_favorite")}
      className={`leading-none transition ${on ? "text-warning" : "text-text-muted hover:text-warning"} ${className}`}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
