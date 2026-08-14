// Tek bir YOL-REMAP satiri (ArchiveImportModal alt-bileseni; 500-satir sinir bolunmesi).
//
// "eski kok → yeni kok" + "Gözat" (klasor secici). H2 ArchiveImportModal deseninin H3 uyarlamasi:
// her kaynak-kok icin bir satir; kullanici yeni kok girer ya da klasor secer. `newRoot` bos
// birakilirsa backend o kok icin remap uygulamaz (dosyalar arsivdeki yollarinda kalir).

import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

interface Props {
  /** Kaynak (eski) kok — arsivdeki yol on-eki (salt-gosterim; LTR). */
  oldRoot: string;
  /** Bu kok altindaki asset sayisi (varsa; sourceRoots'tan). samplePrefix satirinda undefined. */
  count?: number;
  /** Yeni kok input degeri (bos → o kok remap edilmez). */
  value: string;
  /** İce aktarma surerken satir kilitlenir. */
  disabled: boolean;
  onChange: (newRoot: string) => void;
}

export function RemapRow({ oldRoot, count, value, disabled, onChange }: Props) {
  const { t } = useTranslation();

  // Klasor secici → secilen yolu yeni kok yap.
  const browse = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("archive.choose_target"),
    });
    if (typeof selected === "string") onChange(selected);
  };

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-tertiary/50 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
          {t("archive.old_root")}
        </span>
        {typeof count === "number" && (
          <span className="text-[10px] text-text-muted">
            {t("archive.root_count", { count })}
          </span>
        )}
      </div>
      <span dir="ltr" title={oldRoot} className="truncate text-xs text-text-secondary">
        {oldRoot}
      </span>
      <div className="flex items-center gap-1.5">
        <input
          dir="ltr"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("archive.new_root_ph")}
          className="min-w-0 flex-1 rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs
                     text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none
                     disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void browse()}
          disabled={disabled}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-text-secondary
                     transition hover:border-border-hover hover:bg-bg-tertiary
                     disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("archive.browse")}
        </button>
      </div>
    </div>
  );
}
