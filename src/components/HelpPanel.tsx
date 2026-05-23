/**
 * ArchivistPro — Help Panel v2
 *
 * Sol navigasyon ağacı + sağda içerik (Autodesk Help tarzı).
 * - MD başlıklarından otomatik nav ağacı (H2 daraltılabilir, H3 alt öğe)
 * - IntersectionObserver ile kaydırma sırasında aktif öğe takibi
 * - Anlık arama — nav öğelerini filtreler
 * - Klavye Kısayolları ve Teknik Referans özel bölümler olarak entegre
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X, Book, Keyboard, Shield, Eye, GripHorizontal, Search,
  ChevronRight, ChevronDown, FileCode2, Lightbulb, Sparkles,
} from 'lucide-react';
import { useIsAdmin } from '../permissions';
import { getAllShortcuts } from '../services/keyboardShortcuts';
import { fetchGuide, fetchChangelog } from '../services/helpSystem';
import { renderMarkdown } from '../utils/markdownRenderer';
import { APP_VERSION, APP_BUILD_DATE } from '../appVersion';

// ── Tipler ────────────────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  level: 2 | 3;
  children: NavItem[];
}

type ContentMode = 'guide' | 'shortcuts' | 'techref' | 'scenarios' | 'changelog';

interface HelpPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: ContentMode;
}

/** Yardım panelini belirli bir sekmeyle açmak için global event */
export const HELP_OPEN_EVENT = 'archivistpro:help-open';
export type HelpOpenDetail = { mode: ContentMode };

// ── Yardımcı: MD HTML'inden başlık ağacı çıkar ───────────────────────────────

function parseNavTree(html: string): NavItem[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  const tree: NavItem[] = [];
  let currentH2: NavItem | null = null;
  div.querySelectorAll('h2, h3').forEach((el) => {
    const level = parseInt(el.tagName[1]) as 2 | 3;
    const item: NavItem = { id: el.id || '', label: el.textContent || '', level, children: [] };
    if (level === 2) { tree.push(item); currentH2 = item; }
    else if (level === 3 && currentH2) currentH2.children.push(item);
  });
  return tree;
}

function itemMatchesSearch(item: NavItem, q: string): boolean {
  const ql = q.toLowerCase();
  return item.label.toLowerCase().includes(ql) || item.children.some(c => c.label.toLowerCase().includes(ql));
}

/**
 * HTML içindeki metin düğümlerinde (tag dışında) eşleşen kelimeleri
 * <mark class="help-highlight"> ile sarar. Tag attribute'larına dokunmaz.
 */
function highlightHtml(html: string, query: string): string {
  const q = query.trim();
  if (!q) return html;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  // >...</ arasındaki metin segmentlerini hedefle; tag içine girme
  return html.replace(/>([^<]+)</g, (_match, text: string) =>
    '>' + text.replace(regex, '<mark class="help-highlight">$1</mark>') + '<'
  );
}

// ── Bileşen ───────────────────────────────────────────────────────────────────

