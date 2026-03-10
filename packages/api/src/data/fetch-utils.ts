/** Shared fetch utility with timeout for external data sources. */
export async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

/** Validates EVM address format (0x + 40 hex chars). */
export const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/** Validates slug for safe URL construction (prevents path traversal). */
export const SAFE_SLUG_REGEX = /^[a-z0-9][a-z0-9._-]{0,60}$/;
