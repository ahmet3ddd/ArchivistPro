/**
 * Undo-aware wrapper'lar — UI caller'lar raw DB fonksiyonları yerine bunları çağırır.
 * Her wrapper `executeCommand` üzerinden geçer, Ctrl+Z / Ctrl+Y ile geri alınabilir.
 *
 * Kapsam: tüm geri alınabilir işlemler (rename, move, create, assign, delete).
 * Destructive delete (deleteTag, deleteRootGroup) snapshot+restore ile undo destekli.
 */

import { executeCommand } from './undoRedo';
import {
    addScannedRoot as rawAddScannedRoot,
    removeScannedRoot as rawRemoveScannedRoot,
    reactivateScannedRoot,
    renameScannedRoot as rawRenameScannedRoot,
    createRootGroup as rawCreateRootGroup,
    recreateRootGroup,
    renameRootGroup as rawRenameRootGroup,
    setRootGroup as rawSetRootGroup,
    updateRootGroupColor as rawUpdateRootGroupColor,
    setRootFavorite as rawSetRootFavorite,
    deleteRootGroup as rawDeleteRootGroup,
    softDeleteScannedRootWithAssets,
    restoreScannedRootFromTrash,
    snapshotRootGroup,
    restoreRootGroup,
    getRootGroups,
    runSql,
    type ScannedRoot,
} from './database';
import {
    deleteSession as rawDeleteSession,
    snapshotSession,
    restoreSession,
} from './chatStorage';
import {
    createTag as rawCreateTag,
    renameTag as rawRenameTag,
    updateTagColor as rawUpdateTagColor,
    addTagToAsset as rawAddTagToAsset,
    removeTagFromAsset as rawRemoveTagFromAsset,
    setTagsForAsset as rawSetTagsForAsset,
    deleteTag as rawDeleteTag,
    snapshotTag,
    restoreTag,
    type Tag,
} from './tagService';
import { setTagsForRoot as rawSetTagsForRoot } from './rootTagService';

type Refresh = () => void;

/* ─── Kaynak Klasör (scanned_roots) ─────────────────────────────── */

export async function commandAddScannedRoot(
    path: string,
    label: string | undefined,
    refresh: Refresh,
): Promise<string> {
    // ID'yi execute içinde üretmek yerine önceden alıp undo/redo tutarlı yapacağız.
    // Ancak addScannedRoot mevcut path için eski ID'yi döndürebildiğinden ilk execute'u ayrıca yapıyoruz.
    const id = rawAddScannedRoot(path, label);
    refresh();
    const effectiveLabel = label ?? path.split(/[\\/]/).pop() ?? path;
    await executeCommand({
        type: 'ADD_ROOT',
        label: `Klasör eklendi: ${effectiveLabel}`,
        execute: () => { /* zaten yapıldı — redo için tekrar aktifleştir */
            reactivateScannedRoot(id);
            refresh();
        },
        undo: () => {
            rawRemoveScannedRoot(id);
            refresh();
        },
    });
    return id;
}

export async function commandRenameScannedRoot(
    rootId: string,
    oldLabel: string,
    newLabel: string,
    refresh: Refresh,
): Promise<void> {
    if (oldLabel === newLabel) return;
    await executeCommand({
        type: 'RENAME_ROOT',
        label: `Klasör yeniden adlandırıldı: "${oldLabel}" → "${newLabel}"`,
        execute: () => { rawRenameScannedRoot(rootId, newLabel); refresh(); },
        undo: () => { rawRenameScannedRoot(rootId, oldLabel); refresh(); },
    });
}

export async function commandRemoveScannedRoot(
    rootId: string,
    displayLabel: string,
    refresh: Refresh,
): Promise<void> {
    await executeCommand({
        type: 'REMOVE_ROOT',
        label: `Klasör arşivden çıkarıldı: ${displayLabel}`,
        execute: () => { rawRemoveScannedRoot(rootId); refresh(); },
        undo: () => { reactivateScannedRoot(rootId); refresh(); },
    });
}

/**
 * Kaynak klasörü ve tüm assetlerini kalıcı siler — Ctrl+Z ile geri alınabilir.
 * Undo: fine-grained snapshot'tan sadece silinen veriler geri eklenir;
 * diğer arşiv içeriğine ve silme sonrası yapılan değişikliklere dokunulmaz.
 *
 * onExecute — DB silme sonrası store'u güncelle.
 * onUndo    — DB restore sonrası store'u yenile.
 */
