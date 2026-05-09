import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronRight, ChevronLeft, Rocket } from 'lucide-react';
import { setSetting, saveDatabaseDeferred } from '../services/database';

interface TourStep {
  target: string; // data-tour attribute value
  titleKey: string;
  descKey: string;
  position: 'bottom' | 'top' | 'right' | 'left';
}

const STEPS: TourStep[] = [
  { target: '_welcome', titleKey: 'onboarding.welcome.title', descKey: 'onboarding.welcome.desc', position: 'bottom' },
  { target: 'scan-button', titleKey: 'onboarding.scan.title', descKey: 'onboarding.scan.desc', position: 'right' },
  { target: 'search-input', titleKey: 'onboarding.search.title', descKey: 'onboarding.search.desc', position: 'right' },
  { target: 'view-modes', titleKey: 'onboarding.viewModes.title', descKey: 'onboarding.viewModes.desc', position: 'bottom' },
  { target: 'ai-chat', titleKey: 'onboarding.aiChat.title', descKey: 'onboarding.aiChat.desc', position: 'bottom' },
  { target: 'settings-btn', titleKey: 'onboarding.settings.title', descKey: 'onboarding.settings.desc', position: 'bottom' },
  { target: '_done', titleKey: 'onboarding.done.title', descKey: 'onboarding.done.desc', position: 'bottom' },
];

const SPOTLIGHT_PADDING = 8;
const POPOVER_GAP = 12;

interface Props {
  onComplete: () => void;
}

