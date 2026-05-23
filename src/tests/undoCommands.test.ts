import { describe, it, expect, beforeEach, vi } from 'vitest';

/* ── Mock'lar ── */

const mockExecuteCommand = vi.fn(async (cmd: { execute: () => void }) => {
    cmd.execute();
});
vi.mock('../services/undoRedo', () => ({
    executeCommand: (...args: unknown[]) => mockExecuteCommand(...args as [{ execute: () => void }]),
}));

const mockRawAddScannedRoot = vi.fn(() => 'root-1');
const mockRawRemoveScannedRoot = vi.fn();
const mockReactivateScannedRoot = vi.fn();
const mockRawRenameScannedRoot = vi.fn();
const mockRawCreateRootGroup = vi.fn(() => 'group-1');
const mockRecreateRootGroup = vi.fn();
const mockRawRenameRootGroup = vi.fn();
const mockRawSetRootGroup = vi.fn();
const mockRawUpdateRootGroupColor = vi.fn();
const mockRawSetRootFavorite = vi.fn();
const mockRawDeleteRootGroup = vi.fn();
const mockSoftDeleteScannedRootWithAssets = vi.fn();
const mockRestoreScannedRootFromTrash = vi.fn();
const mockSnapshotRootGroup = vi.fn(() => ({ group: { name: 'TestGrup', id: 'group-1' }, memberRootIds: ['r1'] }));
const mockRestoreRootGroup = vi.fn();
const mockGetRootGroups = vi.fn(() => [{ id: 'group-1', name: 'TestGrup', sortOrder: 3 }]);
const mockRunSql = vi.fn();

vi.mock('../services/database', () => ({
    addScannedRoot: (...a: unknown[]) => mockRawAddScannedRoot(...a as [string, string | undefined]),
    removeScannedRoot: (...a: unknown[]) => mockRawRemoveScannedRoot(...a as [string]),
    reactivateScannedRoot: (...a: unknown[]) => mockReactivateScannedRoot(...a as [string]),
    renameScannedRoot: (...a: unknown[]) => mockRawRenameScannedRoot(...a as [string, string]),
    createRootGroup: (...a: unknown[]) => mockRawCreateRootGroup(...a as [string, string]),
    recreateRootGroup: (...a: unknown[]) => mockRecreateRootGroup(...a as [string, string, string, number]),
    renameRootGroup: (...a: unknown[]) => mockRawRenameRootGroup(...a as [string, string]),
    setRootGroup: (...a: unknown[]) => mockRawSetRootGroup(...a as [string, string | null]),
    updateRootGroupColor: (...a: unknown[]) => mockRawUpdateRootGroupColor(...a as [string, string]),
    setRootFavorite: (...a: unknown[]) => mockRawSetRootFavorite(...a as [string, boolean]),
    deleteRootGroup: (...a: unknown[]) => mockRawDeleteRootGroup(...a as [string]),
    softDeleteScannedRootWithAssets: (...a: unknown[]) => mockSoftDeleteScannedRootWithAssets(...a as [string]),
    restoreScannedRootFromTrash: (...a: unknown[]) => mockRestoreScannedRootFromTrash(...a as [string]),
    snapshotRootGroup: (...a: unknown[]) => mockSnapshotRootGroup(...a as [string]),
    restoreRootGroup: (...a: unknown[]) => mockRestoreRootGroup(...a as [unknown]),
    getRootGroups: () => mockGetRootGroups(),
    runSql: (...a: unknown[]) => mockRunSql(...a as [string, unknown[]]),
}));

const mockRawDeleteSession = vi.fn();
const mockSnapshotSession = vi.fn(() => ({
    session: { title: 'Test Sohbet', id: 's1' },
    messages: [{ id: 'm1', role: 'user', content: 'test' }],
}));
const mockRestoreSession = vi.fn();

vi.mock('../services/chatStorage', () => ({
    deleteSession: (...a: unknown[]) => mockRawDeleteSession(...a as [string]),
    snapshotSession: (...a: unknown[]) => mockSnapshotSession(...a as [string]),
    restoreSession: (...a: unknown[]) => mockRestoreSession(...a as [unknown]),
}));

const mockRawCreateTag = vi.fn(() => ({ id: 1, name: 'Etiket1', color: '#ff0000' }));
const mockRawRenameTag = vi.fn();
const mockRawUpdateTagColor = vi.fn();
const mockRawAddTagToAsset = vi.fn();
const mockRawRemoveTagFromAsset = vi.fn();
const mockRawSetTagsForAsset = vi.fn();
const mockRawDeleteTag = vi.fn();
const mockSnapshotTag = vi.fn(() => ({ tag: { id: 1, name: 'E1' }, assetIds: ['a1', 'a2'] }));
const mockRestoreTag = vi.fn();

