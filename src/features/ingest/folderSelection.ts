interface FolderEntry {
  path: string;
  key: string;
}

function compareKey(path: string): string {
  let key = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (key.length > 1 && !/^[A-Za-z]:\/$/.test(key)) key = key.replace(/\/+$/, "");
  return key.toLocaleLowerCase("en-US");
}

function isSameOrAncestor(parent: string, child: string): boolean {
  if (parent === child) return true;
  return parent.endsWith("/") ? child.startsWith(parent) : child.startsWith(`${parent}/`);
}

/** Yeni secimleri mevcut listeye ekler; ayni ve ic-ice kokleri tek en-ust kapsamda birlestirir. */
export function mergeFolderSelections(current: string[], selected: string[]): string[] {
  const entries: FolderEntry[] = [...current, ...selected]
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => ({ path, key: compareKey(path) }));

  return entries
    .filter(
      (entry, index, all) =>
        !all.some(
          (other, otherIndex) =>
            otherIndex !== index &&
            isSameOrAncestor(other.key, entry.key) &&
            (other.key !== entry.key || otherIndex < index),
        ),
    )
    .map((entry) => entry.path);
}
