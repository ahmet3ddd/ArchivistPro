import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import SessionWarningToast from '../components/SessionWarningToast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts.seconds === 'number') return String(opts.seconds);
      return key;
    },
  }),
}));

describe('SessionWarningToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('visible=false ise null render eder', () => {
    const { container } = render(
      <SessionWarningToast visible={false} onExtend={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('visible=true ise role=alert render eder', () => {
    const { container } = render(
      <SessionWarningToast visible={true} onExtend={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('visible=true ise extend butonu gösterilir', () => {
    const { container } = render(
      <SessionWarningToast visible={true} onExtend={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('extend butonuna tıklayınca onExtend + onDismiss çağrılır', () => {
    const onExtend = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <SessionWarningToast visible={true} onExtend={onExtend} onDismiss={onDismiss} />,
    );
    fireEvent.click(container.querySelector('button')!);
    expect(onExtend).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('başlangıçta 60 saniye gösterir', () => {
    const { container } = render(
      <SessionWarningToast visible={true} onExtend={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.textContent).toContain('60');
  });

  it('1 saniye sonra kalan süre 59 gösterir', () => {
    const { container } = render(
      <SessionWarningToast visible={true} onExtend={vi.fn()} onDismiss={vi.fn()} />,
    );
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.textContent).toContain('59');
  });

  it('visible false → true geçişinde sayaç resetlenir', () => {
    const { rerender, container } = render(
      <SessionWarningToast visible={true} onExtend={vi.fn()} onDismiss={vi.fn()} />,
    );
    act(() => { vi.advanceTimersByTime(5000); });
    // visible=false → sayaç durur
    rerender(<SessionWarningToast visible={false} onExtend={vi.fn()} onDismiss={vi.fn()} />);
    // visible=true → yeniden başlar
    rerender(<SessionWarningToast visible={true} onExtend={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.textContent).toContain('60');
  });

  it('visible=false iken extend tıklanamaz (render yok)', () => {
    const onClick = vi.fn();
    const { container } = render(
      <SessionWarningToast visible={false} onExtend={onClick} onDismiss={vi.fn()} />,
    );
    expect(container.querySelector('button')).toBeNull();
  });
});