vi.mock('../services/tagService', () => ({
    createTag: (...a: unknown[]) => mockRawCreateTag(...a as [string, string]),
    renameTag: (...a: unknown[]) => mockRawRenameTag(...a as [number, string]),
    updateTagColor: (...a: unknown[]) => mockRawUpdateTagColor(...a as [number, string]),
    addTagToAsset: (...a: unknown[]) => mockRawAddTagToAsset(...a as [string, number]),
    removeTagFromAsset: (...a: unknown[]) => mockRawRemoveTagFromAsset(...a as [string, number]),
    setTagsForAsset: (...a: unknown[]) => mockRawSetTagsForAsset(...a as [string, number[]]),
    deleteTag: (...a: unknown[]) => mockRawDeleteTag(...a as [number]),
    snapshotTag: (...a: unknown[]) => mockSnapshotTag(...a as [number]),
    restoreTag: (...a: unknown[]) => mockRestoreTag(...a as [unknown]),
}));

const mockRawSetTagsForRoot = vi.fn();
vi.mock('../services/rootTagService', () => ({
    setTagsForRoot: (...a: unknown[]) => mockRawSetTagsForRoot(...a as [string, number[]]),
}));

import {
    commandAddScannedRoot,
    commandRenameScannedRoot,
    commandRemoveScannedRoot,
    commandDeleteScannedRootWithAssets,
    commandSetRootFavorite,
    commandCreateRootGroup,
    commandRenameRootGroup,
    commandUpdateRootGroupColor,
    commandDeleteRootGroup,
    commandSetRootGroup,
    commandCreateTag,
    commandRenameTag,
    commandUpdateTagColor,
    commandDeleteTag,
    commandAddTagToAsset,
    commandRemoveTagFromAsset,
    commandSetTagsForAsset,
    commandDeleteChatSession,
    commandSetTagsForRoot,
} from '../services/undoCommands';

beforeEach(() => {
    vi.clearAllMocks();
});

