import { describe, it, expect } from 'vitest';
import { TrustScorer } from './scorer.js';
import type { AuditEntry } from '@7cordon/shared';

describe('TrustScorer', () => {
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

  describe('calculate', () => {
    it('should return zero score for empty entries', () => {
      const scorer = new TrustScorer();
      const result = scorer.calculate([]);

      expect(result.score).toBe(0);
      expect(result.level).toBe('untrusted');
      expect(result.stats.totalTransactions).toBe(0);
    });

    it('should calculate stats from single approved entry', () => {
      const scorer = new TrustScorer();
      const entry = createAuditEntry({
        params: { amount: '100', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
      });

      const result = scorer.calculate([entry]);

      expect(result.stats.totalTransactions).toBe(1);
      expect(result.stats.approvedCount).toBe(1);
      expect(result.stats.blockedCount).toBe(0);
      expect(result.stats.blockedRatio).toBe(0);
    });

    it('should calculate volume correctly', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({ params: { amount: '100', recipient: '0x123', token: 'USDT', chain: 'ethereum' } }),
        createAuditEntry({ params: { amount: '250', recipient: '0x456', token: 'USDT', chain: 'ethereum' } }),
        createAuditEntry({ params: { amount: '150', recipient: '0x789', token: 'USDT', chain: 'ethereum' } }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.totalVolume).toBe('500.00');
    });

    it('should ignore non-approved transactions in volume calculation', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          finalStatus: 'approved',
          params: { amount: '100', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          finalStatus: 'blocked',
          params: { amount: '500', recipient: '0x456', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      // Only approved transaction counted
      expect(result.stats.totalVolume).toBe('100.00');
    });

    it('should handle invalid amounts in volume calculation', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          params: { amount: 'invalid', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          params: { amount: '100', recipient: '0x456', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      // Invalid amount treated as 0
      expect(result.stats.totalVolume).toBe('100.00');
    });

    it('should calculate highest approved amount', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          finalStatus: 'approved',
          params: { amount: '100', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          finalStatus: 'approved',
          params: { amount: '500', recipient: '0x456', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          finalStatus: 'approved',
          params: { amount: '200', recipient: '0x789', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.highestApprovedAmount).toBe('500.00');
    });

    it('should calculate blocked ratio correctly', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({ finalStatus: 'approved' }),
        createAuditEntry({ finalStatus: 'approved' }),
        createAuditEntry({ finalStatus: 'blocked' }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.blockedRatio).toBeCloseTo(1 / 3, 5);
      expect(result.stats.blockedCount).toBe(1);
      expect(result.stats.approvedCount).toBe(2);
    });

    it('should calculate consecutive approved streak from newest', () => {
      const scorer = new TrustScorer();
      const now = Date.now();
      const entries = [
        createAuditEntry({
          timestamp: now - 3000,
          finalStatus: 'blocked',
        }),
        createAuditEntry({
          timestamp: now - 2000,
          finalStatus: 'approved',
        }),
        createAuditEntry({
          timestamp: now - 1000,
          finalStatus: 'approved',
        }),
        createAuditEntry({
          timestamp: now,
          finalStatus: 'approved',
        }),
      ];

      const result = scorer.calculate(entries);

      // Last 3 are approved (newest to oldest)
      expect(result.stats.consecutiveApproved).toBe(3);
    });

    it('should reset streak on blocked transaction', () => {
      const scorer = new TrustScorer();
      const now = Date.now();
      const entries = [
        createAuditEntry({
          timestamp: now - 3000,
          finalStatus: 'approved',
        }),
        createAuditEntry({
          timestamp: now - 2000,
          finalStatus: 'approved',
        }),
        createAuditEntry({
          timestamp: now - 1000,
          finalStatus: 'blocked',
        }),
        createAuditEntry({
          timestamp: now,
          finalStatus: 'approved',
        }),
      ];

      const result = scorer.calculate(entries);

      // Only the last approved counts
      expect(result.stats.consecutiveApproved).toBe(1);
    });

    it('should handle zero consecutive approved streak', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({ finalStatus: 'approved' }),
        createAuditEntry({ finalStatus: 'blocked' }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.consecutiveApproved).toBe(0);
    });

    it('should calculate active time from first to last transaction', () => {
      const scorer = new TrustScorer();
      const startTime = 1000;
      const endTime = 11000; // 10 seconds later
      const entries = [
        createAuditEntry({ timestamp: startTime }),
        createAuditEntry({ timestamp: startTime + 5000 }),
        createAuditEntry({ timestamp: endTime }),
      ];

      const result = scorer.calculate(entries);

      // (11000 - 1000) / 1000 = 10 seconds
      expect(result.stats.activeTime).toBe(10);
    });

    it('should return zero active time for single transaction', () => {
      const scorer = new TrustScorer();
      const entry = createAuditEntry();

      const result = scorer.calculate([entry]);

      expect(result.stats.activeTime).toBe(0);
    });

    it('should handle pending_approval status', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({ finalStatus: 'approved' }),
        createAuditEntry({ finalStatus: 'pending_approval' }),
        createAuditEntry({ finalStatus: 'blocked' }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.totalTransactions).toBe(3);
      expect(result.stats.approvedCount).toBe(1);
      expect(result.stats.blockedCount).toBe(1);
    });

    it('should return trust score with correct level', () => {
      const scorer = new TrustScorer();
      const entries = Array.from({ length: 20 }, (_, i) =>
        createAuditEntry({
          timestamp: Date.now() + i * 1000,
          finalStatus: 'approved',
          params: { amount: '100', recipient: '0x' + i, token: 'USDT', chain: 'ethereum' },
        })
      );

      const result = scorer.calculate(entries);

      // Should have a non-zero score with many approved transactions
      expect(result.score).toBeGreaterThan(0);
      expect(['untrusted', 'cautious', 'moderate', 'trusted', 'veteran']).toContain(result.level);
    });

    it('should handle decimal amounts correctly', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          params: { amount: '99.99', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          params: { amount: '0.01', recipient: '0x456', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.totalVolume).toBe('100.00');
    });

    it('should handle very large volumes', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          params: { amount: '1000000', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.totalVolume).toBe('1000000.00');
    });

    it('should handle missing amount field', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          params: { recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.totalVolume).toBe('0.00');
    });

    it('should calculate correct blocked count', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({ finalStatus: 'approved' }),
        createAuditEntry({ finalStatus: 'blocked' }),
        createAuditEntry({ finalStatus: 'blocked' }),
        createAuditEntry({ finalStatus: 'blocked' }),
        createAuditEntry({ finalStatus: 'approved' }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.blockedCount).toBe(3);
      expect(result.stats.approvedCount).toBe(2);
    });

    it('should include stats in returned score object', () => {
      const scorer = new TrustScorer();
      const entries = [createAuditEntry()];

      const result = scorer.calculate(entries);

      expect(result.stats).toBeDefined();
      expect(result.stats.totalTransactions).toBe(1);
      expect(result.stats.approvedCount).toBe(1);
      expect(result.stats.blockedRatio).toBe(0);
    });

    it('should handle mixed transaction types', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({ action: 'send', params: { amount: '100', recipient: '0x123', token: 'USDT', chain: 'ethereum' } }),
        createAuditEntry({ action: 'swap', params: { amount: '200', recipient: '0x456', token: 'ETH', chain: 'ethereum' } }),
        createAuditEntry({ action: 'approve', params: { amount: '300', recipient: '0x789', token: 'USDC', chain: 'ethereum' } }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.totalVolume).toBe('600.00');
      expect(result.stats.totalTransactions).toBe(3);
    });

    it('should handle entries with Infinity amounts', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry({
          params: { amount: 'Infinity', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          params: { amount: '100', recipient: '0x456', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      // Infinity is filtered out in isFinite check
      expect(result.stats.totalVolume).toBe('100.00');
    });

    it('should calculate stats for multiple entries with pending status', () => {
      const scorer = new TrustScorer();
      const now = Date.now();
      const entries = [
        createAuditEntry({
          timestamp: now - 2000,
          finalStatus: 'approved',
          params: { amount: '100', recipient: '0x123', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          timestamp: now - 1000,
          finalStatus: 'pending_approval',
          params: { amount: '200', recipient: '0x456', token: 'USDT', chain: 'ethereum' },
        }),
        createAuditEntry({
          timestamp: now,
          finalStatus: 'approved',
          params: { amount: '150', recipient: '0x789', token: 'USDT', chain: 'ethereum' },
        }),
      ];

      const result = scorer.calculate(entries);

      expect(result.stats.approvedCount).toBe(2);
      expect(result.stats.blockedCount).toBe(0);
      expect(result.stats.totalVolume).toBe('250.00'); // Only approved
      expect(result.stats.activeTime).toBe(2); // (now - (now-2000)) / 1000
      expect(result.stats.blockedRatio).toBe(0);
    });

    it('should not modify input entries array', () => {
      const scorer = new TrustScorer();
      const entries = [
        createAuditEntry(),
        createAuditEntry(),
      ];
      const originalLength = entries.length;

      scorer.calculate(entries);

      expect(entries.length).toBe(originalLength);
    });
  });
});
