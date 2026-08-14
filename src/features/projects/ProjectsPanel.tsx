// Projeler (entity) yonetim paneli — TopBar "Projeler" dugmesinden acilir. Portal modal
// (DuplicateFinderPanel deseni: TopBar backdrop-blur containing-block tuzagindan kacmak icin
// createPortal(document.body); scrim/Esc kapatir).
//
// Iki gorunum: (1) LISTE — projeler + atanmis asset sayisi rozeti + ozet; satira tiklayinca
// o projeyi ANA LISTEDE goster (setProject([id]) → panel kapanir, liste project=[id] ile filtrelenir).
// (2) FORM — yeni/duzenle (ProjectForm). Yazma editor+ (backend zorlar; UI ProtectedAction ile
// kesif). Basari → toast + bumpData (liste/facet + useProjects tazele; project-filtre etkilenebilir).
//
// Silme FK SET NULL: atanmis dosyalar SILINMEZ — yalniz proje atamasi kalkar (onay metni NET).

import { confirm } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { ProjectInput, ProjectRow } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { ProtectedAction } from "../../permissions";
import { useUiStore } from "../../store/useUiStore";
import { authErrorMessage } from "../auth/authError";
import { useToast } from "../toast/useToast";
import { ProjectForm } from "./ProjectForm";

interface Props {
  onClose: () => void;
}

type FormMode = { kind: "create" } | { kind: "edit"; project: ProjectRow } | null;

export function ProjectsPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const setProject = useUiStore((s) => s.setProject);
  const projectFilter = useUiStore((s) => s.project);
  const bumpData = useUiStore((s) => s.bumpData);
  const dataVersion = useUiStore((s) => s.dataVersion);

  // Panel-ici liste — dataVersion'a bagli (yazma → bumpData → dataVersion → otomatik tazele).
  const { data, loading, error, refetch } = useIpcQuery(() => ipc.listProjects(), [dataVersion]);
  const projects = data ?? [];

  const [mode, setMode] = useState<FormMode>(null);
  const [saving, setSaving] = useState(false);

  // Esc → paneli kapat (capture; DuplicateFinderPanel deseni).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Bir projeyi ANA listede goster: project-filtreyi ata + paneli kapat.
  const showProject = (id: number) => {
    setProject([id]);
    onClose();
  };

  // Form gonderimi (create/update) → IPC + toast + bumpData + liste kipine don.
  const handleSubmit = (input: ProjectInput) =>
    void (async () => {
      if (saving) return;
      setSaving(true);
      try {
        if (mode?.kind === "edit") {
          await ipc.updateProject(mode.project.id, input);
          toast.success(t("projects.updated_toast"));
        } else {
          await ipc.createProject(input);
          toast.success(t("projects.created_toast"));
        }
        bumpData(); // liste + facet + useProjects tazele (dataVersion → panel query refetch)
        setMode(null);
      } catch (e) {
        toast.error(authErrorMessage(e, t));
      } finally {
        setSaving(false);
      }
    })();

  // Sil (FK SET NULL — atanmis dosyalar SILINMEZ; onay metni bunu NET soyler).
  const handleDelete = (project: ProjectRow) =>
    void (async () => {
      const ok = await confirm(t("projects.delete_confirm", { name: project.name }), {
        title: t("projects.delete"),
        kind: "warning",
      });
      if (!ok) return;
      try {
        await ipc.deleteProject(project.id);
        toast.success(t("projects.deleted_toast"));
        // Silinen proje aktif filtre ise filtreyi temizle (bayat/bos liste kalmasin).
        if (projectFilter.includes(project.id)) {
          setProject(projectFilter.filter((x) => x !== project.id));
        }
        bumpData();
      } catch (e) {
        toast.error(authErrorMessage(e, t));
      }
    })();

  const inForm = mode != null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("projects.title")}
      >
        {/* Baslik + (liste kipinde) proje sayisi + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("projects.title")}
            {!inForm && projects.length > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("projects.count", { count: projects.length })}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Govde */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {inForm ? (
            <ProjectForm
              initial={mode?.kind === "edit" ? mode.project : null}
              saving={saving}
              onSubmit={handleSubmit}
              onCancel={() => setMode(null)}
            />
          ) : loading ? (
            <p className="py-8 text-center text-sm text-text-muted">{t("projects.loading")}</p>
          ) : error ? (
            <div className="py-8 text-center text-sm text-danger">
              <p>{t("projects.load_error")}</p>
              <button
                type="button"
                onClick={refetch}
                className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-primary
                           transition hover:border-border-hover hover:bg-bg-tertiary"
              >
                {t("common.retry")}
              </button>
            </div>
          ) : projects.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-text-secondary">{t("projects.empty")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("projects.empty_hint")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {projects.map((p) => (
                <ProjectListRow
                  key={p.id}
                  project={p}
                  onShow={() => showProject(p.id)}
                  onEdit={() => setMode({ kind: "edit", project: p })}
                  onDelete={() => handleDelete(p)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Alt: "Yeni proje" (yalniz liste kipinde) */}
        {!inForm && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <ProtectedAction require="editor" mode="disabled">
              <button
                type="button"
                onClick={() => setMode({ kind: "create" })}
                className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                           hover:bg-accent-hover"
              >
                + {t("projects.new")}
              </button>
            </ProtectedAction>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface RowProps {
  project: ProjectRow;
  onShow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Bir proje satiri — tikla-goster alani (ad + ozet + asset rozeti) + duzenle/sil eylemleri. */
function ProjectListRow({ project, onShow, onEdit, onDelete }: RowProps) {
  const { t } = useTranslation();

  const pills: string[] = [];
  if (project.clientName) pills.push(`👤 ${project.clientName}`);
  if (project.phase) pills.push(project.phase);
  if (project.status) pills.push(project.status);
  if (project.deadline) pills.push(`📅 ${project.deadline}`);

  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-bg-secondary p-3">
      {/* Tikla → projeyi ana listede goster */}
      <button
        type="button"
        onClick={onShow}
        title={t("projects.show")}
        className="flex min-w-0 flex-1 flex-col items-start gap-1 text-start"
      >
        <span className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-text-primary">{project.name}</span>
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
            {t("projects.asset_count", { count: project.assetCount })}
          </span>
        </span>
        {pills.length > 0 && (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-text-muted">
            {pills.map((p, i) => (
              <span key={i} className="truncate">
                {p}
              </span>
            ))}
          </span>
        )}
      </button>

      {/* Duzenle / Sil (editor+; soluk+pasif viewer'da) */}
      <ProtectedAction require="editor" mode="disabled">
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={t("projects.edit")}
            title={t("projects.edit")}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary
                       transition hover:border-border-hover hover:text-text-primary"
          >
            {t("projects.edit")}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t("projects.delete")}
            title={t("projects.delete")}
            className="rounded border border-danger/40 px-2 py-1 text-xs text-danger
                       transition hover:border-danger hover:bg-danger/10"
          >
            {t("projects.delete")}
          </button>
        </span>
      </ProtectedAction>
    </div>
  );
}
