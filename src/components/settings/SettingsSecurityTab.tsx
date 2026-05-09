import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, Unlock, Clock, ShieldCheck, Check, History, KeyRound, ShieldOff, Plus, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useIsAdmin } from '../../permissions';
import { getSetting, setSettingPersistent, getExcludedAssetCount } from '../../services/database';
import { clearSensitivityCache } from '../../services/ragService';
import { SettingsCard } from './settingsShared';

/* ── PresetSelector — kompakt sayı seçici ── */

function PresetSelector({
    label, description, presets, value, onChange, suffix,
}: {
    label: string;
    description: string;
    presets: number[];
    value: number;
    onChange: (n: number) => void;
    suffix: string;
}) {
    return (
        <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 500, marginBottom: 4, color: 'var(--color-text-primary)' }}>
                {label}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                {description}
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {presets.map((n) => (
                    <button
                        key={n}
                        onClick={() => onChange(n)}
                        className={value === n ? 'btn btn-primary' : 'btn btn-ghost'}
                        style={{ padding: '4px 12px', fontSize: '0.74rem' }}
                    >
                        {n === 0 ? '∞' : `${n} ${suffix}`}
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── AuditRetentionSelector ── */

function AuditRetentionSelector() {
    const { t } = useTranslation();
    const [days, setDays] = useState<number>(() => {
        const raw = getSetting('audit_retention_days');
        const n = raw !== null ? parseInt(raw, 10) : 90;
        return Number.isFinite(n) ? n : 90;
    });
    const presets = [0, 30, 60, 90, 180, 365];
    const handleChange = (n: number) => {
        setDays(n);
        void setSettingPersistent('audit_retention_days', String(n));
    };
    return (
        <PresetSelector
            label={t('settings.security.auditRetentionTitle')}
            description={t('settings.security.auditRetentionDesc')}
            presets={presets}
            value={days}
            onChange={handleChange}
            suffix={t('settings.security.daysSuffix')}
        />
    );
}

/* ── LoginRateLimitSelectors ── */

function LoginMaxAttemptsSelector() {
    const { t } = useTranslation();
    const [n, setN] = useState<number>(() => {
        const raw = getSetting('login_max_attempts');
        const v = raw !== null ? parseInt(raw, 10) : 5;
        return Number.isFinite(v) ? v : 5;
    });
    const presets = [3, 5, 10, 15, 20];
    const handleChange = (val: number) => {
        setN(val);
        void setSettingPersistent('login_max_attempts', String(val));
    };
    return (
        <PresetSelector
            label={t('settings.security.loginMaxAttemptsTitle')}
            description={t('settings.security.loginMaxAttemptsDesc')}
            presets={presets}
            value={n}
            onChange={handleChange}
            suffix={t('settings.security.attemptsSuffix')}
        />
    );
}

function LoginLockoutMinutesSelector() {
    const { t } = useTranslation();
    const [m, setM] = useState<number>(() => {
        const raw = getSetting('login_lockout_minutes');
        const v = raw !== null ? parseInt(raw, 10) : 5;
        return Number.isFinite(v) ? v : 5;
    });
    const presets = [1, 5, 15, 30, 60];
    const handleChange = (val: number) => {
        setM(val);
        void setSettingPersistent('login_lockout_minutes', String(val));
    };
    return (
        <PresetSelector
            label={t('settings.security.loginLockoutTitle')}
            description={t('settings.security.loginLockoutDesc')}
            presets={presets}
            value={m}
            onChange={handleChange}
            suffix={t('settings.security.minutesSuffix')}
        />
    );
}

/**
 * Güvenlik ayarı sekmesi.
 *
 * Tıklama sırasında HİÇBİR global iş yapılmaz: sadece local useState.
 * Global Zustand store ve DB yazımı YALNIZCA panel kapanırken (unmount'ta)
 * değer değişmişse tek sefer yapılır.
 *
 * Görsel: .sec-btn class'ı transition'sız hover/focus-visible sağlar —
 * performans çözümü bozulmadan diğer sekmelerin görsel diliyle hizalı.
 */
export default function SettingsSecurityTab() {
    const { t } = useTranslation();
    const isAdmin = useIsAdmin();
    const [localValue, setLocalValue] = useState(
        () => useStore.getState().sessionTimeoutMinutes
    );

    const localValueRef = useRef(localValue);
    localValueRef.current = localValue;

    useEffect(() => {
        return () => {
            const latest = localValueRef.current;
            const storeVal = useStore.getState().sessionTimeoutMinutes;
            if (latest !== storeVal) {
                useStore.getState().setSessionTimeoutMinutes(latest);
                void setSettingPersistent('session_timeout_minutes', String(latest));
            }
        };
    }, []);

    const timeoutOptions = [
        { value: 5 },
        { value: 15 },
        { value: 30 },
        { value: 60 },
        { value: 120 },
    ];

    const isDisabled = localValue === 0;
    const currentLabel = isDisabled
        ? t('settings.security.never')
        : `${localValue} ${t('settings.security.minutes')}`;

    return (
        <div>
            {/* ── Durum kartı (status banner — SettingsCard dışı) ── */}
            <div
                role="status"
                aria-live="polite"
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 10,
                    marginBottom: 12,
                    border: `1px solid ${isDisabled ? 'color-mix(in srgb, var(--color-warning) 35%, transparent)' : 'color-mix(in srgb, var(--color-accent) 30%, transparent)'}`,
                    background: isDisabled
                        ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)'
                        : 'color-mix(in srgb, var(--color-accent) 5%, transparent)',
                }}
            >
                <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isDisabled
                        ? 'color-mix(in srgb, var(--color-warning) 15%, transparent)'
                        : 'color-mix(in srgb, var(--color-accent) 15%, transparent)',
                    color: isDisabled ? 'var(--color-warning)' : 'var(--color-accent)',
                    flexShrink: 0,
                }}>
                    {isDisabled ? <Unlock size={18} /> : <Lock size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: 2 }}>
                        {t('settings.security.currentStateLabel')}
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: isDisabled ? 'var(--color-warning)' : 'var(--color-text-primary)' }}>
                        {isDisabled
                            ? t('settings.security.currentStateNever')
                            : t('settings.security.currentStateActive', { duration: currentLabel })}
                    </div>
                </div>
            </div>

            {/* ── Oturum Zaman Aşımı ── */}
            <SettingsCard
                icon={<Clock size={15} />}
                title={t('settings.security.sessionTimeout')}
                subtitle={t('settings.card.sessionSub')}
            >
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
                    {t('settings.security.sessionTimeoutDesc')}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 8, marginBottom: 10 }}>
                    {timeoutOptions.map((opt) => {
                        const selected = localValue === opt.value;
                        return (
                            <button
                                key={opt.value}
                                className="sec-btn"
                                data-selected={selected ? 'true' : 'false'}
                                aria-pressed={selected}
                                onClick={() => setLocalValue(opt.value)}
                                style={{
                                    position: 'relative',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    gap: 2,
                                    padding: '12px 10px',
                                    borderRadius: 10,
                                    cursor: 'pointer',
                                    background: selected ? 'var(--color-accent)' : 'transparent',
                                    color: selected ? '#fff' : 'var(--color-text-primary)',
                                    border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                    fontFamily: 'inherit',
                                }}
                            >
                                {selected && (
                                    <Check
                                        size={11}
                                        style={{
                                            position: 'absolute', top: 6, right: 6,
                                            opacity: 0.85,
                                        }}
                                    />
                                )}
                                <span style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                                    {opt.value}
                                </span>
                                <span style={{ fontSize: '0.68rem', opacity: selected ? 0.85 : 0.7, fontWeight: 500 }}>
                                    {t('settings.security.minutes')}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <button
                    className="sec-btn"
                    data-selected={isDisabled ? 'true' : 'false'}
                    data-variant="danger"
                    aria-pressed={isDisabled}
                    onClick={() => setLocalValue(0)}
                    style={{
                        width: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        padding: '10px 14px',
                        borderRadius: 10,
                        cursor: 'pointer',
                        background: isDisabled ? 'color-mix(in srgb, var(--color-warning) 18%, transparent)' : 'transparent',
                        color: isDisabled ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                        border: `1px solid ${isDisabled ? 'var(--color-warning)' : 'var(--color-border)'}`,
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        fontFamily: 'inherit',
                    }}
                >
                    {isDisabled && <Check size={13} style={{ opacity: 0.9 }} />}
                    <Unlock size={13} style={{ opacity: isDisabled ? 1 : 0.6 }} />
                    {t('settings.security.never')}
                </button>

                {/* Bilgi notu — zaman aşımı açıklaması */}
                <div style={{
                    display: 'flex', gap: 10, marginTop: 10,
                    padding: '10px 12px',
                    background: 'var(--color-bg-tertiary)',
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    fontSize: '0.72rem',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.5,
                }}>
                    <ShieldCheck size={14} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
                    <span>{t('settings.security.hint')}</span>
                </div>
            </SettingsCard>

            {/* ── Audit Log Retention ── */}
            <SettingsCard
                icon={<History size={15} />}
                title={t('settings.security.auditRetentionSection')}
                subtitle={t('settings.card.auditSub')}
                defaultCollapsed
            >
                <AuditRetentionSelector />
            </SettingsCard>

            {/* ── Login Güvenliği ── */}
            <SettingsCard
                icon={<KeyRound size={15} />}
                title={t('settings.security.loginSection')}
                subtitle={t('settings.card.loginSecSub')}
                defaultCollapsed
            >
                <LoginMaxAttemptsSelector />
                <LoginLockoutMinutesSelector />
            </SettingsCard>

            {/* ── AI Hassasiyet Filtresi (sadece admin) ── */}
            {isAdmin && <RagSensitivityCard />}
        </div>
    );
}

// ── AI Hassasiyet Filtresi Kartı ─────────────────────────────────────────────

const CATEGORY_KEYS = ['financial', 'personal', 'legal', 'hr'] as const;

function RagSensitivityCard() {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(() => getSetting('rag_sensitivity_enabled') === 'true');
    const [categories, setCategories] = useState<string[]>(() => {
        try { return JSON.parse(getSetting('rag_sensitivity_categories') || '[]'); }
        catch { return []; }
    });
    const [keywords, setKeywords] = useState<string[]>(() => {
        try { return JSON.parse(getSetting('rag_sensitivity_keywords') || '[]'); }
        catch { return []; }
    });
    const [newKeyword, setNewKeyword] = useState('');
    const [manualCount] = useState(() => getExcludedAssetCount());

    const persistAndClearCache = async (key: string, value: string) => {
        await setSettingPersistent(key, value);
        clearSensitivityCache();
    };

    const handleToggle = async () => {
        const next = !enabled;
        setEnabled(next);
        await persistAndClearCache('rag_sensitivity_enabled', next ? 'true' : 'false');
    };

    const handleCategoryToggle = async (cat: string) => {
        const next = categories.includes(cat)
            ? categories.filter(c => c !== cat)
            : [...categories, cat];
        setCategories(next);
        await persistAndClearCache('rag_sensitivity_categories', JSON.stringify(next));
    };

    const handleAddKeyword = async () => {
        const kw = newKeyword.trim().toLowerCase();
        if (!kw || keywords.includes(kw)) return;
        const next = [...keywords, kw];
        setKeywords(next);
        setNewKeyword('');
        await persistAndClearCache('rag_sensitivity_keywords', JSON.stringify(next));
    };

    const handleRemoveKeyword = async (kw: string) => {
        const next = keywords.filter(k => k !== kw);
        setKeywords(next);
        await persistAndClearCache('rag_sensitivity_keywords', JSON.stringify(next));
    };

    return (
        <SettingsCard
            icon={<ShieldOff size={15} />}
            title={t('ragSensitivity.title')}
            subtitle={t('ragSensitivity.subtitle')}
            defaultCollapsed
        >
            {/* Master toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                    {enabled ? t('ragSensitivity.enabled') : t('ragSensitivity.disabled')}
                </span>
                <button
                    className={`btn ${enabled ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={handleToggle}
                    style={{ padding: '5px 14px', fontSize: '0.78rem' }}
                >
                    {enabled ? <Check size={14} /> : <ShieldOff size={14} />}
                    {enabled ? t('common.close') : t('ragSensitivity.activate')}
                </button>
            </div>

            {enabled && (
                <>
                    {/* Kategori chip'leri */}
                    <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 0 6px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                            {t('ragSensitivity.categories.title')}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {CATEGORY_KEYS.map(cat => {
                                const active = categories.includes(cat);
                                return (
                                    <button
                                        key={cat}
                                        onClick={() => handleCategoryToggle(cat)}
                                        style={{
                                            padding: '4px 10px',
                                            fontSize: '0.72rem',
                                            borderRadius: 6,
                                            border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                            background: active ? 'var(--color-accent-muted)' : 'transparent',
                                            color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                                            cursor: 'pointer',
                                            fontWeight: active ? 600 : 400,
                                        }}
                                    >
                                        {active && <Check size={10} style={{ marginRight: 3 }} />}
                                        {t(`ragSensitivity.categories.${cat}`)}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Özel anahtar kelimeler */}
                    <div style={{ borderTop: '1px solid var(--color-border)', padding: '10px 0 6px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: 6 }}>
                            {t('ragSensitivity.keywords.title')}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                            <input
                                type="text"
                                value={newKeyword}
                                onChange={e => setNewKeyword(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddKeyword(); }}
                                placeholder={t('ragSensitivity.keywords.placeholder')}
                                style={{
                                    flex: 1, padding: '5px 10px', fontSize: '0.76rem',
                                    background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
                                    borderRadius: 6, color: 'var(--color-text-primary)', outline: 'none',
                                }}
                            />
                            <button
                                className="btn btn-ghost"
                                onClick={handleAddKeyword}
                                disabled={!newKeyword.trim()}
                                style={{ padding: '5px 10px', fontSize: '0.76rem' }}
                            >
                                <Plus size={13} /> {t('ragSensitivity.keywords.add')}
                            </button>
                        </div>
                        {keywords.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {keywords.map(kw => (
                                    <span
                                        key={kw}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                            padding: '2px 8px', fontSize: '0.7rem', borderRadius: 5,
                                            background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)',
                                            color: 'var(--color-text-secondary)',
                                        }}
                                    >
                                        {kw}
                                        <X
                                            size={10}
                                            style={{ cursor: 'pointer', color: 'var(--color-text-muted)' }}
                                            onClick={() => handleRemoveKeyword(kw)}
                                        />
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                {t('ragSensitivity.keywords.empty')}
                            </div>
                        )}
                    </div>

                    {/* Manuel hariç tutulan sayısı */}
                    {manualCount > 0 && (
                        <div style={{
                            borderTop: '1px solid var(--color-border)', padding: '8px 0',
                            fontSize: '0.74rem', color: 'var(--color-text-muted)',
                        }}>
                            {t('ragSensitivity.manualCount', { count: manualCount })}
                        </div>
                    )}
                </>
            )}
        </SettingsCard>
    );
}
