import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Copy, AlertTriangle, ChevronDown, ChevronRight, Trash2, HelpCircle, Settings2, GitCompare } from 'lucide-react';
import AdvancedCriteriaPanel from './duplicateFinder/AdvancedCriteriaPanel';
import DuplicateCompareView from './duplicateFinder/DuplicateCompareView';
import { formatBytes, formatDate, FORMAT_GROUPS, TYPE_LABELS, TYPE_ORDER, FORMAT_COLORS, assetThumbSrc, type FormatGroupKey } from './duplicateFinder/duplicateHelpers';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { runDuplicateScan, isVisualAsset, isStructuralAsset, hasStructuralMetadata, DEFAULT_CRITERIA, DEFAULT_PERFORMANCE_FILTERS } from '../services/duplicateDetection';
import { getAllAssetsFromArchive, softDeleteAssetFromArchive, isArchiveReady, MAIN_ARCHIVE_ID } from '../services/database';
import { notifySuccess, notifyError } from '../services/notificationCenter';
import { mapTauriError } from '../services/errorMapper';
import { useStore } from '../store/useStore';
import { useIsAdmin } from '../permissions';
import type { Asset } from '../types';
import type { ArchiveType } from '../services/database';
import type { DuplicateGroup, DuplicateScanOptions, DuplicateScanResult, ComparisonCriteria, PerformanceFilters } from '../services/duplicateDetection';
import ModalErrorBoundary from './ModalErrorBoundary';

interface DuplicateFinderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onHelpClick?: () => void;
  seedAssetId?: string | null;
  /** Sağ tık alt seçeneğinden gelen başlangıç eşiği — null ise default 75 kullanılır. */
  initialThreshold?: number | null;
}

// formatBytes, formatDate, FORMAT_GROUPS, TYPE_LABELS, TYPE_ORDER,
// FORMAT_COLORS, assetThumbSrc → duplicateFinder/duplicateHelpers.ts

