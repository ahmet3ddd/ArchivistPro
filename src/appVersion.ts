/** ArchivistPro versiyon bilgileri — tek kaynak (single source of truth) */

import i18n from './i18n';

export const APP_NAME = 'ArchivistPro';
export const APP_VERSION = '2.4.5';
export const APP_BUILD_DATE = '2026-05-08';
/** @deprecated Use getAppDescription() instead — i18n may not be ready at module init time */
export const APP_DESCRIPTION = 'Mimari Dosya Arşiv & Akıllı Arama';
export const getAppDescription = () => i18n.t('appVersion.description');
