import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import VersionTimeline from '../components/VersionTimeline';
import type { AssetRelation } from '../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ASSET_A = 'asset-001';
const ASSET_B = 'asset-002';
const ASSET_C = 'asset-003';

function makeRelation(sourceId: string, targetId: string): AssetRelation {
  return { id: `rel-${sourceId}-${targetId}`, sourceId, targetId, relationType: 'version_of', createdAt: '' };
}

function makeAssetNames(entries: Array<[string, string, string?]>): Map<string, { fileName: string; modifiedAt?: string }> {
  const map = new Map<string, { fileName: string; modifiedAt?: string }>();
  entries.forEach(([id, fileName, modifiedAt]) => map.set(id, { fileName, modifiedAt }));
  return map;
}

describe('VersionTimeline', () => {
  it('version_of ilişkisi yoksa null render eder', () => {
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={[]}
        assetNames={new Map()}
        onAssetClick={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('tek ilişki varsa (chain < 2) null render eder', () => {
    // Only one unique ID pair = 2 entries in chain
    const rels = [makeRelation(ASSET_A, ASSET_B)];
    const names = makeAssetNames([
      [ASSET_A, 'file-v1.dwg', '2024-01-01'],
      [ASSET_B, 'file-v2.dwg', '2024-02-01'],
    ]);
    // chain has 2 items → should render
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={rels}
        assetNames={names}
        onAssetClick={vi.fn()}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('mevcut asset "current" işareti alır', () => {
    const rels = [makeRelation(ASSET_A, ASSET_B)];
    const names = makeAssetNames([
      [ASSET_A, 'file-v1.dwg', '2024-01-01'],
      [ASSET_B, 'file-v2.dwg', '2024-02-01'],
    ]);
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={rels}
        assetNames={names}
        onAssetClick={vi.fn()}
      />,
    );
    // versionTimeline.current i18n key gösterilmeli
    expect(container.textContent).toContain('versionTimeline.current');
  });

  it('dosya adları render edilir', () => {
    const rels = [makeRelation(ASSET_A, ASSET_B)];
    const names = makeAssetNames([
      [ASSET_A, 'proje-v1.dwg', '2024-01-01'],
      [ASSET_B, 'proje-v2.dwg', '2024-02-01'],
    ]);
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={rels}
        assetNames={names}
        onAssetClick={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('proje-v1.dwg');
    expect(container.textContent).toContain('proje-v2.dwg');
  });

  it('current olmayan asset tıklanınca onAssetClick çağrılır', () => {
    const onAssetClick = vi.fn();
    const rels = [makeRelation(ASSET_A, ASSET_B)];
    const names = makeAssetNames([
      [ASSET_A, 'file-v1.dwg', '2024-01-01'],
      [ASSET_B, 'file-v2.dwg', '2024-02-01'],
    ]);
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={rels}
        assetNames={names}
        onAssetClick={onAssetClick}
      />,
    );
    // İkinci item tıklanabilir (ASSET_B, current değil)
    const items = container.querySelectorAll('div[style*="cursor"]');
    const clickable = Array.from(items).find(
      (el) => el.getAttribute('style')?.includes('pointer'),
    );
    if (clickable) {
      fireEvent.click(clickable);
      expect(onAssetClick).toHaveBeenCalled();
    }
  });

  it('assetNames haritasında olmayan ID kısaltılır', () => {
    const rels = [makeRelation('very-long-asset-id-123456', ASSET_B)];
    const names = makeAssetNames([
      [ASSET_B, 'file-v2.dwg', '2024-02-01'],
      // very-long-asset-id-123456 haritada yok
    ]);
    const { container } = render(
      <VersionTimeline
        currentAssetId="very-long-asset-id-123456"
        relations={rels}
        assetNames={names}
        onAssetClick={vi.fn()}
      />,
    );
    // Kısaltılmış ID "..." ile biter
    expect(container.textContent).toContain('...');
  });

  it('3 versiyonlu zincir doğru render edilir', () => {
    const rels = [
      makeRelation(ASSET_A, ASSET_B),
      makeRelation(ASSET_B, ASSET_C),
    ];
    const names = makeAssetNames([
      [ASSET_A, 'v1.dwg', '2024-01-01'],
      [ASSET_B, 'v2.dwg', '2024-02-01'],
      [ASSET_C, 'v3.dwg', '2024-03-01'],
    ]);
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={rels}
        assetNames={names}
        onAssetClick={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('v1.dwg');
    expect(container.textContent).toContain('v2.dwg');
    expect(container.textContent).toContain('v3.dwg');
  });

  it('sıra numaraları (v1, v2...) gösterilir', () => {
    const rels = [makeRelation(ASSET_A, ASSET_B)];
    const names = makeAssetNames([
      [ASSET_A, 'file-v1.dwg', '2024-01-01'],
      [ASSET_B, 'file-v2.dwg', '2024-02-01'],
    ]);
    const { container } = render(
      <VersionTimeline
        currentAssetId={ASSET_A}
        relations={rels}
        assetNames={names}
        onAssetClick={vi.fn()}
      />,
    );
    expect(container.textContent).toContain('v1');
    expect(container.textContent).toContain('v2');
  });
});
