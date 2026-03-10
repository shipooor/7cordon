/**
 * Input sanitization utilities for LLM prompts.
 * Prevents prompt injection attacks from untrusted user input.
 */

const MAX_REASONING_LENGTH = 500;
const MAX_FIELD_LENGTH = 100;
const MAX_HEX_DATA_LENGTH = 200; // Function selector + first few params only
const MAX_CONTRACT_SOURCE_LENGTH = 10_000; // Truncate large contracts to prevent context stuffing

/** Strip zero-width and invisible Unicode characters used to bypass text filters. */
const INVISIBLE_CHARS_RE = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF\u00AD]/g;

/** Scans full string (no ^ anchor) — catches injection anywhere in the text. */
const INJECTION_PATTERNS = /\b(ignore|disregard|forget|override)\b\s+(all\s+)?(previous|above|prior|system)|system[\s:[\]{}]|assistant[\s:]|human[\s:]|\bIMPORTANT[:\s!]|<\||###|you are now|new instructions|\bplease approve\b|\bmark as safe\b|\brespond with\b|\boutput:|\bpretend\b|\broleplay\b|\bact as\b|\blet'?s play\b|\bgame where\b|\bbase64\b|\batob\b|\bbtoa\b|\bdecode\b/im;

/** Common prompt pair type used by L1 and L2 prompt builders. */
export interface PromptPair {
  system: string;
  user: string;
}

/**
 * Sanitizes the agent's reasoning field before including it in a prompt.
 * Flags suspicious content that looks like prompt injection attempts.
 */
export function sanitizeReasoning(reasoning: string): string {
  if (!reasoning) return '(no reasoning provided)';
  let clean = reasoning.replace(INVISIBLE_CHARS_RE, '').slice(0, MAX_REASONING_LENGTH);
  if (INJECTION_PATTERNS.test(clean)) {
    clean = `[SUSPICIOUS INPUT DETECTED] ${clean}`;
  }
  return clean;
}

/**
 * Sanitizes a short transaction field (token name, protocol, etc.).
 * Strips control characters and newlines, limits length.
 * Also checks for prompt injection patterns to prevent indirect injection via field values.
 */
export function sanitizeField(value: string | undefined, maxLen = MAX_FIELD_LENGTH): string | null {
  if (!value || typeof value !== 'string') return null;
  let clean = value.replace(/[\n\r\t\x00-\x1f]/g, '').replace(INVISIBLE_CHARS_RE, '').slice(0, maxLen);
  if (INJECTION_PATTERNS.test(clean)) {
    clean = `[SUSPICIOUS] ${clean}`;
  }
  return clean;
}

/**
 * Validates and sanitizes hex-encoded transaction data.
 * Returns null if the data is not valid hex format.
 */
export function sanitizeHexData(data: string | undefined): string | null {
  if (!data) return null;
  if (!/^0x[0-9a-fA-F]*$/.test(data)) return null;
  return data.slice(0, MAX_HEX_DATA_LENGTH);
}

/**
 * Sanitizes contract source code before including in L2 prompts.
 * Truncates to prevent context stuffing and strips invisible characters.
 */
export function sanitizeContractSource(source: string | null | undefined): string | null {
  if (!source) return null;
  let clean = source.replace(INVISIBLE_CHARS_RE, '').slice(0, MAX_CONTRACT_SOURCE_LENGTH);
  if (clean.length < source.length) {
    clean += '\n// [TRUNCATED — source too large]';
  }
  return clean;
}
