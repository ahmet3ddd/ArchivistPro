// Denetim Gunlugu (audit log) goruntuleyici (#8) — yalniz admin; salt-okuma. Yikici/yazma
// komutlarinin biraktigi denetim izini (kim · ne zaman · hangi eylem · hedef · detay) sayfali
// bir tabloda gosterir (en yeni once). Overlay/portal: BackupPanel deseni (TopBar backdrop-blur
// containing-block tuzagindan kacmak icin `createPortal(document.body)`; scrim/Esc kapatir).
//
// Veri: sorgu-hook (useIpcQuery) → `audit_count` (toplam; sayfalama) + `audit_log(limit,offset)`
// (sayfa; acilista + sayfa degisince). `ts` unix SANIYE → `formatDate` (×1000). Eylem anahtari
// i18n `audit.action.*` ile okunur etikete cevrilir (bilinmeyen → ham anahtar, defaultValue).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { AuditRow } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { formatDate } from "../../lib/format";

/** Sayfa boyu (backend `audit_log` limit'i 1..=200 clamp'ler; 25 guvenli). */
const PAGE_SIZE = 25;

interface Props {
  onClose: () => void;
}

export function AuditLogPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const [page, setPage] = useState(0);

  // Toplam kayit (sayfalama) — bir kez cek. Sayfa (offset) — sayfa degisince yeniden cek.
  const { data: total } = useIpcQuery<number>(() => ipc.auditCount(), []);
  const {
    data: rows,
    loading,
    error,
    refetch,
  } = useIpcQuery<AuditRow[]>(() => ipc.auditLog(PAGE_SIZE, page * PAGE_SIZE), [page]);

  const totalCount = total ?? 0;
  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const items = rows ?? [];

  // Esc → kapat (capture; SettingsModal zaten kapandi, cakisma yok — yine de guvenli).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const btn =
    "rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("audit.title")}
      >
        {/* Baslik + toplam + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("audit.title")}
            {totalCount > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("audit.count", { count: totalCount })}
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

        <p className="border-b border-border bg-bg-tertiary/40 px-5 py-2 text-xs text-text-muted">
          {t("audit.hint")}
        </p>

        {/* Icerik: yukleniyor / hata / bos / tablo */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-text-muted">{t("audit.loading")}</p>
          ) : error ? (
            <div className="text-sm text-danger">
              <p>{t("list.error", { message: error })}</p>
              <button type="button" onClick={refetch} className={`mt-2 ${btn}`}>
                {t("common.retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-text-secondary">{t("audit.empty")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("audit.empty_hint")}</p>
            </div>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-start uppercase tracking-wide text-text-muted">
                  <th className="whitespace-nowrap px-2 py-1.5 text-start font-semibold">
                    {t("audit.col_time")}
                  </th>
                  <th className="px-2 py-1.5 text-start font-semibold">{t("audit.col_user")}</th>
                  <th className="px-2 py-1.5 text-start font-semibold">{t("audit.col_action")}</th>
                  <th className="px-2 py-1.5 text-start font-semibold">{t("audit.col_target")}</th>
                  <th className="px-2 py-1.5 text-start font-semibold">{t("audit.col_detail")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <AuditRowView key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Sayfalama: Onceki · sayfa X / Y · Sonraki */}
        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page <= 0 || loading}
            className={btn}
          >
            {t("audit.prev")}
          </button>
          <span className="text-xs text-text-secondary tabular-nums">
            {t("audit.page", { page: page + 1, pages })}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
            disabled={page >= pages - 1 || loading}
            className={btn}
          >
            {t("audit.next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Tek bir denetim satiri — zaman · kullanici(+rol rozeti) · eylem · hedef · detay. */
function AuditRowView({ row }: { row: AuditRow }) {
  const { t } = useTranslation();

  // Eylem: i18n okunur etiket; bilinmeyen action → ham anahtar (defaultValue fallback).
  const actionLabel = t(`audit.action.${row.action}`, { defaultValue: row.action });
  // Rol rozeti: role.admin/editor/viewer; sistem/bos → ham deger.
  const roleLabel = row.role ? t(`role.${row.role}`, { defaultValue: row.role }) : "";
  // Hedef: targetType · targetId (varsa); ikisi de null → "—".
  const target =
    row.targetType || row.targetId
      ? [row.targetType, row.targetId].filter(Boolean).join(" · ")
      : "—";

  return (
    <tr className="border-b border-border/60 align-top">
      <td className="whitespace-nowrap px-2 py-1.5 text-text-secondary">{formatDate(row.ts)}</td>
      <td className="px-2 py-1.5">
        <span className="text-text-primary">{row.username}</span>
        {roleLabel && (
          <span className="ms-1.5 rounded-full border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-medium uppercase text-text-muted">
            {roleLabel}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-text-primary">{actionLabel}</td>
      <td className="px-2 py-1.5 text-text-secondary">
        <span title={target}>{target}</span>
      </td>
      <td className="max-w-[16rem] px-2 py-1.5 text-text-secondary">
        <span className="block truncate" title={row.detail ?? undefined}>
          {row.detail ?? "—"}
        </span>
      </td>
    </tr>
  );
}
