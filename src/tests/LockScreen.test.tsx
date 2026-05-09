import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import LockScreen from '../components/LockScreen';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockGetUserByCredentials = vi.fn();
vi.mock('../services/userService', () => ({
  getUserByCredentials: (username: string, password: string) =>
    mockGetUserByCredentials(username, password),
}));

describe('LockScreen', () => {
  beforeEach(() => {
    mockGetUserByCredentials.mockReset();
  });

  it('kullanıcı adını gösterir', () => {
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    expect(container.textContent).toContain('Ahmet');
  });

  it('şifre girişi boşken submit butonu devre dışı', () => {
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it('şifre girilince submit butonu aktif olur', () => {
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    const input = container.querySelector('input[type="password"]')!;
    fireEvent.change(input, { target: { value: 'sifre123' } });
    const submitBtn = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it('doğru şifre ile onUnlock çağrılır', async () => {
    const onUnlock = vi.fn();
    mockGetUserByCredentials.mockResolvedValue({ id: '1', username: 'Ahmet', role: 'admin' });
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={onUnlock} onSwitchUser={vi.fn()} />,
    );
    const input = container.querySelector('input[type="password"]')!;
    fireEvent.change(input, { target: { value: 'dogru-sifre' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('yanlış şifre ile hata mesajı gösterilir', async () => {
    mockGetUserByCredentials.mockResolvedValue(null);
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    const input = container.querySelector('input[type="password"]')!;
    fireEvent.change(input, { target: { value: 'yanlis-sifre' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(container.textContent).toContain('lockScreen.wrongPassword');
  });

  it('auth hatası durumunda genel hata mesajı gösterilir', async () => {
    mockGetUserByCredentials.mockRejectedValue(new Error('DB hatası'));
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    const input = container.querySelector('input[type="password"]')!;
    fireEvent.change(input, { target: { value: 'sifre' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(container.textContent).toContain('lockScreen.error');
  });

  it('Kullanıcı Değiştir butonu onSwitchUser çağırır', () => {
    const onSwitchUser = vi.fn();
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={onSwitchUser} />,
    );
    // Son buton = switch user (form dışında)
    const buttons = container.querySelectorAll('button');
    const switchBtn = buttons[buttons.length - 1];
    fireEvent.click(switchBtn);
    expect(onSwitchUser).toHaveBeenCalledTimes(1);
  });

  it('form render eder', () => {
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    expect(container.querySelector('form')).not.toBeNull();
  });

  it('şifre input alanı type=password', () => {
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    const input = container.querySelector('input');
    expect(input?.type).toBe('password');
  });

  it('yanlış şifre sonrası input temizlenir', async () => {
    mockGetUserByCredentials.mockResolvedValue(null);
    const { container } = render(
      <LockScreen username="Ahmet" onUnlock={vi.fn()} onSwitchUser={vi.fn()} />,
    );
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'yanlis' } });
    await act(async () => {
      fireEvent.submit(container.querySelector('form')!);
    });
    expect(input.value).toBe('');
  });
});
