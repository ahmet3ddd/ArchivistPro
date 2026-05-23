import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import StorageWarningBanner from '../components/StorageWarningBanner';
import { useStore } from '../store/useStore';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

describe('StorageWarningBanner', () => {
  beforeEach(() => {
    useStore.setState({ storageWarning: false });
  });

  it('storageWarning=false ise null render eder', () => {
    const { container } = render(<StorageWarningBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('storageWarning=true ise banner render eder', () => {
    useStore.setState({ storageWarning: true });
    const { container } = render(<StorageWarningBanner />);
    expect(container.firstChild).not.toBeNull();
  });

  it('mesaj i18n key ile gösterilir', () => {
    useStore.setState({ storageWarning: true });
    const { container } = render(<StorageWarningBanner />);
    expect(container.textContent).toContain('storageWarning.message');
  });

  it('dismiss butonuna tıklayınca storageWarning false olur', () => {
    useStore.setState({ storageWarning: true });
    const { container } = render(<StorageWarningBanner />);
    fireEvent.click(container.querySelector('button')!);
    expect(useStore.getState().storageWarning).toBe(false);
  });

  it('dismiss butonunun aria-label var', () => {
    useStore.setState({ storageWarning: true });
    const { container } = render(<StorageWarningBanner />);
    const btn = container.querySelector('button');
    expect(btn?.getAttribute('aria-label')).toBeTruthy();
  });

  it('storageWarning tekrar false yapılınca banner kaybolur', () => {
    useStore.setState({ storageWarning: true });
    const { rerender, container } = render(<StorageWarningBanner />);
    expect(container.firstChild).not.toBeNull();
    useStore.setState({ storageWarning: false });
    rerender(<StorageWarningBanner />);
    expect(container.firstChild).toBeNull();
  });
});
