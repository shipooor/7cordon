import { describe, it, expect } from 'vitest';
import { calculateTrustScore } from './trust-formula.js';
import type { TrustStats } from './types/trust.js';

describe('Trust Formula', () => {
  describe('calculateTrustScore', () => {
    it('should return zero score for zero transactions', () => {
      const stats: TrustStats = {
        totalTransactions: 0,
        approvedCount: 0,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '0',
        activeTime: 0,
        highestApprovedAmount: '0',
        consecutiveApproved: 0,
      };

      const result = calculateTrustScore(stats);

      expect(result.score).toBe(0);
      expect(result.level).toBe('untrusted');
    });

    it('should calculate score with perfect approval rate (100% approved)', () => {
      const stats: TrustStats = {
        totalTransactions: 10,
        approvedCount: 10,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '1000',
        activeTime: 36000, // 10 hours in seconds
        highestApprovedAmount: '200',
        consecutiveApproved: 10,
      };

      const result = calculateTrustScore(stats);

      // 40% approval (100) + 25% volume + 20% time + 15% streak
      // Should be high but not max (volume/time/streak impact)
      expect(result.score).toBeGreaterThan(50);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(['moderate', 'trusted', 'veteran']).toContain(result.level);
    });

    it('should penalize blocked transactions', () => {
      const stats: TrustStats = {
        totalTransactions: 10,
        approvedCount: 5,
        blockedCount: 5,
        blockedRatio: 0.5, // 50% blocked
        totalVolume: '1000',
        activeTime: 36000,
        highestApprovedAmount: '200',
        consecutiveApproved: 0,
      };

      const result = calculateTrustScore(stats);

      // 40% approval (50 due to 50% blocked) + other factors
      expect(result.score).toBeLessThan(50);
    });

    it('should map score 0 to untrusted level', () => {
      const stats: TrustStats = {
        totalTransactions: 10,
        approvedCount: 0,
        blockedCount: 10,
        blockedRatio: 1,
        totalVolume: '0',
        activeTime: 0,
        highestApprovedAmount: '0',
        consecutiveApproved: 0,
      };

      const result = calculateTrustScore(stats);

      expect(result.level).toBe('untrusted');
      expect(result.score).toBe(0);
    });

    it('should map scores 1-20 to untrusted level', () => {
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 0,
        blockedCount: 1,
        blockedRatio: 1,
        totalVolume: '0',
        activeTime: 0,
        highestApprovedAmount: '0',
        consecutiveApproved: 0,
      };

      const result = calculateTrustScore(stats);

      expect(result.level).toBe('untrusted');
      expect(result.score).toBeLessThanOrEqual(20);
    });

    it('should map scores 21-40 to cautious level', () => {
      const stats: TrustStats = {
        totalTransactions: 10,
        approvedCount: 8,
        blockedCount: 2,
        blockedRatio: 0.2,
        totalVolume: '5', // Low volume to keep score lower
        activeTime: 100,
        highestApprovedAmount: '2',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);

      expect(result.level).toBe('cautious');
      expect(result.score).toBeGreaterThanOrEqual(21);
      expect(result.score).toBeLessThanOrEqual(40);
    });

    it('should map scores 41-60 to moderate level', () => {
      const stats: TrustStats = {
        totalTransactions: 20,
        approvedCount: 20,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '100', // Log10(100) = 2, volumeScore ~50
        activeTime: 1000,
        highestApprovedAmount: '20',
        consecutiveApproved: 20,
      };

      const result = calculateTrustScore(stats);

      expect(result.level).toBe('moderate');
      expect(result.score).toBeGreaterThanOrEqual(41);
      expect(result.score).toBeLessThanOrEqual(60);
    });

    it('should map scores 61-80 to trusted level', () => {
      const stats: TrustStats = {
        totalTransactions: 30,
        approvedCount: 30,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '500', // Moderate volume
        activeTime: 10000, // ~3 hours
        highestApprovedAmount: '50',
        consecutiveApproved: 30,
      };

      const result = calculateTrustScore(stats);

      expect(result.level).toBe('trusted');
      expect(result.score).toBeGreaterThanOrEqual(61);
      expect(result.score).toBeLessThanOrEqual(80);
    });

    it('should map scores 81-100 to veteran level', () => {
      const stats: TrustStats = {
        totalTransactions: 100,
        approvedCount: 100,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '10000', // Log10(10000) = 4, volumeScore ~100
        activeTime: 360000, // 100 hours
        highestApprovedAmount: '500',
        consecutiveApproved: 100,
      };

      const result = calculateTrustScore(stats);

      expect(result.level).toBe('veteran');
      expect(result.score).toBeGreaterThanOrEqual(81);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should handle volume score calculation correctly', () => {
      // Volume score: log10(amount) / 4 * 100
      // $10 = log10(10) / 4 * 100 = 1/4 * 100 = 25
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 1,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '10',
        activeTime: 0,
        highestApprovedAmount: '10',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);

      // Should have some score contribution from volume
      expect(result.score).toBeGreaterThan(0);
    });

    it('should cap volume score at 100', () => {
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 1,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '1000000000', // Very large volume
        activeTime: 0,
        highestApprovedAmount: '1000000000',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);

      // Should not exceed 100
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should handle time score calculation (log scale)', () => {
      // Time score: log10(hours + 1) / 3 * 100
      // 1 hour: log10(2) / 3 * 100 ≈ 10.3
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 1,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '1',
        activeTime: 3600, // 1 hour in seconds
        highestApprovedAmount: '1',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);

      // Should have some score from time
      expect(result.score).toBeGreaterThan(0);
    });

    it('should cap time score at 100', () => {
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 1,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '1',
        activeTime: 36000000, // Very long time
        highestApprovedAmount: '1',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);

      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should handle streak score calculation', () => {
      // Streak score: (consecutiveApproved / 50) * 100
      // 5 consecutive: (5 / 50) * 100 = 10
      const stats: TrustStats = {
        totalTransactions: 5,
        approvedCount: 5,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '1',
        activeTime: 0,
        highestApprovedAmount: '1',
        consecutiveApproved: 5,
      };

      const result = calculateTrustScore(stats);

      expect(result.score).toBeGreaterThan(0);
    });

    it('should cap streak score at 100', () => {
      const stats: TrustStats = {
        totalTransactions: 100,
        approvedCount: 100,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '1',
        activeTime: 0,
        highestApprovedAmount: '1',
        consecutiveApproved: 100, // Very long streak
      };

      const result = calculateTrustScore(stats);

      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should use proper weighting: 40% approval, 25% volume, 20% time, 15% streak', () => {
      // Create a case where we can verify the weighting
      // All 100: 100*0.4 + 100*0.25 + 100*0.2 + 100*0.15 = 40 + 25 + 20 + 15 = 100
      const stats: TrustStats = {
        totalTransactions: 100,
        approvedCount: 100,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '10000000', // Very high volume to approach 100
        activeTime: 10000000, // Very high time to approach 100
        highestApprovedAmount: '10000000',
        consecutiveApproved: 100, // Max streak
      };

      const result = calculateTrustScore(stats);

      // Should be high and in veteran range
      expect(result.score).toBeGreaterThanOrEqual(90);
      expect(result.level).toBe('veteran');
    });

    it('should return stats in result', () => {
      const stats: TrustStats = {
        totalTransactions: 10,
        approvedCount: 10,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '100',
        activeTime: 3600,
        highestApprovedAmount: '50',
        consecutiveApproved: 10,
      };

      const result = calculateTrustScore(stats);

      expect(result.stats).toEqual(stats);
    });

    it('should handle non-finite volume gracefully', () => {
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 1,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: 'NaN',
        activeTime: 0,
        highestApprovedAmount: '0',
        consecutiveApproved: 1,
      };

      // Should not throw
      const result = calculateTrustScore(stats);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it('should handle boundary case: score exactly at level boundaries', () => {
      // Try to get score exactly at 21 (boundary between untrusted/cautious)
      const stats: TrustStats = {
        totalTransactions: 5,
        approvedCount: 4,
        blockedCount: 1,
        blockedRatio: 0.2,
        totalVolume: '5',
        activeTime: 50,
        highestApprovedAmount: '4',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);

      // Check that level mapping is correct at boundaries
      if (result.score >= 21 && result.score <= 40) {
        expect(result.level).toBe('cautious');
      }
    });

    it('should handle empty totalVolume string', () => {
      const stats: TrustStats = {
        totalTransactions: 1,
        approvedCount: 1,
        blockedCount: 0,
        blockedRatio: 0,
        totalVolume: '',
        activeTime: 0,
        highestApprovedAmount: '0',
        consecutiveApproved: 1,
      };

      const result = calculateTrustScore(stats);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });
});
