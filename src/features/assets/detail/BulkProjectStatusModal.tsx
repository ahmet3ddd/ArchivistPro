// Toplu proje-durum atama modali (coklu asset; ADMIN/EDITOR) — secili TUM dosyalara ayni
// musteri/onay/versiyon/termin degerlerini yazar. Tek-asset `ProjectSection` full-replace'inden
// KASITLI fark: burada per-asset mevcut degerler gosterilemez → yalniz KULLANICININ isaretledigi
// (apply) alanlar yazilir; isaretlenmeyen korunur (clobber yok). Onay 'Reddedildi' secilince tek-
// asset'teki gibi "red sebebi" acilir. Yetki backend'de (editor+); UI yalniz gorunum + kesif.
//
// Akis: alan-basi [Uygula onay kutusu] + deger girisi → Uygula → bulkSetProjectMeta(ids, patch)
//   → toast (N dosya guncellendi) → onDone (grid/facet tazele) → kapat. Calisirken kilitli.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { BulkProjectPatch } from "../../../ipc/client";
import { ipc } from "../../../ipc/client";
import { authErrorMessage } from "../../auth/authError";
import { ProtectedAction } from "../../../permissions";
import { useToast } from "../../toast/useToast";
import { APPROVAL_STATUSES } from "./projectStatus";

interface Props {
  /** Duzenlenecek asset id'leri (toplu secim). */
  ids: number[];
  onClose: () => void;
  /** Basarili yazma sonrasi (grid + facet tazeleme). */
  onDone: () => void;
}

const INPUT_CLS =
  "w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary " +
  "placeholder:text-text-muted transition focus:border-accent focus:outline-none " +
  "disabled:cursor-not-allowed disabled:opacity-60";

/** Bos/whitespace → null (sunucu zaten temizler; agda da normalleyelim). */
function clean(value: string): string | null {
  const v = value.trim();
  return v === "" ? null : v;
}

const badgeIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
    aria-hidden="true"
  >
    <path d="M9 12l2 2 4-4" />
    <path d="M7.5 4.2a2 2 0 0 1 1.4-.6h6.2a2 2 0 0 1 1.4.6l2.7 2.7a2 2 0 0 1 .6 1.4v6.2a2 2 0 0 1-.6 1.4l-2.7 2.7a2 2 0 0 1-1.4.6H8.9a2 2 0 0 1-1.4-.6l-2.7-2.7a2 2 0 0 1-.6-1.4V8.3a2 2 0 0 1 .6-1.4Z" />
  </svg>
);

/** Bir "uygula onay kutusu + deger" satiri. Onay kapaliyken deger girisi soluk + pasif. */
function ApplyField({
  apply,
  onToggle,
  label,
  disabled,
  children,
}: {
  apply: boolean;
  onToggle: (on: boolean) => void;
  label: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex cursor-pointer select-none items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={apply}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          title={t("project.bulk.toggle")}
          className="size-3.5 shrink-0 accent-accent disabled:cursor-not-allowed"
        />
        <span className={apply ? "font-medium text-text-primary" : "text-text-muted"}>{label}</span>
      </label>
      <div className={apply ? "" : "pointer-events-none opacity-50"}>{children}</div>
    </div>
  );
}

