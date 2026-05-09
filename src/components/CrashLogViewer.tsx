/**
 * ArchivistPro — Crash Log Viewer
 *
 * Lists crash reports from AppData/crash_logs/. Follows LogViewerModal pattern.
 * Supports: detail view, single delete, clear all.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, RefreshCw, ChevronLeft, AlertTriangle } from 'lucide-react';
import {
  listCrashReports,
  deleteCrashReport,
  clearAllCrashReports,
  type CrashReport,
} from '../services/crashReporter';
import { useStore } from '../store/useStore';

export default function CrashLogViewer() {
  const { t } = useTranslation();
  const [reports, setReports] = useState<CrashReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<CrashReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await listCrashReports();
    setReports(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    useStore.getState().showConfirmDialog(
      t('crashReport.deleteConfirm'),
      undefined,
      async () => {
        await deleteCrashReport(id);
        setSelectedReport(null);
        load();
      },
    );
  }, [load, t]);

  const handleClearAll = useCallback(() => {
    useStore.getState().showConfirmDialog(
      t('crashReport.clearAllConfirm'),
      t('crashReport.clearAllDetail'),
      async () => {
        await clearAllCrashReports();
        setSelectedReport(null);
        load();
      },
    );
  }, [load, t]);

  const errorTypeBadge = (type: string) => {
    const colors: Record<string, { bg: string; fg: string }> = {
      react_error: { bg: 'rgba(239,68,68,0.1)', fg: '#ef4444' },
      window_error: { bg: 'rgba(245,158,11,0.1)', fg: '#f59e0b' },
      unhandled_rejection: { bg: 'rgba(168,85,247,0.1)', fg: '#a855f7' },
      rust_panic: { bg: 'rgba(220,38,38,0.15)', fg: '#dc2626' },
    };
    const c = colors[type] ?? { bg: 'rgba(100,116,139,0.1)', fg: '#64748b' };
    return (
      <span style={{
        padding: '1px 8px', borderRadius: 4, fontSize: '0.66rem', fontWeight: 600,
        background: c.bg, color: c.fg, whiteSpace: 'nowrap',
      }}>
        {t(`crashReport.type.${type}`, type)}
      </span>
    );
  };

  // Detail view
  if (selectedReport) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setSelectedReport(null)} className="btn btn-ghost" style={{ padding: '4px 8px', gap: 4, fontSize: '0.74rem' }}>
            <ChevronLeft size={14} /> {t('common.back')}
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={() => handleDelete(selectedReport.id)} className="btn btn-ghost" style={{ padding: '4px 10px', color: 'var(--color-danger)', fontSize: '0.72rem', gap: 4 }}>
            <Trash2 size={12} /> {t('crashReport.delete')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {errorTypeBadge(selectedReport.error_type)}
            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {new Date(selectedReport.timestamp).toLocaleString()}
            </span>
          </div>

          <DetailRow label={t('crashReport.field.component')} value={selectedReport.component} />
          <DetailRow label={t('crashReport.field.version')} value={selectedReport.app_version} />
          <DetailRow label={t('crashReport.field.os')} value={selectedReport.os_info} />

          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontWeight: 600, marginTop: 4 }}>
            {t('crashReport.field.message')}
          </div>
          <pre style={{
            fontSize: '0.7rem', color: '#f38ba8', background: 'var(--color-bg-tertiary)',
            padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 80, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {selectedReport.message}
          </pre>

          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontWeight: 600, marginTop: 4 }}>
            {t('crashReport.field.stackTrace')}
          </div>
          <pre style={{
            fontSize: '0.66rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-tertiary)',
            padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: 200, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {selectedReport.stack_trace || t('crashReport.noStackTrace')}
          </pre>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
          <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{t('crashReport.title')}</span>
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 8 }}>
            {reports.length}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={load} className="btn btn-ghost" style={{ padding: '4px 8px' }} title={t('common.refresh')}>
            <RefreshCw size={13} />
          </button>
          {reports.length > 0 && (
            <button onClick={handleClearAll} className="btn btn-ghost" style={{ padding: '4px 8px', color: 'var(--color-danger)' }} title={t('crashReport.clearAll')}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
          ...
        </div>
      ) : reports.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
          {t('crashReport.empty')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto' }}>
          {reports.map((r) => (
            <div
              key={r.id}
              onClick={() => setSelectedReport(r)}
              style={{
                padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid var(--color-border)', background: 'transparent',
                transition: 'background 120ms',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {errorTypeBadge(r.error_type)}
                  <span style={{
                    fontSize: '0.72rem', color: 'var(--color-text-primary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {r.message.slice(0, 80)}
                  </span>
                </div>
                <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {new Date(r.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', padding: '2px 0' }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{value || '—'}</span>
    </div>
  );
}
