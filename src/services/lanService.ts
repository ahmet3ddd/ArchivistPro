/**
 * Archivist Pro — LAN İstemci Servisi (Faz 2)
 *
 * LAN sunucusuna bağlanıp arşiv indirir.
 * Progress callback, SHA-256 bütünlük doğrulaması destekler.
 */

import type { ArchiveManifest } from './archiveShare';
import { TIMINGS } from '../config/constants';

export interface LanServerInfo {
  host: string;
  port: number;
  authCode: string;
}

/** Manifest'e eklenen SHA-256 alanı */
export interface LanManifest extends ArchiveManifest {
  sha256?: string;
}

/** Fetch with timeout */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = TIMINGS.AI_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function baseUrl(server: LanServerInfo): string {
  return `http://${server.host}:${server.port}`;
}

/** Bağlantı testi — /ping */
export async function lanPing(server: LanServerInfo): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(`${baseUrl(server)}/ping`);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

/** Arşiv manifest bilgisi — /manifest (SHA-256 dahil) */
export async function lanFetchManifest(
  server: LanServerInfo,
): Promise<LanManifest | null> {
  try {
    const resp = await fetchWithTimeout(`${baseUrl(server)}/manifest`, {
      headers: { 'X-Auth-Code': server.authCode },
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Arşiv DB indir — /download → Uint8Array olarak döner.
 * Progress callback ile indirme ilerlemesi raporlanır.
 */
export async function lanDownloadArchive(
  server: LanServerInfo,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Uint8Array | null> {
  try {
    const resp = await fetchWithTimeout(
      `${baseUrl(server)}/download`,
      { headers: { 'X-Auth-Code': server.authCode } },
      TIMINGS.LAN_DOWNLOAD_TIMEOUT_MS,
    );
    if (!resp.ok) return null;

    const contentLength = parseInt(resp.headers.get('Content-Length') || '0', 10);
    const reader = resp.body?.getReader();
    if (!reader) {
      // Fallback: ReadableStream yoksa tek seferde oku
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    }

    // Chunked read ile progress
    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, contentLength);
    }

    // Birleştir
    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * SHA-256 hash doğrulaması.
 * @returns true: hash eşleşiyor veya manifest'te hash yoksa (eski sunucu).
 */
export async function verifyDownloadIntegrity(
  data: Uint8Array,
  expectedSha256: string | undefined,
): Promise<boolean> {
  if (!expectedSha256) return true; // Eski sunucu SHA-256 desteklemiyorsa atla

  const hashBuffer = await crypto.subtle.digest('SHA-256', data as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex === expectedSha256.toLowerCase();
}
