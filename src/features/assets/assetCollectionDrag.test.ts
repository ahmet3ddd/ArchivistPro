import { describe, expect, it } from "vitest";

import {
  ASSET_COLLECTION_DRAG_TYPE,
  isAssetCollectionDrag,
  readAssetCollectionDrag,
  writeAssetCollectionDrag,
} from "./assetCollectionDrag";

describe("assetCollectionDrag", () => {
  it("writes a private copy-only payload with unique positive ids", () => {
    const values = new Map<string, string>();
    const data = {
      effectAllowed: "none",
      setData: (type: string, value: string) => values.set(type, value),
    } as unknown as DataTransfer;

    writeAssetCollectionDrag(data, [7, 3, 7, 0, -1, Number.NaN]);

    expect(data.effectAllowed).toBe("copy");
    expect(values.get(ASSET_COLLECTION_DRAG_TYPE)).toBe("[7,3]");
  });

  it("recognizes only the application drag type and parses safe ids", () => {
    expect(isAssetCollectionDrag({ types: [ASSET_COLLECTION_DRAG_TYPE] } as unknown as DataTransfer)).toBe(
      true,
    );
    expect(isAssetCollectionDrag({ types: ["Files"] } as unknown as DataTransfer)).toBe(false);
    expect(
      readAssetCollectionDrag({
        getData: () => "[4,4,2,0,-1,1.5]",
      } as unknown as DataTransfer),
    ).toEqual([4, 2]);
  });

  it("treats malformed or foreign drops as a no-op", () => {
    expect(readAssetCollectionDrag({ getData: () => "not json" } as unknown as DataTransfer)).toEqual([]);
    expect(readAssetCollectionDrag({ getData: () => "{\id\:1}" } as unknown as DataTransfer)).toEqual([]);
  });
});
