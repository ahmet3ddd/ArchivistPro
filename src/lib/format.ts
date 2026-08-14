// Kucuk bicimlendirme yardimcilari (boyut, tarih, uzanti ikonu).

/** HTML dilini tek bicimlendirme kaynagi yap; test/cagiran isterse acik locale verebilir. */
function appLocale(locale?: string): string | undefined {
  if (locale) return locale;
  if (typeof document !== "undefined") return document.documentElement.lang || undefined;
  return undefined;
}

/** Bayt → insan-okunur (1.5 MB). */
export function formatBytes(n: number, locale?: string): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const value = new Intl.NumberFormat(appLocale(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(v);
  return `${value} ${units[i]}`;
}

/** Unix saniye → yerel tarih-saat. */
export function formatDate(unixSecs: number, locale?: string): string {
  return new Date(unixSecs * 1000).toLocaleString(appLocale(locale));
}

/** Unix saniye → yerel kisa tarih (saat yok). */
export function formatDateShort(unixSecs: number, locale?: string): string {
  return new Date(unixSecs * 1000).toLocaleDateString(appLocale(locale));
}

/** Unix milisaniye → yerel tarih-saat. */
export function formatDateMs(unixMillis: number, locale?: string): string {
  return new Date(unixMillis).toLocaleString(appLocale(locale));
}

/** Sayi → uygulama dilinin basamak ayiricilariyla. */
export function formatNumber(value: number, locale?: string): string {
  return value.toLocaleString(appLocale(locale));
}

/** Bir yolun son parcasi (klasor/dosya adi). Hem `/` hem `\` ayraclarini destekler
 *  (path'te ne varsa korunur — Windows/POSIX karisik). Sondaki ayrac yok sayilir.
 *  Parca yoksa (kok ayrac, or. "/" veya "\") yolun kendisi doner. */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return name || path;
}

/** Uzantiya gore kaba tur ikonu (emoji — ilk kabuk; sonra gercek thumbnail).
 *  H2 EXTENSION_MAP genisligiyle hizali: derin cikaricisi olmayan 3D/CAD/nokta-bulutu/yapisal
 *  formatlar da (fbx/obj/stl/dgn/step/e57/...) generik 📦 yerine taninabilir bir ikon alir.
 *  Backend `mime::mime_from_ext` ile ayni allowlist (biri mime, digeri gorsel karsilik). */
export function extIcon(ext: string | null): string {
  switch (ext) {
    case "pdf":
      return "📄";
    // 2D CAD / cizim + muhendislik CAD (dwg ailesi, MicroStation, STEP/IGES, Rhino, ArchiCAD,
    // Vectorworks, Navisworks).
    case "dwg":
    case "dxf":
    case "dwf":
    case "dwfx":
    case "dgn":
    case "step":
    case "stp":
    case "igs":
    case "iges":
    case "3dm":
    case "pln":
    case "mod":
    case "plp":
    case "vwx":
    case "nwd":
    case "nwc":
    case "nwf":
      return "📐";
    // BIM (Revit / IFC).
    case "rvt":
    case "rfa":
    case "ifc":
    case "ifczip":
      return "🏛️";
    // 3D mesh / sahne (SketchUp, 3ds Max, 3DS, Blender, Cinema4D, OBJ/FBX/glTF/STL/PLY/DAE).
    case "skp":
    case "max":
    case "3ds":
    case "blend":
    case "c4d":
    case "obj":
    case "mtl":
    case "fbx":
    case "glb":
    case "gltf":
    case "stl":
    case "ply":
    case "dae":
      return "🧊";
    // Nokta bulutu (lazer tarama).
    case "e57":
    case "pts":
    case "ptx":
      return "☁️";
    // Yapisal analiz (SAP2000 / ETABS).
    case "sdb":
    case "s2k":
    case "$2k":
    case "e2k":
    case "edb":
    case "sap":
    case "$et":
      return "🏗️";
    // Raster + HDR/render cikti.
    case "jpg":
    case "jpeg":
    case "png":
    case "bmp":
    case "tif":
    case "tiff":
    case "gif":
    case "psd":
    case "webp":
    case "tga":
    case "exr":
    case "hdr":
      return "🖼️";
    // Vektor.
    case "svg":
    case "ai":
    case "eps":
      return "✒️";
    case "mp4":
    case "m4v":
    case "mov":
    case "avi":
    case "mkv":
    case "webm":
    case "wmv":
      return "🎬";
    case "doc":
    case "docx":
    case "txt":
    case "csv":
    case "rtf":
    case "md":
      return "📝";
    case "xls":
    case "xlsx":
    case "xlsm":
    case "xlsb":
    case "xltx":
    case "xltm":
    case "ods":
      return "📊";
    case "ppt":
    case "pptx":
      return "📑";
    // Yedek / kilit / otokayit (AutoCAD sidecar + genel yedek).
    case "bak":
    case "~bak":
    case "dwl":
    case "dwl2":
    case "sv$":
    case "$sv":
    case "asv":
      return "🗄️";
    default:
      return "📦";
  }
}
