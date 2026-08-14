import { describe, expect, it } from "vitest";

import {
  completeOnboarding,
  hasCompletedOnboarding,
  onboardingStorageKey,
  type KeyValueStorage,
} from "./onboardingPrefs";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe("onboardingPrefs", () => {
  it("keeps completion separate for each local user", () => {
    const storage = memoryStorage();
    expect(hasCompletedOnboarding(7, storage)).toBe(false);

    completeOnboarding(7, storage);

    expect(hasCompletedOnboarding(7, storage)).toBe(true);
    expect(hasCompletedOnboarding(8, storage)).toBe(false);
    expect(onboardingStorageKey(7)).toBe("arsiv.onboarding.v1.user.7");
  });

  it("does not persist invalid user ids", () => {
    const storage = memoryStorage();
    completeOnboarding(0, storage);
    completeOnboarding(-2, storage);

    expect(hasCompletedOnboarding(0, storage)).toBe(false);
    expect(hasCompletedOnboarding(-2, storage)).toBe(false);
  });
});
