/**
 * Asset file_path'lerinden alt klasör ağacı çıkarır.
 * Sidebar'da "Kaynak Klasörler" → root altında collapsible tree göstermek için.
 *
 * Filter mantığı `filePath.startsWith(rootPath)` kullandığı için node tıklayınca
 * `activeRootFilters`'a node.fullPath eklenince o alt klasör altındaki tüm dosyalar
 * filtrelenir (bkz. utils/searchScoring.ts).
 */

export interface FolderTreeNode {
    name: string;
    fullPath: string;
    fileCount: number;
    children: FolderTreeNode[];
}

interface PathOnly { filePath: string }

/**
 * Verilen rootPath altındaki asset'lerden tek seviye derin alt klasör ağacı kurar.
 * fileCount: o klasörün ve alt-klasörlerinin altındaki toplam dosya sayısı.
 * Boş klasörler (içinde dosya olmayan ara klasörler) zaten oluşmaz — sadece dosya yolu
 * varsa o yol üzerindeki segmentler eklenir.
 */
export function buildSubFolderTree(rootPath: string, assets: PathOnly[]): FolderTreeNode[] {
    if (!rootPath || assets.length === 0) return [];

    const sep = rootPath.includes('\\') ? '\\' : '/';
    const rootWithSep = rootPath.endsWith(sep) ? rootPath : rootPath + sep;
    const root: FolderTreeNode = { name: '', fullPath: rootPath, fileCount: 0, children: [] };

    for (const asset of assets) {
        if (!asset.filePath || !asset.filePath.startsWith(rootWithSep)) continue;

        const relative = asset.filePath.slice(rootWithSep.length);
        const segments = relative.split(/[\\/]/).filter(Boolean);
        if (segments.length <= 1) continue; // Direkt root altındaki dosya — tree node yok

        // Son segment dosya adı, atla
        const dirSegments = segments.slice(0, -1);

        let cursor = root;
        let currentPath = rootPath;
        for (const seg of dirSegments) {
            currentPath = currentPath + sep + seg;
            let child = cursor.children.find(c => c.name === seg);
            if (!child) {
                child = { name: seg, fullPath: currentPath, fileCount: 0, children: [] };
                cursor.children.push(child);
            }
            child.fileCount += 1;
            cursor = child;
        }
    }

    // Alfabetik sırala (recursive)
    const sortRecursive = (nodes: FolderTreeNode[]) => {
        nodes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const n of nodes) sortRecursive(n.children);
    };
    sortRecursive(root.children);

    return root.children;
}
