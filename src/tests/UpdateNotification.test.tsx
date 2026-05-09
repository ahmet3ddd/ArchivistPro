import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import UpdateNotification from '../components/UpdateNotification';
import type { UpdateState, UpdateActions } from '../hooks/useUpdateChecker';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.version) return `v${opts.version} mevcut`;
      return key;
    },
  }),
}));

function makeProps(overrides: Partial<UpdateState & UpdateActions> = {}): UpdateState & UpdateActions {
  return {
    status: 'idle',
    version: null,
    notes: null,
    downloadUrl: null,
    error: null,
    dismissed: false,
    checkForUpdate: vi.fn(),
    openDownload: vi.fn(),
    dismissUpdate: vi.fn(),
    ...overrides,
  };
}

describe('UpdateNotification', () => {
  it('status=idle → null render eder', () => {
    const { container } = render(<UpdateNotification {...makeProps({ status: 'idle' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('status=checking → null render eder', () => {
    const { container } = render(<UpdateNotification {...makeProps({ status: 'checking' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('status=error → null render eder', () => {
    const { container } = render(<UpdateNotification {...makeProps({ status: 'error' })} />);
    expect(container.firstChild).toBeNull();
  });

  it('dismissed=true → null render eder', () => {
    const { container } = render(
      <UpdateNotification {...makeProps({ status: 'available', dismissed: true })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('status=available → banner render eder', () => {
    const { container } = render(
      <UpdateNotification {...makeProps({ status: 'available', version: '2.4.0' })} />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('status=available → versiyon metni gösterilir', () => {
    const { container } = render(
      <UpdateNotification {...makeProps({ status: 'available', version: '2.4.0' })} />,
    );
    expect(container.textContent).toContain('2.4.0');
  });

  it('status=available → indir butonu openDownload çağırır', () => {
    const openDownload = vi.fn();
    const { container } = render(
      <UpdateNotification {...makeProps({ status: 'available', version: '2.4.0', openDownload })} />,
    );
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]); // indir butonu
    expect(openDownload).toHaveBeenCalledTimes(1);
  });

  it('status=available → kapat butonu dismissUpdate çağırır', () => {
    const dismissUpdate = vi.fn();
    const { container } = render(
      <UpdateNotification {...makeProps({ status: 'available', version: '2.4.0', dismissUpdate })} />,
    );
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[1]); // X butonu
    expect(dismissUpdate).toHaveBeenCalledTimes(1);
  });

  it('status=disabled → null render eder', () => {
    const { container } = render(
      <UpdateNotification {...makeProps({ status: 'disabled' })} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