function DuplicateFinderModalInner({ isOpen, onClose, onHelpClick, seedAssetId, initialThreshold }: DuplicateFinderModalProps) {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const focusTrapRef = useFocusTrap(isOpen, onClose);

  const [scope, setScope] = useState<ArchiveType>(MAIN_ARCHIVE_ID);
  const archives = useStore((s) => s.archives);
  const setIsScanModalOpen = useStore((s) => s.setIsScanModalOpen);
  const setPendingRescanPaths = useStore((s) => s.setPendingRescanPaths);

  // Kapsama göre assetleri yükle (aktif arşivi değiştirmez)
  const scopeAssets = getAllAssetsFromArchive(scope);

  const structuralAssetCount = scopeAssets.filter(a => isStructuralAsset(a)).length;

  const missingPhashAssets = useMemo(
    () => scopeAssets.filter(a => isVisualAsset(a) && !a.phash),
    [scopeAssets]
  );
  const missingMetaAssets = useMemo(
    () => scopeAssets.filter(a => isStructuralAsset(a) && !hasStructuralMetadata(a)),
    [scopeAssets]
  );

  // Bu kapsam için silme yetkisi: admin her zaman, viewer sadece personal tip arşivlerde
  const scopeDef = archives.find(a => a.id === scope);
  const canDelete = isAdmin || scopeDef?.type === 'personal';

  const [options, setOptions] = useState<DuplicateScanOptions>({
    checkExactHash: true,
    checkSameName: false,
    checkVisual: false,
    checkStructural: false,
    threshold: initialThreshold ?? 75,
    criteria: { ...DEFAULT_CRITERIA },
    performance: { ...DEFAULT_PERFORMANCE_FILTERS },
  });

  // Detay paneli — portal ile body'ye render edilir, fixed position viewport'a göre
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);
  const detailButtonRef = useRef<HTMLDivElement>(null);
  const portalPanelRef = useRef<HTMLDivElement>(null);

  // Format filtresi (canlı, rescan gerekmez) — boş = hepsi gösterilir
  const [enabledFormats, setEnabledFormats] = useState<Set<FormatGroupKey>>(
    new Set(FORMAT_GROUPS.map(g => g.key))
  );

  // Son taramada kullanılan kriterler + performans — mevcut ile karşılaştırarak uyarı göster
  const [lastScannedCriteria, setLastScannedCriteria] = useState<ComparisonCriteria | null>(null);
  const [lastScannedPerf, setLastScannedPerf] = useState<PerformanceFilters | null>(null);

  // Detay paneli dışına tıklayınca kapat — portal nedeniyle hem buton hem panel ref'ini kontrol et
  useEffect(() => {
    if (!showDetailPanel) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const insideButton = detailButtonRef.current?.contains(target);
      const insidePanel = portalPanelRef.current?.contains(target);
      if (!insideButton && !insidePanel) {
        setShowDetailPanel(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowDetailPanel(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showDetailPanel]);

  // Panel pozisyonunu butonun viewport koordinatlarından hesapla
  useEffect(() => {
    if (!showDetailPanel) {
      setPanelPos(null);
      return;
    }
    function computePos() {
      const btn = detailButtonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      // Panel butonun altında, sol kenarına hizalı; ekran kenarını taşmasın diye sınırla
      const PANEL_WIDTH = 460;
      const margin = 12;
      let left = rect.left;
      if (left + PANEL_WIDTH + margin > window.innerWidth) {
        left = Math.max(margin, window.innerWidth - PANEL_WIDTH - margin);
      }
      setPanelPos({ top: rect.bottom + 6, left });
    }
    computePos();
    window.addEventListener('resize', computePos);
    window.addEventListener('scroll', computePos, true);
    return () => {
      window.removeEventListener('resize', computePos);
      window.removeEventListener('scroll', computePos, true);
    };
  }, [showDetailPanel]);

  const [result, setResult] = useState<DuplicateScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'compare'>('list');
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [skipMissing, setSkipMissing] = useState(false);
  const [skipMissingPhash, setSkipMissingPhash] = useState(false);
  const [skipMissingMeta, setSkipMissingMeta] = useState(false);
  const [showMissingPhashList, setShowMissingPhashList] = useState(false);
  const [showMissingMetaList, setShowMissingMetaList] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const handleScan = useCallback(() => {
    // Önceki taramayı iptal et
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsScanning(true);
    setResult(null);
    setMarked(new Set());
    setCompareIds(null);
    setSkipMissing(false);
    setSkipMissingPhash(false);
    setSkipMissingMeta(false);
    setLastScannedCriteria({ ...options.criteria });
    setLastScannedPerf({ ...(options.performance ?? DEFAULT_PERFORMANCE_FILTERS) });

    // yield to React to render scanning state, then run async scan
    setTimeout(async () => {
      try {
        const scanResult = await runDuplicateScan(scopeAssets, options, controller.signal);
        if (!controller.signal.aborted) {
          setResult(scanResult);
          setExpanded(new Set(scanResult.groups.map(g => g.id)));
        } else {
          // İptal — kısmi sonuçları göster
          setResult(scanResult);
          setExpanded(new Set(scanResult.groups.map(g => g.id)));
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          notifyError(t('common.error.prefix'), mapTauriError(err));
        }
      } finally {
        setIsScanning(false);
      }
    }, 50);
  }, [scopeAssets, options, t]);

  const handleCancelScan = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // seedAssetId ile açıldığında otomatik tara — en güncel handleScan'i ref üzerinden çağır.
  // initialThreshold verilmişse önce eşiği güncelle, ardından tara.
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;
  useEffect(() => {
    if (isOpen && seedAssetId) {
      if (initialThreshold != null) {
        setOptions(prev => ({ ...prev, threshold: initialThreshold }));
      }
      handleScanRef.current();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, seedAssetId]);

  const toggleMark = useCallback((id: string) => {
    setMarked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const markGroupKeepFirst = useCallback((group: DuplicateGroup) => {
    // Sort by modifiedAt descending — keep newest, mark rest
    const sorted = [...group.assets].sort((a, b) =>
      (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '')
    );
    setMarked(prev => {
      const next = new Set(prev);
      sorted.slice(1).forEach(a => next.add(a.id));
      return next;
    });
  }, []);

  const handleDeleteMarked = useCallback(() => {
    if (marked.size === 0) return;
    const count = marked.size;
    useStore.getState().showConfirmDialog(
      t('duplicateFinder.confirmDeleteMultiple', { count }),
      t('duplicateFinder.confirmDeleteMultipleDetail'),
      () => {
        let deleted = 0;
        const toDelete = [...marked];
        for (const id of toDelete) {
          try {
            softDeleteAssetFromArchive(id, scope);
            deleted++;
          } catch {
            // continue
          }
        }
        if (deleted > 0) {
          const current = useStore.getState().scannedAssets ?? [];
          const currentArchive = useStore.getState().activeArchive ?? MAIN_ARCHIVE_ID;
          if (currentArchive === scope) {
            useStore.getState().setScannedAssets(current.filter(a => !marked.has(a.id)));
          }
          notifySuccess(t('duplicateFinder.deleteSuccess', { count: deleted }), '');
          setMarked(new Set());
          setResult(prev => {
            if (!prev) return prev;
            const newGroups = prev.groups
              .map(g => ({ ...g, assets: g.assets.filter(a => !toDelete.includes(a.id)) }))
              .filter(g => g.assets.length >= 2);
            return { ...prev, groups: newGroups };
          });
          setCompareIds(prev => {
            if (!prev) return prev;
            if (toDelete.includes(prev[0]) || toDelete.includes(prev[1])) return null;
            return prev;
          });
        }
      },
      undefined,
      true,
    );
  }, [marked, scope, t]);

  const handleDeleteSingle = useCallback((asset: Asset) => {
    useStore.getState().showConfirmDialog(
      t('duplicateFinder.confirmDeleteSingle', { name: asset.fileName }),
      undefined,
      () => {
    try {
      softDeleteAssetFromArchive(asset.id, scope);
      const current = useStore.getState().scannedAssets ?? [];
      const currentArchive = useStore.getState().activeArchive ?? MAIN_ARCHIVE_ID;
      if (currentArchive === scope) {
        useStore.getState().setScannedAssets(current.filter(a => a.id !== asset.id));
      }
      notifySuccess(t('duplicateFinder.deleteSuccess', { count: 1 }), '');
      setMarked(prev => { const next = new Set(prev); next.delete(asset.id); return next; });
      setResult(prev => {
        if (!prev) return prev;
        const newGroups = prev.groups
          .map(g => ({ ...g, assets: g.assets.filter(a => a.id !== asset.id) }))
          .filter(g => g.assets.length >= 2);
        return { ...prev, groups: newGroups };
      });
      setCompareIds(prev => {
        if (!prev) return prev;
        if (prev[0] === asset.id || prev[1] === asset.id) return null;
        return prev;
      });
    } catch (err) {
      notifyError(t('common.error.prefix'), mapTauriError(err));
    }
      },
      undefined,
      true,
    );
  }, [scope, t]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const compareGroup = useCallback((group: DuplicateGroup) => {
    const [a, b] = group.assets;
    if (!a || !b) return;
    setCompareIds([a.id, b.id]);
    setViewMode('compare');
  }, []);

  const toggleFormatGroup = useCallback((key: FormatGroupKey) => {
    setEnabledFormats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const updateCriteria = useCallback(<K extends keyof ComparisonCriteria>(key: K, value: ComparisonCriteria[K]) => {
    setOptions(prev => ({ ...prev, criteria: { ...prev.criteria, [key]: value } }));
  }, []);

  const updatePerformance = useCallback(<K extends keyof PerformanceFilters>(key: K, value: PerformanceFilters[K]) => {
    setOptions(prev => ({
      ...prev,
      performance: { ...(prev.performance ?? DEFAULT_PERFORMANCE_FILTERS), [key]: value },
    }));
  }, []);

  // Genel kriter göstergesi (panel butonu yanında küçük nokta için)
  const generalCriteriaActive =
    options.criteria.sameSize ||
    options.criteria.sameModifiedWithinDays > 0 ||
    options.criteria.sameParentFolder ||
    (options.performance?.minFileSizeKb ?? 0) > 0;

  // Format filtresini + tik filtrelerini uygula — early return'den ÖNCE (hooks koşullu çağrılamaz)
  const allFormatsEnabled = enabledFormats.size === FORMAT_GROUPS.length;
  const filteredGroups = useMemo(() => {
    if (!isOpen || !result) return [];
    const typeEnabled: Record<string, boolean> = {
      'exact-hash':          options.checkExactHash,
      'same-name':           options.checkSameName,
      'visual-similar':      options.checkVisual,
      'structural-similar':  options.checkStructural,
    };
    let groups = result.groups.filter(group => {
      // 1. Tik filtresi: ilgili kategori tikli değilse gizle
      if (!typeEnabled[group.type]) return false;
      // 2. Format filtresi
      if (allFormatsEnabled) return true;
      return group.assets.some(asset => {
        const type = (asset.fileType ?? '').toUpperCase();
        return FORMAT_GROUPS.some(fg => enabledFormats.has(fg.key) && fg.types.has(type as never));
      });
    });
    // 3. Seed asset filtresi: sadece seed'i içeren grupları göster
    if (seedAssetId) {
      groups = groups.filter(g => g.assets.some(a => a.id === seedAssetId));
    }
    return groups;
  }, [isOpen, result, enabledFormats, allFormatsEnabled,
      options.checkExactHash, options.checkSameName, options.checkVisual, options.checkStructural,
      seedAssetId]);

  if (!isOpen) return null;

  // Groups by type for rendering in order
  const groupedByType = TYPE_ORDER.map(type => ({
    type,
    groups: filteredGroups.filter(g => g.type === type),
  })).filter(({ groups }) => groups.length > 0);

  const totalFiles = filteredGroups.reduce((s, g) => s + g.assets.length, 0);

  const compareAssets: Array<(typeof scopeAssets)[0] | undefined> = compareIds
    ? [
        scopeAssets.find(a => a.id === compareIds[0]),
        scopeAssets.find(a => a.id === compareIds[1]),
      ]
    : [undefined, undefined];

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('duplicateFinder.title')}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={focusTrapRef}
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          width: '100%', maxWidth: 860,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Copy size={17} style={{ color: 'var(--color-accent)' }} />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>{t('duplicateFinder.title')}</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {onHelpClick && (
              <button className="btn btn-ghost" onClick={onHelpClick}
                aria-label={t('topbar.tooltip.help')} title={t('topbar.tooltip.help')}
                style={{ padding: '4px 8px', color: 'var(--color-text-muted)' }}>
                <HelpCircle size={15} />
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} aria-label={t('common.close')} style={{ padding: '4px 8px' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Options — karşılaştırma modunda gizlenir */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0, display: viewMode === 'compare' ? 'none' : undefined }}>
          {/* Kapsam seçici */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {archives.map(arch => {
              const ready = isArchiveReady(arch.id);
              return (
                <button
                  key={arch.id}
                  className={`btn ${scope === arch.id ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ padding: '4px 14px', fontSize: '0.82rem' }}
                  onClick={() => { setScope(arch.id); setResult(null); setMarked(new Set()); }}
                  disabled={!ready}
                  title={!ready ? 'Arşiv henüz yüklenmedi' : arch.name}
                >
                  {arch.name}
                  {!ready && ' (—)'}
                </button>
              );
            })}
            {!canDelete && (
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', alignSelf: 'center', marginLeft: 4 }}>
                · {t('duplicateFinder.viewerDeleteHint')}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', marginBottom: 12 }}>
            {(
              [
                ['checkExactHash', 'checkExactHash'],
                ['checkSameName', 'checkSameName'],
                ['checkVisual', 'checkVisual'],
                ['checkStructural', 'checkStructural'],
              ] as [keyof DuplicateScanOptions, string][]
            ).map(([key, labelKey]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={options[key] as boolean}
                  onChange={e => setOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                {t(`duplicateFinder.${labelKey}`)}
              </label>
            ))}
          </div>

          {(options.checkVisual || options.checkStructural) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                {t('duplicateFinder.threshold')}
              </span>
              <input
                type="range" min={40} max={99} step={1}
                value={options.threshold}
                onChange={e => setOptions(prev => ({ ...prev, threshold: Number(e.target.value) }))}
                style={{ flex: 1, maxWidth: 200, accentColor: 'var(--color-accent)' }}
              />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, minWidth: 36 }}>
                {t('duplicateFinder.similarity', { score: options.threshold })}
              </span>
            </div>
          )}

          {/* O(n²) uyarı — görsel veya yapısal açıkken ve büyük arşivde */}
          {(options.checkVisual || options.checkStructural) && scopeAssets.length > 500 && (
            <div style={{
              padding: '6px 12px', borderRadius: 6, fontSize: '0.72rem', lineHeight: 1.5,
              background: 'rgba(249,200,70,0.1)', border: '1px solid rgba(249,200,70,0.3)',
              color: '#f9c846', marginBottom: 4,
            }}>
              ⚠ {t('duplicateFinder.largeArchiveWarning', { count: scopeAssets.length })}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={handleScan}
              disabled={isScanning}
              style={{ padding: '7px 20px' }}
            >
              {isScanning ? t('duplicateFinder.scanning') : t('duplicateFinder.scan')}
            </button>
            {isScanning && (
              <button
                className="btn btn-ghost"
                onClick={handleCancelScan}
                style={{ padding: '7px 14px', color: 'var(--color-danger)', fontWeight: 600 }}
              >
                {t('duplicateFinder.cancel')}
              </button>
            )}
            {/* Gelişmiş Kriterler butonu — panel portal ile body'ye render edilir */}
            <div ref={detailButtonRef}>
              <button
                className={`btn ${showDetailPanel ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 5 }}
                onClick={() => setShowDetailPanel(p => !p)}
                title={t('duplicateFinder.advancedCriteria')}
              >
                <Settings2 size={15} />
                <span style={{ fontSize: '0.82rem' }}>{t('duplicateFinder.advancedCriteria')}</span>
                {(!allFormatsEnabled || generalCriteriaActive) && (
                  <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: 'var(--color-accent)', flexShrink: 0,
                  }} />
                )}
              </button>

              {/* Panel — portal: AdvancedCriteriaPanel */}
              {showDetailPanel && panelPos && createPortal(
                <AdvancedCriteriaPanel
                  criteria={options.criteria}
                  updateCriteria={updateCriteria}
                  performance={options.performance}
                  updatePerformance={updatePerformance}
                  enabledFormats={enabledFormats}
                  toggleFormatGroup={toggleFormatGroup}
                  result={result}
                  lastScannedCriteria={lastScannedCriteria}
                  lastScannedPerf={lastScannedPerf}
                  panelRef={portalPanelRef}
                  panelPos={panelPos}
                />,
                document.body
              )}
            </div>
          </div>
          {options.checkStructural && structuralAssetCount > 300 && (
            <div style={{
              marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
              fontSize: '0.78rem', color: 'var(--color-warning)',
            }}>
              <AlertTriangle size={13} />
              {t('duplicateFinder.structuralPerfWarning', { count: structuralAssetCount })}
            </div>
          )}
        </div>

        {/* Missing hash warning — karşılaştırma modunda gizlenir */}
        {viewMode !== 'compare' && result && result.missingHashCount > 0 && !skipMissing && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 20px', background: 'var(--color-warning-bg, rgba(250,200,0,0.08))',
            borderBottom: '1px solid var(--color-border)', flexShrink: 0, fontSize: '0.82rem',
          }}>
            <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              {t('duplicateFinder.missingHash', { count: result.missingHashCount })}
            </span>
            <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
              onClick={() => setSkipMissing(true)}>
              {t('duplicateFinder.skipMissing')}
            </button>
          </div>
        )}

        {/* Missing pHash warning */}
        {viewMode !== 'compare' && result && result.missingPhashCount > 0 && !skipMissingPhash && (
          <div style={{
            borderBottom: '1px solid var(--color-border)', flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 20px',
              background: 'var(--color-warning-bg, rgba(250,200,0,0.08))',
              fontSize: '0.82rem',
            }}>
              <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                {t('duplicateFinder.missingPhash', { count: result.missingPhashCount })}
              </span>
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                onClick={() => setShowMissingPhashList(v => !v)}>
                {showMissingPhashList ? t('duplicateFinder.hideFiles') : t('duplicateFinder.showFiles')}
              </button>
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                onClick={() => {
                  setPendingRescanPaths(missingPhashAssets.map(a => a.filePath));
                  onClose();
                  setIsScanModalOpen(true);
                }}>
                {t('duplicateFinder.rescanThese')}
              </button>
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                onClick={() => setSkipMissingPhash(true)}>
                {t('duplicateFinder.skipMissing')}
              </button>
            </div>
            {showMissingPhashList && (
              <div style={{
                padding: '8px 20px 10px', background: 'var(--color-bg-tertiary)',
                maxHeight: 160, overflowY: 'auto', fontSize: '0.78rem',
              }}>
                {missingPhashAssets.map(a => (
                  <div key={a.id} style={{
                    color: 'var(--color-text-secondary)', padding: '2px 0',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={a.filePath}>
                    {a.filePath}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Missing metadata warning */}
        {viewMode !== 'compare' && result && result.missingMetadataCount > 0 && !skipMissingMeta && (
          <div style={{
            borderBottom: '1px solid var(--color-border)', flexShrink: 0,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 20px',
              background: 'var(--color-warning-bg, rgba(250,200,0,0.08))',
              fontSize: '0.82rem',
            }}>
              <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>
                {t('duplicateFinder.missingMetadata', { count: result.missingMetadataCount })}
              </span>
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                onClick={() => setShowMissingMetaList(v => !v)}>
                {showMissingMetaList ? t('duplicateFinder.hideFiles') : t('duplicateFinder.showFiles')}
              </button>
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                onClick={() => {
                  setPendingRescanPaths(missingMetaAssets.map(a => a.filePath));
                  onClose();
                  setIsScanModalOpen(true);
                }}>
                {t('duplicateFinder.rescanThese')}
              </button>
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }}
                onClick={() => setSkipMissingMeta(true)}>
                {t('duplicateFinder.skipMissing')}
              </button>
            </div>
            {showMissingMetaList && (
              <div style={{
                padding: '8px 20px 10px', background: 'var(--color-bg-tertiary)',
                maxHeight: 160, overflowY: 'auto', fontSize: '0.78rem',
              }}>
                {missingMetaAssets.map(a => (
                  <div key={a.id} style={{
                    color: 'var(--color-text-secondary)', padding: '2px 0',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={a.filePath}>
                    {a.filePath}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>

          {/* Results header + view toggle */}
          {result && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                {filteredGroups.length === 0
                  ? t('duplicateFinder.noResults')
                  : t('duplicateFinder.results', { groups: filteredGroups.length, total: totalFiles })}
                {!allFormatsEnabled && result.groups.length !== filteredGroups.length && (
                  <span style={{ marginLeft: 6, opacity: 0.6 }}>
                    ({result.groups.length} toplam, filtre aktif)
                  </span>
                )}
                {result.durationMs > 0 && (
                  <span style={{ marginLeft: 6, opacity: 0.5 }}>{result.durationMs}ms</span>
                )}
                {result.cancelled && (
                  <span style={{ marginLeft: 6, color: '#f9c846', fontWeight: 600 }}>
                    ({t('duplicateFinder.cancelledPartial')})
                  </span>
                )}
              </span>
              {result.groups.length > 0 && viewMode === 'compare' && (
                <button
                  className="btn btn-ghost"
                  style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                  onClick={() => setViewMode('list')}
                >
                  ← {t('duplicateFinder.viewList')}
                </button>
              )}
            </div>
          )}

          {/* LIST VIEW */}
          {viewMode === 'list' && groupedByType.map(({ type, groups }) => (
            <div key={type} style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em',
                color: 'var(--color-text-muted)', textTransform: 'uppercase',
                marginBottom: 8,
              }}>
                {t(`duplicateFinder.${TYPE_LABELS[type]}`)}
                <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.7 }}>
                  {`— ${groups.length} ${t('duplicateFinder.groupLabel')}`}
                </span>
              </div>

              {groups.map(group => (
                <div key={group.id} style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 8, overflow: 'hidden',
                }}>
                  {/* Group header */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 12px', cursor: 'pointer',
                      background: 'var(--color-bg-tertiary)',
                      borderBottom: expanded.has(group.id) ? '1px solid var(--color-border)' : 'none',
                    }}
                    onClick={() => toggleExpand(group.id)}
                  >
                    {expanded.has(group.id)
                      ? <ChevronDown size={14} />
                      : <ChevronRight size={14} />
                    }
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      {group.assets[0]?.fileName ?? '—'}
                      {group.assets.length > 1 && !group.assets.every(a => a.fileName === group.assets[0]?.fileName) && (
                        <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: 4 }}>
                          {t('duplicateFinder.andOthers')}
                        </span>
                      )}
                    </span>
                    <span style={{
                      fontSize: '0.72rem', background: 'var(--color-accent-glow)',
                      color: 'var(--color-accent)', borderRadius: 4, padding: '1px 7px', fontWeight: 600,
                    }}>
                      {group.type === 'exact-hash' || group.type === 'same-name'
                        ? t('duplicateFinder.copiesCount', { count: group.assets.length })
                        : t('duplicateFinder.similarCount', { count: group.assets.length })}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                      {group.detail.reason}
                    </span>
                    {group.detail.matchedFields?.map((f, i) => (
                      <span key={i} style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginLeft: 6 }}>
                        · {f}
                      </span>
                    ))}
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 8px', fontSize: '0.74rem', marginLeft: 8, flexShrink: 0 }}
                      onClick={e => { e.stopPropagation(); compareGroup(group); }}
                    >
                      <GitCompare size={11} style={{ marginRight: 3 }} />
                      {t('duplicateFinder.viewCompare')}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '2px 8px', fontSize: '0.74rem', flexShrink: 0 }}
                      onClick={e => { e.stopPropagation(); markGroupKeepFirst(group); }}
                      title={t('duplicateFinder.keepFirst')}
                    >
                      {t('duplicateFinder.keepFirst')}
                    </button>
                  </div>

                  {/* Asset rows */}
                  {expanded.has(group.id) && group.assets.map(asset => (
                    <div key={asset.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '6px 12px',
                      borderBottom: '1px solid var(--color-border)',
                      background: marked.has(asset.id)
                        ? 'var(--color-danger-glow, rgba(239,68,68,0.06))'
                        : compareIds && (compareIds[0] === asset.id || compareIds[1] === asset.id)
                          ? 'var(--color-accent-glow, rgba(139,92,246,0.08))'
                          : undefined,
                    }}>
                      <input
                        type="checkbox"
                        checked={marked.has(asset.id)}
                        onChange={() => toggleMark(asset.id)}
                        style={{ accentColor: 'var(--color-danger)', flexShrink: 0 }}
                      />
                      {/* Thumbnail */}
                      {(() => {
                        const src = assetThumbSrc(asset);
                        const typeKey = asset.fileType?.toUpperCase() ?? '';
                        const color = FORMAT_COLORS[typeKey] ?? '#6b7280';
                        return src ? (
                          <img
                            src={src}
                            alt=""
                            style={{
                              width: 36, height: 36, objectFit: 'cover',
                              borderRadius: 4, flexShrink: 0,
                              border: '1px solid var(--color-border)',
                              background: 'var(--color-bg-tertiary)',
                            }}
                          />
                        ) : (
                          <div style={{
                            width: 36, height: 36, flexShrink: 0,
                            borderRadius: 4, background: `${color}22`,
                            border: `1px solid ${color}55`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.6rem', fontWeight: 700, color,
                            lineHeight: 1, textAlign: 'center', padding: '0 2px',
                          }}>
                            {typeKey || '?'}
                          </div>
                        );
                      })()}
                      <span style={{
                        flex: 2, fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', color: 'var(--color-text-secondary)',
                      }} title={asset.filePath}>
                        {asset.filePath}
                      </span>
                      <span style={{ flex: '0 0 70px', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                        {formatBytes(asset.fileSize)}
                      </span>
                      <span style={{ flex: '0 0 90px', fontSize: '0.78rem', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                        {formatDate(asset.modifiedAt)}
                      </span>
                      {canDelete && (
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '2px 6px', color: 'var(--color-danger)' }}
                          title={t('common.delete')}
                          onClick={() => handleDeleteSingle(asset)}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* COMPARE VIEW — DuplicateCompareView */}
          {viewMode === 'compare' && (
            <DuplicateCompareView
              compareIds={compareIds}
              compareAssets={compareAssets}
              result={result}
              canDelete={canDelete}
              onDeleteSingle={handleDeleteSingle}
            />
          )}
        </div>

        {/* Footer */}
        {marked.size > 0 && canDelete && (
          <div style={{
            padding: '10px 20px', borderTop: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10,
            flexShrink: 0, background: 'var(--color-bg-secondary)',
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
              {t('duplicateFinder.selectedCount', { count: marked.size })}
            </span>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--color-danger)', borderColor: 'var(--color-danger)', padding: '6px 18px' }}
              onClick={handleDeleteMarked}
            >
              <Trash2 size={14} style={{ marginRight: 6 }} />
              {t('duplicateFinder.deleteSelected', { count: marked.size })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DuplicateFinderModal(props: DuplicateFinderModalProps) {
  if (!props.isOpen) return null;
  return (
    <ModalErrorBoundary onClose={props.onClose}>
      <DuplicateFinderModalInner {...props} />
    </ModalErrorBoundary>
  );
}

export type { DuplicateFinderModalProps };
