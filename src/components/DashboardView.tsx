import { useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, FileText, Box, Image, HardDrive, TrendingUp, Sparkles, Database, Calendar, ClipboardCheck, CheckCircle2, XCircle, Eye } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import type { Asset } from '../types';
import type { FacetKey } from '../types';
import { formatFileSize } from '../data';
import { useStore } from '../store/useStore';
import { useIsAdmin } from '../permissions';
import { updateAssetFields, getApprovalLog } from '../services/database';
import { notifySuccess, notifyInfo } from '../services/notificationCenter';
import AdminActivityPanel from './AdminActivityPanel';

const PIE_COLORS = [
    'var(--color-accent)', 'var(--color-accent-secondary)',
    'var(--color-success)', 'var(--color-warning)',
    '#60a5fa', '#f472b6', '#34d399', '#fbbf24',
];

interface DashboardViewProps {
    assets: Asset[];
}

export default function DashboardView({ assets }: DashboardViewProps) {
    const { t } = useTranslation();
    const isAdmin = useIsAdmin();
    const setViewMode = useStore((s) => s.setViewMode);
    const setActiveFilters = useStore((s) => s.setActiveFilters);

    const handleStatClick = useCallback((filterKey: FacetKey, filterValue: string) => {
        setActiveFilters((prev: Partial<Record<FacetKey, string[]>>) => ({ ...prev, [filterKey]: [filterValue] }));
        setViewMode('explorer');
    }, [setActiveFilters, setViewMode]);
    const stats = useMemo(() => {
        const totalSize = assets.reduce((acc, a) => acc + a.fileSize, 0);
        const projects = new Set(assets.map(a => a.projectName));
        const categories: Record<string, number> = {};
        const types: Record<string, number> = {};
        const styles: Record<string, number> = {};
        const sizeByType: Record<string, number> = {};

        assets.forEach(a => {
            categories[a.category] = (categories[a.category] || 0) + 1;
            types[a.fileType] = (types[a.fileType] || 0) + 1;
            if (a.architecturalStyle) styles[a.architecturalStyle] = (styles[a.architecturalStyle] || 0) + 1;
            sizeByType[a.fileType] = (sizeByType[a.fileType] || 0) + a.fileSize;
        });

        // Aylık büyüme — son 12 ay (createdAt bazlı). Şimdiki ay dahil.
        const now = new Date();
        const monthlyMap = new Map<string, number>();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyMap.set(key, 0);
        }
        assets.forEach(a => {
            if (!a.createdAt) return;
            const d = new Date(a.createdAt);
            if (Number.isNaN(d.getTime())) return;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyMap.has(key)) {
                monthlyMap.set(key, (monthlyMap.get(key) ?? 0) + 1);
            }
        });
        const monthlyGrowth = Array.from(monthlyMap.entries());

        return { totalSize, projects: projects.size, categories, types, styles, sizeByType, monthlyGrowth };
    }, [assets]);

    const sortedEntries = (obj: Record<string, number>) =>
        Object.entries(obj).sort((a, b) => b[1] - a[1]);

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            {/* Top Stats Row */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16, marginBottom: 24,
            }}>
                {[
                    { icon: <FolderOpen size={20} />, value: assets.length, label: t('dashboard.stat.totalAssets'), color: 'var(--color-accent)' },
                    { icon: <Box size={20} />, value: stats.projects, label: t('dashboard.stat.activeProjects'), color: 'var(--color-accent-secondary)' },
                    { icon: <HardDrive size={20} />, value: formatFileSize(stats.totalSize), label: t('dashboard.stat.totalSize'), color: 'var(--color-success)' },
                    { icon: <TrendingUp size={20} />, value: assets.filter(a => a.isIndexed).length, label: t('dashboard.stat.indexed'), color: '#f59e0b' },
                    { icon: <Sparkles size={20} />, value: useStore.getState().stalenessCheck.versionOutdatedIds.size, label: t('dashboard.stat.partiallyIndexed'), color: '#60a5fa' },
                ].map((stat, i) => (
                    <div key={i} className="stat-card animate-card-enter" style={{ animationDelay: `${i * 80}ms` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ color: stat.color, opacity: 0.8 }}>{stat.icon}</div>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: stat.color, opacity: 0.5 }} />
                        </div>
                        <div className="stat-value">{stat.value}</div>
                        <div className="stat-label">{stat.label}</div>
                    </div>
                ))}
            </div>

            {/* Bento Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gridTemplateRows: 'auto',
                gap: 16,
            }}>
                {/* Varlık Türü Dağılımı */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <FileText size={14} style={{ color: 'var(--color-accent)' }} /> {t('dashboard.card.categoryDist')}
                    </div>
                    {sortedEntries(stats.categories).map(([key, val]) => {
                        const pct = Math.round((val / assets.length) * 100);
                        return (
                            <div key={key} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStatClick('category' as FacetKey, key); } }} style={{ marginBottom: 10, cursor: 'pointer' }} onClick={() => handleStatClick('category' as FacetKey, key)}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: 4 }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>{key}</span>
                                    <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{val} <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>({pct}%)</span></span>
                                </div>
                                <div className="progress-bar-track" style={{ height: 6 }}>
                                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Dosya Formatları */}
                <div className="glass-card" style={{ padding: 20, gridColumn: 'span 2' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Image size={14} style={{ color: '#f59e0b' }} /> {t('dashboard.card.fileFormats')}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {sortedEntries(stats.types).map(([key, val]) => (
                            <div key={key} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStatClick('fileType' as FacetKey, key); } }} onClick={() => handleStatClick('fileType' as FacetKey, key)} style={{
                                background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)', padding: '10px 16px',
                                display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                            }}>
                                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-accent)' }}>{key}</span>
                                <span style={{
                                    background: 'var(--color-accent-glow)', color: 'var(--color-accent-hover)',
                                    padding: '2px 8px', borderRadius: 999, fontSize: '0.72rem', fontWeight: 600,
                                }}>{val}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Mimari Stil */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🏛️ {t('dashboard.card.archStyles')}
                    </div>
                    {sortedEntries(stats.styles).map(([key, val]) => (
                        <div key={key} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStatClick('architecturalStyle' as FacetKey, key); } }} onClick={() => handleStatClick('architecturalStyle' as FacetKey, key)} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer',
                        }}>
                            <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{key}</span>
                            <div style={{ display: 'flex', gap: 2 }}>
                                {Array.from({ length: val }).map((_, j) => (
                                    <div key={j} style={{
                                        width: 16, height: 8, borderRadius: 2,
                                        background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
                                    }} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Boyut Dağılımı — Donut Chart */}
                <div className="glass-card" style={{ padding: 20 }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Database size={14} style={{ color: 'var(--color-success)' }} /> {t('dashboard.card.sizeByFormat')}
                    </div>
                    {(() => {
                        const top8 = sortedEntries(stats.sizeByType).slice(0, 8);
                        const pieData = top8.map(([name, value]) => ({ name, value }));
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <ResponsiveContainer width={130} height={130}>
                                    <PieChart>
                                        <Pie
                                            data={pieData} dataKey="value" nameKey="name"
                                            cx="50%" cy="50%" innerRadius={36} outerRadius={58}
                                            strokeWidth={0} paddingAngle={2}
                                        >
                                            {pieData.map((_, i) => (
                                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            formatter={(value) => formatFileSize(Number(value))}
                                            contentStyle={{
                                                background: 'var(--color-bg-tertiary)',
                                                border: '1px solid var(--color-border-hover)',
                                                borderRadius: 8, fontSize: 11,
                                                color: 'var(--color-text-primary)',
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {top8.map(([key, val], i) => (
                                        <div key={key} role="button" tabIndex={0}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleStatClick('fileType' as FacetKey, key); } }}
                                            onClick={() => handleStatClick('fileType' as FacetKey, key)}
                                            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.72rem' }}>
                                            <div style={{ width: 8, height: 8, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                            <span style={{ color: 'var(--color-text-secondary)', flex: 1 }}>{key}</span>
                                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>{formatFileSize(val)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>

                {/* Aylık Büyüme — Recharts AreaChart */}
                <div className="glass-card" style={{ padding: 20, gridColumn: 'span 2' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={14} style={{ color: '#a78bfa' }} /> {t('dashboard.card.monthlyGrowth')}
                    </div>
                    {(() => {
                        const total = stats.monthlyGrowth.reduce((acc, [, v]) => acc + v, 0);
                        const chartData = stats.monthlyGrowth.map(([month, count]) => ({
                            month: month.slice(5),
                            count,
                        }));
                        return (
                            <>
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: 10 }}>
                                    {t('dashboard.card.monthlyGrowthHint', { count: total })}
                                </div>
                                <ResponsiveContainer width="100%" height={140}>
                                    <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.4} />
                                                <stop offset="95%" stopColor="var(--color-accent-secondary)" stopOpacity={0.02} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis
                                            dataKey="month" axisLine={false} tickLine={false}
                                            tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }}
                                        />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 10 }} allowDecimals={false} />
                                        <Tooltip
                                            contentStyle={{
                                                background: 'var(--color-bg-tertiary)',
                                                border: '1px solid var(--color-border-hover)',
                                                borderRadius: 8, fontSize: 12,
                                                color: 'var(--color-text-primary)',
                                            }}
                                            labelStyle={{ color: 'var(--color-text-secondary)' }}
                                        />
                                        <Area
                                            type="monotone" dataKey="count"
                                            stroke="var(--color-accent)" strokeWidth={2}
                                            fill="url(#areaGrad)"
                                            dot={{ r: 3, fill: 'var(--color-accent)', strokeWidth: 0 }}
                                            activeDot={{ r: 5, fill: 'var(--color-accent-hover)', strokeWidth: 0 }}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </>
                        );
                    })()}
                </div>

                {/* Onay Kuyruğu — sadece admin, review/draft sayısı > 0 ise */}
                {isAdmin && (() => {
                    const reviewAssets = assets.filter(a => a.approvalStatus === 'review');
                    const draftAssets = assets.filter(a => a.approvalStatus === 'draft');
                    const approvedCount = assets.filter(a => a.approvalStatus === 'approved').length;
                    const rejectedCount = assets.filter(a => a.approvalStatus === 'rejected').length;
                    if (reviewAssets.length === 0 && draftAssets.length === 0 && approvedCount === 0 && rejectedCount === 0) return null;

                    const handleBatchApproval = (targetAssets: Asset[], status: 'approved' | 'rejected') => {
                        const user = useStore.getState().currentUser || 'admin';
                        for (const a of targetAssets) {
                            updateAssetFields(a.id, { approvalStatus: status }, user);
                        }
                        // Store'daki asset'leri güncelle
                        useStore.getState().setScannedAssets(prev =>
                            prev.map(a => {
                                const match = targetAssets.find(t => t.id === a.id);
                                return match ? { ...a, approvalStatus: status } : a;
                            })
                        );
                        // Persistent bildirim
                        const msg = t('approval.batchDone', { count: targetAssets.length, status: t(`assetStatus.status.${status}`) });
                        if (status === 'approved') {
                            notifySuccess(t('approval.title'), msg);
                        } else {
                            notifyInfo(t('approval.title'), msg);
                        }
                    };

                    return (
                        <div className="glass-card" style={{ padding: 20 }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ClipboardCheck size={14} style={{ color: '#f9c846' }} /> {t('approval.title')}
                            </div>

                            {/* Durum özet */}
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                                {[
                                    { label: t('assetStatus.status.review'), count: reviewAssets.length, color: '#f9c846' },
                                    { label: t('assetStatus.status.draft'), count: draftAssets.length, color: '#94a3b8' },
                                    { label: t('assetStatus.status.approved'), count: approvedCount, color: '#a6e3a1' },
                                    { label: t('assetStatus.status.rejected'), count: rejectedCount, color: '#f38ba8' },
                                ].map(s => (
                                    <div key={s.label} style={{
                                        padding: '4px 10px', borderRadius: 6,
                                        background: `${s.color}15`, border: `1px solid ${s.color}30`,
                                        fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4,
                                    }}>
                                        <span style={{ color: s.color, fontWeight: 600 }}>{s.count}</span>
                                        <span style={{ color: 'var(--color-text-secondary)' }}>{s.label}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Review bekleyenler listesi */}
                            {reviewAssets.length > 0 && (
                                <>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                                        {t('approval.pendingReview', { count: reviewAssets.length })}
                                    </div>
                                    <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 10 }}>
                                        {reviewAssets.slice(0, 20).map(a => (
                                            <div key={a.id} style={{
                                                display: 'flex', alignItems: 'center', gap: 8,
                                                padding: '5px 8px', borderRadius: 4,
                                                fontSize: '0.72rem', color: 'var(--color-text-secondary)',
                                                borderBottom: '1px solid var(--color-border)',
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <Eye size={12} style={{ color: '#f9c846', flexShrink: 0 }} />
                                                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.filePath}>
                                                    {a.fileName}
                                                </span>
                                                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                                    {a.projectName}
                                                </span>
                                            </div>
                                        ))}
                                        {reviewAssets.length > 20 && (
                                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', padding: '4px 8px' }}>
                                                +{reviewAssets.length - 20} {t('approval.more')}
                                            </div>
                                        )}
                                    </div>

                                    {/* Toplu onay butonları */}
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '5px 12px', color: '#a6e3a1' }}
                                            onClick={() => handleBatchApproval(reviewAssets, 'approved')}>
                                            <CheckCircle2 size={13} /> {t('approval.approveAll')}
                                        </button>
                                        <button className="btn btn-ghost" style={{ fontSize: '0.72rem', padding: '5px 12px', color: '#f38ba8' }}
                                            onClick={() => handleBatchApproval(reviewAssets, 'rejected')}>
                                            <XCircle size={13} /> {t('approval.rejectAll')}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })()}

                {/* Onay Geçmişi (son 10 işlem) */}
                {isAdmin && (() => {
                    const logs = getApprovalLog(10);
                    if (logs.length === 0) return null;
                    const statusColor: Record<string, string> = {
                        draft: '#94a3b8', review: '#f9c846', approved: '#a6e3a1', rejected: '#f38ba8',
                    };
                    return (
                        <div className="glass-card" style={{ padding: 20 }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, marginBottom: 10 }}>
                                {t('approval.history')}
                            </div>
                            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                                {logs.map(log => (
                                    <div key={log.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '4px 0', fontSize: '0.68rem',
                                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                                    }}>
                                        <span style={{ color: statusColor[log.fromStatus] || '#94a3b8', minWidth: 55 }}>
                                            {t(`assetStatus.status.${log.fromStatus}`)}
                                        </span>
                                        <span style={{ color: 'var(--color-text-muted)' }}>→</span>
                                        <span style={{ color: statusColor[log.toStatus] || '#94a3b8', minWidth: 55, fontWeight: 600 }}>
                                            {t(`assetStatus.status.${log.toStatus}`)}
                                        </span>
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--color-text-secondary)' }}
                                            title={log.fileName}>
                                            {log.fileName || log.assetId.slice(0, 8)}
                                        </span>
                                        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.62rem', flexShrink: 0 }}>
                                            {log.changedBy} · {new Date(log.changedAt).toLocaleDateString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}

                {/* Admin Aktivite Paneli */}
                {isAdmin && <AdminActivityPanel />}
            </div>
        </div>
    );
}
