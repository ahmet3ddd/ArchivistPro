import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import ToastContainer, { type ToastItem } from '../components/Toast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('ToastContainer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('toasts boşken null render eder', () => {
    const { container } = render(<ToastContainer toasts={[]} onRemove={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('tek toast render eder', () => {
    const toasts: ToastItem[] = [{ id: '1', type: 'success', message: 'İşlem başarılı' }];
    const { container } = render(<ToastContainer toasts={toasts} onRemove={vi.fn()} />);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('mesaj metni gösterilir', () => {
    const toasts: ToastItem[] = [{ id: '1', type: 'info', message: 'Bilgi mesajı' }];
    const { container } = render(<ToastContainer toasts={toasts} onRemove={vi.fn()} />);
    expect(container.textContent).toContain('Bilgi mesajı');
  });

  it('birden fazla toast render edilir', () => {
    const toasts: ToastItem[] = [
      { id: '1', type: 'success', message: 'Birinci' },
      { id: '2', type: 'error', message: 'İkinci' },
      { id: '3', type: 'warning', message: 'Üçüncü' },
    ];
    const { container } = render(<ToastContainer toasts={toasts} onRemove={vi.fn()} />);
    expect(container.querySelectorAll('[role="alert"]').length).toBe(3);
  });

  it('kapat butonuna tıklayınca onRemove(id) çağrılır', () => {
    const onRemove = vi.fn();
    const toasts: ToastItem[] = [{ id: 'abc123', type: 'warning', message: 'Uyarı' }];
    const { container } = render(<ToastContainer toasts={toasts} onRemove={onRemove} />);
    fireEvent.click(container.querySelector('button')!);
    expect(onRemove).toHaveBeenCalledWith('abc123');
  });

  it('4 saniye sonra otomatik olarak onRemove çağrılır', () => {
    const onRemove = vi.fn();
    const toasts: ToastItem[] = [{ id: 'auto1', type: 'success', message: 'Otomatik' }];
    render(<ToastContainer toasts={toasts} onRemove={onRemove} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onRemove).toHaveBeenCalledWith('auto1');
  });

  it('4 saniyeden önce onRemove çağrılmaz', () => {
    const onRemove = vi.fn();
    const toasts: ToastItem[] = [{ id: 'early', type: 'info', message: 'Erken' }];
    render(<ToastContainer toasts={toasts} onRemove={onRemove} />);
    act(() => { vi.advanceTimersByTime(3999); });
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('her toast tipi (success/error/warning/info) render edilir', () => {
    const types: ToastItem['type'][] = ['success', 'error', 'warning', 'info'];
    types.forEach((type) => {
      const toasts: ToastItem[] = [{ id: type, type, message: `${type} mesajı` }];
      const { container } = render(<ToastContainer toasts={toasts} onRemove={vi.fn()} />);
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
    });
  });
});
