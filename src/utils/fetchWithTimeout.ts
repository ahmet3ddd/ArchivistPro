/**
 * fetch() wrapper with AbortController-based timeout.
 * Ensures cloud API calls (Gemini, OpenAI, Groq) do not hang indefinitely.
 */
import { TIMINGS } from '../config/constants';

export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = TIMINGS.API_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}