export default function HelpPanel({ isOpen, onClose, initialMode }: HelpPanelProps) {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const shortcuts = useMemo(() => getAllShortcuts().filter(s => s.enabled), [isOpen]);

  // İçerik
  const [mode, setMode] = useState<ContentMode>(initialMode || 'guide');

  // initialMode değiştiğinde (veya panel açıldığında) sekmeyi güncelle
  useEffect(() => {
    if (isOpen && initialMode) setMode(initialMode);
  }, [isOpen, initialMode]);
  const [guideHtml, setGuideHtml] = useState('');
  const [techRefHtml, setTechRefHtml] = useState('');
  const [scenariosHtml, setScenariosHtml] = useState('');
  const [changelogHtml, setChangelogHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nav durumu
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState('');

  // Ref'ler
  const contentRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Nav ağacı — guideHtml değişince yeniden oluştur
  const navTree = useMemo(() => guideHtml ? parseNavTree(guideHtml) : [], [guideHtml]);

  // Arama sonucu — eşleşen h2'ler (children filtresi dahil)
  const filteredTree = useMemo(() =>
    searchQuery ? navTree.filter(item => itemMatchesSearch(item, searchQuery)) : navTree,
    [navTree, searchQuery]
  );

  // Sağ içerik için highlight'lı HTML — nav araması değişince güncellenir
  const displayHtml = useMemo(
    () => mode === 'guide' ? highlightHtml(guideHtml, searchQuery) : guideHtml,
    [guideHtml, searchQuery, mode]
  );
  const displayTechRefHtml = useMemo(
    () => mode === 'techref' ? highlightHtml(techRefHtml, searchQuery) : techRefHtml,
    [techRefHtml, searchQuery, mode]
  );

  // ── Sürükleme ─────────────────────────────────────────────────────────────

  const [pos, setPos] = useState({
    x: Math.max(20, window.innerWidth / 2 - 430),
    y: Math.max(20, window.innerHeight / 2 - 320),
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const listenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: posRef.current.x, origY: posRef.current.y };
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      setPos({ x: dragRef.current.origX + ev.clientX - dragRef.current.startX, y: dragRef.current.origY + ev.clientY - dragRef.current.startY });
    };
    const up = () => {
      dragRef.current = null; listenersRef.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    listenersRef.current = { move, up };
  }, []);

  useEffect(() => () => {
    if (listenersRef.current) {
      document.removeEventListener('mousemove', listenersRef.current.move);
      document.removeEventListener('mouseup', listenersRef.current.up);
    }
  }, []);

  // ── Kılavuz yükleme ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGuide(isAdmin ? 'admin' : 'user')
      .then(({ markdown }) => {
        if (cancelled) return;
        const html = renderMarkdown(markdown);
        setGuideHtml(html);
        // İlk h2'yi varsayılan olarak aç
        const firstH2 = parseNavTree(html)[0];
        if (firstH2) setExpandedIds(new Set([firstH2.id]));
      })
      .catch(err => { if (!cancelled) setError(t('help.error.loadFailed', { message: err.message })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, isAdmin, t]);

  // ── Teknik referans yükleme ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || mode !== 'techref' || techRefHtml) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/docs/TECHNICAL_REFERENCE.md')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(md => { if (!cancelled) setTechRefHtml(renderMarkdown(md)); })
      .catch(err => { if (!cancelled) setError(t('help.error.loadFailed', { message: err.message })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, mode, techRefHtml, t]);

  // ── Kullanım senaryoları yükleme ────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || mode !== 'scenarios' || scenariosHtml) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchGuide('scenarios')
      .then(({ markdown }) => { if (!cancelled) setScenariosHtml(renderMarkdown(markdown)); })
      .catch(err => { if (!cancelled) setError(t('help.error.loadFailed', { message: err.message })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, mode, scenariosHtml, t]);

  // ── Sürüm notları yükleme ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || mode !== 'changelog' || changelogHtml) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchChangelog()
      .then(({ markdown }) => { if (!cancelled) setChangelogHtml(renderMarkdown(markdown)); })
      .catch(err => { if (!cancelled) setError(t('help.error.loadFailed', { message: err.message })); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, mode, changelogHtml, t]);

  // ── IntersectionObserver — aktif başlık takibi ────────────────────────────

  useEffect(() => {
    if (mode !== 'guide' || !contentRef.current || !guideHtml) return;
    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0 && visible[0].target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { root: contentRef.current, threshold: 0, rootMargin: '-8% 0px -65% 0px' }
    );

    contentRef.current.querySelectorAll('h2, h3').forEach(h => observerRef.current!.observe(h));
    return () => observerRef.current?.disconnect();
  }, [mode, guideHtml]);

  // Aktif öğenin h2 ebeveynini otomatik aç
  useEffect(() => {
    if (!activeId) return;
    navTree.forEach(item => {
      if (item.id === activeId || item.children.some(c => c.id === activeId)) {
        setExpandedIds(prev => { const s = new Set(prev); s.add(item.id); return s; });
      }
    });
  }, [activeId, navTree]);

  // Arama sorgusu değişince → sağ içerikte ilk highlight'a scroll
  useEffect(() => {
    if (!searchQuery.trim() || mode !== 'guide') return;
    // displayHtml DOM'a yansıyana kadar bir frame bekle
    requestAnimationFrame(() => {
      const first = contentRef.current?.querySelector('.help-highlight');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [displayHtml, mode, searchQuery]);

  // ── İçeriğe kaydır ───────────────────────────────────────────────────────

  const scrollToId = useCallback((id: string) => {
    if (!contentRef.current || !id) return;
    setMode('guide');
    // DOM güncellemesini bekle
    requestAnimationFrame(() => {
      const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setActiveId(id);
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  if (!isOpen) return null;

  // ── Nav öğesi render ──────────────────────────────────────────────────────

  const navItemStyle = (isActive: boolean, indent = false): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 4,
    padding: indent ? '3px 8px 3px 28px' : '5px 8px 5px 8px',
    cursor: 'pointer', borderRadius: 5,
    background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
    color: isActive ? '#818cf8' : indent ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
    fontSize: indent ? '0.71rem' : '0.74rem',
    fontWeight: isActive ? 600 : 400,
    lineHeight: 1.45,
    userSelect: 'none',
    transition: 'background 0.12s, color 0.12s',
  });

  const renderGuideNavItems = () => filteredTree.map(item => {
    const isItemActive = activeId === item.id;
    const isExpanded = expandedIds.has(item.id) || !!searchQuery;
    const hasChildren = item.children.length > 0;
    const visibleChildren = searchQuery
      ? item.children.filter(c => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : item.children;

    return (
      <div key={item.id}>
        {/* H2 */}
        <div
          style={navItemStyle(isItemActive)}
          onClick={() => { if (hasChildren) toggleExpand(item.id); if (item.id) scrollToId(item.id); }}
          onMouseEnter={e => { if (!isItemActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={e => { if (!isItemActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-text-muted)', display: 'flex' }}>
            {hasChildren
              ? (isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />)
              : <span style={{ display: 'inline-block', width: 11 }} />
            }
          </span>
          <span style={{ flex: 1 }}>{item.label}</span>
        </div>

        {/* H3 çocuklar */}
        {hasChildren && isExpanded && visibleChildren.map(child => {
          const isChildActive = activeId === child.id;
          return (
            <div
              key={child.id}
              style={navItemStyle(isChildActive, true)}
              onClick={() => scrollToId(child.id)}
              onMouseEnter={e => { if (!isChildActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
              onMouseLeave={e => { if (!isChildActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {child.label}
            </div>
          );
        })}
      </div>
    );
  });

  const specialNavItem = (label: string, icon: React.ReactNode, targetMode: ContentMode) => {
    const isActive = mode === targetMode;
    return (
      <div
        style={navItemStyle(isActive)}
        onClick={() => setMode(targetMode)}
        onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
      >
        <span style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-text-muted)', display: 'flex' }}>{icon}</span>
        <span style={{ flex: 1 }}>{label}</span>
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y,
      width: 860, maxWidth: '97vw',
      height: '86vh', maxHeight: '86vh',
      background: 'var(--color-bg-modal)',
      border: '1px solid var(--modal-border-color)',
      borderTopColor: 'var(--modal-border-top-color)',
      borderRadius: 16,
      zIndex: 900,
      display: 'flex', flexDirection: 'column',
      boxShadow: 'var(--shadow-modal)',
      overflow: 'hidden',
    }}>

      {/* ── Header ── */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--color-border)',
          cursor: 'move', userSelect: 'none', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GripHorizontal size={13} style={{ color: 'var(--color-text-muted)', opacity: 0.4 }} />
          <Book size={15} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
            {t('modals.help')}
          </span>
          {/* Rol rozeti */}
          <span style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 8px', borderRadius: 20,
            background: isAdmin ? 'rgba(99,102,241,0.1)' : 'rgba(168,85,247,0.1)',
            color: isAdmin ? '#818cf8' : '#c084fc',
            fontSize: '0.66rem', fontWeight: 600,
          }}>
            {isAdmin ? <Shield size={10} /> : <Eye size={10} />}
            {isAdmin ? t('help.role.admin') : t('help.role.viewer')}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label={t('help.aria.close')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4, borderRadius: 6, display: 'flex' }}
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Gövde: Sol nav + Sağ içerik ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* ── Sol Navigasyon ── */}
        <div style={{
          width: 224, flexShrink: 0,
          borderRight: '1px solid var(--color-border)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* Arama */}
          <div style={{ padding: '10px 10px 6px', flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid var(--color-border)',
              borderRadius: 8, padding: '5px 10px',
            }}>
              <Search size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('help.search')}
                style={{
                  background: 'none', border: 'none', outline: 'none', flex: 1,
                  fontSize: '0.72rem', color: 'var(--color-text-primary)',
                  minWidth: 0,
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--color-text-muted)', display: 'flex' }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Nav ağacı */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px 4px' }}>
            {/* Kılavuz başlıkları */}
            {loading && !guideHtml ? (
              <div style={{ padding: '12px 10px', fontSize: '0.71rem', color: 'var(--color-text-muted)' }}>
                {t('help.guide.loading')}
              </div>
            ) : (
              renderGuideNavItems()
            )}

            {/* Ayraç */}
            <div style={{ height: 1, background: 'var(--color-border)', margin: '8px 4px' }} />

            {/* Özel bölümler */}
            {specialNavItem(
              t('help.tab.scenarios'),
              <Lightbulb size={11} />,
              'scenarios'
            )}
            {specialNavItem(
              t('help.tab.shortcuts'),
              <Keyboard size={11} />,
              'shortcuts'
            )}
            {specialNavItem(
              t('help.tab.techRef'),
              <FileCode2 size={11} />,
              'techref'
            )}
            {specialNavItem(
              t('help.tab.changelog'),
              <Sparkles size={11} />,
              'changelog'
            )}
          </div>

          {/* Versiyon */}
          <div style={{
            padding: '6px 12px',
            borderTop: '1px solid var(--color-border)',
            fontSize: '0.62rem', color: 'var(--color-text-muted)', opacity: 0.6,
            flexShrink: 0,
          }}>
            ArchivistPro v{APP_VERSION} · {APP_BUILD_DATE}
          </div>
        </div>

        {/* ── Sağ İçerik ── */}
        <div
          ref={contentRef}
          style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}
        >
          {/* Kılavuz içeriği */}
          {mode === 'guide' && (
            <>
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  {t('help.guide.loading')}
                </div>
              )}
              {error && <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{error}</div>}
              {!loading && !error && guideHtml && (
                <div className="help-guide-content" dangerouslySetInnerHTML={{ __html: displayHtml }} />
              )}
            </>
          )}

          {/* Klavye kısayolları */}
          {mode === 'shortcuts' && (
            <div>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 16, paddingBottom: 8, borderBottom: '1px solid var(--color-border)' }}>
                {t('help.tab.shortcuts')}
              </h2>
              {shortcuts.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>—</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {shortcuts.map(s => (
                    <div key={s.id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 4px', fontSize: '0.78rem',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                    }}>
                      <span style={{ color: 'var(--color-text-secondary)' }}>{s.label}</span>
                      <kbd style={{
                        padding: '3px 8px', borderRadius: 5, fontSize: '0.7rem',
                        background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-border)',
                        color: 'var(--color-text-muted)', fontFamily: 'monospace',
                      }}>
                        {s.keys.join(' + ')}
                      </kbd>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Kullanım senaryoları */}
          {mode === 'scenarios' && (
            <>
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  {t('help.guide.loading')}
                </div>
              )}
              {error && <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{error}</div>}
              {!loading && !error && scenariosHtml && (
                <div className="help-guide-content" dangerouslySetInnerHTML={{ __html: scenariosHtml }} />
              )}
            </>
          )}

          {/* Teknik referans */}
          {mode === 'techref' && (
            <>
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  {t('help.guide.loading')}
                </div>
              )}
              {error && <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{error}</div>}
              {!loading && !error && techRefHtml && (
                <div className="help-guide-content" dangerouslySetInnerHTML={{ __html: displayTechRefHtml }} />
              )}
            </>
          )}

          {/* Sürüm notları */}
          {mode === 'changelog' && (
            <>
              {loading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-muted)', fontSize: '0.78rem' }}>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  {t('help.guide.loading')}
                </div>
              )}
              {error && <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{error}</div>}
              {!loading && !error && changelogHtml && (
                <div className="help-guide-content" dangerouslySetInnerHTML={{ __html: changelogHtml }} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
