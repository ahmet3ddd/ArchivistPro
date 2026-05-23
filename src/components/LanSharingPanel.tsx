import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { debugLog } from '../services/logger';
import { useIsAdmin } from '../permissions';
import { reloadDatabase, getAllAssets } from '../services/database';
import { useStore } from '../store/useStore';
import { lanPing, lanFetchManifest, lanDownloadArchive, verifyDownloadIntegrity } from '../services/lanService';
import type { LanServerInfo, LanManifest } from '../services/lanService';

interface ServerStartResult {
  port: number;
  authCode: string;
  localIp: string;
}

interface ServerStatus {
  running: boolean;
  port?: number;
  authCode?: string;
  localIp?: string;
}

type PanelMode = 'idle' | 'server' | 'client';

export const LanSharingPanel: React.FC = () => {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();

  // Viewer direkt istemci modunda başlar (tek yapabileceği bu)
  const [mode, setMode] = useState<PanelMode>(isAdmin ? 'idle' : 'client');

  // Server state
  const [serverRunning, setServerRunning] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerStartResult | null>(null);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  // Client state
  const [clientHost, setClientHost] = useState('');
  const [clientAuthCode, setClientAuthCode] = useState('');
  const [clientConnected, setClientConnected] = useState(false);
  const [clientManifest, setClientManifest] = useState<LanManifest | null>(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Check server status on mount (sadece admin)
  useEffect(() => {
    if (!isAdmin) return;
    invoke<ServerStatus>('lan_get_server_status')
      .then((status) => {
        if (status.running) {
          setServerRunning(true);
          setMode('server');
          setServerInfo({
            port: status.port ?? 9471,
            authCode: status.authCode ?? '',
            localIp: status.localIp ?? '',
          });
        }
      })
      .catch((err) => debugLog('LanSharing', 'Server status check failed', err));
  }, [isAdmin]);

  const handleStartServer = useCallback(async () => {
    setServerLoading(true);
    setServerError('');
    try {
      const result = await invoke<ServerStartResult>('lan_start_server');
      setServerInfo(result);
      setServerRunning(true);
      setMode('server');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setServerLoading(false);
    }
  }, []);

  const handleStopServer = useCallback(async () => {
    setServerLoading(true);
    try {
      await invoke('lan_stop_server');
      setServerRunning(false);
      setServerInfo(null);
      setMode('idle');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
    } finally {
      setServerLoading(false);
    }
  }, []);

  const handleConnect = useCallback(async () => {
    if (!clientHost || !clientAuthCode) return;
    setClientLoading(true);
    setClientError('');
    setClientConnected(false);
    setClientManifest(null);
    setDownloadSuccess(false);

    const server: LanServerInfo = {
      host: clientHost,
      port: 9471,
      authCode: clientAuthCode,
    };

    try {
      const ok = await lanPing(server);
      if (!ok) {
        setClientError(t('lan.status.disconnected'));
        return;
      }

      const manifest = await lanFetchManifest(server);
      if (manifest) {
        setClientConnected(true);
        setClientManifest(manifest);
      } else {
        setClientError(t('lan.status.disconnected'));
      }
    } catch {
      setClientError(t('lan.status.disconnected'));
    } finally {
      setClientLoading(false);
    }
  }, [clientHost, clientAuthCode, t]);

  const handleDownload = useCallback(async () => {
    if (!clientHost || !clientAuthCode) return;
    setDownloading(true);
    setDownloadProgress(0);
    setClientError('');
    setDownloadSuccess(false);

    const server: LanServerInfo = {
      host: clientHost,
      port: 9471,
      authCode: clientAuthCode,
    };

    try {
      // Progress callback ile indir
      const data = await lanDownloadArchive(server, (loaded, total) => {
        if (total > 0) {
          setDownloadProgress(Math.round((loaded / total) * 100));
        }
      });

      if (!data) {
        setClientError(t('lan.status.disconnected'));
        return;
      }

      // SHA-256 bütünlük doğrulaması
      const hashValid = await verifyDownloadIntegrity(data, clientManifest?.sha256);
      if (!hashValid) {
        setClientError(t('lan.integrityFailed'));
        return;
      }

      // DB'ye yaz
      const bytes = Array.from(data);
      await invoke('write_database', { data: bytes });

      await reloadDatabase();
      const assets = getAllAssets();
      useStore.getState().setScannedAssets(assets);
      setDownloadSuccess(true);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  }, [clientHost, clientAuthCode, clientManifest, t]);

  const switchToClient = () => {
    setMode('client');
    setClientError('');
    setClientConnected(false);
    setClientManifest(null);
    setDownloadSuccess(false);
  };

  const switchToIdle = () => {
    setMode('idle');
    setClientError('');
    setClientConnected(false);
    setClientManifest(null);
  };

  // ── idle: mod seçim ekranı ──
  if (mode === 'idle') {
    return (
      <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {isAdmin && (
          <button
            onClick={handleStartServer}
            disabled={serverLoading}
            style={{
              padding: '12px 16px', borderRadius: 8,
              border: '1px solid var(--color-accent)',
              background: 'var(--color-bg-secondary)',
              color: 'var(--color-text-primary)',
              cursor: serverLoading ? 'wait' : 'pointer',
              fontSize: '0.8rem', textAlign: 'left',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('lan.startServer')}</div>
            <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
              {t('lan.startServerHint')}
            </div>
          </button>
        )}

        <button
          onClick={switchToClient}
          style={{
            padding: '12px 16px', borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            fontSize: '0.8rem', textAlign: 'left',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('lan.connect')}</div>
          <div style={{ fontSize: '0.7rem', opacity: 0.6 }}>
              {t('lan.connectHint')}
          </div>
        </button>

        {serverError && (
          <div style={{ fontSize: '0.72rem', color: '#e04040', padding: '4px 0' }}>{serverError}</div>
        )}
      </div>
    );
  }

  // ── server: sunucu çalışıyor ──
  if (mode === 'server' && serverRunning) {
    return (
      <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{
          padding: '14px', borderRadius: 10,
          background: 'rgba(64,128,224,0.08)',
          border: '1px solid rgba(64,128,224,0.25)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--color-accent)', marginBottom: 10, fontSize: '0.82rem' }}>
            {t('lan.serverRunning')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: '0.78rem' }}>
            <span style={{ opacity: 0.6 }}>{t('lan.ipAddress')}</span>
            <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{serverInfo?.localIp}</span>

            <span style={{ opacity: 0.6 }}>{t('lan.port')}</span>
            <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{serverInfo?.port}</span>

            <span style={{ opacity: 0.6 }}>{t('lan.authCode')}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <code style={{
                fontWeight: 700, fontSize: '1.1rem', letterSpacing: 4,
                background: 'rgba(64,128,224,0.12)', padding: '2px 10px',
                borderRadius: 6, display: 'inline-block', width: 'fit-content',
              }}>
                {serverInfo?.authCode}
              </code>
              <button
                title={t('lan.regenerateCode')}
                onClick={async () => {
                  try {
                    const newCode = await invoke<string>('lan_regenerate_auth_code');
                    setServerInfo((prev) => prev ? { ...prev, authCode: newCode } : prev);
                  } catch (err) {
                    setServerError(err instanceof Error ? err.message : String(err));
                  }
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--color-text-muted)', padding: 4, borderRadius: 4,
                  display: 'flex', alignItems: 'center',
                }}
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          <div style={{ fontSize: '0.68rem', opacity: 0.5, marginTop: 10, lineHeight: 1.5 }}>
            {t('lan.serverHint')}
          </div>
        </div>

        <button
          onClick={handleStopServer}
          disabled={serverLoading}
          style={{
            padding: '8px 16px', borderRadius: 6,
            border: '1px solid rgba(224,64,64,0.4)',
            background: 'transparent',
            color: '#e04040',
            cursor: serverLoading ? 'wait' : 'pointer',
            fontSize: '0.74rem', alignSelf: 'flex-start',
          }}
        >
          {t('lan.stopServer')}
        </button>

        {serverError && (
          <div style={{ fontSize: '0.72rem', color: '#e04040' }}>{serverError}</div>
        )}
      </div>
    );
  }

  // ── client: bağlantı ekranı ──
  return (
    <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{t('lan.connectionInfo')}</span>
        {isAdmin && (
          <button
            onClick={switchToIdle}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-secondary)',
              cursor: 'pointer', fontSize: '0.72rem', textDecoration: 'underline',
            }}
          >
            {t('common.cancel')}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: '0.68rem', opacity: 0.6, display: 'block', marginBottom: 3 }}>
            {t('lan.ipAddress')}
          </label>
          <input
            type="text"
            placeholder="192.168.1.x"
            value={clientHost}
            onChange={(e) => setClientHost(e.target.value)}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'inherit', fontSize: '0.8rem',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ width: 110 }}>
          <label style={{ fontSize: '0.68rem', opacity: 0.6, display: 'block', marginBottom: 3 }}>
            {t('lan.authCode')}
          </label>
          <input
            type="text"
            placeholder="00000000"
            value={clientAuthCode}
            onChange={(e) => setClientAuthCode(e.target.value)}
            maxLength={8}
            style={{
              width: '100%', padding: '8px 10px', borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
              color: 'inherit', fontSize: '0.9rem',
              letterSpacing: 3, fontFamily: 'monospace',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      <button
        onClick={handleConnect}
        disabled={clientLoading || !clientHost || !clientAuthCode}
        style={{
          padding: '8px 16px', borderRadius: 6, border: 'none',
          background: (!clientHost || !clientAuthCode) ? 'var(--color-bg-tertiary)' : '#30a050',
          color: (!clientHost || !clientAuthCode) ? 'var(--color-text-muted)' : '#fff',
          cursor: clientLoading ? 'wait' : 'pointer',
          fontSize: '0.78rem', alignSelf: 'flex-start',
        }}
      >
        {clientLoading ? '...' : t('lan.connect')}
      </button>

      {clientError && (
        <div style={{ fontSize: '0.72rem', color: '#e04040', padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          <AlertTriangle size={13} />
          {clientError}
        </div>
      )}

      {/* Bağlantı başarılı — manifest + indir */}
      {clientConnected && clientManifest && (
        <div style={{
          padding: '12px', borderRadius: 8,
          background: 'rgba(48,160,80,0.08)',
          border: '1px solid rgba(48,160,80,0.25)',
          fontSize: '0.78rem',
        }}>
          <div style={{ fontWeight: 600, color: '#30a050', marginBottom: 8 }}>
            {t('lan.status.connected')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginBottom: 10 }}>
            {clientManifest.appVersion != null && (
              <>
                <span style={{ opacity: 0.6 }}>{t('settings.about.version')}</span>
                <span>{String(clientManifest.appVersion)}</span>
              </>
            )}
            {clientManifest.dbSizeBytes != null && (
              <>
                <span style={{ opacity: 0.6 }}>{t('lan.dbSize')}</span>
                <span>{(Number(clientManifest.dbSizeBytes) / 1024 / 1024).toFixed(1)} MB</span>
              </>
            )}
            {clientManifest.sha256 && (
              <>
                <span style={{ opacity: 0.6 }}>SHA-256</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.66rem', wordBreak: 'break-all' }}>
                  {clientManifest.sha256.substring(0, 16)}...
                </span>
              </>
            )}
          </div>

          {!downloadSuccess ? (
            <>
              <button
                onClick={handleDownload}
                disabled={downloading}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  background: '#4080e0', color: '#fff',
                  cursor: downloading ? 'wait' : 'pointer',
                  fontSize: '0.78rem',
                  width: '100%',
                }}
              >
                {downloading
                  ? `${t('lan.status.downloading')} ${downloadProgress}%`
                  : t('lan.download')}
              </button>

              {/* Progress bar */}
              {downloading && (
                <div className="progress-bar-track" style={{ marginTop: 8, height: 4, borderRadius: 2 }}>
                  <div
                    className="progress-bar-fill"
                    style={{
                      width: `${downloadProgress}%`,
                      height: '100%',
                      borderRadius: 2,
                      transition: 'width 0.2s ease-out',
                    }}
                  />
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#30a050', fontWeight: 600, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle size={15} />
              {t('lan.downloadSuccess')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LanSharingPanel;
