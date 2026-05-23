import { invoke } from '@tauri-apps/api/core';

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

export async function computeImagePhashFromPath(path: string): Promise<string> {
    return invoke<string>('compute_image_phash', { path });
}

export async function computeImagePhashFromFile(file: File): Promise<string> {
    const buffer = await file.arrayBuffer();
    const base64Data = bytesToBase64(new Uint8Array(buffer));
    return invoke<string>('compute_image_phash_from_bytes', { base64Data });
}

export async function getHammingDistance(hashA: string, hashB: string): Promise<number> {
    return invoke<number>('hamming_distance', { hashA, hashB });
}
