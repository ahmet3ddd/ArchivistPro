import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../components/ErrorBoundary';

vi.mock('../services/logger', () => ({ systemLog: vi.fn() }));
vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
}));
vi.mock('../services/crashReporter', () => ({
  writeCrashReport: vi.fn(),
}));

function Bomb({ shouldThrow = false }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Test hatası');
  return <div>Normal içerik</div>;
}

// Dışarıdan kontrol edilebilen bomb — dismiss testleri için
let bombFlag = true;
function ControlledBomb() {
  if (bombFlag) throw new Error('Kontrollü hata');
  return <div>Kurtarıldı</div>;
}

describe('ErrorBoundary', () => {
  it('hata yoksa children render eder', () => {
    const { container } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Normal içerik');
  });

  it('hata yakalanınca fallback UI gösterir', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Test hatası');
    consoleError.mockRestore();
  });

  it('fallback UI iki buton içerir (yenile + devam)', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    expect(container.querySelectorAll('button').length).toBe(2);
    consoleError.mockRestore();
  });

  it('devam et butonu hata state temizler', () => {
    bombFlag = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <ControlledBomb />
      </ErrorBoundary>,
    );
    // Hata arayüzü 2 buton içermeli
    expect(container.querySelectorAll('button').length).toBe(2);
    bombFlag = false; // Sonraki render normal çalışır
    fireEvent.click(container.querySelectorAll('button')[1]); // devam et
    expect(container.textContent).toContain('Kurtarıldı');
    consoleError.mockRestore();
  });

  it('hata sınırı i18n key lerini render eder', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <ErrorBoundary>
        <Bomb shouldThrow />
      </ErrorBoundary>,
    );
    // i18n mock key döndürür, title ve reload key'leri görünür
    expect(container.textContent).toContain('errorBoundary.title');
    consoleError.mockRestore();
  });
});
