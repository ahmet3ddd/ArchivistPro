import { describe, expect, it } from "vitest";

import { trimToasts, type Toast, type ToastKind } from "./toastStore";

/** Kisa kurucu: id = sira, tur verilir. */
function mk(id: number, kind: ToastKind): Toast {
  return { id, kind, message: `m${id}` };
}

describe("trimToasts", () => {
  it("sinir asilmadiysa dokunmaz", () => {
    const list = [mk(1, "success"), mk(2, "info")];
    expect(trimToasts(list, 4)).toEqual(list);
  });

  it("tasmada en eski HATA-DISI toast duser", () => {
    const list = [mk(1, "success"), mk(2, "info"), mk(3, "success")];
    expect(trimToasts(list, 2).map((t) => t.id)).toEqual([2, 3]);
  });

  it("🔑 HATA, sonradan gelen basari mesajlariyla ekrandan ATILMAZ", () => {
    // Regresyon nobeti: eski kural "en eskiyi dusur"du → hata (id 1) ilk kurban olurdu ve
    // kullanici "islem olmadi ama nedenini goremedim" durumunda kalirdi.
    const list = [mk(1, "error"), mk(2, "success"), mk(3, "success"), mk(4, "success")];
    const kept = trimToasts(list, 2).map((t) => t.id);
    expect(kept).toContain(1);
    expect(kept).toEqual([1, 4]); // hata korunur + en yeni basari
  });

  it("birden fazla tasmada da hatalar korunur", () => {
    const list = [
      mk(1, "success"),
      mk(2, "error"),
      mk(3, "success"),
      mk(4, "error"),
      mk(5, "success"),
    ];
    expect(trimToasts(list, 2).map((t) => t.id)).toEqual([2, 4]);
  });

  it("hepsi hataysa mecburen en eski duser (kuyruk sonsuz buyumesin)", () => {
    const list = [mk(1, "error"), mk(2, "error"), mk(3, "error")];
    expect(trimToasts(list, 2).map((t) => t.id)).toEqual([2, 3]);
  });
});