export async function commandDeleteScannedRootWithAssets(
    root: ScannedRoot,
    onExecute: () => void,
    onUndo: () => void,
): Promise<void> {
    const displayLabel = root.label || root.path.split(/[\\/]/).pop() || root.path;
    await executeCommand({
        type: 'DELETE_ROOT_WITH_ASSETS',
        label: `"${displayLabel}" klasörü Çöp Kutusu'na taşındı`,
        execute: () => {
            softDeleteScannedRootWithAssets(root.id);
            onExecute();
        },
        undo: () => {
            restoreScannedRootFromTrash(root.id);
            onUndo();
        },
    });
}

export async function commandSetRootFavorite(
    rootId: string,
    oldValue: boolean,
    newValue: boolean,
    displayLabel: string,
    refresh: Refresh,
): Promise<void> {
    if (oldValue === newValue) return;
    await executeCommand({
        type: 'SET_ROOT_FAVORITE',
        label: newValue ? `Favorilere eklendi: ${displayLabel}` : `Favorilerden çıkarıldı: ${displayLabel}`,
        execute: () => { rawSetRootFavorite(rootId, newValue); refresh(); },
        undo: () => { rawSetRootFavorite(rootId, oldValue); refresh(); },
    });
}

/* ─── Klasör Grupları (root_groups) ─────────────────────────────── */

export async function commandCreateRootGroup(
    name: string,
    color: string,
    refresh: Refresh,
): Promise<string> {
    const id = rawCreateRootGroup(name, color);
    refresh();
    // Mevcut sort_order'ı bul (recreate için)
    const snap = getRootGroups().find((g) => g.id === id);
    const sortOrder = snap?.sortOrder ?? 0;
    await executeCommand({
        type: 'CREATE_GROUP',
        label: `Grup oluşturuldu: ${name}`,
        execute: () => { recreateRootGroup(id, name, color, sortOrder); refresh(); },
        undo: () => {
            runSql('UPDATE scanned_roots SET group_id = NULL WHERE group_id = ?', [id]);
            runSql('DELETE FROM root_groups WHERE id = ?', [id]);
            refresh();
        },
    });
    return id;
}

export async function commandRenameRootGroup(
    groupId: string,
    oldName: string,
    newName: string,
    refresh: Refresh,
): Promise<void> {
    if (oldName === newName) return;
    await executeCommand({
        type: 'RENAME_GROUP',
        label: `Grup yeniden adlandırıldı: "${oldName}" → "${newName}"`,
        execute: () => { rawRenameRootGroup(groupId, newName); refresh(); },
        undo: () => { rawRenameRootGroup(groupId, oldName); refresh(); },
    });
}

export async function commandUpdateRootGroupColor(
    groupId: string,
    oldColor: string,
    newColor: string,
    refresh: Refresh,
): Promise<void> {
    if (oldColor === newColor) return;
    await executeCommand({
        type: 'UPDATE_GROUP_COLOR',
        label: `Grup rengi değiştirildi`,
        execute: () => { rawUpdateRootGroupColor(groupId, newColor); refresh(); },
        undo: () => { rawUpdateRootGroupColor(groupId, oldColor); refresh(); },
    });
}

export async function commandDeleteRootGroup(
    groupId: string,
    refresh: Refresh,
): Promise<boolean> {
    const snap = snapshotRootGroup(groupId);
    if (!snap) return false;
    await executeCommand({
        type: 'DELETE_GROUP',
        label: `Grup silindi: ${snap.group.name}` + (snap.memberRootIds.length > 0 ? ` (${snap.memberRootIds.length} klasör grupsuz kaldı)` : ''),
        execute: () => { rawDeleteRootGroup(groupId); refresh(); },
        undo: () => { restoreRootGroup(snap); refresh(); },
    });
    return true;
}

export async function commandSetRootGroup(
    rootId: string,
    oldGroupId: string | null,
    newGroupId: string | null,
    rootLabel: string,
    refresh: Refresh,
): Promise<void> {
    if (oldGroupId === newGroupId) return;
    await executeCommand({
        type: 'ASSIGN_GROUP',
        label: newGroupId
            ? `"${rootLabel}" gruba taşındı`
            : `"${rootLabel}" gruptan çıkarıldı`,
        execute: () => { rawSetRootGroup(rootId, newGroupId); refresh(); },
        undo: () => { rawSetRootGroup(rootId, oldGroupId); refresh(); },
    });
}

/* ─── Etiketler (tags) ──────────────────────────────────────────── */

export async function commandCreateTag(
    name: string,
    color: string,
    refresh: Refresh,
): Promise<Tag | null> {
    const tag = rawCreateTag(name, color);
    if (!tag) return null;
    refresh();
    await executeCommand({
        type: 'CREATE_TAG',
        label: `Etiket oluşturuldu: ${tag.name}`,
        execute: () => {
            // Zaten yapıldı; redo için tekrar oluştur (rawCreateTag INSERT OR IGNORE)
            rawCreateTag(name, color);
            refresh();
        },
        undo: () => { rawDeleteTag(tag.id); refresh(); },
    });
    return tag;
}