/* ════════════════════════════════════════════════════════════════════
   Kaynak Klasör (scanned_roots)
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Kaynak Klasör', () => {
    const refresh = vi.fn();

    it('commandAddScannedRoot — ID döner ve rawAdd çağırır', async () => {
        const id = await commandAddScannedRoot('C:\\Proje', 'Proje', refresh);
        expect(id).toBe('root-1');
        expect(mockRawAddScannedRoot).toHaveBeenCalledWith('C:\\Proje', 'Proje');
        expect(refresh).toHaveBeenCalled();
        expect(mockExecuteCommand).toHaveBeenCalledOnce();
    });

    it('commandAddScannedRoot — label undefined ise path son segmentini kullanır', async () => {
        await commandAddScannedRoot('C:\\Users\\Test\\Folder', undefined, refresh);
        expect(mockRawAddScannedRoot).toHaveBeenCalledWith('C:\\Users\\Test\\Folder', undefined);
        const cmd = mockExecuteCommand.mock.calls[0][0];
        expect(cmd.label).toContain('Folder');
    });

    it('commandRenameScannedRoot — yeni adla çağırır', async () => {
        await commandRenameScannedRoot('r1', 'Eski', 'Yeni', refresh);
        expect(mockExecuteCommand).toHaveBeenCalledOnce();
        expect(mockRawRenameScannedRoot).toHaveBeenCalledWith('r1', 'Yeni');
    });

    it('commandRenameScannedRoot — aynı ad ise no-op', async () => {
        await commandRenameScannedRoot('r1', 'Ayni', 'Ayni', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandRemoveScannedRoot — çağırır ve executeCommand gönderir', async () => {
        await commandRemoveScannedRoot('r1', 'TestRoot', refresh);
        expect(mockRawRemoveScannedRoot).toHaveBeenCalledWith('r1');
        expect(mockExecuteCommand).toHaveBeenCalledOnce();
        expect(mockExecuteCommand.mock.calls[0][0].type).toBe('REMOVE_ROOT');
    });

    it('commandDeleteScannedRootWithAssets — soft delete çağırır', async () => {
        const onExec = vi.fn();
        const onUndo = vi.fn();
        await commandDeleteScannedRootWithAssets(
            { id: 'r1', path: 'C:\\Test\\Klasor', label: 'Klasor', isActive: true } as never,
            onExec,
            onUndo,
        );
        expect(mockSoftDeleteScannedRootWithAssets).toHaveBeenCalledWith('r1');
        expect(onExec).toHaveBeenCalled();
    });

    it('commandSetRootFavorite — değer değişirse çağırır', async () => {
        await commandSetRootFavorite('r1', false, true, 'Proje', refresh);
        expect(mockRawSetRootFavorite).toHaveBeenCalledWith('r1', true);
        expect(mockExecuteCommand).toHaveBeenCalledOnce();
    });

    it('commandSetRootFavorite — aynı değer ise no-op', async () => {
        await commandSetRootFavorite('r1', true, true, 'Proje', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
});

/* ════════════════════════════════════════════════════════════════════
   Klasör Grupları (root_groups)
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Klasör Grupları', () => {
    const refresh = vi.fn();

    it('commandCreateRootGroup — ID döner ve rawCreate çağırır', async () => {
        const id = await commandCreateRootGroup('GrupA', '#00ff00', refresh);
        expect(id).toBe('group-1');
        expect(mockRawCreateRootGroup).toHaveBeenCalledWith('GrupA', '#00ff00');
        expect(refresh).toHaveBeenCalled();
    });

    it('commandRenameRootGroup — yeni adla çağırır', async () => {
        await commandRenameRootGroup('g1', 'Eski', 'Yeni', refresh);
        expect(mockRawRenameRootGroup).toHaveBeenCalledWith('g1', 'Yeni');
    });

    it('commandRenameRootGroup — aynı ad ise no-op', async () => {
        await commandRenameRootGroup('g1', 'Ayni', 'Ayni', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandUpdateRootGroupColor — yeni renkle çağırır', async () => {
        await commandUpdateRootGroupColor('g1', '#000', '#fff', refresh);
        expect(mockRawUpdateRootGroupColor).toHaveBeenCalledWith('g1', '#fff');
    });

    it('commandUpdateRootGroupColor — aynı renk ise no-op', async () => {
        await commandUpdateRootGroupColor('g1', '#000', '#000', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandDeleteRootGroup — snapshot varsa siler ve true döner', async () => {
        const result = await commandDeleteRootGroup('g1', refresh);
        expect(result).toBe(true);
        expect(mockRawDeleteRootGroup).toHaveBeenCalledWith('g1');
    });

    it('commandDeleteRootGroup — snapshot null ise false döner', async () => {
        mockSnapshotRootGroup.mockReturnValueOnce(null);
        const result = await commandDeleteRootGroup('g1', refresh);
        expect(result).toBe(false);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandSetRootGroup — grup atama yapar', async () => {
        await commandSetRootGroup('r1', null, 'g1', 'Proje', refresh);
        expect(mockRawSetRootGroup).toHaveBeenCalledWith('r1', 'g1');
    });

    it('commandSetRootGroup — aynı grup ise no-op', async () => {
        await commandSetRootGroup('r1', 'g1', 'g1', 'Proje', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
});

/* ════════════════════════════════════════════════════════════════════
   Etiketler (tags)
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Etiketler', () => {
    const refresh = vi.fn();

    it('commandCreateTag — tag oluşturur ve döner', async () => {
        const tag = await commandCreateTag('Yeni', '#ff0000', refresh);
        expect(tag).toEqual({ id: 1, name: 'Etiket1', color: '#ff0000' });
        expect(mockRawCreateTag).toHaveBeenCalledWith('Yeni', '#ff0000');
        expect(refresh).toHaveBeenCalled();
    });

    it('commandCreateTag — rawCreateTag null dönerse null döner', async () => {
        mockRawCreateTag.mockReturnValueOnce(null);
        const tag = await commandCreateTag('X', '#000', refresh);
        expect(tag).toBeNull();
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandRenameTag — yeni adla çağırır', async () => {
        await commandRenameTag(1, 'Eski', 'Yeni', refresh);
        expect(mockRawRenameTag).toHaveBeenCalledWith(1, 'Yeni');
    });

    it('commandRenameTag — aynı ad ise no-op', async () => {
        await commandRenameTag(1, 'Ayni', 'Ayni', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandUpdateTagColor — renk değiştirir', async () => {
        await commandUpdateTagColor(1, '#000', '#fff', 'Tag1', refresh);
        expect(mockRawUpdateTagColor).toHaveBeenCalledWith(1, '#fff');
    });

    it('commandUpdateTagColor — aynı renk ise no-op', async () => {
        await commandUpdateTagColor(1, '#000', '#000', 'Tag1', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandDeleteTag — snapshot varsa siler ve true döner', async () => {
        const result = await commandDeleteTag(1, 'Tag1', refresh);
        expect(result).toBe(true);
        expect(mockRawDeleteTag).toHaveBeenCalledWith(1);
    });

    it('commandDeleteTag — snapshot null ise false döner', async () => {
        mockSnapshotTag.mockReturnValueOnce(null);
        const result = await commandDeleteTag(1, 'Tag1', refresh);
        expect(result).toBe(false);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandAddTagToAsset — tag atar', async () => {
        await commandAddTagToAsset('a1', 1, 'Tag1', refresh);
        expect(mockRawAddTagToAsset).toHaveBeenCalledWith('a1', 1);
    });

    it('commandRemoveTagFromAsset — tag kaldırır', async () => {
        await commandRemoveTagFromAsset('a1', 1, 'Tag1', refresh);
        expect(mockRawRemoveTagFromAsset).toHaveBeenCalledWith('a1', 1);
    });

    it('commandSetTagsForAsset — yeni tag seti uygular', async () => {
        await commandSetTagsForAsset('a1', [1, 2], [3, 4], refresh);
        expect(mockRawSetTagsForAsset).toHaveBeenCalledWith('a1', [3, 4]);
    });

    it('commandSetTagsForAsset — aynı set ise no-op', async () => {
        await commandSetTagsForAsset('a1', [1, 2], [2, 1], refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
});

/* ════════════════════════════════════════════════════════════════════
   Sohbetler
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Sohbetler', () => {
    const refresh = vi.fn();

    it('commandDeleteChatSession — snapshot varsa siler ve true döner', async () => {
        const result = await commandDeleteChatSession('s1', refresh);
        expect(result).toBe(true);
        expect(mockRawDeleteSession).toHaveBeenCalledWith('s1');
    });

    it('commandDeleteChatSession — snapshot null ise false döner', async () => {
        mockSnapshotSession.mockReturnValueOnce(null);
        const result = await commandDeleteChatSession('s1', refresh);
        expect(result).toBe(false);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });

    it('commandDeleteChatSession — label mesaj sayısı içerir', async () => {
        await commandDeleteChatSession('s1', refresh);
        const cmd = mockExecuteCommand.mock.calls[0][0];
        expect(cmd.label).toContain('1 mesaj');
    });
});

/* ════════════════════════════════════════════════════════════════════
   Root Tags
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Root Etiketleri', () => {
    const refresh = vi.fn();

    it('commandSetTagsForRoot — yeni tag seti uygular', async () => {
        await commandSetTagsForRoot('r1', [1], [2, 3], 'Proje', refresh);
        expect(mockRawSetTagsForRoot).toHaveBeenCalledWith('r1', [2, 3]);
    });

    it('commandSetTagsForRoot — aynı set ise no-op', async () => {
        await commandSetTagsForRoot('r1', [1, 2], [2, 1], 'Proje', refresh);
        expect(mockExecuteCommand).not.toHaveBeenCalled();
    });
});

/* ════════════════════════════════════════════════════════════════════
   Undo callback testleri
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Undo Callback Doğrulama', () => {
    const refresh = vi.fn();

    // executeCommand'ı undo çağıracak şekilde yeniden yapılandır
    beforeEach(() => {
        mockExecuteCommand.mockImplementation(async (cmd: { undo: () => void }) => {
            cmd.undo();
        });
    });
    afterEach(() => {
        mockExecuteCommand.mockImplementation(async (cmd: { execute: () => void }) => {
            cmd.execute();
        });
    });

    it('commandRemoveScannedRoot undo — reactivate çağırır', async () => {
        await commandRemoveScannedRoot('r1', 'Label', refresh);
        expect(mockReactivateScannedRoot).toHaveBeenCalledWith('r1');
    });

    it('commandDeleteScannedRootWithAssets undo — restoreFromTrash çağırır', async () => {
        const onExec = vi.fn();
        const onUndo = vi.fn();
        await commandDeleteScannedRootWithAssets(
            { id: 'r1', path: 'C:\\X', label: 'X', isActive: true } as never,
            onExec,
            onUndo,
        );
        expect(mockRestoreScannedRootFromTrash).toHaveBeenCalledWith('r1');
        expect(onUndo).toHaveBeenCalled();
    });

    it('commandDeleteRootGroup undo — restoreRootGroup çağırır', async () => {
        await commandDeleteRootGroup('g1', refresh);
        expect(mockRestoreRootGroup).toHaveBeenCalled();
    });

    it('commandDeleteTag undo — restoreTag çağırır', async () => {
        await commandDeleteTag(1, 'E1', refresh);
        expect(mockRestoreTag).toHaveBeenCalled();
    });

    it('commandDeleteChatSession undo — restoreSession çağırır', async () => {
        await commandDeleteChatSession('s1', refresh);
        expect(mockRestoreSession).toHaveBeenCalled();
    });

    it('commandRenameScannedRoot undo — eski adı geri yazar', async () => {
        await commandRenameScannedRoot('r1', 'Eski', 'Yeni', refresh);
        expect(mockRawRenameScannedRoot).toHaveBeenCalledWith('r1', 'Eski');
    });

    it('commandSetTagsForAsset undo — önceki set geri yüklenir', async () => {
        await commandSetTagsForAsset('a1', [1, 2], [3, 4], refresh);
        expect(mockRawSetTagsForAsset).toHaveBeenCalledWith('a1', [1, 2]);
    });

    it('commandSetRootFavorite undo — eski değeri geri yazar', async () => {
        await commandSetRootFavorite('r1', false, true, 'P', refresh);
        expect(mockRawSetRootFavorite).toHaveBeenCalledWith('r1', false);
    });

    it('commandSetRootGroup undo — eski grubu geri yazar', async () => {
        await commandSetRootGroup('r1', 'g-old', 'g-new', 'P', refresh);
        expect(mockRawSetRootGroup).toHaveBeenCalledWith('r1', 'g-old');
    });

    it('commandUpdateRootGroupColor undo — eski rengi geri yazar', async () => {
        await commandUpdateRootGroupColor('g1', '#aaa', '#bbb', refresh);
        expect(mockRawUpdateRootGroupColor).toHaveBeenCalledWith('g1', '#aaa');
    });

    it('commandRenameRootGroup undo — eski adı geri yazar', async () => {
        await commandRenameRootGroup('g1', 'Eski', 'Yeni', refresh);
        expect(mockRawRenameRootGroup).toHaveBeenCalledWith('g1', 'Eski');
    });

    it('commandUpdateTagColor undo — eski rengi geri yazar', async () => {
        await commandUpdateTagColor(1, '#old', '#new', 'T', refresh);
        expect(mockRawUpdateTagColor).toHaveBeenCalledWith(1, '#old');
    });

    it('commandRenameTag undo — eski adı geri yazar', async () => {
        await commandRenameTag(1, 'EskiTag', 'YeniTag', refresh);
        expect(mockRawRenameTag).toHaveBeenCalledWith(1, 'EskiTag');
    });

    it('commandAddTagToAsset undo — etiketi kaldırır', async () => {
        await commandAddTagToAsset('a1', 1, 'T', refresh);
        expect(mockRawRemoveTagFromAsset).toHaveBeenCalledWith('a1', 1);
    });

    it('commandRemoveTagFromAsset undo — etiketi geri ekler', async () => {
        await commandRemoveTagFromAsset('a1', 1, 'T', refresh);
        expect(mockRawAddTagToAsset).toHaveBeenCalledWith('a1', 1);
    });

    it('commandSetTagsForRoot undo — önceki set geri yüklenir', async () => {
        await commandSetTagsForRoot('r1', [5, 6], [7, 8], 'P', refresh);
        expect(mockRawSetTagsForRoot).toHaveBeenCalledWith('r1', [5, 6]);
    });
});

/* ════════════════════════════════════════════════════════════════════
   Redo (execute) callback detay testleri
   ════════════════════════════════════════════════════════════════════ */

