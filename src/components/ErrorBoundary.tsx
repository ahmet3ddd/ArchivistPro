import { Component, type ReactNode } from 'react';
import { systemLog } from '../services/logger';
import i18n from '../i18n';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    systemLog('ERROR', 'ErrorBoundary', `${error.message} | ${info.componentStack ?? ''}`);
    import('../services/crashReporter').then(({ writeCrashReport }) => {
      writeCrashReport(
        'react_error',
        error.message,
        (error.stack ?? '') + '\n\nComponent Stack:\n' + (info.componentStack ?? ''),
        'ErrorBoundary',
      );
    }).catch(() => { /* silent */ });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)', fontFamily: 'system-ui', gap: 16, padding: 32,
        }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{i18n.t('errorBoundary.title')}</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-muted)', maxWidth: 500, textAlign: 'center' }}>
            {i18n.t('errorBoundary.description')}
          </div>
          {this.state.error && (
            <pre style={{
              fontSize: 12, color: '#f38ba8', background: 'var(--color-bg-tertiary)',
              padding: 16, borderRadius: 8, maxWidth: 600, overflow: 'auto', maxHeight: 120,
            }}>
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="btn btn-primary" onClick={this.handleReload}>
              {i18n.t('errorBoundary.reload')}
            </button>
            <button className="btn btn-ghost" onClick={this.handleDismiss}>
              {i18n.t('errorBoundary.continue')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
