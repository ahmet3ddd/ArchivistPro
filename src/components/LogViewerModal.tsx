/**
 * ArchivistPro — Log Viewer (Yönetici Log Paneli)
 *
 * Admin-only. Audit log kayıtlarını gösterir, filtreler, siler.
 * Silme modları: tek kayıt, çoklu seçim (Ctrl/Shift+Click), tarih aralığı, tümü.
 * Keyboard: Delete → seçili sil, Ctrl+A → tümünü seç, Escape → kapat.
 */

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Trash2, RefreshCw, Filter, Calendar, AlertTriangle, CheckSquare, ShieldCheck, ShieldAlert, ChevronRight, ChevronDown } from 'lucide-react';
import {
  getAuditLogs, getAuditLogCount, clearAuditLogs,
  deleteAuditLog, deleteAuditLogsBatch, clearAuditLogsBefore,
  verifyAuditLogIntegrity,
  type AuditLogEntry, type AuditDeleteResult, type AuditIntegrityResult,
} from '../services/logger';
import { notifySuccess, notifyError } from '../services/notificationCenter';
import { useStore } from '../store/useStore';

interface LogViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ── Detail Content (expanded row) ── */

function LogDetailContent({ log }: { log: AuditLogEntry }) {
  const { t } = useTranslation();
  let parsedDetail: Record<string, unknown> | null = null;
  let rawDetail = '';
  if (log.detail && log.detail.trim() && log.detail !== '{}' && log.detail !== 'null') {
    try {
      const parsed = JSON.parse(log.detail);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedDetail = parsed as Record<string, unknown>;
      } else {
        rawDetail = log.detail;
      }
    } catch {
      rawDetail = log.detail;
    }
  }

  const resultColor = log.result === 'SUCCESS' ? '#10b981' : log.result === 'FAIL' ? '#ef4444' : '#f59e0b';

  const renderField = (label: string, value: React.ReactNode) => (
    <Fragment key={label}>
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>{label}</div>
      <div style={{ color: 'var(--color-text-primary)', fontSize: '0.74rem', wordBreak: 'break-word' }}>{value}</div>
    </Fragment>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontWeight: 600, fontSize: '0.78rem', color: 'var(--color-text-primary)' }}>
        {t('logViewer.detail.title')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', gap: '4px 16px' }}>
        {renderField('ID', String(log.id))}
        {renderField(t('logViewer.col.time'), new Date(log.timestamp).toLocaleString())}
        {renderField(t('logViewer.col.role'), log.role)}
        {renderField(t('logViewer.col.action'), log.action)}
        {renderField(t('logViewer.col.target'), <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{log.target}</span>)}
        {renderField(
          t('logViewer.col.result'),
          <span style={{ fontWeight: 600, color: resultColor }}>{log.result}</span>
        )}
      </div>

      {parsedDetail && Object.keys(parsedDetail).length > 0 && (
        <>
          <div style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--color-text-primary)', marginTop: 4 }}>
            {t('logViewer.detail.extraInfo')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', gap: '4px 16px' }}>
            {Object.entries(parsedDetail).map(([k, v]) => renderField(
              k,
              <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>
                {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
              </span>
            ))}
          </div>
        </>
      )}

      {rawDetail && (
        <pre style={{
          background: 'var(--color-bg-tertiary)', padding: '8px 10px', borderRadius: 6,
          fontSize: '0.7rem', overflow: 'auto', margin: 0,
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border)',
        }}>{rawDetail}</pre>
      )}

      {!parsedDetail && !rawDetail && (
        <div style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.72rem' }}>
          {t('logViewer.detail.noExtra')}
        </div>
      )}
    </div>
  );
}

