import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getSearchHistory,
  addToSearchHistory,
  removeFromSearchHistory,
  clearSearchHistory,
  searchInHistory,
  getSavedSearches,
  saveSearch,
  deleteSavedSearch,
  renameSavedSearch,
} from '../services/searchHistory';

describe('SearchHistory — Arama Geçmişi', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('boş geçmiş boş dizi döner', () => {
    expect(getSearchHistory()).toEqual([]);
  });

  it('addToSearchHistory arama ekler', () => {
    addToSearchHistory('mimari plan', 5);
    const history = getSearchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].query).toBe('mimari plan');
    expect(history[0].resultCount).toBe(5);
  });

  it('addToSearchHistory boş string eklemez', () => {
    addToSearchHistory('');
    addToSearchHistory('   ');
    expect(getSearchHistory()).toHaveLength(0);
  });

  it('duplicate arama en üste taşınır', () => {
    addToSearchHistory('plan');
    addToSearchHistory('kesit');
    addToSearchHistory('plan');
    const history = getSearchHistory();
    expect(history).toHaveLength(2);
    expect(history[0].query).toBe('plan');
    expect(history[1].query).toBe('kesit');
  });

  it('geçmiş max 50 kayıtla sınırlı', () => {
    for (let i = 0; i < 55; i++) {
      addToSearchHistory(`query_${i}`);
    }
    expect(getSearchHistory()).toHaveLength(50);
  });

  it('removeFromSearchHistory kayıt siler', () => {
    addToSearchHistory('plan');
    addToSearchHistory('kesit');
    removeFromSearchHistory('plan');
    const history = getSearchHistory();
    expect(history).toHaveLength(1);
    expect(history[0].query).toBe('kesit');
  });

  it('clearSearchHistory tüm geçmişi temizler', () => {
    addToSearchHistory('plan');
    addToSearchHistory('kesit');
    clearSearchHistory();
    expect(getSearchHistory()).toHaveLength(0);
  });

  it('searchInHistory prefix ile arar', () => {
    addToSearchHistory('mimari plan');
    addToSearchHistory('mekanik tesisat');
    addToSearchHistory('mimari kesit');
    const results = searchInHistory('mim');
    expect(results).toHaveLength(2);
    expect(results.every(r => r.query.includes('mimari'))).toBe(true);
  });

  it('searchInHistory boş prefix son 10 kayıt döner', () => {
    addToSearchHistory('a');
    addToSearchHistory('b');
    const results = searchInHistory('');
    expect(results).toHaveLength(2);
  });

  it('searchInHistory max 10 sonuç döner', () => {
    for (let i = 0; i < 15; i++) {
      addToSearchHistory(`test_${i}`);
    }
    const results = searchInHistory('test');
    expect(results.length).toBeLessThanOrEqual(10);
  });
});

describe('SearchHistory — Kayıtlı Aramalar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('boş kayıtlı aramalar boş dizi döner', () => {
    expect(getSavedSearches()).toEqual([]);
  });

  it('saveSearch kayıtlı arama oluşturur', () => {
    const saved = saveSearch('Mimari Planlar', 'mimari plan');
    expect(saved.name).toBe('Mimari Planlar');
    expect(saved.query).toBe('mimari plan');
    expect(saved.id).toContain('saved_');
  });

  it('saveSearch filtrelerle kaydeder', () => {
    const filters = { category: ['CAD'], fileType: ['dwg'] };
    const saved = saveSearch('DWG Dosyalar', 'plan', filters);
    expect(saved.filters).toEqual(filters);
  });

  it('getSavedSearches kayıtlı aramaları listeler', () => {
    saveSearch('Arama 1', 'query1');
    saveSearch('Arama 2', 'query2');
    expect(getSavedSearches()).toHaveLength(2);
  });

  it('deleteSavedSearch kayıtlı aramayı siler', () => {
    const saved = saveSearch('Silinecek', 'test');
    deleteSavedSearch(saved.id);
    expect(getSavedSearches()).toHaveLength(0);
  });

  it('renameSavedSearch isim değiştirir', () => {
    const saved = saveSearch('Eski', 'test');
    expect(renameSavedSearch(saved.id, 'Yeni')).toBe(true);
    const all = getSavedSearches();
    expect(all[0].name).toBe('Yeni');
  });

  it('renameSavedSearch olmayan ID için false döner', () => {
    expect(renameSavedSearch('nonexistent', 'X')).toBe(false);
  });
});
