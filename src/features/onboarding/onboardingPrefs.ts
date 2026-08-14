// İlk-kullanım rehberinin makine-yerel, kullanıcıya özel tamamlanma kaydı.
//
// Bu ürün ayarı veya arşiv verisi değildir: kullanıcı farklı bir makinede ilk
// kez giriş yaparsa rehberi yeniden görmesi yararlıdır. Bu yüzden DB'ye değil
// localStorage'a yazılır. Storage erişimi engellenirse rehber yine çalışır;
// yalnız sonraki açılışta tekrar gösterilebilir.

const KEY_PREFIX = "arsiv.onboarding.v1.user.";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function onboardingStorageKey(userId: number): string {
  return `${KEY_PREFIX}${userId}`;
}

export function hasCompletedOnboarding(userId: number, storage = browserStorage()): boolean {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !storage) return false;
  try {
    return storage.getItem(onboardingStorageKey(userId)) === "done";
  } catch {
    return false;
  }
}

export function completeOnboarding(userId: number, storage = browserStorage()): void {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !storage) return;
  try {
    storage.setItem(onboardingStorageKey(userId), "done");
  } catch {
    // Gizli mod / kota / politika: rehberin kapanmasını engelleme.
  }
}
