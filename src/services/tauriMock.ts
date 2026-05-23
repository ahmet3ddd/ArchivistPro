/**
 * Archivist Pro — Tauri Mock Utility
 * 
 * Tauri API'lerinin tarayıcı ortamında (veya browser subagent içinde) 
 * hata vermeden çalışmasını sağlayan mock servis.
 */

export const isTauri = () => {
    return typeof window !== 'undefined' && (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
};

export const mockInvoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
    console.log(`[Mock Invoke] ${command}`, args);

    if (command === 'scan_archivist_directory') {
        return []; // Boş liste dön
    }

    if (command === 'get_max_version') {
        return "2024";
    }

    if (command === 'generate_thumbnail') {
        return null;
    }

    return null;
};

export const mockOpen = async (options: Record<string, unknown>): Promise<string | string[] | null> => {
    console.log(`[Mock Open]`, options);
    return null;
};

export const BaseDirectory = {
    AppData: 0,
    Resource: 1,
    AppConfig: 2,
} as const;

export type BaseDirectory = (typeof BaseDirectory)[keyof typeof BaseDirectory];
