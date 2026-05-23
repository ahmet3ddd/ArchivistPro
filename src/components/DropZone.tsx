/**
 * Archivist Pro — Drop Zone
 *
 * Ana içerik alanını sarar. Dosya/klasör sürüklendiğinde görsel geri bildirim verir.
 * Tauri ortamında çalışır — native file path'leri alır.
 */

import { useState, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderDown } from 'lucide-react';

interface DropZoneProps {
  children: ReactNode;
  onFolderDrop?: (path: string) => void;
  disabled?: boolean;
}

export default function DropZone({ children, onFolderDrop, disabled }: DropZoneProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Sadece drop zone'dan tamamen çıkıldığında
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (disabled || !onFolderDrop) return;

    // Tauri ortamında native file path'leri kullan
    const items = e.dataTransfer.files;
    if (items.length > 0) {
      // İlk öğenin path'ini al (Tauri webview'da path bilgisi sınırlı olabilir)
      const item = items[0];
      const path = (item as unknown as { path?: string }).path;
      if (path) {
        onFolderDrop(path);
      } else {
        // Fallback: Toast ile bilgi ver
        try {
          const { notifyInfo } = await import('../services/notificationCenter');
          notifyInfo(
            t('dropZone.hint'),
            t('dropZone.useButton'),
          );
        } catch { /* sessiz */ }
      }
    }
  }, [disabled, onFolderDrop, t]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      {children}

      {/* Drop overlay */}
      {isDragging && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100,
          background: 'rgba(99, 102, 241, 0.08)',
          border: '3px dashed var(--color-accent)',
          borderRadius: 'var(--radius-md, 12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 12,
          backdropFilter: 'blur(2px)',
          pointerEvents: 'none',
        }}>
          <FolderDown size={48} style={{ color: 'var(--color-accent)', opacity: 0.6 }} />
          <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--color-accent)' }}>
            {t('dropZone.dropHere')}
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>
            {t('dropZone.dropDesc')}
          </div>
        </div>
      )}
    </div>
  );
}
