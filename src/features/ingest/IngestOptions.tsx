// Indeksleme modali — "Sec & Secenekler" adimi (IngestModal alt-bileseni; <500 satir).
//
// GERCEK secenekler: skip-unchanged (artimsal) + tarama modu (birlestir/degistir/sifirla).
// Yikici modlar (degistir → kayip dosyalar cope; sifirla → TUM arsiv kalici sil) UYARI +
// (sifirla icin) 'SIFIRLA' yazma onayi ister. Baskin renk cikarimi gercek gorsel extractor'un
// daimi parcasidir; AI indeksleme ise Ayarlar > AI'daki kalici oto-indeks surucusunde yonetilir.
//
// i18n: tum kullanici-gorunur metin t('ingest.*'). Logical CSS (RTL); yol dir='ltr'.

import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import type { IngestMode } from "../../ipc/client";
import { mergeFolderSelections } from "./folderSelection";

interface Props {
  /** Secili kaynak-kokler ([] = henuz secilmedi). */
  paths: string[];
  onPathsChange: (paths: string[]) => void;
  /** Artimsal: degismeyenleri atla (GERCEK; varsayilan acik). */
  skipUnchanged: boolean;
  onSkipUnchangedChange: (on: boolean) => void;
  /** Tarama modu (birlestir/degistir/sifirla). */
  mode: IngestMode;
  onModeChange: (mode: IngestMode) => void;
  /** Klasorden otomatik proje ata (kok-alti ilk klasor → proje; yalniz projesiz dosyalar). */
  autoProject: boolean;
  onAutoProjectChange: (on: boolean) => void;
  /** Sifirla onay metni (kullanici 'SIFIRLA' yazar). Eslesme kontrolu ebeveynde (canRun). */
  confirmText: string;
  onConfirmTextChange: (text: string) => void;
}

export function IngestOptions({
  paths,
  onPathsChange,
  skipUnchanged,
  onSkipUnchangedChange,
  mode,
  onModeChange,
  autoProject,
  onAutoProjectChange,
  confirmText,
  onConfirmTextChange,
}: Props) {
  const { t } = useTranslation();

  const browse = async () => {
    const selected = await open({
      directory: true,
      multiple: true,
      title: t("ingest.choose_folders"),
    });
    const additions =
      typeof selected === "string" ? [selected] : Array.isArray(selected) ? selected : [];
    if (additions.length > 0) onPathsChange(mergeFolderSelections(paths, additions));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Kaynak-kok listesi: secici her tikta bir klasor ekler; satirlar tek tek cikarilabilir. */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t("ingest.choose_folders")}
          </span>
          {paths.length > 0 && (
            <span className="text-xs tabular-nums text-text-secondary">
              {t("ingest.selected_folder_count", { count: paths.length })}
            </span>
          )}
        </div>
        {paths.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-bg-tertiary/40 px-3 py-3 text-sm text-text-muted">
            {t("ingest.placeholder")}
          </p>
        ) : (
          <ul className="flex max-h-44 flex-col gap-1.5 overflow-y-auto rounded-md border border-border bg-bg-tertiary/30 p-2">
            {paths.map((path) => (
              <li
                key={path}
                className="flex min-w-0 items-center gap-2 rounded-md bg-bg-tertiary/70 px-2.5 py-2"
              >
                <span
                  dir="ltr"
                  title={path}
                  className="min-w-0 flex-1 truncate text-start text-sm text-text-primary"
                >
                  {path}
                </span>
                <button
                  type="button"
                  onClick={() => onPathsChange(paths.filter((item) => item !== path))}
                  aria-label={t("ingest.remove_folder", { name: folderName(path) })}
                  title={t("ingest.remove_folder", { name: folderName(path) })}
                  className="shrink-0 rounded px-2 py-0.5 text-text-muted transition hover:bg-danger/10 hover:text-danger"
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-text-muted">{t("ingest.multi_folder_hint")}</p>
          <button
            type="button"
            onClick={() => void browse()}
            className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
          >
            {t("ingest.add_folder")}
          </button>
        </div>
      </div>

      {/* Secenekler */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t("ingest.options")}
        </span>

        {/* GERCEK: skip-unchanged (artimsal). Reset'te etkisiz (DB once tamamen silinir). */}
        <label
          className={`flex items-center gap-3 rounded-md border border-border bg-bg-tertiary/40 px-3 py-2.5 transition ${
            mode === "reset" ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-bg-tertiary/70"
          }`}
        >
          <input
            type="checkbox"
            checked={skipUnchanged}
            disabled={mode === "reset"}
            onChange={(e) => onSkipUnchangedChange(e.target.checked)}
            className="h-4 w-4 shrink-0 accent-accent"
          />
          <span className="text-sm text-text-primary">{t("ingest.skip_unchanged")}</span>
        </label>

        {/* GERCEK: klasorden oto-proje. Kok-alti ilk klasor adi proje olur (upsert-by-name);
            yalniz projesiz (project_id NULL) dosyalara atanir → manuel atamayi EZMEZ. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-bg-tertiary/40 px-3 py-2.5 transition hover:bg-bg-tertiary/70">
          <input
            type="checkbox"
            checked={autoProject}
            onChange={(e) => onAutoProjectChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          />
          <span className="flex flex-col">
            <span className="text-sm text-text-primary">{t("ingest.auto_project")}</span>
            <span className="text-xs text-text-muted">{t("ingest.auto_project_hint")}</span>
          </span>
        </label>

        {/* Tarama modu (radio): birlestir/degistir/sifirla — hepsi GERCEK (backend destekler). */}
        <fieldset className="flex flex-col gap-2 rounded-md border border-border bg-bg-tertiary/40 px-3 py-2.5">
          <legend className="px-1 text-xs font-medium text-text-secondary">{t("ingest.mode")}</legend>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="ingest-mode"
              checked={mode === "merge"}
              onChange={() => onModeChange("merge")}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            <span className="text-sm text-text-primary">{t("ingest.mode_merge")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="ingest-mode"
              checked={mode === "replace"}
              onChange={() => onModeChange("replace")}
              className="h-4 w-4 shrink-0 accent-accent"
            />
            <span className="text-sm text-text-primary">{t("ingest.mode_replace")}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="radio"
              name="ingest-mode"
              checked={mode === "reset"}
              onChange={() => onModeChange("reset")}
              className="h-4 w-4 shrink-0 accent-danger"
            />
            <span className="text-sm text-text-primary">{t("ingest.mode_reset")}</span>
          </label>
        </fieldset>

        {/* Degistir uyarisi: kayip dosyalar cope (geri-alinabilir) — kapsam yalniz bu klasor. */}
        {mode === "replace" && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning">
            {t("ingest.replace_warning")}
          </p>
        )}

        {/* Sifirla uyarisi (KIRMIZI) + 'SIFIRLA' yazma onayi: TUM arsiv kalici silinir. */}
        {mode === "reset" && (
          <div className="flex flex-col gap-2 rounded-md border border-danger/50 bg-danger/10 px-3 py-3">
            <p className="text-xs font-medium text-danger">{t("ingest.reset_warning")}</p>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-text-secondary">
                {t("ingest.reset_confirm_label", { word: t("ingest.reset_confirm_word") })}
              </span>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => onConfirmTextChange(e.target.value)}
                placeholder={t("ingest.reset_confirm_word")}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-md border border-danger/50 bg-bg-tertiary px-2.5 py-1.5 text-sm
                           text-text-primary placeholder:text-text-muted focus:border-danger focus:outline-none"
              />
            </label>
          </div>
        )}

      </div>
    </div>
  );
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
