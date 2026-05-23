import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ArchiveHealthBadge from '../components/ArchiveHealthBadge';
import { useStore } from '../store/useStore';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => {
        if (opts?.count !== undefined) return `${key}:${opts.count}`;
        if (opts?.done !== undefined && opts?.total !== undefined)
          return `${opts.done}/${opts.total}`;
        return key;
      },
    }),
  };
});

// ArchiveHealthModal — sadece varlık test edilsin, içerik mock
vi.mock('../components/ArchiveHealthModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="archive-health-modal">
      <button onClick={onClose}>Kapat</button>
    </div>
  ),
}));

const IDLE_CHECK = {
  status: 'idle' as const,
  staleIds: new Set<string>(),
  missingIds: new Set<string>(),
  versionOutdatedIds: new Set<string>(),
  progress: null,
  lastCheckedAt: null,
};

describe('ArchiveHealthBadge', () => {
  beforeEach(() => {
    useStore.setState({ stalenessCheck: IDLE_CHECK });
  });

  it('idle durumda buton render edilir', () => {
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('idle durumda i18n label gösterilir', () => {
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.textContent).toContain('health.idle');
  });

  it('checking durumda buton devre dışı', () => {
    useStore.setState({
      stalenessCheck: { ...IDLE_CHECK, status: 'checking' },
    });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('done + hepsi güncel → allFresh label', () => {
    useStore.setState({
      stalenessCheck: { ...IDLE_CHECK, status: 'done' },
    });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.textContent).toContain('health.allFresh');
  });

  it('done + stale dosyalar → stale label', () => {
    useStore.setState({
      stalenessCheck: {
        ...IDLE_CHECK,
        status: 'done',
        staleIds: new Set(['a1', 'a2']),
      },
    });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.textContent).toContain('health.stale:2');
  });

  it('done + missing dosyalar → missing label', () => {
    useStore.setState({
      stalenessCheck: {
        ...IDLE_CHECK,
        status: 'done',
        missingIds: new Set(['m1']),
      },
    });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.textContent).toContain('health.missing');
  });

  it('error durumda hata label gösterilir', () => {
    useStore.setState({
      stalenessCheck: { ...IDLE_CHECK, status: 'error' },
    });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.textContent).toContain('health.error');
  });

  it('tıklayınca modal açılır', () => {
    useStore.setState({ stalenessCheck: { ...IDLE_CHECK, status: 'done' } });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    fireEvent.click(container.querySelector('button')!);
    expect(container.querySelector('[data-testid="archive-health-modal"]')).not.toBeNull();
  });

  it('modal kapatınca kapanır', () => {
    useStore.setState({ stalenessCheck: { ...IDLE_CHECK, status: 'done' } });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    fireEvent.click(container.querySelector('button')!); // aç
    const closeBtn = container.querySelector('[data-testid="archive-health-modal"] button')!;
    fireEvent.click(closeBtn); // kapat
    expect(container.querySelector('[data-testid="archive-health-modal"]')).toBeNull();
  });

  it('checking sırasında progress gösterilir', () => {
    useStore.setState({
      stalenessCheck: {
        ...IDLE_CHECK,
        status: 'checking',
        progress: { done: 15, total: 100 },
      },
    });
    const { container } = render(
      <ArchiveHealthBadge assets={[]} onStartCheck={vi.fn()} />,
    );
    expect(container.textContent).toContain('15/100');
  });
});
