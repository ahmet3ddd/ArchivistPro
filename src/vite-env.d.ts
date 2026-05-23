/// <reference types="vite/client" />

// CSS-only paketler için ambient module declaration (side-effect import)
declare module '@fontsource-variable/sora';

interface ImportMetaEnv {
    readonly VITE_APP_ROLE: 'admin' | 'viewer';
}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}

// File System Access API types (not yet in standard TS lib)
interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    name: string;
    kind: 'directory';
}

interface FileSystemFileHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<FileSystemWritableFileStream>;
    name: string;
    kind: 'file';
}

interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | Blob | ArrayBuffer | ArrayBufferView): Promise<void>;
    close(): Promise<void>;
}

interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
}

interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}
