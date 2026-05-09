/**
 * Archivist Pro — Kurulum Sihirbazı (First Run Wizard)
 *
 * 3 adım: Hoşgeldin+Dil, Gereksinimler Checklist, Özet+Başla
 * İlk çalıştırılmada otomatik gösterilir. Eski kullanıcılar göremez.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import {
  ChevronRight, ChevronLeft, Check, X, AlertTriangle,
  Globe, RefreshCw, Rocket, Info, Key,
  CheckCircle, XCircle, Search,
} from 'lucide-react';
import {
  checkWasmSupport,
  getWindowsVersion,
  estimateDiskSpace,
  markSetupWizardSeen,
} from '../services/systemCheck';
import {
  detectHardware,
  saveHardwareProfile,
  getTierRecommendation,
  markPerformanceSetupSeen,
} from '../services/hardwareDetect';
import type { HardwareProfile } from '../services/hardwareDetect';
import { useStore } from '../store/useStore';
import { pingOllama, DEFAULT_CHAT_MODEL } from '../services/ollamaService';

interface SetupWizardProps {
  onComplete: () => void;
}

interface OllamaStatus {
  running: boolean;
  models: string[];       // all models
  visionModels: string[]; // vision-capable models
  chatModel: string | null;
  checking: boolean;
}

const TOTAL_STEPS = 3;

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const { t } = useTranslation();
  const setAiConfig = useStore((s) => s.setAiConfig);

  const [step, setStep] = useState(0);

  // Step 0 — system (silent checks)
  const [wasmOk, setWasmOk] = useState(true);
  const [winVer, setWinVer] = useState('');
  const [diskSpace, setDiskSpace] = useState<{ usage: number; quota: number } | null>(null);
  const [diskChecked, setDiskChecked] = useState(false);

  // Hardware — detected silently, never shown to user
  const [hwProfile, setHwProfile] = useState<HardwareProfile | null>(null);

  // Step 1 — checklist
  const [ollama, setOllama] = useState<OllamaStatus>({
    running: false, models: [], visionModels: [], chatModel: null, checking: true,
  });
  const [odaStatus, setOdaStatus] = useState<'checking' | 'found' | 'notfound'>('checking');

  // Init checks
  useEffect(() => {
    setWasmOk(checkWasmSupport());
    setWinVer(getWindowsVersion());
    estimateDiskSpace().then(d => {
      setDiskSpace(d);
      setDiskChecked(true);
    });

    // Hardware detect — silent
    const profile = detectHardware();
    saveHardwareProfile(profile);
    setHwProfile(profile);
  }, []);

  // Ollama check — Rust ollama_ping uzerinden (HTTP plugin scope gerektirmez)
  const checkOllama = useCallback(async () => {
    setOllama(prev => ({ ...prev, checking: true }));
    try {
      const result = await pingOllama();
      const chatModel = result.allModels.find(name =>
        name.startsWith(DEFAULT_CHAT_MODEL.split(':')[0])
      ) || result.chatModels[0] || null;
      setOllama({
        running: true,
        models: result.allModels,
        visionModels: result.visionModels,
        chatModel,
        checking: false,
      });
    } catch {
      setOllama({ running: false, models: [], visionModels: [], chatModel: null, checking: false });
    }
  }, []);

  useEffect(() => {
    checkOllama();
  }, [checkOllama]);

  // ODA check
  const checkOda = useCallback(async () => {
    setOdaStatus('checking');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const detected = await invoke<string | null>('detect_oda_converter');
      if (detected) {
        setOdaStatus('found');
        localStorage.setItem('oda_converter_path', detected);
        await invoke('set_oda_converter_path', { path: detected });
      } else {
        setOdaStatus('notfound');
      }
    } catch {
      setOdaStatus('notfound');
    }
  }, []);

  useEffect(() => {
    checkOda();
  }, [checkOda]);

  // Auto-determine AI mode based on Ollama status
  const autoAiMode = (ollama.running && ollama.models.length > 0) ? 'local' : 'skip';

  // Count missing requirements
  const missingCount = [
    !ollama.running,
    !ollama.chatModel,
    ollama.visionModels.length === 0,
    odaStatus !== 'found',
  ].filter(Boolean).length;

  const handleFinish = useCallback(() => {
    // Apply tier silently
    if (hwProfile) {
      const rec = getTierRecommendation(hwProfile.tier);
      setAiConfig((prev) => ({
        ...prev,
        apiProvider: rec.imageSearchProvider === 'none' ? prev.apiProvider : rec.imageSearchProvider,
        apiUrl: 'http://localhost:11434/v1/chat/completions',
      }));
    }

    // Apply AI mode automatically
    if (autoAiMode === 'local') {
      setAiConfig((prev) => ({
        ...prev,
        apiProvider: 'ollama' as any,
        chatModel: DEFAULT_CHAT_MODEL,
        visionModel: 'llava',
      }));
    }

    markPerformanceSetupSeen();
    markSetupWizardSeen();
    onComplete();
  }, [hwProfile, autoAiMode, setAiConfig, onComplete]);

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) setStep(s => s + 1);
    else handleFinish();
  };

  const handleBack = () => {
    if (step > 0) setStep(s => s - 1);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--color-bg-primary)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Inter', 'Outfit', system-ui, sans-serif",
      zIndex: 9999,
    }}>
      <div style={{
        width: 560, maxHeight: '90vh', overflow: 'auto',
        borderRadius: 20,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        boxShadow: '0 8px 48px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 32px 16px',
          borderBottom: '1px solid var(--color-border)',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.06) 100%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', fontWeight: 700, color: '#fff',
            }}>
              A
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {t('wizard.title')}
              </h2>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                {t('wizard.step', { current: step + 1, total: TOTAL_STEPS })}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            display: 'flex', gap: 4, marginTop: 8,
          }}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div key={i} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step
                  ? 'var(--color-accent)'
                  : 'var(--color-border, rgba(255,255,255,0.1))',
                transition: 'background 0.3s',
              }} />
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 32px' }}>
          {step === 0 && (
            <StepWelcome
              wasmOk={wasmOk}
              winVer={winVer}
              diskSpace={diskSpace}
              diskChecked={diskChecked}
            />
          )}
          {step === 1 && (
            <StepChecklist
              ollama={ollama}
              odaStatus={odaStatus}
              onRecheckOllama={checkOllama}
              onRecheckOda={checkOda}
            />
          )}
          {step === 2 && (
            <StepSummary
              autoAiMode={autoAiMode}
              missingCount={missingCount}
              wasmOk={wasmOk}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 32px',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          {step > 0 ? (
            <button
              onClick={handleBack}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-muted)', fontSize: '0.82rem',
                display: 'flex', alignItems: 'center', gap: 4, padding: '8px 0',
              }}
            >
              <ChevronLeft size={14} />
              {t('wizard.back')}
            </button>
          ) : (
            <div />
          )}

          <button
            className="btn btn-primary"
            onClick={handleNext}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 20px', fontSize: '0.85rem', fontWeight: 600,
              borderRadius: 10,
            }}
          >
            {step === TOTAL_STEPS - 1 ? (
              <>
                <Rocket size={15} />
                {t('wizard.ready.launch')}
              </>
            ) : (
              <>
                {t('wizard.next')}
                <ChevronRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Step 0: Welcome + Language ─── */
