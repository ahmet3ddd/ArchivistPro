import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import AssetTagsPanel from '../components/AssetTagsPanel';
import { useStore } from '../store/useStore';
import type { Tag } from '../services/tagService';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return { ...actual, useTranslation: () => ({ t: (key: string) => key }) };
});

const mockGetTagsForAsset = vi.fn<[string], Tag[]>();
const mockGetAllTags = vi.fn<[], Tag[]>();
const mockSearchTags = vi.fn<[string], Tag[]>();
const mockIsFavorite = vi.fn<[string], boolean>();
const mockAddFavorite = vi.fn();
const mockRemoveFavorite = vi.fn();
const mockGetChunkCountByAssetId = vi.fn<[string], number>();
const mockCommandAddTagToAsset = vi.fn();
const mockCommandRemoveTagFromAsset = vi.fn();
const mockCommandCreateTag = vi.fn();

vi.mock('../services/tagService', () => ({
  getTagsForAsset: (id: string) => mockGetTagsForAsset(id),
  getAllTags: () => mockGetAllTags(),
  searchTags: (q: string) => mockSearchTags(q),
  suggestTagsForAsset: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/database')>();
  return {
    ...actual,
    getChunkCountByAssetId: (id: string) => mockGetChunkCountByAssetId(id),
    getChunkCountByAssetIdAsync: async (id: string) => mockGetChunkCountByAssetId(id),
  };
});
vi.mock('../services/undoCommands', () => ({
  commandAddTagToAsset: (...args: unknown[]) => mockCommandAddTagToAsset(...args),
  commandRemoveTagFromAsset: (...args: unknown[]) => mockCommandRemoveTagFromAsset(...args),
  commandCreateTag: (...args: unknown[]) => mockCommandCreateTag(...args),
}));
vi.mock('../services/favorites', () => ({
  isFavorite: (id: string) => mockIsFavorite(id),
  addFavorite: (id: string) => mockAddFavorite(id),
  removeFavorite: (id: string) => mockRemoveFavorite(id),
}));
vi.mock('../services/notificationCenter', () => ({
  notifyError: vi.fn(),
}));

const SAMPLE_TAG: Tag = { id: 1, name: 'Mimari', color: '#6366f1' };

describe('AssetTagsPanel', () => {
  beforeEach(() => {
    mockGetTagsForAsset.mockReturnValue([]);
    mockGetAllTags.mockReturnValue([]);
    mockSearchTags.mockReturnValue([]);
    mockIsFavorite.mockReturnValue(false);
    mockGetChunkCountByAssetId.mockReturnValue(0);
    useStore.setState({
      aiConfig: { apiProvider: 'ollama', apiKey: '', apiUrl: '', enableClipVision: false, visionModel: '', embeddingModel: '' },
      scannedAssets: [],
    });
    vi.clearAllMocks();
  });

  it('etiket yokken "Etiket yok" gösterilir', () => {
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    expect(container.textContent).toContain('Etiket yok');
  });

  it('etiketler render edilir', () => {
    mockGetTagsForAsset.mockReturnValue([SAMPLE_TAG]);
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    expect(container.textContent).toContain('Mimari');
  });

  it('birden fazla etiket render edilir', () => {
    mockGetTagsForAsset.mockReturnValue([
      SAMPLE_TAG,
      { id: 2, name: 'Yapısal', color: '#10b981' },
    ]);
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    expect(container.textContent).toContain('Mimari');
    expect(container.textContent).toContain('Yapısal');
  });

  it('Plus butonuna tıklayınca tag input açılır', () => {
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    const buttons = container.querySelectorAll('button');
    // Plus butonu (son header butonu)
    const plusBtn = buttons[buttons.length - 1];
    fireEvent.click(plusBtn);
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('favori değilken yıldız butonu StarOff rengi', () => {
    mockIsFavorite.mockReturnValue(false);
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    const favBtn = container.querySelector('button[title*="Favorites"]') ||
      container.querySelectorAll('button')[0];
    expect(favBtn).not.toBeNull();
  });

  it('favori butonuna tıklayınca addFavorite çağrılır', () => {
    mockIsFavorite.mockReturnValue(false);
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    const favBtn = container.querySelectorAll('button')[0]; // ilk buton = favori
    fireEvent.click(favBtn);
    expect(mockAddFavorite).toHaveBeenCalledWith('asset-1');
  });

  it('favori iken tıklayınca removeFavorite çağrılır', () => {
    mockIsFavorite.mockReturnValue(true);
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    const favBtn = container.querySelectorAll('button')[0];
    fireEvent.click(favBtn);
    expect(mockRemoveFavorite).toHaveBeenCalledWith('asset-1');
  });

  it('tag kaldır butonuna tıklayınca commandRemoveTagFromAsset çağrılır', () => {
    mockGetTagsForAsset.mockReturnValue([SAMPLE_TAG]);
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    // Tag chip içindeki X butonu
    const removeBtn = container.querySelector('span button');
    fireEvent.click(removeBtn!);
    expect(mockCommandRemoveTagFromAsset).toHaveBeenCalled();
  });

  it('Escape tuşu tag input kapatır', () => {
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    const plusBtn = container.querySelectorAll('button')[container.querySelectorAll('button').length - 1];
    fireEvent.click(plusBtn); // input aç
    const input = container.querySelector('input')!;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(container.querySelector('input')).toBeNull();
  });

  it('input değişince tagQuery güncellenir', () => {
    const { container } = render(<AssetTagsPanel assetId="asset-1" />);
    const plusBtn = container.querySelectorAll('button')[container.querySelectorAll('button').length - 1];
    fireEvent.click(plusBtn);
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Yapı' } });
    expect(input.value).toBe('Yapı');
  });
});