export default function OnboardingTour({ onComplete }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const current = STEPS[step];
  const isWelcome = current.target === '_welcome';
  const isDone = current.target === '_done';
  const isCenterStep = isWelcome || isDone;

  const measureTarget = useCallback(() => {
    if (isCenterStep) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${current.target}"]`);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    } else {
      setTargetRect(null);
    }
  }, [current.target, isCenterStep]);

  useEffect(() => {
    measureTarget();
    const handleResize = () => measureTarget();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [measureTarget]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleFinish();
      if (e.key === 'ArrowRight' || e.key === 'Enter') handleNext();
      if (e.key === 'ArrowLeft') handlePrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else handleFinish();
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleFinish = () => {
    try { setSetting('onboarding_completed', '1'); saveDatabaseDeferred(); } catch { /* ignore */ }
    onComplete();
  };

  // Spotlight cutout position
  const spotlightStyle = targetRect ? {
    position: 'fixed' as const,
    left: targetRect.left - SPOTLIGHT_PADDING,
    top: targetRect.top - SPOTLIGHT_PADDING,
    width: targetRect.width + SPOTLIGHT_PADDING * 2,
    height: targetRect.height + SPOTLIGHT_PADDING * 2,
    borderRadius: 8,
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
    zIndex: 100001,
    pointerEvents: 'none' as const,
    transition: 'all 0.3s ease',
  } : undefined;

  // Calculate popover position
  const getPopoverStyle = (): React.CSSProperties => {
    if (isCenterStep || !targetRect) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 100002,
      };
    }

    const pos = current.position;
    const style: React.CSSProperties = {
      position: 'fixed',
      zIndex: 100002,
      maxWidth: 360,
    };

    if (pos === 'bottom') {
      style.top = targetRect.bottom + SPOTLIGHT_PADDING + POPOVER_GAP;
      style.left = targetRect.left + targetRect.width / 2;
      style.transform = 'translateX(-50%)';
    } else if (pos === 'top') {
      style.bottom = window.innerHeight - targetRect.top + SPOTLIGHT_PADDING + POPOVER_GAP;
      style.left = targetRect.left + targetRect.width / 2;
      style.transform = 'translateX(-50%)';
    } else if (pos === 'right') {
      style.top = targetRect.top + targetRect.height / 2;
      style.left = targetRect.right + SPOTLIGHT_PADDING + POPOVER_GAP;
      style.transform = 'translateY(-50%)';
    } else if (pos === 'left') {
      style.top = targetRect.top + targetRect.height / 2;
      style.right = window.innerWidth - targetRect.left + SPOTLIGHT_PADDING + POPOVER_GAP;
      style.transform = 'translateY(-50%)';
    }

    return style;
  };

  return (
    <>
      {/* Overlay — for center steps or when target not found */}
      {(isCenterStep || !targetRect) && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 100000,
            background: 'rgba(0,0,0,0.6)',
          }}
          onClick={handleFinish}
        />
      )}

      {/* Spotlight cutout */}
      {spotlightStyle && <div style={spotlightStyle} />}

      {/* Click blocker — allow clicks only on popover */}
      {!isCenterStep && targetRect && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100000, cursor: 'default' }}
          onClick={handleFinish}
        />
      )}

      {/* Popover */}
      <div
        ref={popoverRef}
        style={{
          ...getPopoverStyle(),
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-accent)',
          borderRadius: 12,
          padding: isCenterStep ? '32px 36px' : '20px 24px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          minWidth: isCenterStep ? 400 : 280,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleFinish}
          aria-label={t('common.close')}
          style={{
            position: 'absolute', top: 10, right: 10,
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--color-text-muted)', padding: 4,
          }}
        >
          <X size={16} />
        </button>

        {/* Welcome icon */}
        {isWelcome && (
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 64, height: 64, borderRadius: 16,
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
              fontSize: 32, color: '#fff',
            }}>
              <Rocket size={32} />
            </div>
          </div>
        )}

        {/* Done icon */}
        {isDone && (
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 48 }}>
            &#10003;
          </div>
        )}

        {/* Step indicator */}
        <div style={{
          display: 'flex', gap: 4, marginBottom: 12,
          justifyContent: isCenterStep ? 'center' : 'flex-start',
        }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 20 : 6, height: 6, borderRadius: 3,
              background: i === step
                ? 'var(--color-accent)'
                : i < step
                  ? 'var(--color-accent-secondary)'
                  : 'var(--color-border)',
              transition: 'all 0.3s ease',
            }} />
          ))}
        </div>

        {/* Title */}
        <h3 style={{
          margin: 0, marginBottom: 8,
          fontSize: isCenterStep ? '1.3rem' : '1rem',
          fontWeight: 700,
          color: 'var(--color-text-primary)',
          textAlign: isCenterStep ? 'center' : 'left',
        }}>
          {t(current.titleKey)}
        </h3>

        {/* Description */}
        <p style={{
          margin: 0, marginBottom: 20,
          fontSize: '0.85rem', lineHeight: 1.5,
          color: 'var(--color-text-secondary)',
          textAlign: isCenterStep ? 'center' : 'left',
        }}>
          {t(current.descKey)}
        </p>

        {/* Navigation */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: step === 0 ? 'space-between' : 'space-between',
          gap: 8,
        }}>
          {/* Skip */}
          {!isDone && (
            <button
              onClick={handleFinish}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-muted)', fontSize: '0.78rem',
                padding: '6px 0',
              }}
            >
              {t('onboarding.skip')}
            </button>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            {/* Back */}
            {step > 0 && !isDone && (
              <button
                onClick={handlePrev}
                className="btn btn-ghost"
                style={{ padding: '7px 14px', fontSize: '0.82rem' }}
              >
                <ChevronLeft size={14} />
                {t('onboarding.back')}
              </button>
            )}

            {/* Next / Finish */}
            <button
              onClick={handleNext}
              className="btn btn-primary"
              style={{ padding: '7px 18px', fontSize: '0.82rem', fontWeight: 600 }}
            >
              {isDone
                ? t('onboarding.start')
                : (
                  <>
                    {step === 0 ? t('onboarding.letsGo') : t('onboarding.next')}
                    <ChevronRight size={14} />
                  </>
                )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
