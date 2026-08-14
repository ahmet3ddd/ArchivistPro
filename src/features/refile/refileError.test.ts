import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { refileErrorMessage } from "./refileError";

// Sahte i18n `t`: anahtar + (varsa) `detail` ile deterministik dizge doner.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts && "detail" in opts ? `${key}:${opts.detail as string}` : key) as unknown as TFunction;

describe("refileErrorMessage", () => {
  it("bilinen kod → refile.err.<kod>", () => {
    expect(refileErrorMessage("target_exists", t)).toBe("refile.err.target_exists");
    expect(refileErrorMessage("same_dir", t)).toBe("refile.err.same_dir");
  });
  it("io:<detay> → refile.err.io (+ detay)", () => {
    expect(refileErrorMessage("io:disk dolu", t)).toBe("refile.err.io:disk dolu");
  });
  it("Error ornegi → mesaji (bilinen kod)", () => {
    expect(refileErrorMessage(new Error("not_found"), t)).toBe("refile.err.not_found");
  });
  it("bilinmeyen kod → ham dizge (sessiz-yutma YOK)", () => {
    expect(refileErrorMessage("acayip_hata", t)).toBe("acayip_hata");
  });
  it("bos → refile.err.io yedegi", () => {
    expect(refileErrorMessage("", t)).toBe("refile.err.io:");
  });
});
