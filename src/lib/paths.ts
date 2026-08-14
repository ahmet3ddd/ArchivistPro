// Yol yardimcilari — DB'deki yollar farkli OS'tan gelmis olabilir (Windows `\` + POSIX `/`,
// karisik da olabilir). std/URL yol API'si yerine her iki ayrac elle islenir (backend
// query.rs `parent_dir` ile ayni gerekce). FolderTree (agac kurma) + PathBreadcrumb (yol izi)
// paylasir → bolme mantigi TEK noktada (birikimli yol iki yerde birebir ayni uretilir).

/** Bir yolu ata-segmentlerine boler: her ayrac (`/` veya `\`) sinirinda {birikimli-yol,
 *  segment-ad}. Orijinal ayrac KORUNUR → birikimli yol DB'deki yolla birebir eslesir
 *  (`pathPrefix` filtresi dogru calisir). Ardisik ayrac (UNC `\\`) bos segment uretmez.
 *  Or. `C:\A\B` → [{C:, C:}, {C:\A, A}, {C:\A\B, B}]. */
export function ancestors(path: string): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  let start = 0;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "/" || path[i] === "\\") {
      if (i > start) out.push({ path: path.slice(0, i), name: path.slice(start, i) });
      start = i + 1;
    }
  }
  if (start < path.length) out.push({ path, name: path.slice(start) });
  return out;
}