describe('undoCommands — Redo/Execute Detay', () => {
    const refresh = vi.fn();

    it('commandCreateRootGroup undo — SQL ile üyeleri ve grubu siler', async () => {
        // undo çağır
        mockExecuteCommand.mockImplementationOnce(async (cmd: { undo: () => void }) => { cmd.undo(); });
        await commandCreateRootGroup('G1', '#00f', refresh);
        expect(mockRunSql).toHaveBeenCalledTimes(2);
    });

    it('commandCreateTag redo — rawCreateTag çağırır', async () => {
        // İlk execute zaten yapılıyor; redo execute callback'i de rawCreateTag çağırmalı
        await commandCreateTag('T1', '#f00', refresh);
        // rawCreateTag: 1 kez doğrudan + 1 kez execute callback'ten = 2
        expect(mockRawCreateTag).toHaveBeenCalledTimes(2);
    });

    it('commandDeleteRootGroup label — üye sayısını içerir', async () => {
        await commandDeleteRootGroup('g1', refresh);
        const cmd = mockExecuteCommand.mock.calls[0][0];
        expect(cmd.label).toContain('1 klasör');
    });

    it('commandDeleteTag label — asset sayısını içerir', async () => {
        await commandDeleteTag(1, 'E1', refresh);
        const cmd = mockExecuteCommand.mock.calls[0][0];
        expect(cmd.label).toContain('2 dosyadan');
    });
});
