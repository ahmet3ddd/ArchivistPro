import { useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { Asset } from '../types';
import i18n from '../i18n';

export function useAssetDeletion(filteredAssets: Asset[]) {
  const selectedAssetId = useStore((s) => s.selectedAssetId);

  const handleDelete = useCallback(() => {
    const selected = selectedAssetId;
    if (!selected) return;
    const asset = filteredAssets.find(a => a.id === selected);
    if (!asset) return;
    useStore.getState().showConfirmDialog(
      i18n.t('deletion.confirmTitle', { fileName: asset.fileName }),
      i18n.t('deletion.confirmBody'),
      async () => {
        const { executeCommand } = await import('../services/undoRedo');
        const { softDeleteAsset, restoreAsset } = await import('../services/database');
        const { notifySuccess } = await import('../services/notificationCenter');
        await executeCommand({
          type: 'DELETE_ASSET',
          label: i18n.t('deletion.label', { fileName: asset.fileName }),
          execute: () => {
            softDeleteAsset(selected);
            useStore.getState().setScannedAssets((prev) => prev.filter(a => a.id !== selected));
            useStore.getState().setSelectedAssetId(null);
            notifySuccess(i18n.t('deletion.removed'), i18n.t('deletion.removedUndo', { fileName: asset.fileName }));
          },
          undo: async () => {
            restoreAsset(selected);
            // Asset'i listeye geri ekle (DB'den çekmeye gerek yok — orijinal kopyayı kullan)
            useStore.getState().setScannedAssets((prev) => [...prev, asset]);
            const { notifySuccess: ns } = await import('../services/notificationCenter');
            ns(i18n.t('deletion.undone'), i18n.t('deletion.undoneDetail', { fileName: asset.fileName }));
          },
        });
      }
    );
  }, [selectedAssetId, filteredAssets]);

  return { handleDelete };
}
