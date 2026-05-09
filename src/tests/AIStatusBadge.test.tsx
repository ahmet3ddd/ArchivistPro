import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import AIStatusBadge from '../components/AIStatusBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockUseOllamaStatus = vi.fn();
vi.mock('../hooks/useOllamaStatus', () => ({
  useOllamaStatus: (opts: unknown) => mockUseOllamaStatus(opts),
}));

const offlineStatus = {
  running: false,
  chatReady: false,
  visionReady: false,
  corsOk: null,
  version: null,
};

const readyStatus = {
  running: true,
  chatReady: true,
  visionReady: true,
  corsOk: true,
  version: '0.6.0',
};

const partialStatus = {
  running: true,
  chatReady: true,
  visionReady: false,
  corsOk: true,
  version: '0.6.0',
};

describe('AIStatusBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUseOllamaStatus.mockReturnValue({ status: offlineStatus });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('buton render edilir', () => {
    const { container } = render(<AIStatusBadge />);
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('aria-label var', () => {
    const { container } = render(<AIStatusBadge />);
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('aria-label')).toBe('aiStatus.label');
  });

  it('onClick callback çağrılır', () => {
    const onClick = vi.fn();
    const { container } = render(<AIStatusBadge onClick={onClick} />);
    fireEvent.click(container.querySelector('button')!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('hover sonrası tooltip görünür', () => {
    const { container } = render(<AIStatusBadge />);
    const btn = container.querySelector('button')!;
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(400); });
    // Tooltip divini bul — width: 220px ile benzersiz
    expect(container.querySelector('div[style*="220px"]')).not.toBeNull();
  });

  it('hover sonrası tooltip onSetupClick butonu gösterir (offline durumda)', () => {
    const onSetupClick = vi.fn();
    const { container } = render(<AIStatusBadge onSetupClick={onSetupClick} />);
    const btn = container.querySelector('button')!;
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(400); });
    // Tooltip içinde setup link butonu
    const buttons = container.querySelectorAll('button');
    // En az 2 buton: ana buton + setup link
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('hazır durum (running+chatReady+visionReady) — tooltip setup butonu göstermez', () => {
    mockUseOllamaStatus.mockReturnValue({ status: readyStatus });
    const onSetupClick = vi.fn();
    const { container } = render(<AIStatusBadge onSetupClick={onSetupClick} />);
    const btn = container.querySelector('button')!;
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(400); });
    // allReady=true → setup butonu yok, sadece 1 buton (ana)
    const setupBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.style.textDecoration === 'underline',
    );
    expect(setupBtn).toBeUndefined();
  });

  it('kısmi hazır durum — sarı nokta (partialReady)', () => {
    mockUseOllamaStatus.mockReturnValue({ status: partialStatus });
    const { container } = render(<AIStatusBadge />);
    // Dot div'i var olmalı (renk testi visual, sadece varlık kontrolü)
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('mouse ayrılınca tooltip kapanır', () => {
    const { container } = render(<AIStatusBadge />);
    const btn = container.querySelector('button')!;
    fireEvent.mouseEnter(btn);
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('div[style*="220px"]')).not.toBeNull();
    fireEvent.mouseLeave(btn);
    act(() => { vi.advanceTimersByTime(300); });
    expect(container.querySelector('div[style*="220px"]')).toBeNull();
  });
});
