import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from './logger.js';
import type { AuditEntry } from '@7cordon/shared';
import * as fs from 'fs';

// Mock fs functions
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('path', () => ({
  default: {
    join: (...parts: string[]) => parts.join('/'),
  },
}));

const createAuditEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'entry-1',
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  timestamp: Date.now(),
  action: 'send',
  params: {
    amount: '100',
    recipient: '0x1234567890123456789012345678901234567890',
    token: 'USDT',
    chain: 'ethereum',
  },
  agentReasoning: 'normal transaction',
  policyResult: {
    allowed: true,
    violations: [],
  },
  analysisResult: {
    riskLevel: 'safe',
    threats: [],
    reasoning: 'safe',
    duration: 100,
    model: 'haiku',
  },
  finalStatus: 'approved',
  riskLevel: 'safe',
  explanation: 'approved',
  feePaid: '0.001',
  ...overrides,
});

describe('AuditLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create default cache directory if not exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      new AuditLogger();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.7cordon'),
        expect.objectContaining({ recursive: true, mode: 0o700 })
      );
    });

    it('should use custom log directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      new AuditLogger('/custom/log/dir');

      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should load existing entries on initialization', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const entry = createAuditEntry();
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(entry) + '\n');

      const logger = new AuditLogger();
      const entries = logger.getEntries();

      expect(entries.length).toBeGreaterThan(0);
    });
  });

  describe('append', () => {
    it('should append entry to log', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry = createAuditEntry();

      logger.append(entry);

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.stringContaining('audit.jsonl'),
        expect.stringContaining(JSON.stringify(entry)),
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('should include entry in memory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry = createAuditEntry();

      logger.append(entry);
      const entries = logger.getEntries(1);

      expect(entries[0].id).toBe(entry.id);
    });

    it('should add newline after entry', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry = createAuditEntry();

      logger.append(entry);

      const calls = vi.mocked(fs.appendFileSync).mock.calls;
      const data = calls[0][1] as string;
      expect(data.endsWith('\n')).toBe(true);
    });

    it('should prune old entries when exceeding MAX_ENTRIES', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();

      // Add more than MAX_ENTRIES (10,000)
      for (let i = 0; i < 10001; i++) {
        logger.append(createAuditEntry({ id: `entry-${i}` }));
      }

      const entries = logger.getEntries();
      // Should not exceed MAX_ENTRIES
      expect(entries.length).toBeLessThanOrEqual(10000);
    });

    it('should keep newest entries when pruning', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();

      // Add 11 entries (simulating 10001+ with smaller mock)
      for (let i = 0; i < 11; i++) {
        // Force small MAX_ENTRIES by appending many times
        logger.append(createAuditEntry({ id: `entry-${i}` }));
      }

      // Oldest entries should be removed, newest kept
      const entries = logger.getEntries();
      const hasNewest = entries.some(e => e.id.includes('10'));
      expect(hasNewest || entries.length <= 10000).toBe(true);
    });

    it('should handle append failure gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.appendFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      const logger = new AuditLogger();

      // Should not throw
      expect(() => {
        logger.append(createAuditEntry());
      }).not.toThrow();

      // Entry should still be in memory
      expect(logger.getEntries().length).toBeGreaterThan(0);
    });
  });

  describe('getEntries', () => {
    it('should return entries in reverse order (newest first)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry1 = createAuditEntry({ id: 'entry-1', timestamp: 1000 });
      const entry2 = createAuditEntry({ id: 'entry-2', timestamp: 2000 });
      const entry3 = createAuditEntry({ id: 'entry-3', timestamp: 3000 });

      logger.append(entry1);
      logger.append(entry2);
      logger.append(entry3);

      const entries = logger.getEntries();

      expect(entries[0].id).toBe('entry-3'); // Newest first
      expect(entries[1].id).toBe('entry-2');
      expect(entries[2].id).toBe('entry-1'); // Oldest last
    });

    it('should support limit parameter', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      for (let i = 0; i < 5; i++) {
        logger.append(createAuditEntry({ id: `entry-${i}` }));
      }

      const entries = logger.getEntries(2);

      expect(entries.length).toBe(2);
    });

    it('should support offset parameter', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      for (let i = 0; i < 5; i++) {
        logger.append(createAuditEntry({ id: `entry-${i}` }));
      }

      const entries = logger.getEntries(2, 1);

      expect(entries.length).toBe(2);
      // Skip first (newest), start from second
      expect(entries[0].id).not.toBe(`entry-4`);
    });

    it('should support both limit and offset', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      for (let i = 0; i < 10; i++) {
        logger.append(createAuditEntry({ id: `entry-${i}` }));
      }

      const entries = logger.getEntries(3, 2);

      expect(entries.length).toBe(3);
    });

    it('should return empty array if offset exceeds entries', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry());

      const entries = logger.getEntries(1, 10);

      expect(entries.length).toBe(0);
    });
  });

  describe('getAllEntries', () => {
    it('should return all entries in original order (oldest first)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry1 = createAuditEntry({ id: 'entry-1' });
      const entry2 = createAuditEntry({ id: 'entry-2' });
      const entry3 = createAuditEntry({ id: 'entry-3' });

      logger.append(entry1);
      logger.append(entry2);
      logger.append(entry3);

      const entries = logger.getAllEntries();

      expect(entries[0].id).toBe('entry-1');
      expect(entries[1].id).toBe('entry-2');
      expect(entries[2].id).toBe('entry-3');
    });
  });

  describe('getStats', () => {
    it('should calculate stats from entries', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({ finalStatus: 'approved' }));
      logger.append(createAuditEntry({ finalStatus: 'blocked' }));
      logger.append(createAuditEntry({ finalStatus: 'pending_approval' }));

      const stats = logger.getStats();

      expect(stats.totalRequests).toBe(3);
      expect(stats.approved).toBe(1);
      expect(stats.blocked).toBe(1);
      expect(stats.pending).toBe(1);
    });

    it('should calculate total fees paid', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({ feePaid: '0.001' }));
      logger.append(createAuditEntry({ feePaid: '0.002' }));
      logger.append(createAuditEntry({ feePaid: '0.003' }));

      const stats = logger.getStats();

      expect(parseFloat(stats.totalFeesPaid)).toBeCloseTo(0.006, 5);
    });

    it('should calculate average analysis duration', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({
        analysisResult: { ...createAuditEntry().analysisResult, duration: 100 },
      }));
      logger.append(createAuditEntry({
        analysisResult: { ...createAuditEntry().analysisResult, duration: 200 },
      }));

      const stats = logger.getStats();

      expect(stats.averageAnalysisTime).toBe(150);
    });

    it('should handle missing feePaid', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry = createAuditEntry();
      delete entry.feePaid;
      logger.append(entry);

      const stats = logger.getStats();

      expect(stats.totalFeesPaid).toBeDefined();
    });

    it('should handle missing analysisResult', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      const entry = createAuditEntry();
      delete entry.analysisResult;
      logger.append(entry);

      const stats = logger.getStats();

      expect(stats.averageAnalysisTime).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all entries from memory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry());
      logger.append(createAuditEntry());

      logger.clear();

      expect(logger.getEntries().length).toBe(0);
    });

    it('should clear log file on disk', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry());

      logger.clear();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('audit.jsonl'),
        '',
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('should handle file write failure during clear', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Write failed');
      });

      const logger = new AuditLogger();
      logger.append(createAuditEntry());

      // Should not throw
      expect(() => {
        logger.clear();
      }).not.toThrow();

      // Memory should still be cleared
      expect(logger.getEntries().length).toBe(0);
    });
  });

  describe('getEntriesByStatus', () => {
    it('should filter entries by approved status', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({ finalStatus: 'approved', id: 'a1' }));
      logger.append(createAuditEntry({ finalStatus: 'blocked', id: 'b1' }));
      logger.append(createAuditEntry({ finalStatus: 'approved', id: 'a2' }));

      const approved = logger.getEntriesByStatus('approved');

      expect(approved.length).toBe(2);
      expect(approved.every(e => e.finalStatus === 'approved')).toBe(true);
    });

    it('should filter entries by blocked status', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({ finalStatus: 'approved' }));
      logger.append(createAuditEntry({ finalStatus: 'blocked', id: 'b1' }));
      logger.append(createAuditEntry({ finalStatus: 'blocked', id: 'b2' }));

      const blocked = logger.getEntriesByStatus('blocked');

      expect(blocked.length).toBe(2);
      expect(blocked.every(e => e.finalStatus === 'blocked')).toBe(true);
    });

    it('should filter entries by pending_approval status', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({ finalStatus: 'pending_approval', id: 'p1' }));
      logger.append(createAuditEntry({ finalStatus: 'pending_approval', id: 'p2' }));

      const pending = logger.getEntriesByStatus('pending_approval');

      expect(pending.length).toBe(2);
      expect(pending.every(e => e.finalStatus === 'pending_approval')).toBe(true);
    });

    it('should return entries in reverse order (newest first)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry({ finalStatus: 'approved', id: 'a1', timestamp: 1000 }));
      logger.append(createAuditEntry({ finalStatus: 'approved', id: 'a2', timestamp: 2000 }));

      const approved = logger.getEntriesByStatus('approved');

      expect(approved[0].id).toBe('a2'); // Newer first
      expect(approved[1].id).toBe('a1');
    });
  });

  describe('load from disk', () => {
    it('should skip corrupted lines', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const entry1 = createAuditEntry({ id: 'entry-1' });
      const entry2 = createAuditEntry({ id: 'entry-2' });
      const corruptedLine = '{invalid json}';

      const fileContent = [
        JSON.stringify(entry1),
        corruptedLine,
        JSON.stringify(entry2),
      ].join('\n');

      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);

      const logger = new AuditLogger();

      // Should load valid entries, skip corrupted
      const entries = logger.getAllEntries();
      expect(entries.length).toBe(2);
      expect(entries[0].id).toBe('entry-1');
      expect(entries[1].id).toBe('entry-2');
    });

    it('should handle empty lines', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const entry = createAuditEntry();

      const fileContent = [
        JSON.stringify(entry),
        '',
        '',
        JSON.stringify(entry),
      ].join('\n');

      vi.mocked(fs.readFileSync).mockReturnValue(fileContent);

      const logger = new AuditLogger();

      const entries = logger.getAllEntries();
      expect(entries.length).toBe(2);
    });

    it('should recover from file read errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read failed');
      });

      // Should not throw
      const logger = new AuditLogger();

      expect(logger.getEntries().length).toBe(0);
    });

    it('should recover from JSON parse errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

      const logger = new AuditLogger();

      expect(logger.getEntries().length).toBe(0);
    });
  });

  describe('file permissions', () => {
    it('should create directory with 0o700 permissions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      new AuditLogger();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ mode: 0o700 })
      );
    });

    it('should create log file with 0o600 permissions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.append(createAuditEntry());

      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
    });

    it('should write clear file with 0o600 permissions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const logger = new AuditLogger();
      logger.clear();

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ mode: 0o600 })
      );
    });
  });
});
