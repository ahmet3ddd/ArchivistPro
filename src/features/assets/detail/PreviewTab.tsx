// Onizleme sekmesi — secili asset'in gorsel onizlemesi (thumbnail; yoksa uzanti ikonu) USTTE,
// altinda cekirdek dosya bilgisi (boyut/tur/olusturma-degisiklik-indeks tarihleri/tam yol) + AI
// gorsel-analizi + Proje-durum bolumu. Eski ayri "Bilgi" sekmesi BU sekmeye BIRLESTIRILDI
// (kullanici istegi: onizlemeyle bilgi tek yerde). Thumbnail data-URI ust panelden gecirilir
// (useThumbnails orada cagrilir); tarih/boyut bicimleme lib/format'tan.

import { useTranslation } from "react-i18next";

import type { AssetDetail } from "../../../ipc/client";
import { extIcon, formatBytes, formatDate } from "../../../lib/format";
import { isVideoExt } from "../../../lib/media";
import { DominantColorPalette } from "../DominantColorPalette";
import { AiVisionSection } from "./AiVisionSection";
import { Field } from "./Field";
import { ProjectSection } from "./ProjectSection";
import { VideoPreview } from "./VideoPreview";

interface Props {
  detail: AssetDetail;
  thumb: string | undefined;
  /** Detay panelinin get_asset refetch'i — AiVisionSection analiz sonrasi ai_ alanlarini tazeler. */
  onRefetch: () => void;
  /** UZAK arsiv (LAN Faz 3): AI analizi gizlenir — analiz YEREL DB'ye yazar, uzak id
   *  baska bir yerel dosyaya AI metadata'si islerdi. */
  readOnly?: boolean;
}

export function PreviewTab({ detail, thumb, onRefetch, readOnly }: Props) {
  const { t } = useTranslation();
  const { asset } = detail;
  const playableVideo = !readOnly && isVideoExt(asset.ext);
  return (
    <div className="flex flex-col gap-3">
      {/* Gorsel onizleme — thumbnail (varsa) buyuk gosterilir; yoksa uzantiya gore ikon fallback */}
      {playableVideo ? (
        <div className="p-2">
          <VideoPreview assetId={asset.id} fileName={asset.file_name} poster={thumb} />
        </div>
      ) : thumb ? (
        <div className="flex items-center justify-center p-2">
          <img
            src={thumb}
            alt={asset.file_name}
            className="max-h-[60vh] w-full rounded-lg border border-border bg-bg-primary/60 object-contain"
          />
        </div>
      ) : (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-2 p-6">
          <span className="text-6xl leading-none" aria-hidden>
            {extIcon(asset.ext)}
          </span>
          <span className="break-all text-center text-xs text-text-muted">{asset.file_name}</span>
        </div>
      )}

      <DominantColorPalette colors={asset.dominant_colors} className="self-center" />

      {/* Cekirdek dosya bilgisi (eski "Bilgi" sekmesi) — yol mantiken-LTR + kirpilir (title = tam yol) */}
      <div className="p-1 text-xs">
        <dl className="space-y-1">
          <Field label={t("detail.size")} value={formatBytes(asset.size_bytes)} />
          <Field label={t("detail.type")} value={asset.ext ?? asset.mime ?? "—"} dir="ltr" />
          <Field label={t("detail.created")} value={formatDate(asset.created_at)} />
          <Field label={t("detail.modified")} value={formatDate(asset.modified_at)} />
          {asset.indexed_at != null && (
            <Field label={t("detail.indexed")} value={formatDate(asset.indexed_at)} />
          )}
          <Field label={t("detail.path")} value={asset.path} dir="ltr" truncate />
        </dl>

        {/* AI gorsel-analizi (GORUNUR + YONETILEBILIR) — cekirdek alanlardan SONRA, proje-durumdan ONCE.
            UZAK arsivde GIZLI: analiz komutu YEREL DB'ye yazar; uzak id ayni numaradaki BASKA bir
            yerel dosyaya AI metadata'si islerdi. */}
        {!readOnly && (
          <AiVisionSection asset={asset} metadata={detail.metadata} onRefetch={onRefetch} />
        )}

        {/* Proje karti uzakta tamamen gizli: alanlar zaten degistirilemiyordu ve dar detay
            panelinde gereksiz yer kapliyordu. Yerelde duzenleme davranisi aynen korunur. */}
        {!readOnly && (
          <ProjectSection
            assetId={asset.id}
            project={detail.project}
            assignedProject={detail.assigned_project}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}