function StepWelcome({ wasmOk, diskSpace, diskChecked }: {
  wasmOk: boolean;
  winVer: string;
  diskSpace: { usage: number; quota: number } | null;
  diskChecked: boolean;
}) {
  const { t } = useTranslation();

  const handleLangChange = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem('archivist_language', lang);
  };

  // Show system warnings only if there's a problem
  const hasWarning = !wasmOk || (diskChecked && diskSpace && (diskSpace.quota - diskSpace.usage) < 1e9);

  return (
    <div>
      <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
        {t('wizard.welcome.title')}
      </h3>
      <p style={{ margin: '0 0 20px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
        {t('wizard.welcome.subtitle')}
      </p>

      {/* Language */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Globe size={14} />
          {t('wizard.welcome.language')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { code: 'tr', label: 'Turkce' },
            { code: 'en', label: 'English' },
          ].map(lang => (
            <button
              key={lang.code}
              onClick={() => handleLangChange(lang.code)}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                background: i18n.language === lang.code
                  ? 'rgba(99,102,241,0.12)' : 'var(--color-bg-tertiary, rgba(255,255,255,0.04))',
                border: `1px solid ${i18n.language === lang.code ? 'var(--color-accent)' : 'var(--color-border)'}`,
                color: i18n.language === lang.code ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                fontWeight: i18n.language === lang.code ? 600 : 400,
                fontSize: '0.82rem',
                transition: 'all 0.15s',
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* System warnings — only shown if something is wrong */}
      {hasWarning && (
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
            {t('wizard.welcome.systemCheck')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!wasmOk && (
              <CheckRow
                ok={false}
                label={t('wizard.welcome.wasm')}
                detail={t('wizard.welcome.wasmFail')}
              />
            )}
            {diskChecked && diskSpace && (diskSpace.quota - diskSpace.usage) < 1e9 && (
              <CheckRow
                ok={false}
                label={t('wizard.welcome.disk')}
                detail={t('wizard.welcome.diskAvailable', { size: formatBytes(diskSpace.quota - diskSpace.usage) })}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Step 1: Requirements Checklist ─── */
function StepChecklist({ ollama, odaStatus, onRecheckOllama, onRecheckOda }: {
  ollama: OllamaStatus;
  odaStatus: 'checking' | 'found' | 'notfound';
  onRecheckOllama: () => void;
  onRecheckOda: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
        {t('wizard.checklist.title')}
      </h3>
      <p style={{ margin: '0 0 20px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
        {t('wizard.checklist.subtitle')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Ollama service */}
        <CheckRowWithAction
          ok={ollama.running}
          checking={ollama.checking}
          label={t('wizard.checklist.ollamaService')}
          detail={ollama.checking
            ? t('wizard.checklist.checking')
            : ollama.running
              ? t('wizard.checklist.ollamaRunning')
              : t('wizard.checklist.ollamaNotRunning')
          }
          hint={!ollama.running && !ollama.checking ? t('wizard.checklist.ollamaLink') : undefined}
          onRecheck={onRecheckOllama}
        />

        {/* Chat model */}
        <CheckRowWithAction
          ok={!!ollama.chatModel}
          checking={ollama.checking}
          label={t('wizard.checklist.chatModel')}
          detail={ollama.checking
            ? t('wizard.checklist.checking')
            : ollama.chatModel
              ? t('wizard.checklist.chatModelOk', { model: ollama.chatModel })
              : t('wizard.checklist.chatModelMissing', { model: DEFAULT_CHAT_MODEL })
          }
          onRecheck={onRecheckOllama}
        />

        {/* Vision model */}
        <CheckRowWithAction
          ok={ollama.visionModels.length > 0}
          checking={ollama.checking}
          label={t('wizard.checklist.visionModel')}
          detail={ollama.checking
            ? t('wizard.checklist.checking')
            : ollama.visionModels.length > 0
              ? t('wizard.checklist.visionModelOk', { model: ollama.visionModels[0] })
              : t('wizard.checklist.visionModelMissing')
          }
          onRecheck={onRecheckOllama}
        />

        {/* ODA FileConverter */}
        <CheckRowWithAction
          ok={odaStatus === 'found'}
          checking={odaStatus === 'checking'}
          label={t('wizard.checklist.odaConverter')}
          detail={odaStatus === 'checking'
            ? t('wizard.checklist.checking')
            : odaStatus === 'found'
              ? t('wizard.checklist.odaFound')
              : t('wizard.checklist.odaNotFound')
          }
          hint={odaStatus === 'notfound' ? t('wizard.checklist.odaLink') : undefined}
          onRecheck={onRecheckOda}
        />
      </div>

      {/* Optional note */}
      <div style={{
        marginTop: 16,
        padding: '10px 14px', borderRadius: 10,
        background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.1)',
        fontSize: '0.72rem', color: 'var(--color-text-muted)', lineHeight: 1.5,
        display: 'flex', alignItems: 'flex-start', gap: 8,
      }}>
        <Info size={14} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 1 }} />
        {t('wizard.checklist.optionalNote')}
      </div>
    </div>
  );
}

/* ─── Step 2: Summary ─── */
function StepSummary({ autoAiMode, missingCount, wasmOk }: {
  autoAiMode: 'local' | 'skip';
  missingCount: number;
  wasmOk: boolean;
}) {
  const { t } = useTranslation();

  const warningCount = [!wasmOk].filter(Boolean).length;

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16, margin: '0 auto 12px',
          background: 'linear-gradient(135deg, #22c55e, #10b981)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Check size={28} style={{ color: '#fff' }} />
        </div>
        <h3 style={{ margin: '0 0 4px', fontSize: '1.15rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
          {t('wizard.ready.title')}
        </h3>
        <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          {t('wizard.ready.subtitle')}
        </p>
      </div>

      {/* Summary */}
      <div style={{
        padding: '14px 16px', borderRadius: 12, marginBottom: 16,
        background: 'var(--color-bg-tertiary, rgba(255,255,255,0.03))',
        border: '1px solid var(--color-border)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 2 }}>
          {t('wizard.ready.summary')}
        </div>
        <SummaryRow
          label={t('wizard.ready.aiMode')}
          value={autoAiMode === 'local' ? t('wizard.ready.aiModeLocal') : t('wizard.ready.aiModeSkip')}
          ok={autoAiMode === 'local'}
        />
        <SummaryRow
          label={t('wizard.ready.missingDeps')}
          value={missingCount === 0 ? t('wizard.ready.missingDepsNone') : t('wizard.ready.missingDepsCount', { count: missingCount })}
          ok={missingCount === 0}
        />
        <SummaryRow
          label={t('wizard.ready.systemStatus')}
          value={warningCount === 0 ? t('wizard.ready.allGood') : t('wizard.ready.hasWarnings', { count: warningCount })}
          ok={warningCount === 0}
        />
      </div>

      {/* Default credentials */}
      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: 'rgba(99,102,241,0.06)',
        border: '1px solid rgba(99,102,241,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Key size={14} style={{ color: 'var(--color-accent)' }} />
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-accent)' }}>
            {t('wizard.ready.defaultCreds')}
          </span>
        </div>
        <div style={{
          fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)',
          padding: '6px 10px', borderRadius: 6,
          background: 'rgba(0,0,0,0.2)', fontFamily: 'monospace', letterSpacing: '0.5px',
        }}>
          {t('wizard.ready.defaultCredsHint')}
        </div>
        <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          {t('wizard.ready.changePasswordHint')}
        </p>
      </div>
    </div>
  );
}

/* ─── Shared Components ─── */

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 10,
      background: 'var(--color-bg-tertiary, rgba(255,255,255,0.03))',
      border: '1px solid var(--color-border)',
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {ok ? <Check size={13} style={{ color: '#22c55e' }} /> : <X size={13} style={{ color: '#ef4444' }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 1 }}>{detail}</div>
      </div>
    </div>
  );
}

function CheckRowWithAction({ ok, checking, label, detail, hint, onRecheck }: {
  ok: boolean;
  checking: boolean;
  label: string;
  detail: string;
  hint?: string;
  onRecheck: () => void;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 14px', borderRadius: 10,
      background: 'var(--color-bg-tertiary, rgba(255,255,255,0.03))',
      border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'var(--color-border)'}`,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 6,
        background: checking
          ? 'rgba(99,102,241,0.15)'
          : ok ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {checking
          ? <Search size={13} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
          : ok
            ? <CheckCircle size={13} style={{ color: '#22c55e' }} />
            : <XCircle size={13} style={{ color: '#ef4444' }} />
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 1 }}>{detail}</div>
        {hint && (
          <div style={{ fontSize: '0.68rem', color: 'var(--color-accent)', marginTop: 3 }}>{hint}</div>
        )}
      </div>
      <button
        onClick={onRecheck}
        disabled={checking}
        style={{
          background: 'none', border: 'none', cursor: checking ? 'wait' : 'pointer',
          color: 'var(--color-text-muted)', padding: 4, flexShrink: 0,
        }}
        title={label}
      >
        <RefreshCw size={13} className={checking ? 'spinner' : ''} />
      </button>
    </div>
  );
}

function SummaryRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{
        fontSize: '0.78rem', fontWeight: 600,
        color: ok === undefined ? 'var(--color-text-primary)' : ok ? '#22c55e' : '#f59e0b',
      }}>
        {value}
      </span>
    </div>
  );
}
