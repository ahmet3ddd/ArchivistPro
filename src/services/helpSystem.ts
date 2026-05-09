/**
 * Archivist Pro — Help Sistemi
 *
 * Context-aware ? butonu: hangi ekrandaysan o ekranın yardımı açılır.
 * Markdown kılavuz uygulama içinde render edilir.
 * Aktif dil i18n.language'dan okunur; çeviri yoksa locale fallback chain
 * (istenen dil → en → tr) ile mevcut bir kılavuza düşülür.
 */

import i18n from '../i18n';

/* ── Tipler ── */

export type HelpContext =
  | 'main'
  | 'explorer'
  | 'dashboard'
  | 'technical'
  | 'sidebar'
  | 'detail-panel'
  | 'scan-modal'
  | 'ai-settings'
  | 'refile-modal'
  | 'tags'
  | 'favorites'
  | 'search'
  | 'keyboard-shortcuts'
  | 'duplicate-finder';

export interface HelpSection {
  id: HelpContext;
  title: string;
  anchor: string;
}

/* ── Context → Kılavuz Bölümü Eşlemesi ── */

const HELP_MAP: Record<HelpContext, HelpSection> = {
  main: { id: 'main', title: 'Hoş Geldiniz', anchor: 'hoş-geldiniz' },
  explorer: { id: 'explorer', title: 'Ana Ekran — Explorer', anchor: '1-ana-ekran' },
  dashboard: { id: 'dashboard', title: 'Ana Ekran — Dashboard', anchor: '1-ana-ekran' },
  technical: { id: 'technical', title: 'Ana Ekran — Teknik', anchor: '1-ana-ekran' },
  sidebar: { id: 'sidebar', title: 'Filtreler ve Arama', anchor: '3-arama' },
  'detail-panel': { id: 'detail-panel', title: 'Dosya Detayları', anchor: '4-dosya-detayları' },
  'scan-modal': { id: 'scan-modal', title: 'Dosya Tarama', anchor: '2-dosya-tarama-ve-indeksleme' },
  'ai-settings': { id: 'ai-settings', title: 'AI Özellikleri', anchor: '8-ai-özellikleri' },
  'refile-modal': { id: 'refile-modal', title: 'Dosya Reorganizasyonu', anchor: 'dosya-reorganizasyonu-refile' },
  tags: { id: 'tags', title: 'Etiketler', anchor: '5-etiketler' },
  favorites: { id: 'favorites', title: 'Favoriler ve Koleksiyonlar', anchor: '6-favoriler-ve-koleksiyonlar' },
  search: { id: 'search', title: 'Arama', anchor: '3-arama' },
  'keyboard-shortcuts': { id: 'keyboard-shortcuts', title: 'Klavye Kısayolları', anchor: '7-klavye-kısayolları' },
  'duplicate-finder': { id: 'duplicate-finder', title: 'Kopya & Benzer Dosya Bulucu', anchor: '10-kopya-benzer-dosya-bulucu' },
};

/* ── Dil Yönetimi ── */

export type SupportedLanguage = 'tr' | 'en' | 'zh' | 'ja' | 'ar';
export type GuideKind = 'user' | 'admin' | 'scenarios';

const SUPPORTED: SupportedLanguage[] = ['tr', 'en', 'zh', 'ja', 'ar'];
const FALLBACK_CHAIN: SupportedLanguage[] = ['en', 'tr'];

/** Test/manuel override; null ise i18n.language esas alınır. */
let _override: SupportedLanguage | null = null;

export function setHelpLanguage(lang: SupportedLanguage): void {
  _override = lang;
}

function langFromI18n(): SupportedLanguage {
  const raw = (i18n.language || 'tr').split('-')[0];
  return (SUPPORTED as string[]).includes(raw) ? (raw as SupportedLanguage) : 'tr';
}

export function getHelpLanguage(): SupportedLanguage {
  return _override ?? langFromI18n();
}

/* ── Public API ── */

/** Belirli bir context için help section bilgisini döndürür */
export function getHelpSection(context: HelpContext): HelpSection {
  return HELP_MAP[context] || HELP_MAP.main;
}

/** Tüm help section'ları listeler (içindekiler tablosu) */
export function getAllHelpSections(): HelpSection[] {
  return Object.values(HELP_MAP);
}

/** Doküman çeşidini ve dili dosya yoluna çevirir. */
export function getGuidePath(kind: GuideKind, lang?: SupportedLanguage): string {
  const lng = lang ?? getHelpLanguage();
  const file = kind === 'scenarios'
    ? (lng === 'tr' ? 'kullanim-senaryolari.md' : 'scenarios.md')
    : (kind === 'admin' ? 'admin-guide.md' : 'user-guide.md');
  return `docs/${lng}/${file}`;
}

/** Geriye uyumlu — kullanıcı/admin kılavuzu için aktif dilde yol. */
export function getGuideFilePath(isAdmin: boolean): string {
  return getGuidePath(isAdmin ? 'admin' : 'user');
}

/**
 * Locale fallback ile kılavuz markdown'ı yükler.
 * Sırasıyla: aktif dil → en → tr. İlk 200 OK olan kullanılır.
 * Hangi dilden geldiği `locale` alanında döner — UI "EN'den düşüldü" notu gösterebilir.
 */
export async function fetchGuide(kind: GuideKind): Promise<{ markdown: string; locale: SupportedLanguage }> {
  const requested = getHelpLanguage();
  const seen = new Set<SupportedLanguage>();
  const order: SupportedLanguage[] = [requested, ...FALLBACK_CHAIN].filter(l => {
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });

  let lastErr: Error | null = null;
  for (const locale of order) {
    const path = getGuidePath(kind, locale);
    try {
      const r = await fetch(`/${path}`);
      if (r.ok) return { markdown: await r.text(), locale };
      lastErr = new Error(`HTTP ${r.status} for /${path}`);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`No locale available for ${kind}`);
}

/** Desteklenen dilleri listeler */
export function getSupportedLanguages(): Array<{ code: SupportedLanguage; name: string }> {
  return [
    { code: 'tr', name: 'Türkçe' },
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文' },
    { code: 'ja', name: '日本語' },
    { code: 'ar', name: 'العربية' },
  ];
}
