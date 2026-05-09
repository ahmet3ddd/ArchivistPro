import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/sora'
import './i18n'
import './index.css'
import App from './App'

// Global error handlers → crash reporter (async, non-blocking)
const initCrashHandlers = () => import('./services/crashReporter').then(({ writeCrashReport }) => {
  window.onerror = (_msg, source, lineno, colno, error) => {
    const message = error?.message ?? String(_msg);
    const stack = error?.stack ?? `${source ?? ''}:${lineno ?? 0}:${colno ?? 0}`;
    writeCrashReport('window_error', message, stack, 'window');
  };

  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
    const stack = reason instanceof Error ? (reason.stack ?? '') : '';
    writeCrashReport('unhandled_rejection', message, stack, 'window');
  };
}).catch(() => { /* Tauri unavailable — silent */ });

initCrashHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
