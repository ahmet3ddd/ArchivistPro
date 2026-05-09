/**
 * ArchivistPro — Asset Etiket & Favori Paneli
 *
 * Detay panelinde kullanılır.
 * Etiket ekleme/çıkarma, favori toggle, koleksiyon ekleme.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Plus, Star, StarOff, X, Wand2, Loader } from 'lucide-react';
import {
  getAllTags,
  getTagsForAsset, searchTags, suggestTagsForAsset, type Tag as TagType,
} from '../services/tagService';
import { getChunkCountByAssetId } from '../services/database';
import {
    commandAddTagToAsset,
    commandRemoveTagFromAsset,
    commandCreateTag,
} from '../services/undoCommands';
import { addFavorite, removeFavorite, isFavorite } from '../services/favorites';
import { notifyError } from '../services/notificationCenter';
import { useStore } from '../store/useStore';

interface AssetTagsPanelProps {
  assetId: string;
}

export default function AssetTagsPanel({ assetId }: AssetTagsPanelProps) {
  const { t } = useTranslation();
  const [assetTags, setAssetTags] = useState<TagType[]>([]);
  const [, setAllTags] = useState<TagType[]>([]);
  const [isFav, setIsFav] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const [suggestions, setSuggestions] = useState<TagType[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[] | null>(null);
  const aiConfig = useStore((s) => s.aiConfig);

  // Veri yükle
  useEffect(() => {
    setAssetTags(getTagsForAsset(assetId));
    setAllTags(getAllTags());
    setIsFav(isFavorite(assetId));
    setShowTagInput(false);
    setTagQuery('');
  }, [assetId]);

  // Tag arama
  useEffect(() => {
    if (!showTagInput) return;
    const results = tagQuery ? searchTags(tagQuery) : getAllTags();
    // Zaten eklenmiş olanları çıkar
    const assetTagIds = new Set(assetTags.map(t => t.id));
    setSuggestions(results.filter(t => !assetTagIds.has(t.id)));
  }, [tagQuery, showTagInput, assetTags]);

  // Store'u tetikle — etiket değişince allAssets memo'su yenilensin (arama çalışsın)
  const triggerStoreRefresh = useCallback(() => {
    const tags = getTagsForAsset(assetId);
    setAssetTags(tags);
    // scannedAssets'ı tetikle: ilgili asset'in userTags'ını güncelle
    useStore.getState().setScannedAssets((prev) =>
      prev.map(a => a.id === assetId
        ? { ...a, userTags: tags.map(t => ({ id: t.id, name: t.name, color: t.color })) }
        : a
      )
    );
  }, [assetId]);

  const handleAddTag = useCallback((tag: TagType) => {
    void commandAddTagToAsset(assetId, tag.id, tag.name, triggerStoreRefresh);
    setTagQuery('');
    setShowTagInput(false);
  }, [assetId, triggerStoreRefresh]);

  const handleCreateAndAddTag = useCallback(async () => {
    if (!tagQuery.trim()) return;
    const name = tagQuery.trim();
    const tag = await commandCreateTag(name, '#6366f1', () => { setAllTags(getAllTags()); });
    if (tag) {
      await commandAddTagToAsset(assetId, tag.id, tag.name, triggerStoreRefresh);
    }
    setTagQuery('');
    setShowTagInput(false);
  }, [assetId, tagQuery, triggerStoreRefresh]);

  const handleRemoveTag = useCallback((tagId: number) => {
    const tagName = assetTags.find((t) => t.id === tagId)?.name ?? '';
    void commandRemoveTagFromAsset(assetId, tagId, tagName, triggerStoreRefresh);
  }, [assetId, assetTags, triggerStoreRefresh]);

  const toggleFavorite = useCallback(() => {
    const next = !isFav;
    if (next) addFavorite(assetId); else removeFavorite(assetId);
    setIsFav(next);
    // Global store'u senkronla — kart yıldız ikonları anında güncellenir
    useStore.getState().toggleFavoriteId(assetId, next);
  }, [assetId, isFav]);

  const handleAiSuggest = useCallback(async () => {
    if (isSuggesting || aiConfig.apiProvider !== 'ollama') return;
    setIsSuggesting(true);
    try {
      const tags = await suggestTagsForAsset(assetId, aiConfig);
      setAiSuggestions(tags);
    } catch (err) {
      notifyError(`Etiket önerisi hatası: ${String(err)}`);
    } finally {
      setIsSuggesting(false);
    }
  }, [assetId, aiConfig, isSuggesting]);

  const handleApplySuggestedTag = useCallback(async (suggestedName: string) => {
    const existing = assetTags.find(t => t.name.toLowerCase() === suggestedName.toLowerCase());
    if (existing) {
      // Zaten var — sadece listeden kaldır
      setAiSuggestions(prev => prev ? prev.filter(s => s !== suggestedName) : null);
      return;
    }
    // Yeni tag oluştur ve ekle
    const tag = await commandCreateTag(suggestedName, '#6366f1', () => { setAllTags(getAllTags()); });
    if (tag) {
      await commandAddTagToAsset(assetId, tag.id, tag.name, triggerStoreRefresh);
    }
    // Listeden kaldır
    setAiSuggestions(prev => prev ? prev.filter(s => s !== suggestedName) : null);
  }, [assetId, assetTags, triggerStoreRefresh]);

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Favori + Etiket Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          <Tag size={13} />
          Etiketler
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={toggleFavorite}
            title={isFav ? t('assetTags.removeFromFavorites') : t('assetTags.addToFavorites')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: isFav ? '#f59e0b' : 'var(--color-text-muted)',
            }}
          >
            {isFav ? <Star size={14} fill="#f59e0b" /> : <StarOff size={14} />}
          </button>
          <button
            onClick={handleAiSuggest}
            disabled={isSuggesting || aiConfig.apiProvider !== 'ollama' || getChunkCountByAssetId(assetId) === 0}
            title="AI ile etiket öner (indexli dosya gerekir)"
            style={{
              background: 'none', border: 'none', cursor: isSuggesting || aiConfig.apiProvider !== 'ollama' || getChunkCountByAssetId(assetId) === 0 ? 'not-allowed' : 'pointer', padding: 2,
              color: isSuggesting || aiConfig.apiProvider !== 'ollama' || getChunkCountByAssetId(assetId) === 0 ? 'var(--color-text-muted)' : '#a78bfa',
            }}
          >
            {isSuggesting ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={14} />}
          </button>
          <button
            onClick={() => setShowTagInput(!showTagInput)}
            title="Etiket ekle"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: 'var(--color-accent)',
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Mevcut etiketler */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: showTagInput || aiSuggestions ? 8 : 0 }}>
        {assetTags.map(tag => (
          <span key={tag.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 8px', borderRadius: 12, fontSize: '0.68rem',
            background: `${tag.color}22`, color: tag.color, border: `1px solid ${tag.color}44`,
          }}>
            {tag.name}
            <button
              onClick={() => handleRemoveTag(tag.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: tag.color, padding: 0, lineHeight: 1 }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {assetTags.length === 0 && !showTagInput && !aiSuggestions && (
          <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Etiket yok
          </span>
        )}
      </div>

      {/* Önerilen Etiketler */}
      {aiSuggestions && aiSuggestions.length > 0 && (
        <div style={{ paddingTop: 6, borderTop: '1px solid var(--color-border)', marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-accent)' }}>
            <span>💡 Önerilen Etiketler</span>
            <button
              onClick={() => setAiSuggestions(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 0 }}
            >
              <X size={12} />
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {aiSuggestions.map(name => {
              const alreadyAdded = assetTags.some(t => t.name.toLowerCase() === name.toLowerCase());
              return (
                <button
                  key={name}
                  onClick={() => handleApplySuggestedTag(name)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                    padding: '2px 6px', borderRadius: 10, fontSize: '0.65rem',
                    background: alreadyAdded ? 'rgba(100,100,100,0.2)' : 'rgba(167,139,250,0.2)',
                    color: alreadyAdded ? 'var(--color-text-muted)' : '#a78bfa',
                    border: `1px solid ${alreadyAdded ? 'rgba(100,100,100,0.3)' : 'rgba(167,139,250,0.3)'}`,
                    cursor: 'pointer',
                    opacity: alreadyAdded ? 0.5 : 1,
                  }}
                >
                  {name}
                  <span>{alreadyAdded ? '✓' : '+'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Etiket ekleme inputu */}
      {showTagInput && (
        <div style={{ position: 'relative' }}>
          <input
            autoFocus
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateAndAddTag();
              if (e.key === 'Escape') { setShowTagInput(false); setTagQuery(''); }
            }}
            placeholder={t('assetTags.placeholder')}
            style={{
              width: '100%', padding: '5px 8px', fontSize: '0.72rem',
              background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)',
              borderRadius: 6, color: 'var(--color-text-primary)', outline: 'none',
            }}
          />
          {/* Öneri listesi */}
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 2,
              background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
              borderRadius: 6, maxHeight: 120, overflow: 'auto', zIndex: 10,
            }}>
              {suggestions.slice(0, 8).map(tag => (
                <button key={tag.id}
                  onClick={() => handleAddTag(tag)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    padding: '4px 8px', background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-text-primary)', fontSize: '0.7rem', textAlign: 'left',
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color }} />
                  {tag.name}
                </button>
              ))}
            </div>
          )}
          {/* Yeni etiket oluştur butonu */}
          {tagQuery.trim() && !suggestions.find(s => s.name.toLowerCase() === tagQuery.trim().toLowerCase()) && (
            <button
              onClick={handleCreateAndAddTag}
              style={{
                marginTop: 4, fontSize: '0.68rem', color: 'var(--color-accent)',
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              + {t('assetTags.createTag', { name: tagQuery.trim() })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
