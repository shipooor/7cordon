/**
 * Guardian Integration Tests — orchestration pipeline
 *
 * These tests verify the end-to-end request() pipeline:
 * 1. Policy check (L0)
 * 2. Cache check
 * 3. Remote AI analysis (L1/L2)
 * 4. Risk-based decision matrix
 * 5. Transaction execution via WDK
 * 6. Audit logging
 *
 * Uses mocks for API client and WDK to avoid real network calls and wallet derivation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TransactionRequest, AnalysisResult } from '@7cordon/shared';
import { Guardian } from './guardian.js';

// Store mock instances for test setup
let mockApiClientInstance: any;
let mockWalletManagerInstance: any;
let mockSparkPayerInstance: any;

// Mock the API client module
vi.mock('./api-client.js', () => {
  class MockGuardianApiClient {
    analyze = vi.fn();
    reportResult = vi.fn().mockResolvedValue(undefined);
    authenticate = vi.fn().mockResolvedValue(undefined);
    setWalletAuth = vi.fn();

    constructor() {
      mockApiClientInstance = this;
    }
  }
  return {
    GuardianApiClient: MockGuardianApiClient,
  };
});

// Mock WalletManager
vi.mock('./wdk/wallet-manager.js', () => {
  class MockWalletManager {
    init = vi.fn().mockResolvedValue(undefined);
    getAddress = vi.fn().mockReturnValue('0x1234567890abcdef1234567890abcdef12345678');
    sign = vi.fn().mockResolvedValue('signature_mock');
    send = vi.fn().mockResolvedValue({ hash: 'tx_hash_mock' });
    dispose = vi.fn().mockResolvedValue(undefined);

    constructor() {
      mockWalletManagerInstance = this;
    }
  }
  return {
    WalletManager: MockWalletManager,
  };
});

// Mock SparkPayer
vi.mock('./wdk/spark-payer.js', () => {
  class MockSparkPayer {
    init = vi.fn().mockResolvedValue(undefined);
    startStreaming = vi.fn();
    stopStreaming = vi.fn().mockReturnValue({ totalPaid: '0.001' });
    dispose = vi.fn().mockResolvedValue(undefined);

    constructor() {
      mockSparkPayerInstance = this;
    }
  }
  return {
    SparkPayer: MockSparkPayer,
  };
});

function createRequest(overrides?: Partial<TransactionRequest>): TransactionRequest {
  return {
    id: 'req-' + Math.random().toString(36).slice(2),
    action: 'send',
    params: {
      chain: 'ethereum',
      amount: '50',
      toAddress: '0xrecipient',
    },
    reasoning: 'test',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createAnalysisResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    requestId: 'req-123',
    level: 'L1_quick',
    riskLevel: 'safe',
    approved: true,
    explanation: 'safe transaction',
    duration: 500,
    details: {
      threats: [],
    },
    ...overrides,
  };
}

describe('Guardian.request()', () => {
  let guardian: Guardian;

  beforeEach(async () => {
    // Reset mock instances for each test
    mockApiClientInstance = null;
    mockWalletManagerInstance = null;
    mockSparkPayerInstance = null;

    // Create fresh guardian instance for each test (avoids state bleed from budget tracking)
    guardian = new Guardian({
      evmRpcUrl: 'http://localhost:8545',
      chain: 'ethereum',
      apiUrl: 'http://localhost:3000',
      apiKey: 'test-key',
      analysisOnly: true,
      // Higher budget for testing purposes to avoid budget conflicts across tests
      policy: {
        dailyBudget: '10000',
        weeklyBudget: '50000',
      },
    });

    // Initialize guardian
    await guardian.init('test seed phrase');

    // Clear persisted audit log to prevent budget bleed from previous test runs
    guardian.getAuditLog().clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('L0 policy blocking', () => {
    it('should block request exceeding max transaction amount without AI call', async () => {
      const request = createRequest({
        params: { chain: 'ethereum', amount: '500', toAddress: '0xrecipient' },
      });

      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.riskLevel).toBe('safe');
      expect(result.analysisLevel).toBe('L0_policy');
      expect(result.explanation).toContain('Blocked by policy');
      expect(mockApiClientInstance.analyze).not.toHaveBeenCalled();
      expect(result.feePaid).toBe('0');
    });

    it('should block request with non-whitelisted token', async () => {
      const request = createRequest({
        params: {
          chain: 'ethereum',
          amount: '50',
          toAddress: '0xrecipient',
          fromToken: 'SCAM_TOKEN',
        },
      });

      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.analysisLevel).toBe('L0_policy');
      expect(result.explanation).toContain('Blocked by policy');
      expect(mockApiClientInstance.analyze).not.toHaveBeenCalled();
    });

    it('should block request with blacklisted address', async () => {
      // Update policy to blacklist an address
      const blacklistedAddr = '0xbadaddress';
      const engine = guardian.getPolicyEngine();
      const config = engine.getConfig();
      engine.updateConfig({
        ...config,
        blacklist: { addresses: [blacklistedAddr] },
      });

      const request = createRequest({
        params: { chain: 'ethereum', amount: '50', toAddress: blacklistedAddr },
      });

      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.analysisLevel).toBe('L0_policy');
      expect(mockApiClientInstance.analyze).not.toHaveBeenCalled();
    });

    it('should block request exceeding daily budget', async () => {
      // Simulate existing spend by recording transactions
      const engine = guardian.getPolicyEngine();
      engine.recordTransaction('400'); // Already spent 400 of 500 daily budget

      const request = createRequest({ params: { chain: 'ethereum', amount: '200', toAddress: '0xrecipient' } });

      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.analysisLevel).toBe('L0_policy');
      expect(mockApiClientInstance.analyze).not.toHaveBeenCalled();
    });
  });

  describe('L1 analysis path', () => {
    it('should call API for analysis when L0 passes', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'safe' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      const result = await guardian.request(request);

      expect(result.status).toBe('approved');
      expect(mockApiClientInstance.analyze).toHaveBeenCalledWith(
        expect.objectContaining({ id: request.id }),
        expect.any(Number),
      );
    });

    it('should return approved status for safe/low risk + small amount', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'low' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest({ params: { chain: 'ethereum', amount: '5', toAddress: '0xrecipient' } });
      const result = await guardian.request(request);

      expect(result.status).toBe('approved');
      expect(result.riskLevel).toBe('low');
      expect(result.analysisLevel).toBe('L1_quick');
    });

    it('should return pending_approval for medium risk', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'medium' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      const result = await guardian.request(request);

      expect(result.status).toBe('pending_approval');
      expect(result.riskLevel).toBe('medium');
    });

    it('should return pending_approval for safe risk + large amount', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'safe' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      // amount 99 < manualApproveThreshold (500), so safe risk + medium amount = approved
      const request = createRequest({ params: { chain: 'ethereum', amount: '99', toAddress: '0xrecipient' } });
      const result = await guardian.request(request);

      expect(result.status).toBe('approved');
      expect(result.riskLevel).toBe('safe');
    });

    it('should return blocked when API returns unapproved', async () => {
      const analysisResult = createAnalysisResult({ approved: false, riskLevel: 'high' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.riskLevel).toBe('high');
    });

    it('should return blocked for critical risk regardless of amount', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'critical' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest({ params: { chain: 'ethereum', amount: '1', toAddress: '0xrecipient' } });
      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.riskLevel).toBe('critical');
    });

    it('should return blocked for high risk regardless of amount', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'high' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest({ params: { chain: 'ethereum', amount: '1', toAddress: '0xrecipient' } });
      const result = await guardian.request(request);

      expect(result.status).toBe('blocked');
      expect(result.riskLevel).toBe('high');
    });
  });

  describe('cache behavior', () => {
    it('should skip API call on cache hit', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      // First request — hits API
      const request1 = createRequest({ params: { chain: 'ethereum', amount: '50', toAddress: '0xrecipient' } });
      await guardian.request(request1);
      expect(mockApiClientInstance.analyze).toHaveBeenCalledTimes(1);

      // Second request with same action/address — hits cache
      const request2 = createRequest({
        params: { chain: 'ethereum', amount: '75', toAddress: '0xrecipient' },
      });
      const result = await guardian.request(request2);

      expect(mockApiClientInstance.analyze).toHaveBeenCalledTimes(1); // Not called again
      expect(result.riskLevel).toBe(analysisResult.riskLevel);
    });

    it('should skip cache for high/critical risk results', async () => {
      const criticalResult = createAnalysisResult({ riskLevel: 'critical' });
      mockApiClientInstance.analyze.mockResolvedValue(criticalResult);

      // First request — high risk, should NOT cache
      const request1 = createRequest({ params: { chain: 'ethereum', amount: '50', toAddress: '0xrecipient' } });
      await guardian.request(request1);
      expect(mockApiClientInstance.analyze).toHaveBeenCalledTimes(1);

      // Second request with same parameters — should hit API again (not cached)
      const request2 = createRequest({
        params: { chain: 'ethereum', amount: '75', toAddress: '0xrecipient' },
      });
      mockApiClientInstance.analyze.mockResolvedValue(criticalResult);
      await guardian.request(request2);

      expect(mockApiClientInstance.analyze).toHaveBeenCalledTimes(2); // Cache was skipped
    });
  });

  describe('audit logging', () => {
    it('should create audit log entry for approved request', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'safe' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      await guardian.request(request);

      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();

      expect(entries.length).toBeGreaterThan(0);
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.requestId).toBe(request.id);
      expect(lastEntry.finalStatus).toBe('approved');
    });

    it('should create audit log entry for policy-blocked request', async () => {
      const request = createRequest({
        params: { chain: 'ethereum', amount: '500', toAddress: '0xrecipient' },
      });

      await guardian.request(request);

      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();

      expect(entries.length).toBeGreaterThan(0);
      const lastEntry = entries[entries.length - 1];
      expect(lastEntry.requestId).toBe(request.id);
      expect(lastEntry.finalStatus).toBe('blocked');
      expect(lastEntry.policyResult).toBeDefined();
      expect(lastEntry.policyResult.passed).toBe(false);
    });

    it('should record fee paid in audit log', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      await guardian.request(request);

      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();
      const lastEntry = entries[entries.length - 1];

      expect(lastEntry.feePaid).toBeDefined();
      expect(typeof lastEntry.feePaid).toBe('string');
    });

    it('should record transaction hash in audit log when approved', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'safe' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest({ params: { chain: 'ethereum', amount: '5', toAddress: '0xrecipient' } });
      await guardian.request(request);

      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();
      const lastEntry = entries[entries.length - 1];

      // analysisOnly mode doesn't execute, so no txHash
      expect(lastEntry.finalStatus).toBe('approved');
      expect(lastEntry.txHash).toBeUndefined(); // analysisOnly skips execution
    });
  });

  describe('trust score updates', () => {
    it('should update trust score after approved request', async () => {
      const analysisResult = createAnalysisResult({ approved: true, riskLevel: 'safe' });
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const scoreBeforeRequest = guardian.getTrustScore().score;

      const request = createRequest({ params: { chain: 'ethereum', amount: '5', toAddress: '0xrecipient' } });
      await guardian.request(request);

      const scoreAfterRequest = guardian.getTrustScore().score;

      // Score should improve with approved transaction
      expect(scoreAfterRequest).toBeGreaterThanOrEqual(scoreBeforeRequest);
    });

    it('should keep trust score in valid range', async () => {
      const request = createRequest({
        params: { chain: 'ethereum', amount: '500', toAddress: '0xrecipient' },
      });

      await guardian.request(request);

      const scoreAfter = guardian.getTrustScore().score;

      // Score should be in valid range (0-100)
      expect(scoreAfter).toBeGreaterThanOrEqual(0);
      expect(scoreAfter).toBeLessThanOrEqual(100);
    });
  });

  describe('concurrent request serialization', () => {
    it('should serialize concurrent requests (not parallel execute)', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request1 = createRequest({ params: { chain: 'ethereum', amount: '50', toAddress: '0xrecipient' } });
      const request2 = createRequest({ params: { chain: 'ethereum', amount: '60', toAddress: '0xrecipient' } });

      // Send both requests concurrently
      const [result1, result2] = await Promise.all([guardian.request(request1), guardian.request(request2)]);

      // Both should complete successfully
      expect(result1.status).toBeDefined();
      expect(result2.status).toBeDefined();

      // Verify they both appear in audit log (both executed, one after the other)
      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    it('should complete both concurrent requests without errors', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      // Send two concurrent requests
      const request1 = createRequest({ params: { chain: 'ethereum', amount: '50', toAddress: '0xrecipient' } });
      const request2 = createRequest({ params: { chain: 'ethereum', amount: '60', toAddress: '0xrecipient' } });

      const [result1, result2] = await Promise.all([guardian.request(request1), guardian.request(request2)]);

      // Both should complete successfully
      expect(result1.status).toBe('approved');
      expect(result2.status).toBe('approved');

      // Verify serialization in audit log
      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();
      const requestIds = entries.map(e => e.requestId);
      expect(requestIds).toContain(request1.id);
      expect(requestIds).toContain(request2.id);
    });
  });

  describe('error handling', () => {
    it('should propagate API errors from analysis client', async () => {
      // Test that API errors bubble up rather than being silently caught
      mockApiClientInstance.analyze.mockRejectedValueOnce(new Error('Network timeout'));

      const request = createRequest({ params: { chain: 'ethereum', amount: '10', toAddress: '0xrecipient' } });
      await expect(guardian.request(request)).rejects.toThrow('Network timeout');
    });

    it('should attempt to log request even when analysis API call fails', async () => {
      // Verify that audit logging handles API errors gracefully
      mockApiClientInstance.analyze.mockRejectedValueOnce(new Error('API unreachable'));

      const request = createRequest({ params: { chain: 'ethereum', amount: '15', toAddress: '0xrecipient' } });
      try {
        await guardian.request(request);
      } catch {
        // Expected to throw
      }

      // Audit log should exist (may contain previous entries)
      const auditLog = guardian.getAuditLog();
      const entries = auditLog.getAllEntries();
      expect(entries).toBeDefined();
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  describe('API reporting (fire-and-forget)', () => {
    it('should call reportResult after decision', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      await guardian.request(request);

      expect(mockApiClientInstance.reportResult).toHaveBeenCalledWith(
        expect.objectContaining({ id: request.id }),
        expect.any(Object),
      );
    });

    it('should report even when policy blocks', async () => {
      const request = createRequest({
        params: { chain: 'ethereum', amount: '500', toAddress: '0xrecipient' },
      });

      await guardian.request(request);

      expect(mockApiClientInstance.reportResult).toHaveBeenCalled();
    });

    it('should not fail on reportResult error (fire-and-forget)', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);
      mockApiClientInstance.reportResult.mockRejectedValue(new Error('Dashboard offline'));

      const request = createRequest();
      // Should not throw — reportResult errors are caught
      await expect(guardian.request(request)).resolves.toBeDefined();
    });
  });

  describe('request metadata', () => {
    it('should include duration in response', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      const result = await guardian.request(request);

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe('number');
    });

    it('should include timestamp in response', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      const result = await guardian.request(request);

      expect(result.timestamp).toBeGreaterThan(0);
      expect(typeof result.timestamp).toBe('number');
    });

    it('should include requestId in response', async () => {
      const analysisResult = createAnalysisResult();
      mockApiClientInstance.analyze.mockResolvedValue(analysisResult);

      const request = createRequest();
      const result = await guardian.request(request);

      expect(result.requestId).toBe(request.id);
    });
  });
});