export default function LogViewerModal({ isOpen, onClose }: LogViewerModalProps) {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filterAction, setFilterAction] = useState('');
  const [showDateClear, setShowDateClear] = useState(false);
  const [dateClearDays, setDateClearDays] = useState(30);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [integrityResult, setIntegrityResult] = useState<AuditIntegrityResult | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const lastClickedRef = useRef<number | null>(null);

  const toggleExpanded = useCallback((id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  /* ── Veri yükleme ── */

  const loadLogs = useCallback(() => {
    const filters = filterAction ? { action: filterAction as AuditLogEntry['action'] } : undefined;
    setLogs(getAuditLogs(200, 0, filters));
    setTotalCount(getAuditLogCount());
    setSelectedIds(new Set());
    lastClickedRef.current = null;
  }, [filterAction]);

  useEffect(() => {
    if (isOpen) loadLogs();
  }, [isOpen, loadLogs]);

  /* ── Silme sonuç işleme ── */

  const handleResult = useCallback((result: AuditDeleteResult, successMsg: string, successDetail: string) => {
    // saveDatabase çağrısı kaldırıldı — logger.ts içindeki silme/temizleme
    // fonksiyonları artık Rust mirror invoke ile direkt rusqlite'a yazıyor
    // (mirrorAuditChangesToDisk). Ana thread bloku yok.
    loadLogs();
    if (result.success) {
      if (result.deletedCount > 0) {
        notifySuccess(successMsg, successDetail);
      } else {
        useStore.getState().addToast(t('logViewer.delete.noneFound'), 'info');
      }
    } else {
      notifyError(t('logViewer.delete.failed'), result.error || t('common.error.unknown'));
    }
  }, [loadLogs, t]);

  /* ── Seçim mantığı ── */

  const handleRowClick = useCallback((logId: number, e: React.MouseEvent) => {
    // Ctrl/Cmd + Click: toggle tekli
    if (e.ctrlKey || e.metaKey) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(logId)) next.delete(logId);
        else next.add(logId);
        return next;
      });
      lastClickedRef.current = logId;
      return;
    }

    // Shift + Click: aralık seçimi
    if (e.shiftKey && lastClickedRef.current !== null) {
      const ids = logs.map(l => l.id);
      const startIdx = ids.indexOf(lastClickedRef.current);
      const endIdx = ids.indexOf(logId);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeIds = ids.slice(from, to + 1);
        setSelectedIds(prev => {
          const next = new Set(prev);
          rangeIds.forEach(id => next.add(id));
          return next;
        });
      }
      return;
    }

    // Normal click: tekli toggle
    setSelectedIds(prev => {
      if (prev.size === 1 && prev.has(logId)) return new Set();
      return new Set([logId]);
    });
    lastClickedRef.current = logId;
  }, [logs]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === logs.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(logs.map(l => l.id)));
    }
  }, [selectedIds.size, logs]);

  /* ── Silme işlemleri ── */

  const handleDeleteSelected = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    useStore.getState().showConfirmDialog(
      t('logViewer.delete.confirm', { count: ids.length }),
      t('logViewer.delete.confirmDetail'),
      () => {
        const result = ids.length === 1
          ? deleteAuditLog(ids[0])
          : deleteAuditLogsBatch(ids);
        handleResult(result, t('logViewer.delete.success'), t('logViewer.delete.successDetail', { count: result.deletedCount }));
      },
    );
  }, [selectedIds, handleResult, t]);

  const handleClearAll = useCallback(() => {
    useStore.getState().showConfirmDialog(
      t('logViewer.clearAll.confirm'),
      t('logViewer.clearAll.confirmDetail'),
      () => {
        const result = clearAuditLogs();
        handleResult(result, t('logViewer.clearAll.success'), t('logViewer.delete.successDetail', { count: result.deletedCount }));
      },
    );
  }, [handleResult, t]);

  const handleVerifyIntegrity = useCallback(() => {
    const result = verifyAuditLogIntegrity();
    setIntegrityResult(result);
  }, []);

  const handleClearByDate = useCallback(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - dateClearDays);
    const cutoffIso = cutoff.toISOString();

    useStore.getState().showConfirmDialog(
      t('logViewer.clearByDate.confirm', { days: dateClearDays }),
      t('logViewer.clearByDate.confirmDetail'),
      () => {
        const result = clearAuditLogsBefore(cutoffIso);
        handleResult(result, t('logViewer.clearByDate.success'), t('logViewer.clearByDate.successDetail', { count: result.deletedCount }));
      },
    );
  }, [dateClearDays, handleResult, t]);

  /* ── Keyboard kısayolları ── */

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      // Input/select içindeyken kısayol çalışmasın
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault();
        handleDeleteSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, selectedIds.size, handleDeleteSelected, handleSelectAll, onClose]);

  /* ── Render ── */

  if (!isOpen) return null;

  const optionStyle: React.CSSProperties = {
    background: 'var(--color-bg-tertiary)',
    color: 'var(--color-text-primary)',
  };

  const selectStyle: React.CSSProperties = {
    background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
    borderRadius: 6, padding: '4px 8px', fontSize: '0.72rem',
    color: 'var(--color-text-primary)', outline: 'none', cursor: 'pointer',
  };

  const resultColor = (r: string) =>
    r === 'SUCCESS' ? '#10b981' : r === 'FAIL' ? '#ef4444' : '#f59e0b';

  const allSelected = logs.length > 0 && selectedIds.size === logs.length;

  return (
    <div className="modal-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="logviewer-modal-title" style={{ width: 750, maxWidth: '95vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--color-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 id="logviewer-modal-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{t('modals.logViewer')}</h2>
            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 8 }}>
              {t('logViewer.header.totalRecords', { count: totalCount })}
            </span>
            {selectedIds.size > 0 && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-accent)', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 8, fontWeight: 600 }}>
                {t('logViewer.header.selected', { count: selectedIds.size })}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {selectedIds.size > 0 && (
              <button onClick={handleDeleteSelected} className="btn btn-ghost"
                style={{ padding: '4px 10px', color: 'var(--color-danger)', fontSize: '0.72rem', gap: 4 }}
                title={t('logViewer.tooltip.deleteSelected', { count: selectedIds.size })}>
                <Trash2 size={13} /> {t('logViewer.button.deleteSelected')}
              </button>
            )}
            <button onClick={handleVerifyIntegrity} className="btn btn-ghost"
              style={{ padding: '4px 8px', color: integrityResult
                ? (integrityResult.valid ? '#10b981' : '#ef4444')
                : 'var(--color-text-muted)' }}
              title={t('logViewer.tooltip.verifyIntegrity')}>
              {integrityResult && !integrityResult.valid ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
            </button>
            <button onClick={loadLogs} className="btn btn-ghost" style={{ padding: '4px 8px' }} title={t('logViewer.tooltip.refresh')}>
              <RefreshCw size={14} />
            </button>
            <button onClick={() => setShowDateClear(!showDateClear)} className="btn btn-ghost"
              style={{ padding: '4px 8px', color: showDateClear ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              title={t('logViewer.tooltip.clearByDate')}>
              <Calendar size={14} />
            </button>
            <button onClick={handleClearAll} className="btn btn-ghost"
              style={{ padding: '4px 8px', color: 'var(--color-danger)' }} title={t('logViewer.tooltip.clearAll')}>
              <Trash2 size={14} />
            </button>
            <button onClick={onClose} aria-label={t('common.aria.close')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Tarih bazlı temizleme barı ── */}
        {showDateClear && (
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(244,63,94,0.04)',
          }}>
            <AlertTriangle size={14} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>{t('logViewer.dateBar.label')}</span>
            <select value={dateClearDays} onChange={(e) => setDateClearDays(Number(e.target.value))} style={selectStyle}>
              <option value={1} style={optionStyle}>{t('logViewer.dateBar.daysOld', { days: 1 })}</option>
              <option value={7} style={optionStyle}>{t('logViewer.dateBar.daysOld', { days: 7 })}</option>
              <option value={14} style={optionStyle}>{t('logViewer.dateBar.daysOld', { days: 14 })}</option>
              <option value={30} style={optionStyle}>{t('logViewer.dateBar.daysOld', { days: 30 })}</option>
              <option value={60} style={optionStyle}>{t('logViewer.dateBar.daysOld', { days: 60 })}</option>
              <option value={90} style={optionStyle}>{t('logViewer.dateBar.daysOld', { days: 90 })}</option>
            </select>
            <button onClick={handleClearByDate} className="btn btn-ghost"
              style={{ padding: '4px 12px', fontSize: '0.72rem', color: 'var(--color-danger)', gap: 4 }}>
              <Trash2 size={12} /> {t('logViewer.button.clearByDate')}
            </button>
          </div>
        )}

        {/* ── Bütünlük doğrulama sonuç banner ── */}
        {integrityResult && (
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: integrityResult.valid
              ? 'rgba(16,185,129,0.08)'
              : 'rgba(239,68,68,0.08)',
          }}>
            {integrityResult.valid
              ? <ShieldCheck size={16} style={{ color: '#10b981', flexShrink: 0, marginTop: 1 }} />
              : <ShieldAlert size={16} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />}
            <div style={{ flex: 1, fontSize: '0.74rem', lineHeight: 1.5 }}>
              {integrityResult.error ? (
                <span style={{ color: '#ef4444' }}>
                  {t('logViewer.integrity.error', { error: integrityResult.error })}
                </span>
              ) : integrityResult.valid ? (
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {t('logViewer.integrity.valid', { count: integrityResult.totalRows })}
                </span>
              ) : (
                <>
                  <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 2 }}>
                    {t('logViewer.integrity.invalid', {
                      broken: integrityResult.brokenRowIds.length,
                      total: integrityResult.totalRows,
                    })}
                  </div>
                  {integrityResult.firstBrokenId !== null && (
                    <div style={{ color: 'var(--color-text-secondary)' }}>
                      {t('logViewer.integrity.firstBroken', { id: integrityResult.firstBrokenId })}
                    </div>
                  )}
                  {integrityResult.missingHashCount > 0 && (
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', marginTop: 2 }}>
                      {t('logViewer.integrity.missingHash', { count: integrityResult.missingHashCount })}
                    </div>
                  )}
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.7rem', marginTop: 2 }}>
                    {t('logViewer.integrity.hint')}
                  </div>
                </>
              )}
            </div>
            <button onClick={() => setIntegrityResult(null)} aria-label={t('common.aria.close')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0 }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── Filtre ── */}
        <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Filter size={13} style={{ color: 'var(--color-text-muted)' }} />
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} style={selectStyle}>
            <option value="" style={optionStyle}>{t('logViewer.filter.allActions')}</option>
            <option value="SCAN_START" style={optionStyle}>{t('logViewer.action.scanStarted')}</option>
            <option value="SCAN_COMPLETE" style={optionStyle}>{t('logViewer.action.scanCompleted')}</option>
            <option value="SCAN_CANCEL" style={optionStyle}>{t('logViewer.action.scanCancelled')}</option>
            <option value="FILE_DELETE" style={optionStyle}>{t('logViewer.action.fileDeleted')}</option>
            <option value="SETTINGS_CHANGE" style={optionStyle}>{t('logViewer.action.settingsChanged')}</option>
            <option value="UNDO" style={optionStyle}>{t('topbar.tooltip.undo')}</option>
            <option value="REDO" style={optionStyle}>{t('topbar.tooltip.redo')}</option>
            <option value="ARCHIVE_EXPORT" style={optionStyle}>{t('logViewer.action.dbExport')}</option>
            <option value="AUDIT_LOG_CLEAR" style={optionStyle}>{t('logViewer.clearAll.success')}</option>
            <option value="MESSAGE_SEND" style={optionStyle}>{t('logViewer.action.messageSent')}</option>
            <option value="MESSAGE_REPLY" style={optionStyle}>{t('logViewer.action.messageReplied')}</option>
            <option value="MESSAGE_DELETE" style={optionStyle}>{t('logViewer.action.messageDelete')}</option>
          </select>
        </div>

        {/* ── Log tablosu ── */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
              {t('logViewer.table.empty')}
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: '0.72rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '8px 8px 8px 12px', fontWeight: 600, width: 32 }}>
                    <button onClick={handleSelectAll}
                      title={allSelected ? t('logViewer.tooltip.deselectAll') : t('logViewer.tooltip.selectAll')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                        color: allSelected ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        display: 'inline-flex', alignItems: 'center' }}>
                      <CheckSquare size={14} />
                    </button>
                  </th>
                  <th style={{ padding: '8px 8px', fontWeight: 600 }}>{t('logViewer.col.time')}</th>
                  <th style={{ padding: '8px 8px', fontWeight: 600 }}>{t('logViewer.col.role')}</th>
                  <th style={{ padding: '8px 8px', fontWeight: 600 }}>{t('logViewer.col.action')}</th>
                  <th style={{ padding: '8px 8px', fontWeight: 600 }}>{t('logViewer.col.target')}</th>
                  <th style={{ padding: '8px 8px', fontWeight: 600 }}>{t('logViewer.col.result')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isSelected = selectedIds.has(log.id);
                  const isExpanded = expandedId === log.id;
                  return (
                    <Fragment key={log.id}>
                      <tr
                        onClick={(e) => handleRowClick(log.id, e)}
                        onDoubleClick={() => toggleExpanded(log.id)}
                        style={{
                          borderBottom: isExpanded ? 'none' : '1px solid var(--color-border)',
                          background: isSelected ? 'rgba(99,102,241,0.08)' : 'transparent',
                          cursor: 'pointer', transition: 'background 120ms',
                        }}
                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                        onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={{ padding: '6px 8px 6px 12px', textAlign: 'center' }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: isSelected ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
                            background: isSelected ? 'var(--color-accent)' : 'transparent',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            transition: 'all 120ms',
                          }}>
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 5L4 7L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(log.timestamp).toLocaleString('tr-TR')}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{
                            padding: '1px 6px', borderRadius: 4, fontSize: '0.66rem', fontWeight: 600,
                            background: log.role === 'admin' ? 'rgba(99,102,241,0.1)' : 'rgba(168,85,247,0.1)',
                            color: log.role === 'admin' ? '#818cf8' : '#c084fc',
                          }}>
                            {log.role}
                          </span>
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                          {log.action}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.target}
                        </td>
                        <td style={{ padding: '6px 8px', fontWeight: 600, color: resultColor(log.result) }}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(log.id); }}
                            title={t('logViewer.detail.tooltip')}
                            style={{
                              background: 'none', border: 'none', padding: 0, color: 'inherit',
                              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontWeight: 'inherit', fontSize: 'inherit',
                            }}
                          >
                            {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            {log.result}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'rgba(99,102,241,0.04)' }}>
                          <td colSpan={6} style={{ padding: '12px 16px 16px 40px' }}>
                            <LogDetailContent log={log} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer: seçim bilgi barı ── */}
        {logs.length > 0 && (
          <div style={{
            padding: '6px 20px', borderTop: '1px solid var(--color-border)',
            fontSize: '0.64rem', color: 'var(--color-text-muted)',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>
              {selectedIds.size > 0
                ? t('logViewer.footer.selectedOf', { selected: selectedIds.size, total: logs.length })
                : t('logViewer.footer.showing', { count: logs.length })}
            </span>
            <span>{t('logViewer.footer.hint')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
