// Proje olustur/duzenle formu (ProjectsPanel ici) — ad ZORUNLU + opsiyonel musteri/faz/durum/
// termin/aciklama. Full-replace semantigi: `initial` verildiginde (duzenle) tum mevcut degerler
// forma yuklenir; bos birakilan opsiyonel alan backend'de NULL olur. Faz/durum SERBEST metin ama
// datalist ile oneri sunulur. Yazma editor+ (submit ProtectedAction ile soluk+pasif; gercek
// yetki Rust'ta). Bilesen sunum-odakli: IPC/toast/tazeleme ebeveyn (ProjectsPanel) sorumlulugu.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ProjectInput, ProjectRow } from "../../ipc/client";
import { ProtectedAction } from "../../permissions";
import { PROJECT_PHASES, PROJECT_STATUSES } from "./projectMeta";

const INPUT_CLS =
  "w-full rounded-md border border-border bg-bg-tertiary px-2.5 py-1.5 text-sm text-text-primary " +
  "placeholder:text-text-muted transition focus:border-accent focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const LABEL_CLS = "flex flex-col gap-1 text-xs";
const LABEL_TEXT = "font-medium text-text-secondary";

/** Bos/whitespace → null ("" DEGIL) → backend NULL saklar. */
function clean(value: string): string | null {
  const v = value.trim();
  return v === "" ? null : v;
}

interface Props {
  /** Duzenlenecek proje (varsa duzenle kipi; yoksa yeni proje). */
  initial?: ProjectRow | null;
  saving: boolean;
  onSubmit: (input: ProjectInput) => void;
  onCancel: () => void;
}

export function ProjectForm({ initial, saving, onSubmit, onCancel }: Props) {
  const { t } = useTranslation();
  const editing = initial != null;

  const [name, setName] = useState(initial?.name ?? "");
  const [clientName, setClientName] = useState(initial?.clientName ?? "");
  const [phase, setPhase] = useState(initial?.phase ?? "");
  const [status, setStatus] = useState(initial?.status ?? "");
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");

  const nameValid = name.trim() !== "";

  const submit = () => {
    if (!nameValid || saving) return;
    onSubmit({
      name: name.trim(),
      clientName: clean(clientName),
      phase: clean(phase),
      status: clean(status),
      deadline: clean(deadline),
      description: clean(description),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-display text-sm font-bold text-text-primary">
        {editing ? t("projects.edit") : t("projects.new")}
      </h3>

      {/* Ad (ZORUNLU) */}
      <label className={LABEL_CLS}>
        <span className={LABEL_TEXT}>
          {t("projects.name")} <span className="text-danger">*</span>
        </span>
        <input
          type="text"
          value={name}
          disabled={saving}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={t("projects.name")}
          className={INPUT_CLS}
        />
        {!nameValid && <span className="text-[11px] text-text-muted">{t("projects.name_required")}</span>}
      </label>

      {/* Musteri */}
      <label className={LABEL_CLS}>
        <span className={LABEL_TEXT}>{t("projects.client")}</span>
        <input
          type="text"
          value={clientName}
          disabled={saving}
          onChange={(e) => setClientName(e.target.value)}
          className={INPUT_CLS}
        />
      </label>

      {/* Faz + Durum (serbest metin; datalist oneri) */}
      <div className="grid grid-cols-2 gap-3">
        <label className={LABEL_CLS}>
          <span className={LABEL_TEXT}>{t("projects.phase")}</span>
          <input
            type="text"
            list="projects-phase-suggestions"
            value={phase}
            disabled={saving}
            onChange={(e) => setPhase(e.target.value)}
            className={INPUT_CLS}
          />
          <datalist id="projects-phase-suggestions">
            {PROJECT_PHASES.map((p) => (
              <option key={p} value={t(`projects.phase_${p}`)} />
            ))}
          </datalist>
        </label>
        <label className={LABEL_CLS}>
          <span className={LABEL_TEXT}>{t("projects.status")}</span>
          <input
            type="text"
            list="projects-status-suggestions"
            value={status}
            disabled={saving}
            onChange={(e) => setStatus(e.target.value)}
            className={INPUT_CLS}
          />
          <datalist id="projects-status-suggestions">
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={t(`projects.status_${s}`)} />
            ))}
          </datalist>
        </label>
      </div>

      {/* Termin */}
      <label className={LABEL_CLS}>
        <span className={LABEL_TEXT}>{t("projects.deadline")}</span>
        <input
          type="date"
          value={deadline}
          disabled={saving}
          onChange={(e) => setDeadline(e.target.value)}
          className={`${INPUT_CLS} [color-scheme:dark]`}
        />
      </label>

      {/* Aciklama */}
      <label className={LABEL_CLS}>
        <span className={LABEL_TEXT}>{t("projects.description")}</span>
        <textarea
          value={description}
          disabled={saving}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          className={`${INPUT_CLS} resize-y`}
        />
      </label>

      {/* Islem cubugu */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary
                     transition hover:border-border-hover hover:bg-bg-tertiary disabled:opacity-50"
        >
          {t("common.close")}
        </button>
        <ProtectedAction require="editor" mode="disabled">
          <button
            type="button"
            onClick={submit}
            disabled={saving || !nameValid}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                       hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("projects.saving") : editing ? t("projects.save") : t("projects.create")}
          </button>
        </ProtectedAction>
      </div>
    </div>
  );
}