export function BulkProjectStatusModal({ ids, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const toast = useToast();

  const [applyClient, setApplyClient] = useState(false);
  const [clientName, setClientName] = useState("");
  const [applyApproval, setApplyApproval] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [applyVersion, setApplyVersion] = useState(false);
  const [versionLabel, setVersionLabel] = useState("");
  const [applyDeadline, setApplyDeadline] = useState(false);
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);

  const appliedCount = [applyClient, applyApproval, applyVersion, applyDeadline].filter(
    Boolean,
  ).length;
  // Red sebebi yalniz onay uygulanip 'Reddedildi' secilince (tek-asset ProjectSection kuplaji).
  const showRejection = applyApproval && approvalStatus === "rejected";

  const requestClose = useCallback(() => {
    if (saving) return;
    onClose();
  }, [saving, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const apply = async () => {
    if (saving || appliedCount === 0) return;
    setSaving(true);
    try {
      const patch: BulkProjectPatch = {
        applyClient,
        clientName: clean(clientName),
        applyApproval,
        approvalStatus: clean(approvalStatus),
        rejectionReason: clean(rejectionReason),
        applyVersion,
        versionLabel: clean(versionLabel),
        applyDeadline,
        deadline: clean(deadline),
      };
      const n = await ipc.bulkSetProjectMeta(ids, patch);
      toast.success(t("project.bulk.saved", { count: n }));
      onDone();
      onClose();
    } catch (e) {
      toast.error(authErrorMessage(e, t));
    } finally {
      setSaving(false);
    }
  };

  const applyLabel =
    appliedCount === 0 ? t("project.bulk.none") : t("project.bulk.apply_n", { count: appliedCount });

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={requestClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("project.bulk.title")}
      >
        {/* Baslik + kapat (saving'de kapat gizli — kilitli) */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-white">
            {badgeIcon}
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-text-primary">
              {t("project.bulk.title")}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t("project.bulk.subtitle", { count: ids.length })}
            </p>
          </div>
          {!saving && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="ms-auto shrink-0 rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          )}
        </div>

        {/* Govde: alan-basi uygula-onay kutusu + deger */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 py-4">
          {/* Musteri */}
          <ApplyField
            apply={applyClient}
            onToggle={setApplyClient}
            label={t("project.client")}
            disabled={saving}
          >
            <input
              type="text"
              value={clientName}
              disabled={!applyClient || saving}
              onChange={(e) => setClientName(e.target.value)}
              className={INPUT_CLS}
            />
          </ApplyField>

          {/* Onay durumu */}
          <ApplyField
            apply={applyApproval}
            onToggle={setApplyApproval}
            label={t("project.approval")}
            disabled={saving}
          >
            <select
              value={approvalStatus}
              disabled={!applyApproval || saving}
              onChange={(e) => setApprovalStatus(e.target.value)}
              className={INPUT_CLS}
            >
              <option value="">{t("project.status_unset")}</option>
              {APPROVAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`project.status_${s}`)}
                </option>
              ))}
            </select>
          </ApplyField>

          {/* Red sebebi (yalniz onay uygulanip 'Reddedildi') */}
          {showRejection && (
            <label className="flex flex-col gap-1 ps-6 text-xs">
              <span className="text-text-muted">{t("project.rejection_reason")}</span>
              <textarea
                value={rejectionReason}
                disabled={saving}
                rows={2}
                onChange={(e) => setRejectionReason(e.target.value)}
                className={`${INPUT_CLS} resize-y`}
              />
            </label>
          )}

          {/* Versiyon */}
          <ApplyField
            apply={applyVersion}
            onToggle={setApplyVersion}
            label={t("project.version")}
            disabled={saving}
          >
            <input
              type="text"
              value={versionLabel}
              disabled={!applyVersion || saving}
              onChange={(e) => setVersionLabel(e.target.value)}
              className={INPUT_CLS}
            />
          </ApplyField>

          {/* Termin */}
          <ApplyField
            apply={applyDeadline}
            onToggle={setApplyDeadline}
            label={t("project.deadline")}
            disabled={saving}
          >
            <input
              type="date"
              value={deadline}
              disabled={!applyDeadline || saving}
              onChange={(e) => setDeadline(e.target.value)}
              className={`${INPUT_CLS} [color-scheme:dark]`}
            />
          </ApplyField>

          {/* Uyari bandi */}
          <p className="mt-1 rounded-md border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">
            {t("project.bulk.warning", { count: ids.length })}
          </p>
        </div>

        {/* Alt islem cubugu */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary transition hover:bg-bg-tertiary disabled:opacity-50"
          >
            {t("common.close")}
          </button>
          <ProtectedAction require="editor" mode="disabled">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={saving || appliedCount === 0}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? t("project.bulk.saving") : applyLabel}
            </button>
          </ProtectedAction>
        </div>
      </div>
    </div>,
    document.body,
  );
}
