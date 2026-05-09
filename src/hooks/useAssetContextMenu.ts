import { useState, useCallback, useEffect, useMemo } from 'react';
import type { Asset } from '../types';

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  assetId: string | null;
}

const INITIAL_STATE: ContextMenuState = { visible: false, x: 0, y: 0, assetId: null };

export function useAssetContextMenu(assets: Asset[]) {
  const [menuState, setMenuState] = useState<ContextMenuState>(INITIAL_STATE);

  const handleContextMenu = useCallback((e: React.MouseEvent, assetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({ visible: true, x: e.clientX, y: e.clientY, assetId });
  }, []);

  const closeMenu = useCallback(() => {
    setMenuState(INITIAL_STATE);
  }, []);

  // Close on outside click, Escape, scroll, resize
  useEffect(() => {
    if (!menuState.visible) return;

    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-context-menu]')) return;
      closeMenu();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [menuState.visible, closeMenu]);

  const targetAsset = useMemo(() => {
    if (!menuState.assetId) return null;
    return assets.find(a => a.id === menuState.assetId) ?? null;
  }, [assets, menuState.assetId]);

  return { menuState, targetAsset, handleContextMenu, closeMenu };
}