export async function commandRenameTag(
    tagId: number,
    oldName: string,
    newName: string,
    refresh: Refresh,
): Promise<void> {
    if (oldName === newName) return;
    await executeCommand({
        type: 'RENAME_TAG',
        label: `Etiket yeniden adlandırıldı: "${oldName}" → "${newName}"`,
        execute: () => { rawRenameTag(tagId, newName); refresh(); },
        undo: () => { rawRenameTag(tagId, oldName); refresh(); },
    });
}

export async function commandUpdateTagColor(
    tagId: number,
    oldColor: string,
    newColor: string,
    tagName: string,
    refresh: Refresh,
): Promise<void> {
    if (oldColor === newColor) return;
    await executeCommand({
        type: 'UPDATE_TAG_COLOR',
        label: `"${tagName}" etiketinin rengi değiştirildi`,
        execute: () => { rawUpdateTagColor(tagId, newColor); refresh(); },
        undo: () => { rawUpdateTagColor(tagId, oldColor); refresh(); },
    });
}

export async function commandDeleteTag(
    tagId: number,
    tagName: string,
    refresh: Refresh,
): Promise<boolean> {
    const snap = snapshotTag(tagId);
    if (!snap) return false;
    await executeCommand({
        type: 'DELETE_TAG',
        label: `Etiket silindi: "${tagName}"` + (snap.assetIds.length > 0 ? ` (${snap.assetIds.length} dosyadan kaldırıldı)` : ''),
        execute: () => { rawDeleteTag(tagId); refresh(); },
        undo: () => { restoreTag(snap); refresh(); },
    });
    return true;
}

export async function commandAddTagToAsset(
    assetId: string,
    tagId: number,
    tagName: string,
    refresh: Refresh,
): Promise<void> {
    await executeCommand({
        type: 'ADD_TAG_ASSET',
        label: `"${tagName}" etiketi atandı`,
        execute: () => { rawAddTagToAsset(assetId, tagId); refresh(); },
        undo: () => { rawRemoveTagFromAsset(assetId, tagId); refresh(); },
    });
}

export async function commandRemoveTagFromAsset(
    assetId: string,
    tagId: number,
    tagName: string,
    refresh: Refresh,
): Promise<void> {
    await executeCommand({
        type: 'REMOVE_TAG_ASSET',
        label: `"${tagName}" etiketi kaldırıldı`,
        execute: () => { rawRemoveTagFromAsset(assetId, tagId); refresh(); },
        undo: () => { rawAddTagToAsset(assetId, tagId); refresh(); },
    });
}

export async function commandSetTagsForAsset(
    assetId: string,
    previousTagIds: number[],
    newTagIds: number[],
    refresh: Refresh,
): Promise<void> {
    const same = previousTagIds.length === newTagIds.length
        && previousTagIds.every((id) => newTagIds.includes(id));
    if (same) return;
    await executeCommand({
        type: 'SET_ASSET_TAGS',
        label: `Etiketler güncellendi`,
        execute: () => { rawSetTagsForAsset(assetId, newTagIds); refresh(); },
        undo: () => { rawSetTagsForAsset(assetId, previousTagIds); refresh(); },
    });
}

/* ─── Sohbetler ─────────────────────────────────────────────────── */

export async function commandDeleteChatSession(
    sessionId: string,
    refresh: Refresh,
): Promise<boolean> {
    const snap = snapshotSession(sessionId);
    if (!snap) return false;
    await executeCommand({
        type: 'DELETE_CHAT_SESSION',
        label: `Sohbet silindi: ${snap.session.title}` + (snap.messages.length > 0 ? ` (${snap.messages.length} mesaj)` : ''),
        execute: () => { rawDeleteSession(sessionId); refresh(); },
        undo: () => { restoreSession(snap); refresh(); },
    });
    return true;
}

export async function commandSetTagsForRoot(
    rootId: string,
    previousTagIds: number[],
    newTagIds: number[],
    rootLabel: string,
    refresh: Refresh,
): Promise<void> {
    const same = previousTagIds.length === newTagIds.length
        && previousTagIds.every((id) => newTagIds.includes(id));
    if (same) return;
    await executeCommand({
        type: 'SET_ROOT_TAGS',
        label: `"${rootLabel}" klasörünün etiketleri güncellendi`,
        execute: () => { rawSetTagsForRoot(rootId, newTagIds); refresh(); },
        undo: () => { rawSetTagsForRoot(rootId, previousTagIds); refresh(); },
    });
}
