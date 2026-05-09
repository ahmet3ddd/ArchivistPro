import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { notifyError } from '../services/notificationCenter';
import i18n from '../i18n';

export function useStorageWarningListener() {
  const setStorageWarning = useStore((s) => s.setStorageWarning);

  useEffect(() => {
    const storageHandler = (e: Event) => {
      setStorageWarning(true);
      const detail = (e as CustomEvent).detail;
      if (detail?.type === 'disk') {
        notifyError(i18n.t('storageWarningHook.diskLow'), i18n.t('storageWarningHook.diskLowDetail'));
      } else {
        notifyError(i18n.t('storageWarningHook.storageFull'), i18n.t('storageWarningHook.storageFullDetail'));
      }
    };
    const dbSaveHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      notifyError(i18n.t('storageWarningHook.saveFailed'), detail?.message || i18n.t('storageWarningHook.saveFailedDetail'));
    };
    window.addEventListener('archivist:storage-full', storageHandler);
    window.addEventListener('archivist:db-save-error', dbSaveHandler);
    return () => {
      window.removeEventListener('archivist:storage-full', storageHandler);
      window.removeEventListener('archivist:db-save-error', dbSaveHandler);
    };
  }, [setStorageWarning]);
}
