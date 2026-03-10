import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TransactionRequest, AuditEntry } from '@saaafe/shared';
import { DEFAULT_POLICY } from '@saaafe/shared';
import { PolicyEngine } from './engine.js';

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe('constructor', () => {
    it('should initialize with default policy', () => {
      const config = engine.getConfig();
      expect(config.maxTransactionAmount).toBe(DEFAULT_POLICY.maxTransactionAmount);
      expect(config.dailyBudget).toBe(DEFAULT_POLICY.dailyBudget);
      expect(config.weeklyBudget).toBe(DEFAULT_POLICY.weeklyBudget);
    });

    it('should merge custom config with defaults', () => {
      const customEngine = new PolicyEngine({
        maxTransactionAmount: '200',
      });
      const config = customEngine.getConfig();
      expect(config.maxTransactionAmount).toBe('200');
      expect(config.dailyBudget).toBe(DEFAULT_POLICY.dailyBudget);
    });

    it('should allow empty constructor', () => {
      expect(() => new PolicyEngine()).not.toThrow();
    });

    it('should allow undefined overrides', () => {
      expect(() => new PolicyEngine(undefined)).not.toThrow();
    });

    it('should merge whitelist arrays from defaults and custom', () => {
      const customEngine = new PolicyEngine({
        whitelist: {
          protocols: ['sushiswap'],
          tokens: ['DAI'],
          addresses: [],
        },
      });
      const config = customEngine.getConfig();
      expect(config.whitelist.protocols).toContain('aave');
      expect(config.whitelist.protocols).toContain('sushiswap');
    });

    it('should merge blacklist arrays', () => {
      const customEngine = new PolicyEngine({
        blacklist: {
          addresses: ['0xhacker'],
        },
      });
      const config = customEngine.getConfig();
      expect(config.blacklist.addresses).toContain('0xhacker');
    });
  });

  describe('evaluate', () => {
    const baseRequest: TransactionRequest = {
      id: 'test-1',
      action: 'send',
      params: {
        chain: 'ethereum',
        amount: '50',
        toAddress: '0xrecipient',
      },
      reasoning: 'test send',
      timestamp: Date.now(),
    };

    it('should pass valid transaction', () => {
      const result = engine.evaluate(baseRequest);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should fail when amount exceeds max', () => {
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          amount: '1000', // exceeds default max of 100
        },
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'max_transaction_amount')).toBe(true);
    });

    it('should fail when amount is invalid', () => {
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          amount: 'invalid',
        },
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'invalid_amount')).toBe(true);
    });

    it('should fail when action is not allowed', () => {
      const request = {
        ...baseRequest,
        action: 'approve' as const,
      };
      const restrictedEngine = new PolicyEngine({
        allowedActions: ['send', 'swap'],
      });
      const result = restrictedEngine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'allowed_action')).toBe(true);
    });

    it('should fail when daily budget exceeded', () => {
      // Record transactions that use up most of daily budget
      engine.recordTransaction('400');
      engine.recordTransaction('100');

      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          amount: '100', // total would be 600, exceeds 500
        },
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'daily_budget')).toBe(true);
    });

    it('should fail when weekly budget exceeded', () => {
      // Record transactions in the same engine (weekly spend accumulates)
      engine.recordTransaction('1000');
      engine.recordTransaction('500');

      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          amount: '600', // total would be 2100, exceeds 2000
        },
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'weekly_budget')).toBe(true);
    });

    it('should fail when rate limit exceeded', () => {
      const engineWithLowRateLimit = new PolicyEngine({ rateLimit: 2 });

      // Record 2 transactions (at limit)
      engineWithLowRateLimit.recordTransaction('10');
      engineWithLowRateLimit.recordTransaction('10');

      // Try to record a 3rd within the same minute
      const result = engineWithLowRateLimit.evaluate(baseRequest);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'rate_limit')).toBe(true);
    });

    it('should fail when toAddress is blacklisted', () => {
      const engineWithBlacklist = new PolicyEngine({
        blacklist: {
          addresses: ['0xhacker'],
        },
      });
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          toAddress: '0xhacker',
        },
      };
      const result = engineWithBlacklist.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'address_blacklist')).toBe(true);
    });

    it('should fail when protocol is not whitelisted', () => {
      const engineWithProtocolWhitelist = new PolicyEngine({
        whitelist: {
          protocols: ['aave', 'compound'],
          tokens: [],
          addresses: [],
        },
      });
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          protocol: 'unknown-protocol',
        },
      };
      const result = engineWithProtocolWhitelist.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'protocol_whitelist')).toBe(true);
    });

    it('should fail when fromToken is not whitelisted', () => {
      const engineWithTokenWhitelist = new PolicyEngine({
        whitelist: {
          protocols: [],
          tokens: ['USDT', 'ETH'],
          addresses: [],
        },
      });
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          fromToken: 'SCAM',
        },
      };
      const result = engineWithTokenWhitelist.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'token_whitelist')).toBe(true);
    });

    it('should fail when toToken is not whitelisted', () => {
      const engineWithTokenWhitelist = new PolicyEngine({
        whitelist: {
          protocols: [],
          tokens: ['USDT', 'ETH'],
          addresses: [],
        },
      });
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          toToken: 'SCAM',
        },
      };
      const result = engineWithTokenWhitelist.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'token_whitelist')).toBe(true);
    });

    it('should pass when protocol is whitelisted', () => {
      const engineWithProtocolWhitelist = new PolicyEngine({
        whitelist: {
          protocols: ['aave', 'compound'],
          tokens: [],
          addresses: [],
        },
      });
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          protocol: 'aave',
        },
      };
      const result = engineWithProtocolWhitelist.evaluate(request);
      expect(result.passed).toBe(true);
    });

    it('should pass when token is whitelisted', () => {
      const engineWithTokenWhitelist = new PolicyEngine({
        whitelist: {
          protocols: [],
          tokens: ['USDT', 'ETH'],
          addresses: [],
        },
      });
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          fromToken: 'ETH',
        },
      };
      const result = engineWithTokenWhitelist.evaluate(request);
      expect(result.passed).toBe(true);
    });

    it('should report multiple violations', () => {
      const restrictiveEngine = new PolicyEngine({
        maxTransactionAmount: '10',
        allowedActions: ['swap'],
        rateLimit: 1,
      });

      // Trigger rate limit
      restrictiveEngine.recordTransaction('5');

      const request = {
        ...baseRequest,
        action: 'send' as const,
        params: {
          ...baseRequest.params,
          amount: '100', // exceeds max
        },
      };
      const result = restrictiveEngine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle request without optional params', () => {
      const request = {
        id: 'test-2',
        action: 'send' as const,
        params: {
          chain: 'ethereum' as const,
          amount: '50',
        },
        reasoning: 'simple send',
        timestamp: Date.now(),
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(true);
    });

    it('should handle hex amount rejection', () => {
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          amount: '0x64', // hex 100
        },
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'invalid_amount')).toBe(true);
    });

    it('should handle scientific notation rejection', () => {
      const request = {
        ...baseRequest,
        params: {
          ...baseRequest.params,
          amount: '1e2', // scientific 100
        },
      };
      const result = engine.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'invalid_amount')).toBe(true);
    });
  });

  describe('recordTransaction', () => {
    it('should add transaction to spend log', () => {
      engine.recordTransaction('50');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(50);
    });

    it('should accumulate multiple transactions', () => {
      engine.recordTransaction('50');
      engine.recordTransaction('75');
      engine.recordTransaction('25');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(150);
    });

    it('should ignore invalid amounts', () => {
      engine.recordTransaction('50');
      engine.recordTransaction('invalid');
      engine.recordTransaction('0');
      engine.recordTransaction('-10');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(50);
    });

    it('should track timestamps for rate limiting', () => {
      const engineWithLowRate = new PolicyEngine({ rateLimit: 2 });
      engineWithLowRate.recordTransaction('10');
      engineWithLowRate.recordTransaction('10');

      // Should be at limit
      const request: TransactionRequest = {
        id: 'test',
        action: 'send',
        params: { chain: 'ethereum', amount: '10' },
        reasoning: 'test',
        timestamp: Date.now(),
      };
      let result = engineWithLowRate.evaluate(request);
      expect(result.passed).toBe(false);

      // Wait 1 minute + 1ms to let rate limit expire
      vi.useFakeTimers();
      vi.advanceTimersByTime(60001);

      // Should pass now
      result = engineWithLowRate.evaluate(request);
      expect(result.passed).toBe(true);

      vi.useRealTimers();
    });

    it('should prune old timestamps from rate tracking', () => {
      const engineWithLowRate = new PolicyEngine({ rateLimit: 2 });

      vi.useFakeTimers();

      // Add 2 transactions
      engineWithLowRate.recordTransaction('10');
      engineWithLowRate.recordTransaction('10');

      // Advance 61 seconds
      vi.advanceTimersByTime(61000);

      // Add another transaction (old ones should be pruned)
      engineWithLowRate.recordTransaction('10');

      // Should not be at rate limit (old ones pruned)
      const request: TransactionRequest = {
        id: 'test',
        action: 'send',
        params: { chain: 'ethereum', amount: '10' },
        reasoning: 'test',
        timestamp: Date.now(),
      };
      const result = engineWithLowRate.evaluate(request);
      expect(result.passed).toBe(true);

      vi.useRealTimers();
    });

    it('should prune old spend entries to prevent unbounded growth', () => {
      engine.recordTransaction('100');

      vi.useFakeTimers();

      // Advance 7 days + 1 second
      vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1000);

      // Record a new transaction
      engine.recordTransaction('100');

      // Only the new transaction should count for weekly spend
      const status = engine.getBudgetStatus();
      expect(status.weeklySpent).toBe(100);

      vi.useRealTimers();
    });

    it('should handle large transaction amounts', () => {
      engine.recordTransaction('999999999');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(999999999);
    });

    it('should handle decimal transaction amounts', () => {
      engine.recordTransaction('50.75');
      engine.recordTransaction('25.25');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(76);
    });
  });

  describe('restoreFromAuditLog', () => {
    it('should restore approved transactions to spend log', () => {
      const now = Date.now();
      const entries: AuditEntry[] = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: '100' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
      ];

      engine.restoreFromAuditLog(entries);
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(100);
    });

    it('should ignore non-approved entries', () => {
      const now = Date.now();
      const entries: AuditEntry[] = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: '100' },
          agentReasoning: 'test',
          policyResult: { passed: false, violations: [] },
          finalStatus: 'blocked',
          riskLevel: 'critical',
          explanation: 'test',
          feePaid: '0',
        },
        {
          id: 'audit-2',
          requestId: 'req-2',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: '50' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'pending_approval',
          riskLevel: 'medium',
          explanation: 'test',
          feePaid: '0',
        },
      ];

      engine.restoreFromAuditLog(entries);
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(0);
    });

    it('should ignore entries older than 1 week', () => {
      const now = Date.now();
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const entries: AuditEntry[] = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: oneWeekAgo - 1000, // older than 1 week
          action: 'send',
          params: { chain: 'ethereum', amount: '100' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
        {
          id: 'audit-2',
          requestId: 'req-2',
          timestamp: now - 1000, // recent
          action: 'send',
          params: { chain: 'ethereum', amount: '50' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
      ];

      engine.restoreFromAuditLog(entries);
      const status = engine.getBudgetStatus();
      expect(status.weeklySpent).toBe(50);
    });

    it('should ignore entries with invalid amounts', () => {
      const now = Date.now();
      const entries: AuditEntry[] = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: 'invalid' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
      ];

      engine.restoreFromAuditLog(entries);
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(0);
    });

    it('should ignore entries with zero or negative amounts', () => {
      const now = Date.now();
      const entries: AuditEntry[] = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: '0' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
        {
          id: 'audit-2',
          requestId: 'req-2',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: '-50' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
      ];

      engine.restoreFromAuditLog(entries);
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(0);
    });

    it('should accumulate multiple approved entries', () => {
      const now = Date.now();
      const entries: AuditEntry[] = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: now,
          action: 'send',
          params: { chain: 'ethereum', amount: '100' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
        {
          id: 'audit-2',
          requestId: 'req-2',
          timestamp: now - 1000,
          action: 'send',
          params: { chain: 'ethereum', amount: '200' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
        {
          id: 'audit-3',
          requestId: 'req-3',
          timestamp: now - 2000,
          action: 'send',
          params: { chain: 'ethereum', amount: '150' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved',
          riskLevel: 'safe',
          explanation: 'test',
          feePaid: '0',
        },
      ];

      engine.restoreFromAuditLog(entries);
      const status = engine.getBudgetStatus();
      expect(status.weeklySpent).toBe(450);
    });
  });

  describe('getBudgetStatus', () => {
    it('should return daily and weekly spend', () => {
      engine.recordTransaction('100');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(100);
      expect(status.weeklySpent).toBe(100);
    });

    it('should return budget limits from config', () => {
      const status = engine.getBudgetStatus();
      expect(status.dailyLimit).toBe(Number(DEFAULT_POLICY.dailyBudget));
      expect(status.weeklyLimit).toBe(Number(DEFAULT_POLICY.weeklyBudget));
    });

    it('should calculate correct daily spend', () => {
      engine.recordTransaction('50');
      engine.recordTransaction('100');
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(150);
      expect(status.dailyLimit).toBe(500);
    });

    it('should differentiate daily and weekly spend', () => {
      vi.useFakeTimers();

      // Add transaction
      engine.recordTransaction('300');

      // Advance 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      // Add another transaction
      engine.recordTransaction('300');

      const status = engine.getBudgetStatus();
      expect(status.weeklySpent).toBe(600);
      expect(status.dailySpent).toBe(300); // only the recent one

      vi.useRealTimers();
    });

    it('should return zero spend initially', () => {
      const status = engine.getBudgetStatus();
      expect(status.dailySpent).toBe(0);
      expect(status.weeklySpent).toBe(0);
    });
  });

  describe('getConfig', () => {
    it('should return copy of policy config', () => {
      const config = engine.getConfig();
      expect(config).toEqual(DEFAULT_POLICY);
    });

    it('should return independent copy (modifications do not affect engine)', () => {
      const config = engine.getConfig();
      config.maxTransactionAmount = '999';
      const config2 = engine.getConfig();
      expect(config2.maxTransactionAmount).toBe(DEFAULT_POLICY.maxTransactionAmount);
    });

    it('should include all default policy fields', () => {
      const config = engine.getConfig();
      expect(config).toHaveProperty('maxTransactionAmount');
      expect(config).toHaveProperty('dailyBudget');
      expect(config).toHaveProperty('weeklyBudget');
      expect(config).toHaveProperty('rateLimit');
      expect(config).toHaveProperty('allowedActions');
      expect(config).toHaveProperty('whitelist');
      expect(config).toHaveProperty('blacklist');
      expect(config).toHaveProperty('autoApproveThreshold');
      expect(config).toHaveProperty('manualApproveThreshold');
    });
  });

  describe('updateConfig', () => {
    it('should update single field', () => {
      engine.updateConfig({ maxTransactionAmount: '200' });
      const config = engine.getConfig();
      expect(config.maxTransactionAmount).toBe('200');
    });

    it('should preserve other fields when updating one', () => {
      engine.updateConfig({ maxTransactionAmount: '200' });
      const config = engine.getConfig();
      expect(config.dailyBudget).toBe(DEFAULT_POLICY.dailyBudget);
    });

    it('should deep merge whitelist protocols', () => {
      engine.updateConfig({
        whitelist: { protocols: ['sushiswap'], tokens: [], addresses: [] },
      });
      const config = engine.getConfig();
      expect(config.whitelist.protocols).toContain('aave');
      expect(config.whitelist.protocols).toContain('sushiswap');
    });

    it('should deep merge whitelist tokens', () => {
      engine.updateConfig({
        whitelist: { protocols: [], tokens: ['DAI'], addresses: [] },
      });
      const config = engine.getConfig();
      expect(config.whitelist.tokens).toContain('USDT');
      expect(config.whitelist.tokens).toContain('DAI');
    });

    it('should deep merge whitelist addresses', () => {
      engine.updateConfig({
        whitelist: { protocols: [], tokens: [], addresses: ['0x1234'] },
      });
      const config = engine.getConfig();
      expect(config.whitelist.addresses).toContain('0x1234');
    });

    it('should deep merge blacklist addresses', () => {
      engine.updateConfig({
        blacklist: { addresses: ['0xhacker'] },
      });
      const config = engine.getConfig();
      expect(config.blacklist.addresses).toContain('0xhacker');
    });

    it('should deduplicate whitelist entries', () => {
      engine.updateConfig({
        whitelist: { protocols: ['aave'], tokens: [], addresses: [] },
      });
      const config = engine.getConfig();
      const aaveCount = config.whitelist.protocols.filter((p) => p === 'aave').length;
      expect(aaveCount).toBe(1);
    });

    it('should deduplicate blacklist entries', () => {
      engine.updateConfig({
        blacklist: { addresses: ['0xhacker'] },
      });
      engine.updateConfig({
        blacklist: { addresses: ['0xhacker'] },
      });
      const config = engine.getConfig();
      const hackerCount = config.blacklist.addresses.filter((a) => a === '0xhacker').length;
      expect(hackerCount).toBe(1);
    });

    it('should allow updating allowedActions', () => {
      engine.updateConfig({
        allowedActions: ['send', 'swap'],
      });
      const config = engine.getConfig();
      expect(config.allowedActions).toEqual(['send', 'swap']);
    });

    it('should allow multiple updates in sequence', () => {
      engine.updateConfig({ maxTransactionAmount: '200' });
      engine.updateConfig({ dailyBudget: '1000' });
      const config = engine.getConfig();
      expect(config.maxTransactionAmount).toBe('200');
      expect(config.dailyBudget).toBe('1000');
    });

    it('should allow updating rateLimit', () => {
      engine.updateConfig({ rateLimit: 10 });
      const config = engine.getConfig();
      expect(config.rateLimit).toBe(10);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete transaction lifecycle', () => {
      // Use custom engine with higher limits to accommodate test amounts
      const testEngine = new PolicyEngine({
        maxTransactionAmount: '500',
      });

      const request: TransactionRequest = {
        id: 'tx-1',
        action: 'send',
        params: {
          chain: 'ethereum',
          amount: '100',
          toAddress: '0xrecipient',
        },
        reasoning: 'test send',
        timestamp: Date.now(),
      };

      // 1. Evaluate
      let result = testEngine.evaluate(request);
      expect(result.passed).toBe(true);

      // 2. Record
      testEngine.recordTransaction(request.params.amount);

      // 3. Check budget status
      let status = testEngine.getBudgetStatus();
      expect(status.dailySpent).toBe(100);

      // 4. Evaluate another transaction
      const request2: TransactionRequest = {
        ...request,
        id: 'tx-2',
        params: {
          ...request.params,
          amount: '300',
        },
      };
      result = testEngine.evaluate(request2);
      expect(result.passed).toBe(true);

      // 5. Record second transaction
      testEngine.recordTransaction(request2.params.amount);

      // 6. Check final status
      status = testEngine.getBudgetStatus();
      expect(status.dailySpent).toBe(400);
    });

    it('should prevent budget bypass via process restart', () => {
      // Simulate first process session
      const engine1 = new PolicyEngine();
      engine1.recordTransaction('400');
      engine1.recordTransaction('100');

      // Simulate audit log from first session
      const auditEntries = [
        {
          id: 'audit-1',
          requestId: 'req-1',
          timestamp: Date.now(),
          action: 'send' as const,
          params: { chain: 'ethereum' as const, amount: '400' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved' as const,
          riskLevel: 'safe' as const,
          explanation: 'test',
          feePaid: '0',
        },
        {
          id: 'audit-2',
          requestId: 'req-2',
          timestamp: Date.now(),
          action: 'send' as const,
          params: { chain: 'ethereum' as const, amount: '100' },
          agentReasoning: 'test',
          policyResult: { passed: true, violations: [] },
          finalStatus: 'approved' as const,
          riskLevel: 'safe' as const,
          explanation: 'test',
          feePaid: '0',
        },
      ];

      // Simulate second process session
      const engine2 = new PolicyEngine();
      engine2.restoreFromAuditLog(auditEntries);

      // Attempt to exceed budget
      const request: TransactionRequest = {
        id: 'tx-3',
        action: 'send',
        params: { chain: 'ethereum', amount: '100' },
        reasoning: 'test',
        timestamp: Date.now(),
      };
      const result = engine2.evaluate(request);
      expect(result.passed).toBe(false);
      expect(result.violations.some((v) => v.rule === 'daily_budget')).toBe(true);
    });
  });
});
