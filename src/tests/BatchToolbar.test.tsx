import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import BatchToolbar from '../components/BatchToolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.count !== undefined) return `${opts.count} seçili`;
      return key;
    },
  }),
}));

describe('BatchToolbar', () => {
  const defaultProps = {
    selectedCount: 3,
    totalCount: 10,
    onAddTags: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
  };

  it('role=toolbar render eder', () => {
    const { container } = render(<BatchToolbar {...defaultProps} />);
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
  });

  it('seçim sayısını gösterir', () => {
    const { container } = render(<BatchToolbar {...defaultProps} selectedCount={5} />);
    expect(container.textContent).toContain('5');
  });

  it('etiket ekle butonuna tıklayınca onAddTags çağrılır', () => {
    const onAddTags = vi.fn();
    const { container } = render(<BatchToolbar {...defaultProps} onAddTags={onAddTags} />);
    const buttons = container.querySelectorAll('button');
    // btn-primary = etiket ekle butonu
    const tagBtn = Array.from(buttons).find(b => b.className.includes('btn-primary'));
    fireEvent.click(tagBtn!);
    expect(onAddTags).toHaveBeenCalledTimes(1);
  });

  it('seçimi temizle butonuna tıklayınca onClearSelection çağrılır', () => {
    const onClearSelection = vi.fn();
    const { container } = render(<BatchToolbar {...defaultProps} onClearSelection={onClearSelection} />);
    const buttons = container.querySelectorAll('button');
    // Son buton = temizle
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('selectedCount < totalCount iken tümünü seç butonu görünür', () => {
    const onSelectAll = vi.fn();
    const { container } = render(
      <BatchToolbar {...defaultProps} selectedCount={3} totalCount={10} onSelectAll={onSelectAll} />,
    );
    const buttons = container.querySelectorAll('button');
    // tümünü seç butonu mevcut (btn-primary hariç)
    expect(buttons.length).toBeGreaterThanOrEqual(3); // tümünü seç + etiket + temizle
  });

  it('tümünü seç butonuna tıklayınca onSelectAll çağrılır', () => {
    const onSelectAll = vi.fn();
    const { container } = render(
      <BatchToolbar {...defaultProps} selectedCount={3} totalCount={10} onSelectAll={onSelectAll} />,
    );
    const buttons = container.querySelectorAll('button');
    // İlk buton = tümünü seç
    fireEvent.click(buttons[0]);
    expect(onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('selectedCount === totalCount iken tümünü seç butonu görünmez', () => {
    const { container } = render(
      <BatchToolbar {...defaultProps} selectedCount={10} totalCount={10} />,
    );
    const buttons = container.querySelectorAll('button');
    // Sadece etiket ekle + temizle = 2 buton
    expect(buttons.length).toBe(2);
  });

  it('aria-label var', () => {
    const { container } = render(<BatchToolbar {...defaultProps} />);
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar?.getAttribute('aria-label')).toBeTruthy();
  });
});
