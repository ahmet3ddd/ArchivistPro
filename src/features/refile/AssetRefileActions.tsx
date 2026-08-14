// Tekil asset dosya-yonetim eylemleri (detay ust baslik; ADMIN) — "Yeniden adlandir" + "Tasi".
//
// ProtectedAction require="admin" (hidden): viewer/editor GORMEZ; gercek yetki Rust'ta (UI yalniz
// gorunum). "Yeniden adlandir" → RenameModal. "Tasi" → useRefileMove (klasor-secici → refileAssets
// [id]). Ikisi de basari sonrasi `onChanged` (detay refetch + grid bumpData). i18n zorunlu.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { ProtectedAction } from "../../permissions";
import { RenameModal } from "./RenameModal";
import { useRefileMove } from "./useRefileMove";

interface Props {
  assetId: number;
  fileName: string;
  /** Basarili yeniden-adlandir/tasi sonrasi (detay refetch + grid tazeleme). */
  onChanged: () => void;
}

export function AssetRefileActions({ assetId, fileName, onChanged }: Props) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const { moving, progress, move } = useRefileMove(onChanged);

  const btn =
    "flex-1 rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary transition hover:border-border-hover disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <ProtectedAction require="admin">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setRenaming(true)} disabled={moving} className={btn}>
          {t("refile.rename")}
        </button>
        <button type="button" onClick={() => void move([assetId])} disabled={moving} className={btn}>
          {moving ? t("refile.moving", progress) : t("refile.move")}
        </button>
      </div>
      {renaming && (
        <RenameModal
          assetId={assetId}
          currentName={fileName}
          onClose={() => setRenaming(false)}
          onDone={onChanged}
        />
      )}
    </ProtectedAction>
  );
}
