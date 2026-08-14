import { describe, expect, it } from "vitest";

import { basename, extIcon, formatBytes, formatNumber } from "./format";

describe("formatBytes", () => {
  it("1KB alti → ham bayt (B)", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });
  it("KB/MB/GB'ye olcekler (tek ondalik)", () => {
    expect(formatBytes(1024, "en-US")).toBe("1.0 KB");
    expect(formatBytes(1536, "en-US")).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024, "en-US")).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 1024, "en-US")).toBe("1.0 GB");
  });
  it("en buyuk birimde (TB) durur", () => {
    expect(formatBytes(1024 ** 5, "en-US")).toBe("1,024.0 TB");
  });
  it("uygulama dilinin ondalik ve basamak ayiricilarini kullanir", () => {
    expect(formatBytes(1536, "tr-TR")).toBe("1,5 KB");
    expect(formatNumber(12345, "tr-TR")).toBe("12.345");
    expect(formatNumber(12345, "en-US")).toBe("12,345");
  });
});

describe("basename", () => {
  it("POSIX + Windows + karisik ayraci ele alir", () => {
    expect(basename("/a/b/c.dwg")).toBe("c.dwg");
    expect(basename("C:\\A\\B\\plan.pdf")).toBe("plan.pdf");
    expect(basename("D:/mix\\path/file.jpg")).toBe("file.jpg");
  });
  it("sondaki ayraci yok sayar", () => {
    expect(basename("/a/b/")).toBe("b");
    expect(basename("C:\\A\\B\\")).toBe("B");
  });
  it("ayrac yoksa / yalniz kok → yolun kendisi", () => {
    expect(basename("file.txt")).toBe("file.txt");
    expect(basename("/")).toBe("/");
  });
});

describe("extIcon", () => {
  it("bilinen aileleri esler", () => {
    expect(extIcon("pdf")).toBe("📄");
    expect(extIcon("dwg")).toBe("📐");
    expect(extIcon("jpg")).toBe("🖼️");
    expect(extIcon("xlsx")).toBe("📊");
  });
  it("genis 3D/CAD/nokta-bulutu/yapisal allowlist (H2 pariti) taninabilir ikon alir", () => {
    // 3D mesh/sahne → 🧊
    for (const e of ["fbx", "obj", "stl", "glb", "gltf", "ply", "dae", "3ds", "blend"]) {
      expect(extIcon(e)).toBe("🧊");
    }
    // CAD/muhendislik → 📐
    for (const e of ["dgn", "step", "iges", "dwf", "3dm", "nwd"]) expect(extIcon(e)).toBe("📐");
    // BIM → 🏛️ · nokta bulutu → ☁️ · yapisal → 🏗️ · vektor → ✒️
    expect(extIcon("ifczip")).toBe("🏛️");
    expect(extIcon("e57")).toBe("☁️");
    expect(extIcon("sdb")).toBe("🏗️");
    expect(extIcon("svg")).toBe("✒️");
    // Raster ek (webp/tga/exr) → 🖼️ · yedek → 🗄️
    expect(extIcon("webp")).toBe("🖼️");
    expect(extIcon("asv")).toBe("🗄️");
  });
  it("bilinmeyen / null → varsayilan kutu", () => {
    expect(extIcon("zzz")).toBe("📦");
    expect(extIcon(null)).toBe("📦");
  });
});
