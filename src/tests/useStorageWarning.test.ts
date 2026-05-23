import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStorageWarningListener } from '../hooks/useStorageWarning';
import { useStore } from '../store/useStore';

vi.mock('../services/notificationCenter', () => ({
  notifyError: vi.fn(),
}));
vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
}));

describe('useStorageWarningListener', () => {
  beforeEach(() => {
    useStore.setState({ storageWarning: false });
  });

  it('archivist:storage-full event dinler ve storageWarning set eder', () => {
    renderHook(() => useStorageWarningListener());

    window.dispatchEvent(new Event('archivist:storage-full'));

    expect(useStore.getState().storageWarning).toBe(true);
  });

  it('archivist:db-save-error event dinler', async () => {
    const { notifyError } = await import('../services/notificationCenter');
    renderHook(() => useStorageWarningListener());

    window.dispatchEvent(new CustomEvent('archivist:db-save-error', {
      detail: { message: 'Disk dolu' },
    }));

    expect(notifyError).toHaveBeenCalled();
  });

  it('unmount sonrası event listener temizlenir', () => {
    const { unmount } = renderHook(() => useStorageWarningListener());
    unmount();

    // Yeni bir event göndersek de storageWarning değişmemeli
    useStore.setState({ storageWarning: false });
    window.dispatchEvent(new Event('archivist:storage-full'));

    expect(useStore.getState().storageWarning).toBe(false);
  });
});
