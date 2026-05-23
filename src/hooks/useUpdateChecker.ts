/**
 * ArchivistPro — LAN Update Checker Hook
 *
 * Kullanici LAN'daki bir HTTP sunucuya `latest.json` koyar:
 *   { "version": "2.4.0", "notes": "...", "downloadUrl": "http://..." }
 *
 * Settings → About → "Guncellemeler" kartindaki sunucu URL bos ise hicbir kontrol yapilmaz.
 * Yeni surum bulundugunda kullanici "Indir" der; LAN downloadUrl varsayilan tarayicida acilir.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { TIMINGS } from '../config/constants';
import { systemLog } from '../services/logger';
import { APP_VERSION } from '../appVersion';
import { getSetting } from '../services/database';

export type UpdateStatus = 'idle' | 'disabled' | 'checking' | 'available' | 'error';

export interface UpdateState {
  status: UpdateStatus;
  version: string | null;
  notes: string | null;
  downloadUrl: string | null;
  error: string | null;
  dismissed: boolean;
}

export interface UpdateActions {
  checkForUpdate: () => Promise<void>;
  openDownload: () => Promise<void>;
  dismissUpdate: () => void;
}

interface RemoteManifest {
  version: string;
  notes?: string;
  downloadUrl: string;
  releaseDate?: string;
}

function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.split('.').map((p) => parseInt(p, 10) || 0);
  const l = local.split('.').map((p) => parseInt(p, 10) || 0);
  const len = Math.max(r.length, l.length);
  for (let i = 0; i < len; i++) {
    const rp = r[i] ?? 0;
    const lp = l[i] ?? 0;
    if (rp > lp) return true;
    if (rp < lp) return false;
  }
  return false;
}

function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function useUpdateChecker(enabled: boolean): UpdateState & UpdateActions {
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    version: null,
    notes: null,
    downloadUrl: null,
    error: null,
    dismissed: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const checkForUpdate = useCallback(async () => {
    const raw = getSetting('update_server_url') ?? '';
    const base = normalizeServerUrl(raw);
    if (!base) {
      setState((s) => ({ ...s, status: 'disabled', error: null }));
      return;
    }

    try {
      setState((s) => ({ ...s, status: 'checking', error: null }));
      const { fetch } = await import('@tauri-apps/plugin-http');
      const res = await fetch(`${base}/latest.json`, { method: 'GET' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const manifest = (await res.json()) as RemoteManifest;
      if (!manifest?.version || !manifest?.downloadUrl) {
        throw new Error('latest.json eksik alan iceriyor (version / downloadUrl)');
      }

      if (isNewerVersion(manifest.version, APP_VERSION)) {
        setState((s) => ({
          ...s,
          status: 'available',
          version: manifest.version,
          notes: manifest.notes ?? null,
          downloadUrl: manifest.downloadUrl,
          dismissed: false,
        }));
        systemLog('INFO', 'Updater', `LAN update available: v${manifest.version}`);
      } else {
        setState((s) => ({ ...s, status: 'idle', version: manifest.version }));
        systemLog('DEBUG', 'Updater', `Up-to-date (LAN reports v${manifest.version})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, status: 'error', error: msg }));
      systemLog('WARN', 'Updater', `LAN check failed: ${msg}`);
    }
  }, []);

  const openDownload = useCallback(async () => {
    const url = stateRef.current.downloadUrl;
    if (!url) return;
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      systemLog('INFO', 'Updater', `Opened download URL in browser: ${url}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, status: 'error', error: msg }));
      systemLog('ERROR', 'Updater', `Open failed: ${msg}`);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setState((s) => ({ ...s, dismissed: true }));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const initTimeout = setTimeout(() => {
      checkForUpdate();
    }, 5_000);
    const interval = setInterval(() => {
      checkForUpdate();
    }, TIMINGS.UPDATE_CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initTimeout);
      clearInterval(interval);
    };
  }, [enabled, checkForUpdate]);

  return { ...state, checkForUpdate, openDownload, dismissUpdate };
}
