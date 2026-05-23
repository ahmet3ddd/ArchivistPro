import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { registerDefaultShortcuts, startListening, stopListening } from '../services/keyboardShortcuts';
import { undo, redo, onUndoRedoChange } from '../services/undoRedo';
import { getUnreadCount } from '../services/messageService';
import { getUserCount } from '../services/userService';
import { getAuditLogs, auditLog, clearAuditLogsBefore, debugLog } from '../services/logger';
import { getSetting } from '../services/database';
import { readRecoveryKey, writeRecoveryKey, generateRecoveryKey } from '../services/recoveryService';
import { initTheme } from '../services/themeService';
import { setTrashDir } from '../services/trash';
import { loadBuildFeatures } from '../services/buildFeatures';
import { TIMINGS } from '../config/constants';
import i18n from '../i18n';

export function useAppInitialization(dbReady: boolean) {
  const isLoggedIn = useStore((s) => s.isLoggedIn);
  const currentRole = useStore((s) => s.currentRole);
  const currentUser = useStore((s) => s.currentUser);

  const [showHelp, setShowHelp] = useState(false);
  const [undoRedoState, setUndoRedoState] = useState<{
    canUndo: boolean;
    canRedo: boolean;
    undoLabel: string | null;
    redoLabel: string | null;
  }>({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  /** Recovery key bootstrap + isFirstRun tespiti tamamlandı mı */
  const [recoveryReady, setRecoveryReady] = useState(false);
  /** DB'de hiç kullanıcı yoksa true — FirstRunSetup gösterilir */
  const [isFirstRun, setIsFirstRun] = useState(false);
  const bootstrapDone = useRef(false);
  /** Önceki okunmamış mesaj sayısı; -1 = ilk poll henüz yapılmadı */
  const prevUnreadRef = useRef(-1);

  // Tema init
  useEffect(() => { initTheme(); }, []);

  // Çöp kutusu dizini init (appDataDir/.archivistpro-trash)
  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const dir = await invoke<string>('get_trash_dir');
        if (dir) setTrashDir(dir);
      } catch {
        // Tauri dışı ortamda (test) sessizce geç
      }
    })();
  }, []);

  // Build feature bayraklarını cache'le (admin-only komutlar derlemede var mı)
  useEffect(() => {
    loadBuildFeatures();
  }, []);

  // Klavye kısayolları
  useEffect(() => {
    if (!isLoggedIn) return;
    registerDefaultShortcuts({
      undo: () => undo(),
      redo: () => redo(),
      search: () => document.querySelector<HTMLInputElement>('.sidebar-search-input')?.focus(),
      escape: () => useStore.getState().setSelectedAssetId(null),
      help: () => setShowHelp(true),
    });
    startListening();
    return () => stopListening();
  }, [isLoggedIn]);

  // Undo/redo state listener — TopBar'a `undoLabel` aktarır. Toast YOK:
  // - execute: inline banner (chat) veya TopBar etiketi zaten gösteriyor
  // - undo/redo: UI'da sonuç zaten görünür (sohbet listeye döner vb.),
  //   ayrıca toast göstermek gürültü
  useEffect(() => {
    return onUndoRedoChange((state) => {
      setUndoRedoState({
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        undoLabel: state.undoLabel,
        redoLabel: state.redoLabel,
      });
    });
  }, []);

  // Mesaj polling (10s) + login sonrası gecikmeli poll
  useEffect(() => {
    if (!dbReady) return;

    // Kullanıcı değişince sayacı sıfırla (yeni oturumda bildirim tetiklenmesin)
    prevUnreadRef.current = -1;

    const poll = async () => {
      if (!currentUser) return;
      const count = getUnreadCount(currentUser);
      useStore.getState().setUnreadMessageCount(count);

      const prev = prevUnreadRef.current;
      prevUnreadRef.current = count;

      // İlk poll (prev === -1) → sadece sayacı kaydet, bildirim gönderme
      if (prev < 0) return;

      // Sayı arttıysa ve pencere odakta değilse OS bildirimi göster
      if (count > prev) {
        try {
          const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
          const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');

          const focused = await getCurrentWebviewWindow().isFocused();
          if (!focused) {
            let permitted = await isPermissionGranted();
            if (!permitted) {
              permitted = (await requestPermission()) === 'granted';
            }
            if (permitted) {
              const diff = count - prev;
              sendNotification({
                title: 'ArchivistPro',
                body: diff === 1
                  ? i18n.t('notification.newMessage')
                  : i18n.t('notification.newMessages', { count: diff }),
              });
            }
          }
        } catch {
          // Tauri dışı ortam (test) veya izin reddedildi — sessizce geç
        }
      }
    };

    poll();
    // Login sonrası DB hazır olmayabilir, 1.5s sonra tekrar dene
    const delayedPoll = setTimeout(poll, TIMINGS.MESSAGE_POLL_DELAY_MS);
    const interval = setInterval(poll, TIMINGS.MESSAGE_POLL_INTERVAL_MS);
    return () => { clearTimeout(delayedPoll); clearInterval(interval); };
  }, [dbReady, currentRole, currentUser]);

  // Recovery key bootstrap + ilk kurulum tespiti
  useEffect(() => {
    if (!dbReady || bootstrapDone.current) return;
    bootstrapDone.current = true;

    (async () => {
      // Recovery key yoksa üret ve kaydet
      try {
        const existing = await readRecoveryKey();
        if (!existing) {
          await writeRecoveryKey(generateRecoveryKey());
        }
      } catch {
        // Tauri dışı ortamda (test) sessizce geç
      }

      // Hiç kullanıcı yoksa ilk kurulum modu
      const count = getUserCount();
      setIsFirstRun(count === 0);
      setRecoveryReady(true);

      // Önceki oturumda yarıda kalmış bir tarama var mı?
      // Son ~20 scan-ilgili kaydı tarayıp SCAN_START sonrası terminal olayı
      // yoksa SCAN_INTERRUPTED kaydı düşeriz (crash/kill/güç kesintisi izi).
      // Önceki kapanışta marker bırakıldıysa: tüket + audit log'a APP_SHUTDOWN_GRACEFUL yaz.
      // Bu marker DB save'den bağımsız çalıştığı için büyük DB'lerde de güvenilir.
      let gracefulMarker: { timestamp: string; reason: string } | null = null;
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        gracefulMarker = await invoke<{ timestamp: string; reason: string } | null>('take_graceful_shutdown_marker');
        if (gracefulMarker) {
          auditLog('APP_SHUTDOWN_GRACEFUL', '', {
            reason: gracefulMarker.reason,
            timestamp: gracefulMarker.timestamp,
            source: 'marker_file',
          }, 'SUCCESS');
        }
      } catch { /* sessizce */ }

      try {
        const TERMINAL = new Set(['SCAN_COMPLETE', 'SCAN_CANCEL', 'SCAN_ERROR', 'SCAN_INTERRUPTED']);
        // SCAN_START sonrası terminal event yoksa scan kesintiye uğradı.
        // Aynı pencerede APP_SHUTDOWN_GRACEFUL var mı? → kullanıcı kendisi kapattı.
        const recent = getAuditLogs(40, 0, undefined);
        const scanRelated = recent.filter((e) => e.action.startsWith('SCAN_'));
        const lastStartIdx = scanRelated.findIndex((e) => e.action === 'SCAN_START');
        if (lastStartIdx >= 0) {
          const hasTerminalAfter = scanRelated
            .slice(0, lastStartIdx)
            .some((e) => TERMINAL.has(e.action));
          if (!hasTerminalAfter) {
            const startEntry = scanRelated[lastStartIdx];
            const startedAt = startEntry.timestamp;
            const detectedAt = new Date().toISOString();
            const elapsedMs = Math.max(0, new Date(detectedAt).getTime() - new Date(startedAt).getTime());
            const totalSec = Math.floor(elapsedMs / 1000);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            const elapsed = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;

            // SCAN_START'tan SONRA APP_SHUTDOWN_GRACEFUL var mı? İki kaynaktan kontrol:
            // 1) Marker dosyası (bu açılışta tüketildi) — kritik kanıt
            // 2) Audit log'daki APP_SHUTDOWN_GRACEFUL kaydı (önceki DB save'den)
            const startTime = new Date(startedAt).getTime();
            const markerAfterStart = gracefulMarker !== null &&
                new Date(gracefulMarker.timestamp).getTime() > startTime;
            const logAfterStart = recent.some((e) =>
                e.action === 'APP_SHUTDOWN_GRACEFUL' &&
                new Date(e.timestamp).getTime() > startTime
            );
            const gracefulShutdown = markerAfterStart || logAfterStart;

            const inferredCause = gracefulShutdown ? 'user_close' : 'unexpected_termination';
            const note = gracefulShutdown
                ? i18n.t('audit.scanInterrupted.noteUserClose')
                : i18n.t('audit.scanInterrupted.noteUnexpected');

            const detail: Record<string, string | number | boolean> = {
                startedAt,
                detectedAt,
                elapsedMs,
                elapsed,
                inferredCause,
                gracefulShutdown,
                note,
            };

            // Beklenmedik sonlanma için OS event log'unu sorgula — gerçek sebep
            if (!gracefulShutdown) {
                try {
                    const { invoke } = await import('@tauri-apps/api/core');
                    const events = await invoke<Array<{
                        time: string; id: number; level: string; provider: string; message: string;
                    }>>('query_os_events_for_crash', { startIso: startedAt, endIso: detectedAt });

                    if (events && events.length > 0) {
                        const hasCrash = events.some((e) => e.id === 1000 || e.provider === 'Application Error');
                        const hasHang = events.some((e) => e.id === 1002 || e.provider === 'Application Hang');
                        const hasUnexpectedReboot = events.some((e) => e.id === 6008 || e.id === 41);
                        const hasShutdown = events.some((e) => e.id === 1074 || e.id === 6006);

                        let detectedCause: string | null = null;
                        if (hasCrash) detectedCause = 'app_crash';
                        else if (hasHang) detectedCause = 'app_hang';
                        else if (hasUnexpectedReboot) detectedCause = 'system_unexpected_reboot';
                        else if (hasShutdown) detectedCause = 'system_shutdown';

                        if (detectedCause) {
                            detail.detectedCause = detectedCause;
                            detail.detectedCauseText = i18n.t(`audit.scanInterrupted.cause.${detectedCause}`);
                        }

                        // İlgili event'in özeti (debug + ek bilgi)
                        const importance = (e: { id: number }) =>
                            e.id === 1000 ? 0 : e.id === 1002 ? 1 : e.id === 6008 ? 2 : e.id === 41 ? 3 : e.id === 1074 ? 4 : 5;
                        const top = events.filter((e) => e.message).sort((a, b) => importance(a) - importance(b))[0];
                        if (top) {
                            const oneLine = top.message.replace(/\s+/g, ' ').slice(0, 250);
                            detail.osEventSummary = `[${top.id}] ${top.provider} @ ${top.time} — ${oneLine}`;
                        }
                    }
                } catch { /* Windows dışı veya PowerShell başarısız */ }

                // Hâlâ kesin sebep tespit edilemediyse genel olası sebep listesi göster
                if (!detail.detectedCause) {
                    detail.possibleCauses = i18n.t('audit.scanInterrupted.possibleCauses');
                }
            }

            auditLog('SCAN_INTERRUPTED', startEntry.target, detail, 'FAIL');
          }
        }
      } catch { /* sessizce geç */ }

      // Audit log retention — startup'ta bir kez eski kayıtları temizle.
      // Süre kullanıcı tarafından Settings'ten ayarlanır (audit_retention_days, default 90).
      // 0 = retention kapalı (hiçbir şey silinmez).
      try {
        const raw = getSetting('audit_retention_days');
        const days = raw !== null ? Math.max(0, Math.min(3650, parseInt(raw, 10) || 0)) : 90;
        if (days > 0) {
          const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
          const result = clearAuditLogsBefore(cutoff);
          if (result.success && result.deletedCount > 0) {
            debugLog('AuditRetention', `${result.deletedCount} kayıt temizlendi (>${days} gün)`);
          }
        }
      } catch { /* sessizce */ }
    })();
  }, [dbReady]);

  // Giriş yapılınca isFirstRun sıfırla (FirstRunSetup tamamlandıktan sonra)
  useEffect(() => {
    if (isLoggedIn) setIsFirstRun(false);
  }, [isLoggedIn]);

  return { undoRedoState, recoveryReady, isFirstRun, setIsFirstRun, showHelp, setShowHelp };
}
