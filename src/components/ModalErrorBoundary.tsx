import { Component, type ReactNode } from 'react';
import { systemLog } from '../services/logger';
import i18n from '../i18n';

interface Props {
  onClose: () => void;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ModalErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    systemLog('ERROR', 'ModalErrorBoundary', `${error.message} | ${info.componentStack ?? ''}`);
    import('../services/crashReporter').then(({ writeCrashReport }) => {
      writeCrashReport(
        'react_error',
        error.message,
        (error.stack ?? '') + '\n\nComponent Stack:\n' + (info.componentStack ?? ''),
        'ModalErrorBoundary',
      );
    }).catch(() => { /* silent */ });
  }

  handleClose = () => {
    this.setState({ hasError: false, error: null });
    this.props.onClose();
  };

  render() {
    if (this.state.hasError) {
      const t = (key: string) => i18n.t(key);
      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            background: 'var(--color-bg-modal)',
            border: '1px solid var(--color-border)',
            borderRadius: 12, padding: 24, maxWidth: 380, width: '90vw',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-danger)', marginBottom: 8 }}>
              {t('modalError.title')}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              {t('modalError.description')}
            </div>
            {this.state.error && (
              <div style={{
                fontSize: '0.7rem', color: 'var(--color-text-muted)',
                background: 'var(--color-bg-tertiary)',
                padding: '6px 10px', borderRadius: 6, marginBottom: 16,
                fontFamily: 'monospace', wordBreak: 'break-all', maxHeight: 60, overflow: 'auto',
              }}>
                {this.state.error.message}
              </div>
            )}
            <button
              onClick={this.handleClose}
              style={{
                padding: '8px 24px', borderRadius: 8, border: 'none',
                background: 'var(--color-accent)', color: '#fff',
                fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              {t('modalError.close')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
