import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import FilterPresetSelector from '../components/FilterPresetSelector';
import { useStore } from '../store/useStore';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

const BASE_PRESET = {
  id: 'p1',
  name: 'Proje Filtresi',
  activeFilters: { fileType: ['DWG', 'MAX'] },
  createdAt: '2024-01-01',
};

describe('FilterPresetSelector', () => {
  beforeEach(() => {
    useStore.setState({
      filterPresets: [],
      activeFilters: {},
    });
    localStorage.clear();
  });

  it('preset yok + aktif filtre yok → null render eder', () => {
    const { container } = render(<FilterPresetSelector />);
    expect(container.firstChild).toBeNull();
  });

  it('preset varsa buton render edilir', () => {
    useStore.setState({ filterPresets: [BASE_PRESET] });
    const { container } = render(<FilterPresetSelector />);
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('aktif filtre varsa buton render edilir (preset olmasa da)', () => {
    useStore.setState({ activeFilters: { fileType: ['DWG'] }, filterPresets: [] });
    const { container } = render(<FilterPresetSelector />);
    expect(container.querySelector('button')).not.toBeNull();
  });

  it('buton tıklanınca dropdown açılır', () => {
    useStore.setState({ filterPresets: [BASE_PRESET] });
    const { container } = render(<FilterPresetSelector />);
    fireEvent.click(container.querySelector('button')!);
    // Dropdown açık → preset adı görünür
    expect(container.textContent).toContain('Proje Filtresi');
  });

  it('preset ismi dropdown da gösterilir', () => {
    useStore.setState({ filterPresets: [BASE_PRESET] });
    const { container } = render(<FilterPresetSelector />);
    fireEvent.click(container.querySelector('button')!);
    expect(container.textContent).toContain('Proje Filtresi');
  });

  it('preset sayısı buton etiketinde gösterilir', () => {
    useStore.setState({ filterPresets: [BASE_PRESET, { ...BASE_PRESET, id: 'p2', name: 'İkinci' }] });
    const { container } = render(<FilterPresetSelector />);
    expect(container.textContent).toContain('2');
  });

  it('sil butonuna tıklayınca deleteFilterPreset çağrılır', () => {
    useStore.setState({ filterPresets: [BASE_PRESET] });
    const { container } = render(<FilterPresetSelector />);
    fireEvent.click(container.querySelector('button')!); // dropdown aç
    // Sil butonu — title="common.delete"
    const buttons = container.querySelectorAll('button');
    const deleteBtn = Array.from(buttons).find(
      (b) => b.getAttribute('title') === 'common.delete',
    );
    expect(deleteBtn).not.toBeUndefined();
    fireEvent.click(deleteBtn!);
    expect(useStore.getState().filterPresets.length).toBe(0);
  });

  it('preset yokken "boş" mesajı gösterilir', () => {
    useStore.setState({ filterPresets: [], activeFilters: { fileType: ['DWG'] } });
    const { container } = render(<FilterPresetSelector />);
    fireEvent.click(container.querySelector('button')!);
    expect(container.textContent).toContain('filterPreset.empty');
  });

  it('aktif filtre varken kaydet butonu aktif', () => {
    useStore.setState({ filterPresets: [], activeFilters: { fileType: ['DWG'] } });
    const { container } = render(<FilterPresetSelector />);
    fireEvent.click(container.querySelector('button')!);
    // Kaydet butonu disabled değil
    const buttons = container.querySelectorAll('button');
    const saveBtn = Array.from(buttons).find(
      (b) => b.textContent?.includes('filterPreset.saveCurrentFilters'),
    ) as HTMLButtonElement | undefined;
    expect(saveBtn?.disabled).toBe(false);
  });

  it('dropdown dışına tıklayınca kapanır', () => {
    useStore.setState({ filterPresets: [BASE_PRESET] });
    const { container } = render(<FilterPresetSelector />);
    fireEvent.click(container.querySelector('button')!); // aç
    expect(container.textContent).toContain('Proje Filtresi');
    // Dışarıya tıkla
    fireEvent.mouseDown(document.body);
    expect(container.textContent).not.toContain('Proje Filtresi');
  });
});
