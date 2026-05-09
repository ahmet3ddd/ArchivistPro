import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ConfirmDialog from '../components/ConfirmDialog';
import { useStore } from '../store/useStore';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

describe('ConfirmDialog', () => {
  beforeEach(() => {
    useStore.setState({ confirmDialog: null });
    vi.clearAllMocks();
  });

  it('dialog=null ise null render eder', () => {
    const { container } = render(<ConfirmDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('dialog var ise alertdialog render eder', () => {
    useStore.setState({
      confirmDialog: { message: 'Silmek istiyor musunuz?', onConfirm: vi.fn() },
    });
    const { container } = render(<ConfirmDialog />);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('dialog mesajı gösterilir', () => {
    useStore.setState({
      confirmDialog: { message: 'Kalıcı olarak silinecek', onConfirm: vi.fn() },
    });
    const { container } = render(<ConfirmDialog />);
    expect(container.textContent).toContain('Kalıcı olarak silinecek');
  });

  it('detail prop varsa gösterilir', () => {
    useStore.setState({
      confirmDialog: {
        message: 'Ana mesaj',
        detail: 'Bu işlem geri alınamaz',
        onConfirm: vi.fn(),
      },
    });
    const { container } = render(<ConfirmDialog />);
    expect(container.textContent).toContain('Bu işlem geri alınamaz');
  });

  it('confirm butonuna tıklayınca onConfirm çağrılır', () => {
    const onConfirm = vi.fn();
    useStore.setState({ confirmDialog: { message: 'Test', onConfirm } });
    const { container } = render(<ConfirmDialog />);
    // En son buton = confirm
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('confirm tıklayınca dialog kapanır', () => {
    useStore.setState({ confirmDialog: { message: 'Test', onConfirm: vi.fn() } });
    const { container } = render(<ConfirmDialog />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(useStore.getState().confirmDialog).toBeNull();
  });

  it('cancel butonuna tıklayınca dialog kapanır', () => {
    useStore.setState({ confirmDialog: { message: 'Test', onConfirm: vi.fn() } });
    const { container } = render(<ConfirmDialog />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]); // ilk buton = cancel
    expect(useStore.getState().confirmDialog).toBeNull();
  });

  it('hideCancel=true ise sadece bir buton var', () => {
    useStore.setState({
      confirmDialog: { message: 'Test', onConfirm: vi.fn(), hideCancel: true },
    });
    const { container } = render(<ConfirmDialog />);
    expect(container.querySelectorAll('button').length).toBe(1);
  });

  it('confirmLabel prop kullanılır', () => {
    useStore.setState({
      confirmDialog: { message: 'Test', onConfirm: vi.fn(), confirmLabel: 'Evet Sil' },
    });
    const { container } = render(<ConfirmDialog />);
    expect(container.textContent).toContain('Evet Sil');
  });

  it('backdrop tıklayınca dialog kapanır', () => {
    useStore.setState({ confirmDialog: { message: 'Test', onConfirm: vi.fn() } });
    const { container } = render(<ConfirmDialog />);
    // Backdrop = ilk div (fixed overlay)
    fireEvent.click(container.firstChild as Element);
    expect(useStore.getState().confirmDialog).toBeNull();
  });

  it('Escape tuşu dialog kapatır', () => {
    useStore.setState({ confirmDialog: { message: 'Test', onConfirm: vi.fn() } });
    render(<ConfirmDialog />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useStore.getState().confirmDialog).toBeNull();
  });
});
