import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import InputDialog from '../components/InputDialog';
import { useStore } from '../store/useStore';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : key),
    }),
  };
});

describe('InputDialog', () => {
  beforeEach(() => {
    useStore.setState({ inputDialog: null });
    vi.clearAllMocks();
  });

  it('dialog=null ise null render eder', () => {
    const { container } = render(<InputDialog />);
    expect(container.firstChild).toBeNull();
  });

  it('dialog var ise role=dialog render eder', () => {
    useStore.setState({
      inputDialog: { message: 'Yeni isim girin', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('dialog mesajı gösterilir', () => {
    useStore.setState({
      inputDialog: { message: 'Klasör adını girin', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    expect(container.textContent).toContain('Klasör adını girin');
  });

  it('defaultValue input alanına yüklenir', () => {
    useStore.setState({
      inputDialog: { message: 'Test', defaultValue: 'Mevcut Ad', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Mevcut Ad');
  });

  it('boş input iken confirm butonu devre dışı', () => {
    useStore.setState({
      inputDialog: { message: 'Test', defaultValue: '', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('input dolu iken confirm butonu aktif', () => {
    useStore.setState({
      inputDialog: { message: 'Test', defaultValue: 'Bir Değer', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    const buttons = container.querySelectorAll('button');
    const confirmBtn = buttons[buttons.length - 1] as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(false);
  });

  it('confirm butonuna tıklayınca onConfirm(value) çağrılır', () => {
    const onConfirm = vi.fn();
    useStore.setState({
      inputDialog: { message: 'Test', defaultValue: 'Yeni Klasör', onConfirm },
    });
    const { container } = render(<InputDialog />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onConfirm).toHaveBeenCalledWith('Yeni Klasör');
  });

  it('confirm tıklayınca dialog kapanır', () => {
    useStore.setState({
      inputDialog: { message: 'Test', defaultValue: 'Değer', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(useStore.getState().inputDialog).toBeNull();
  });

  it('cancel butonuna tıklayınca dialog kapanır', () => {
    useStore.setState({
      inputDialog: { message: 'Test', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    const buttons = container.querySelectorAll('button');
    fireEvent.click(buttons[0]); // cancel = ilk buton
    expect(useStore.getState().inputDialog).toBeNull();
  });

  it('backdrop tıklayınca dialog kapanır', () => {
    useStore.setState({
      inputDialog: { message: 'Test', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    fireEvent.click(container.firstChild as Element);
    expect(useStore.getState().inputDialog).toBeNull();
  });

  it('input değeri onChange ile güncellenir', () => {
    useStore.setState({
      inputDialog: { message: 'Test', defaultValue: '', onConfirm: vi.fn() },
    });
    const { container } = render(<InputDialog />);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Yeni Değer' } });
    expect(input.value).toBe('Yeni Değer');
  });
});
