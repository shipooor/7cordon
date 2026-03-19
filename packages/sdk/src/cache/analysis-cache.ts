/**
 * AnalysisCache — Cache analysis results locally.
 *
 * Saves AI costs and Spark fees. Same token/protocol checked once = reused.
 * In-memory LRU Map with file persistence and max size limit.
 */

import { writeFile } from 'fs/promises';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import type { AnalysisResult } from '@7cordon/shared';
import { CACHE_TTL } from '@7cordon/shared';

interface CacheEntry {
  result: AnalysisResult;
  cachedAt: number;
  ttl: number;
}

/** Maximum number of cached entries to prevent memory exhaustion. */
const MAX_CACHE_SIZE = 1000;

export class AnalysisCache {
  private cache = new Map<string, CacheEntry>();
  private filePath: string;

  constructor(cacheDir?: string) {
    const dir = cacheDir || path.join(process.cwd(), '.7cordon');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.filePath = path.join(dir, 'analysis-cache.json');
    this.loadFromDisk();
  }

  /**
   * Build cache key from transaction properties.
   * Excludes amount — risk analysis depends on token/protocol/address, not amount.
   * Amount thresholds are applied post-cache by the Guardian decision logic.
   * Uses JSON.stringify to avoid collisions from values containing separators.
   */
  static buildKey(
    action: string,
    contractAddress?: string,
    token?: string,
    protocol?: string,
    toAddress?: string,
  ): string {
    return JSON.stringify([
      action,
      contractAddress?.toLowerCase() ?? '',
      token?.toLowerCase() ?? '',
      protocol?.toLowerCase() ?? '',
      toAddress?.toLowerCase() ?? '',
    ]);
  }

  /** Get cached analysis result, or null if not found or expired. */
  get(key: string): AnalysisResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /** Store an analysis result with TTL based on type. */
  set(key: string, result: AnalysisResult, type: 'token' | 'protocol' | 'address' = 'token'): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }

    const ttl = type === 'protocol'
      ? CACHE_TTL.PROTOCOL_INFO
      : type === 'address'
        ? CACHE_TTL.ADDRESS_CHECK
        : CACHE_TTL.TOKEN_ANALYSIS;

    this.cache.set(key, { result, cachedAt: Date.now(), ttl });
    this.scheduleSave();
  }

  /** Check if a non-expired entry exists for the key. */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /** Get the number of non-expired entries. */
  get size(): number {
    const now = Date.now();
    let count = 0;
    for (const entry of this.cache.values()) {
      if (now - entry.cachedAt <= entry.ttl) count++;
    }
    return count;
  }

  /** Remove all entries and persist the empty cache. */
  clear(): void {
    this.cache.clear();
    this.scheduleSave();
  }

  /** Force re-analysis by removing a specific key. */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  private saveScheduled = false;

  /** Debounced async save to avoid blocking on every set(). */
  private scheduleSave(): void {
    if (this.saveScheduled) return;
    this.saveScheduled = true;

    setTimeout(() => {
      this.saveScheduled = false;
      this.saveToDisk();
    }, 1000).unref();
  }

  private saveToDisk(): void {
    const data = Object.fromEntries(this.cache);
    writeFile(this.filePath, JSON.stringify(data), { mode: 0o600 }).catch(() => {
      // Non-critical — cache is in-memory
    });
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const content = readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(content);
      for (const [key, entry] of Object.entries(data)) {
        const typed = entry as CacheEntry;
        // Skip expired entries on load
        if (Date.now() - typed.cachedAt <= typed.ttl) {
          this.cache.set(key, typed);
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }
}
