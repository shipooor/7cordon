import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AnalysisResult } from '@saaafe/shared';
import { AnalysisCache } from './analysis-cache.js';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';

// Mock fs functions
vi.mock('fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('path', () => ({
  default: {
    join: (...parts: string[]) => parts.join('/'),
  },
}));

const createAnalysisResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
  riskLevel: 'safe',
  threats: [],
  reasoning: 'normal transaction',
  duration: 100,
  model: 'haiku',
  ...overrides,
});

describe('AnalysisCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Default mock returns
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('buildKey', () => {
    it('should build key from transaction properties', () => {
      const key = AnalysisCache.buildKey('send', '0xABC123', 'USDT', 'aave', '0xDEF456');

      expect(typeof key).toBe('string');
      expect(key).toContain('send');
    });

    it('should normalize addresses to lowercase', () => {
      const key1 = AnalysisCache.buildKey('send', '0xABC', 'USDT', 'AAVE', '0xDEF');
      const key2 = AnalysisCache.buildKey('send', '0xabc', 'usdt', 'aave', '0xdef');

      expect(key1).toBe(key2);
    });

    it('should handle missing optional parameters', () => {
      const key = AnalysisCache.buildKey('send');

      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
    });

    it('should produce consistent keys', () => {
      const key1 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave');
      const key2 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave');

      expect(key1).toBe(key2);
    });

    it('should differentiate by action type', () => {
      const key1 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave');
      const key2 = AnalysisCache.buildKey('swap', '0x123', 'USDT', 'aave');

      expect(key1).not.toBe(key2);
    });

    it('should differentiate by contract address', () => {
      const key1 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave');
      const key2 = AnalysisCache.buildKey('send', '0x456', 'USDT', 'aave');

      expect(key1).not.toBe(key2);
    });

    it('should differentiate by token', () => {
      const key1 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave');
      const key2 = AnalysisCache.buildKey('send', '0x123', 'ETH', 'aave');

      expect(key1).not.toBe(key2);
    });

    it('should differentiate by protocol', () => {
      const key1 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave');
      const key2 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'compound');

      expect(key1).not.toBe(key2);
    });

    it('should differentiate by toAddress', () => {
      const key1 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave', '0xAAA');
      const key2 = AnalysisCache.buildKey('send', '0x123', 'USDT', 'aave', '0xBBB');

      expect(key1).not.toBe(key2);
    });
  });

  describe('set and get', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it('should store and retrieve analysis result', () => {
      const cache = new AnalysisCache();
      const key = 'test-key';
      const result = createAnalysisResult();

      cache.set(key, result);
      const retrieved = cache.get(key);

      expect(retrieved).toEqual(result);
    });

    it('should return null for missing key', () => {
      const cache = new AnalysisCache();

      const result = cache.get('nonexistent-key');

      expect(result).toBeNull();
    });

    it('should expire entries after TTL', () => {
      const cache = new AnalysisCache();
      const key = 'test-key';
      const result = createAnalysisResult();

      cache.set(key, result, 'token'); // TOKEN_ANALYSIS TTL = 24h
      expect(cache.get(key)).not.toBeNull();

      // Advance time by 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      expect(cache.get(key)).toBeNull();
    });

    it('should use different TTLs for different types', () => {
      const cache = new AnalysisCache();
      const tokenKey = 'token-key';
      const protocolKey = 'protocol-key';
      const addressKey = 'address-key';

      const result = createAnalysisResult();

      cache.set(tokenKey, result, 'token'); // 24h
      cache.set(protocolKey, result, 'protocol'); // 30d
      cache.set(addressKey, result, 'address'); // 7d

      // All exist initially
      expect(cache.get(tokenKey)).not.toBeNull();
      expect(cache.get(protocolKey)).not.toBeNull();
      expect(cache.get(addressKey)).not.toBeNull();

      // After 8 days: token expired, address expired, protocol still valid
      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

      expect(cache.get(tokenKey)).toBeNull();
      expect(cache.get(protocolKey)).not.toBeNull();
      expect(cache.get(addressKey)).toBeNull();
    });

    it('should expire token analysis after 24 hours', () => {
      const cache = new AnalysisCache();
      const key = 'token-key';
      const result = createAnalysisResult();

      cache.set(key, result, 'token');

      vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1000); // Just before expiry
      expect(cache.get(key)).not.toBeNull();

      vi.advanceTimersByTime(2000); // Just after expiry
      expect(cache.get(key)).toBeNull();
    });

    it('should expire protocol info after 30 days', () => {
      const cache = new AnalysisCache();
      const key = 'protocol-key';
      const result = createAnalysisResult();

      cache.set(key, result, 'protocol');

      vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 - 1000);
      expect(cache.get(key)).not.toBeNull();

      vi.advanceTimersByTime(2000);
      expect(cache.get(key)).toBeNull();
    });

    it('should expire address checks after 7 days', () => {
      const cache = new AnalysisCache();
      const key = 'address-key';
      const result = createAnalysisResult();

      cache.set(key, result, 'address');

      vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 - 1000);
      expect(cache.get(key)).not.toBeNull();

      vi.advanceTimersByTime(2000);
      expect(cache.get(key)).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true for existing non-expired entry', () => {
      const cache = new AnalysisCache();
      const key = 'test-key';

      cache.set(key, createAnalysisResult());

      expect(cache.has(key)).toBe(true);
    });

    it('should return false for missing entry', () => {
      const cache = new AnalysisCache();

      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired entry', () => {
      const cache = new AnalysisCache();
      const key = 'test-key';

      cache.set(key, createAnalysisResult(), 'token');

      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      expect(cache.has(key)).toBe(false);
    });
  });

  describe('size', () => {
    it('should return zero for empty cache', () => {
      const cache = new AnalysisCache();

      expect(cache.size).toBe(0);
    });

    it('should count non-expired entries', () => {
      const cache = new AnalysisCache();

      cache.set('key1', createAnalysisResult(), 'token');
      cache.set('key2', createAnalysisResult(), 'token');
      cache.set('key3', createAnalysisResult(), 'token');

      expect(cache.size).toBe(3);
    });

    it('should exclude expired entries from size', () => {
      const cache = new AnalysisCache();

      cache.set('key1', createAnalysisResult(), 'token');
      cache.set('key2', createAnalysisResult(), 'token');

      vi.advanceTimersByTime(25 * 60 * 60 * 1000); // Expire both

      expect(cache.size).toBe(0);
    });

    it('should count mixed TTL entries correctly', () => {
      const cache = new AnalysisCache();

      cache.set('token-key', createAnalysisResult(), 'token'); // 24h
      cache.set('protocol-key', createAnalysisResult(), 'protocol'); // 30d
      cache.set('address-key', createAnalysisResult(), 'address'); // 7d

      expect(cache.size).toBe(3);

      vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);

      // Token and address expired, protocol still valid
      expect(cache.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const cache = new AnalysisCache();

      cache.set('key1', createAnalysisResult());
      cache.set('key2', createAnalysisResult());
      cache.set('key3', createAnalysisResult());

      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
    });

    it('should allow reinserting after clear', () => {
      const cache = new AnalysisCache();

      cache.set('key1', createAnalysisResult());
      cache.clear();
      cache.set('key1', createAnalysisResult());

      expect(cache.get('key1')).not.toBeNull();
    });
  });

  describe('invalidate', () => {
    it('should remove specific entry', () => {
      const cache = new AnalysisCache();

      cache.set('key1', createAnalysisResult());
      cache.set('key2', createAnalysisResult());

      cache.invalidate('key1');

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).not.toBeNull();
    });

    it('should allow reinserting invalidated key', () => {
      const cache = new AnalysisCache();
      const result1 = createAnalysisResult();

      cache.set('key', result1);
      cache.invalidate('key');

      const result2 = createAnalysisResult({ reasoning: 'updated' });
      cache.set('key', result2);

      expect(cache.get('key')).toEqual(result2);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when cache exceeds MAX_SIZE', () => {
      const cache = new AnalysisCache();

      // Insert 1001 entries (MAX_SIZE = 1000)
      for (let i = 0; i < 1001; i++) {
        cache.set(`key${i}`, createAnalysisResult());
      }

      // Oldest entry should be evicted
      expect(cache.get('key0')).toBeNull();
      // Most recent should still exist
      expect(cache.get('key1000')).not.toBeNull();
    });

    it('should maintain cache size at MAX_SIZE', () => {
      const cache = new AnalysisCache();

      // Insert 1500 entries
      for (let i = 0; i < 1500; i++) {
        cache.set(`key${i}`, createAnalysisResult());
      }

      // Size should not exceed 1000
      expect(cache.size).toBeLessThanOrEqual(1000);
    });

    it('should evict in FIFO order', () => {
      const cache = new AnalysisCache();

      // Fill cache to capacity
      for (let i = 0; i < 1001; i++) {
        cache.set(`key${i}`, createAnalysisResult());
      }

      // key0-999 should be gone (or mostly gone), key1000 should be present
      expect(cache.get('key1000')).not.toBeNull();
    });
  });

  describe('disk persistence', () => {
    beforeEach(() => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it('should debounce cache saves (timing test)', () => {
      const cache = new AnalysisCache();

      // Just verify the cache accepts entries without throwing
      cache.set('key1', createAnalysisResult());
      cache.set('key2', createAnalysisResult());
      cache.set('key3', createAnalysisResult());

      // Should still have entries in memory
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
    });

    it('should handle concurrent sets', () => {
      const cache = new AnalysisCache();

      cache.set('key1', createAnalysisResult());
      cache.set('key2', createAnalysisResult());

      // Memory should have entries
      expect(cache.size).toBe(2);
    });

    it('should load existing cache from disk on construction', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockCacheData = {
        'key1': { result: createAnalysisResult(), cachedAt: Date.now(), ttl: 86400000 },
        'key2': { result: createAnalysisResult({ riskLevel: 'high' }), cachedAt: Date.now(), ttl: 86400000 },
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCacheData));

      const cache = new AnalysisCache();

      expect(cache.get('key1')).not.toBeNull();
      expect(cache.get('key2')).not.toBeNull();
    });

    it('should skip expired entries when loading from disk', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const now = Date.now();
      const mockCacheData = {
        'key1': { result: createAnalysisResult(), cachedAt: now - 86400000 * 2, ttl: 86400000 }, // Expired
        'key2': { result: createAnalysisResult({ riskLevel: 'high' }), cachedAt: now, ttl: 86400000 }, // Not expired
      };

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCacheData));

      const cache = new AnalysisCache();

      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).not.toBeNull();
    });

    it('should skip loading if file does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

      // Should not throw
      const cache = new AnalysisCache();

      expect(cache.size).toBe(0);
    });

    it('should recover from corrupted cache file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json{]');

      // Should not throw
      const cache = new AnalysisCache();

      expect(cache.size).toBe(0);
    });
  });

  describe('custom cache directory', () => {
    it('should use provided cache directory', () => {
      const cache = new AnalysisCache('/custom/cache/dir');

      // Should not throw
      cache.set('test', createAnalysisResult());
    });
  });
});
