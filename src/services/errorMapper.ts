/**
 * Archivist Pro — Hata Mesajı Eşleyicisi
 *
 * Tauri ve sistem hatalarını kullanıcı dostu Türkçe/i18n mesajlarına dönüştürür.
 * notifyError() çağrılarında String(err) yerine mapTauriError(err) kullanılmalıdır.
 *
 * Kullanım:
 *   import { mapTauriError } from '../services/errorMapper';
 *   notifyError(t('someKey'), mapTauriError(err));
 */

import i18n from '../i18n';

/** Hata nesnesinden ham mesajı alır */
function rawMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  try { return JSON.stringify(err); } catch { return 'Bilinmeyen hata'; }
}

/**
 * Teknik hata mesajını kullanıcıya gösterilebilir formata dönüştürür.
 * Tanınmayan hatalar olduğu gibi geçer (teknik bilgi yine de görünür).
 */
export function mapTauriError(err: unknown): string {
  const msg = rawMessage(err);

  // Dosya bulunamadı
  if (/No such file or directory|os error 2|bulunamadı/i.test(msg)) {
    return i18n.t('error.fileNotFound');
  }
  // İzin reddedildi
  if (/Permission denied|Access is denied|os error 13|izin|yetki/i.test(msg)) {
    return i18n.t('error.permissionDenied');
  }
  // Disk dolu
  if (/No space left|disk.*full|os error 28/i.test(msg)) {
    return i18n.t('error.diskFull');
  }
  // Ağ / bağlantı
  if (/connection refused|ECONNREFUSED|network|timeout|timed out/i.test(msg)) {
    return i18n.t('error.networkError');
  }
  // Kimlik doğrulama / rol
  if (/require_admin|require_authenticated|unauthorized|Oturum açılmamış|Admin gerekli/i.test(msg)) {
    return i18n.t('error.unauthorized');
  }
  // Dosya zaten var
  if (/already exists|os error 17|mevcut/i.test(msg)) {
    return i18n.t('error.fileAlreadyExists');
  }
  // Geçersiz yol
  if (/path traversal|invalid path|Geçersiz yol/i.test(msg)) {
    return i18n.t('error.invalidPath');
  }

  // Tanınmayan hata — kısaltarak göster (kullanıcıya çok teknik metin verme)
  const truncated = msg.length > 120 ? msg.slice(0, 120) + '…' : msg;
  return truncated;
}
