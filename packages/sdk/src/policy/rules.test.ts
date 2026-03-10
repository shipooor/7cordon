import { describe, it, expect } from 'vitest';
import type { PolicyViolation } from '@saaafe/shared';
import {
  checkAmount,
  checkBudget,
  checkWhitelist,
  checkBlacklist,
  checkRateLimit,
  checkAllowedAction,
} from './rules.js';

describe('Policy Rules', () => {
  describe('checkAmount', () => {
    it('should pass for valid amount within max', () => {
      const result = checkAmount('50', '100');
      expect(result).toBeNull();
    });

    it('should pass for amount exactly at max', () => {
      const result = checkAmount('100', '100');
      expect(result).toBeNull();
    });

    it('should pass for valid decimal amount', () => {
      const result = checkAmount('99.99', '100');
      expect(result).toBeNull();
    });

    it('should fail for amount exceeding max', () => {
      const result = checkAmount('150', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('max_transaction_amount');
      expect(result?.message).toContain('exceeds maximum');
    });

    it('should fail for invalid amount (NaN)', () => {
      const result = checkAmount('abc', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
      expect(result?.message).toContain('Invalid transaction amount');
    });

    it('should fail for negative amount', () => {
      const result = checkAmount('-50', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for empty string', () => {
      const result = checkAmount('', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for whitespace-only string', () => {
      const result = checkAmount('   ', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for hex notation (0x)', () => {
      const result = checkAmount('0x1F', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for hex notation (0X uppercase)', () => {
      const result = checkAmount('0X1F', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for scientific notation (1e3)', () => {
      const result = checkAmount('1e3', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for scientific notation (1E3 uppercase)', () => {
      const result = checkAmount('1E3', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should fail for scientific notation with negative exponent', () => {
      const result = checkAmount('1e-3', '100');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('invalid_amount');
    });

    it('should pass for zero amount (valid number)', () => {
      // Zero is a valid number in parseAmount (num >= 0, so 0 is not rejected)
      const result = checkAmount('0', '100');
      expect(result).toBeNull();
    });

    it('should return correct violation properties', () => {
      const result = checkAmount('150', '100');
      expect(result).toEqual({
        rule: 'max_transaction_amount',
        message: expect.stringContaining('150'),
        value: '150',
        limit: '100',
      });
    });
  });

  describe('checkBudget', () => {
    it('should pass when spend plus amount is within daily budget', () => {
      const result = checkBudget('100', 200, '500', 'daily');
      expect(result).toBeNull();
    });

    it('should pass when spend plus amount exactly equals budget', () => {
      const result = checkBudget('100', 300, '400', 'daily');
      expect(result).toBeNull();
    });

    it('should fail when spend plus amount exceeds daily budget', () => {
      const result = checkBudget('200', 400, '500', 'daily');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('daily_budget');
      expect(result?.message).toContain('exceed');
    });

    it('should fail when spend plus amount exceeds weekly budget', () => {
      const result = checkBudget('300', 1800, '2000', 'weekly');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('weekly_budget');
    });

    it('should pass when current spend is zero', () => {
      const result = checkBudget('250', 0, '500', 'daily');
      expect(result).toBeNull();
    });

    it('should skip check for invalid amount', () => {
      const result = checkBudget('invalid', 100, '500', 'daily');
      expect(result).toBeNull();
    });

    it('should skip check for invalid budget', () => {
      const result = checkBudget('100', 100, 'invalid', 'daily');
      expect(result).toBeNull();
    });

    it('should return correct daily violation message', () => {
      const result = checkBudget('100', 450, '500', 'daily');
      expect(result).toEqual({
        rule: 'daily_budget',
        message: expect.stringContaining('daily budget'),
        value: '550.00',
        limit: '500',
      });
    });

    it('should return correct weekly violation message', () => {
      const result = checkBudget('200', 1850, '2000', 'weekly');
      expect(result).toEqual({
        rule: 'weekly_budget',
        message: expect.stringContaining('weekly budget'),
        value: '2050.00',
        limit: '2000',
      });
    });

    it('should handle decimal amounts correctly', () => {
      const result = checkBudget('50.50', 100.25, '200', 'daily');
      expect(result).toBeNull();
    });

    it('should correctly sum large amounts', () => {
      const result = checkBudget('1500', 500, '2000', 'daily');
      expect(result).toBeNull(); // 500 + 1500 = 2000, which equals budget (passes)
    });
  });

  describe('checkWhitelist', () => {
    it('should pass when whitelist is empty (allow all)', () => {
      const result = checkWhitelist('anyAddress', [], 'address');
      expect(result).toBeNull();
    });

    it('should pass when value is in whitelist', () => {
      const result = checkWhitelist('uniswap', ['aave', 'uniswap', 'compound'], 'protocol');
      expect(result).toBeNull();
    });

    it('should pass with case-insensitive matching (lowercase value)', () => {
      const result = checkWhitelist('UniSwap', ['aave', 'uniswap', 'compound'], 'protocol');
      expect(result).toBeNull();
    });

    it('should pass with case-insensitive matching (uppercase whitelist)', () => {
      const result = checkWhitelist('uniswap', ['AAVE', 'UNISWAP', 'COMPOUND'], 'protocol');
      expect(result).toBeNull();
    });

    it('should fail when value is not in whitelist', () => {
      const result = checkWhitelist('sushiswap', ['aave', 'uniswap', 'compound'], 'protocol');
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('protocol_whitelist');
    });

    it('should return correct violation for token', () => {
      const result = checkWhitelist('SCAM', ['USDT', 'ETH', 'WBTC'], 'token');
      expect(result).toEqual({
        rule: 'token_whitelist',
        message: expect.stringContaining('not in the whitelist'),
        value: 'SCAM',
        limit: 'USDT, ETH, WBTC',
      });
    });

    it('should return correct violation for address', () => {
      const result = checkWhitelist('0xabc123', ['0x123def', '0x456abc'], 'address');
      expect(result).toEqual({
        rule: 'address_whitelist',
        message: expect.stringContaining('not in the whitelist'),
        value: '0xabc123',
        limit: '0x123def, 0x456abc',
      });
    });

    it('should handle single item whitelist', () => {
      const result = checkWhitelist('aave', ['aave'], 'protocol');
      expect(result).toBeNull();
    });

    it('should handle multiple spaces case insensitive', () => {
      const result = checkWhitelist('PROTOCOL', ['protocol'], 'protocol');
      expect(result).toBeNull();
    });

    it('should fail on partial match', () => {
      const result = checkWhitelist('uniswap-v3', ['uniswap', 'compound'], 'protocol');
      expect(result).not.toBeNull();
    });

    it('should handle addresses with mixed case', () => {
      const result = checkWhitelist('0xAbCdEf1234567890', ['0xabcdef1234567890'], 'address');
      expect(result).toBeNull();
    });
  });

  describe('checkBlacklist', () => {
    it('should pass when address is not blacklisted', () => {
      const result = checkBlacklist('0x1234567890', ['0xabc123', '0xdef456']);
      expect(result).toBeNull();
    });

    it('should pass when blacklist is empty', () => {
      const result = checkBlacklist('0x1234567890', []);
      expect(result).toBeNull();
    });

    it('should fail when address is blacklisted', () => {
      const result = checkBlacklist('0xabc123', ['0xabc123', '0xdef456']);
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('address_blacklist');
      expect(result?.message).toContain('blacklisted');
    });

    it('should use case-insensitive matching (lowercase address)', () => {
      const result = checkBlacklist('0xABC123', ['0xabc123']);
      expect(result).not.toBeNull();
    });

    it('should use case-insensitive matching (uppercase address)', () => {
      const result = checkBlacklist('0xabc123', ['0xABC123']);
      expect(result).not.toBeNull();
    });

    it('should return correct violation properties', () => {
      const result = checkBlacklist('0xhacker', ['0xhacker', '0xscammer']);
      expect(result).toEqual({
        rule: 'address_blacklist',
        message: expect.stringContaining('0xhacker'),
        value: '0xhacker',
        limit: 'blacklisted',
      });
    });

    it('should handle multiple blacklisted addresses', () => {
      const blacklist = Array.from({ length: 100 }, (_, i) => `0x${i}`);
      const result = checkBlacklist('0x50', blacklist);
      expect(result).not.toBeNull();
    });

    it('should fail on partial address match only with exact match', () => {
      const result = checkBlacklist('0xabc', ['0xabcdef']);
      expect(result).toBeNull();
    });
  });

  describe('checkRateLimit', () => {
    it('should pass when no recent timestamps', () => {
      const result = checkRateLimit([], 5);
      expect(result).toBeNull();
    });

    it('should pass when recent count is strictly below limit', () => {
      const now = Date.now();
      const timestamps = [now - 10000, now - 20000, now - 30000];
      const result = checkRateLimit(timestamps, 5);
      expect(result).toBeNull();
    });

    it('should pass when recent count is one below limit', () => {
      const now = Date.now();
      const timestamps = [now - 5000, now - 10000, now - 20000, now - 30000];
      const result = checkRateLimit(timestamps, 5);
      expect(result).toBeNull(); // 4 < 5
    });

    it('should fail when recent count equals limit (uses >=)', () => {
      const now = Date.now();
      const timestamps = [now - 5000, now - 10000, now - 20000, now - 30000, now - 40000];
      const result = checkRateLimit(timestamps, 5);
      expect(result).not.toBeNull(); // recentCount >= maxPerMinute triggers violation
      expect(result?.rule).toBe('rate_limit');
    });

    it('should fail when recent count exceeds limit', () => {
      const now = Date.now();
      const timestamps = [
        now - 5000,
        now - 10000,
        now - 15000,
        now - 20000,
        now - 25000,
        now - 30000,
      ];
      const result = checkRateLimit(timestamps, 5);
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('rate_limit');
    });

    it('should ignore timestamps older than 1 minute', () => {
      const now = Date.now();
      const timestamps = [
        now - 10000, // within 1 min
        now - 61000, // outside 1 min
        now - 120000, // outside 1 min
      ];
      const result = checkRateLimit(timestamps, 2);
      expect(result).toBeNull();
    });

    it('should fail when old timestamps expire and new ones exceed limit', () => {
      const now = Date.now();
      const timestamps = [
        now - 5000,
        now - 10000,
        now - 15000,
        now - 20000,
        now - 25000,
      ];
      const result = checkRateLimit(timestamps, 4);
      expect(result).not.toBeNull();
    });

    it('should return correct violation properties', () => {
      const now = Date.now();
      const timestamps = [now - 5000, now - 10000, now - 15000, now - 20000, now - 25000, now - 30000];
      const result = checkRateLimit(timestamps, 3);
      expect(result).toEqual({
        rule: 'rate_limit',
        message: expect.stringContaining('Rate limit exceeded'),
        value: '6',
        limit: '3',
      });
    });

    it('should handle edge case at exactly 60 seconds ago', () => {
      const now = Date.now();
      const timestamps = [
        now - 5000,
        now - 10000,
        now - 55000,
        now - 59999, // just inside 60s window
      ];
      const result = checkRateLimit(timestamps, 5);
      expect(result).toBeNull();
    });

    it('should handle edge case just outside 60 seconds ago', () => {
      const now = Date.now();
      const timestamps = [
        now - 5000,
        now - 10000,
        now - 55000,
        now - 61000, // safely outside 60s window (1s margin for Date.now() drift)
      ];
      const result = checkRateLimit(timestamps, 4); // limit higher than the 3 included
      expect(result).toBeNull(); // only 3 timestamps within 60s window
    });

    it('should handle large timestamp list', () => {
      const now = Date.now();
      const timestamps = Array.from({ length: 100 }, (_, i) => now - i * 500);
      const result = checkRateLimit(timestamps, 50);
      expect(result).not.toBeNull();
    });
  });

  describe('checkAllowedAction', () => {
    it('should pass when action is in allowed list', () => {
      const allowed: Array<'send' | 'swap' | 'lend'> = ['send', 'swap', 'lend'];
      const result = checkAllowedAction('send', allowed);
      expect(result).toBeNull();
    });

    it('should pass when action is the only allowed action', () => {
      const allowed: Array<'swap'> = ['swap'];
      const result = checkAllowedAction('swap', allowed);
      expect(result).toBeNull();
    });

    it('should fail when action is not in allowed list', () => {
      const allowed: Array<'send' | 'swap'> = ['send', 'swap'];
      const result = checkAllowedAction('lend', allowed);
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('allowed_action');
    });

    it('should fail when allowed list is empty', () => {
      const result = checkAllowedAction('send', []);
      expect(result).not.toBeNull();
      expect(result?.rule).toBe('allowed_action');
    });

    it('should return correct violation message', () => {
      const allowed: Array<'send' | 'swap'> = ['send', 'swap'];
      const result = checkAllowedAction('bridge', allowed);
      expect(result).toEqual({
        rule: 'allowed_action',
        message: expect.stringContaining('not allowed'),
        value: 'bridge',
        limit: 'send, swap',
      });
    });

    it('should list all allowed actions in violation', () => {
      const allowed: Array<'send' | 'swap' | 'lend' | 'withdraw'> = ['send', 'swap', 'lend', 'withdraw'];
      const result = checkAllowedAction('approve', allowed);
      expect(result?.limit).toBe('send, swap, lend, withdraw');
    });

    it('should handle all transaction actions', () => {
      const allActions: Array<'send' | 'swap' | 'approve' | 'lend' | 'withdraw' | 'bridge'> = [
        'send',
        'swap',
        'approve',
        'lend',
        'withdraw',
        'bridge',
      ];
      const result = checkAllowedAction('send', allActions);
      expect(result).toBeNull();
    });

    it('should fail for single missing action from large list', () => {
      const allowed: Array<'send' | 'swap' | 'approve' | 'lend' | 'withdraw'> = [
        'send',
        'swap',
        'approve',
        'lend',
        'withdraw',
      ];
      const result = checkAllowedAction('bridge', allowed);
      expect(result).not.toBeNull();
    });
  });
});
