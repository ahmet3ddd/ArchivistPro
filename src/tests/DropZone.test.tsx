import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import DropZone from '../components/DropZone';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../services/notificationCenter', () => ({
  notifyInfo: vi.fn(),
}));

describe('DropZone', () => {
  it('children render eder', () => {
    const { container } = render(
      <DropZone>
        <div id="child">İçerik</div>
      </DropZone>,
    );
    expect(container.querySelector('#child')).not.toBeNull();
  });

  it('başlangıçta overlay görünmez', () => {
    const { container } = render(
      <DropZone>
        <div>Çocuk</div>
      </DropZone>,
    );
    expect(container.textContent).not.toContain('dropZone.dropHere');
  });

  it('dragOver olayında overlay gösterilir', () => {
    const { container } = render(
      <DropZone onFolderDrop={vi.fn()}>
        <div>Çocuk</div>
      </DropZone>,
    );
    const wrapper = container.firstChild as Element;
    fireEvent.dragOver(wrapper, {
      dataTransfer: { files: [] },
    });
    expect(container.textContent).toContain('dropZone.dropHere');
  });

  it('disabled=true ise dragOver overlay göstermez', () => {
    const { container } = render(
      <DropZone disabled onFolderDrop={vi.fn()}>
        <div>Çocuk</div>
      </DropZone>,
    );
    const wrapper = container.firstChild as Element;
    fireEvent.dragOver(wrapper);
    expect(container.textContent).not.toContain('dropZone.dropHere');
  });

  it('drop olayında isDragging false olur', () => {
    const { container } = render(
      <DropZone onFolderDrop={vi.fn()}>
        <div>Çocuk</div>
      </DropZone>,
    );
    const wrapper = container.firstChild as Element;
    fireEvent.dragOver(wrapper, { dataTransfer: { files: [] } });
    expect(container.textContent).toContain('dropZone.dropHere');

    fireEvent.drop(wrapper, {
      dataTransfer: {
        files: [],
      },
    });
    expect(container.textContent).not.toContain('dropZone.dropHere');
  });

  it('dosya path ile onFolderDrop çağrılır', () => {
    const onFolderDrop = vi.fn();
    const { container } = render(
      <DropZone onFolderDrop={onFolderDrop}>
        <div>Çocuk</div>
      </DropZone>,
    );
    const wrapper = container.firstChild as Element;
    // Tauri ortamında path bilgisi olan dosya simüle edilir
    const mockFile = Object.defineProperty(new File([], 'test.dwg'), 'path', {
      value: 'C:\\Projeler\\test.dwg',
      writable: false,
    });
    fireEvent.drop(wrapper, {
      dataTransfer: { files: [mockFile] },
    });
    expect(onFolderDrop).toHaveBeenCalledWith('C:\\Projeler\\test.dwg');
  });

  it('onFolderDrop tanımsızsa drop hata fırlatmaz', () => {
    const { container } = render(
      <DropZone>
        <div>Çocuk</div>
      </DropZone>,
    );
    const wrapper = container.firstChild as Element;
    expect(() => {
      fireEvent.drop(wrapper, { dataTransfer: { files: [] } });
    }).not.toThrow();
  });

  it('overlay dropZone.dropDesc metnini içerir', () => {
    const { container } = render(
      <DropZone onFolderDrop={vi.fn()}>
        <div>Çocuk</div>
      </DropZone>,
    );
    const wrapper = container.firstChild as Element;
    fireEvent.dragOver(wrapper, { dataTransfer: { files: [] } });
    expect(container.textContent).toContain('dropZone.dropDesc');
  });
});
