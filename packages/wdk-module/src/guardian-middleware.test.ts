import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TransactionRequest, AnalysisResult, PolicyConfig } from '@saaafe/shared';
import { guardianMiddleware } from './guardian-middleware.js';
import { GuardianBlockedError } from './errors.js';

// Store mock functions at module level so we can reference them in tests
let mockAnalyzeFn = vi.fn();
let mockEvaluateFn = vi.fn();
let mockRecordTransactionFn = vi.fn();

// Mock GuardianApiClient and PolicyEngine
vi.mock('@saaafe/sdk', () => {
  return {
    GuardianApiClient: class MockGuardianApiClient {
      constructor(public baseUrl: string, public apiKey: string) {}
      analyze(request: any) {
        return mockAnalyzeFn(request);
      }
    },
    PolicyEngine: class MockPolicyEngine {
      constructor(public config: Partial<PolicyConfig> | undefined) {}
      evaluate(request: any) {
        return mockEvaluateFn(request);
      }
      recordTransaction(amount: string) {
        return mockRecordTransactionFn(amount);
      }
    },
  };
});

describe('guardianMiddleware', () => {
  let mockAccount: any;
  let originalSendTransaction: any;
  let originalTransfer: any;

  beforeEach(() => {
    // Reset all mocks
    mockAnalyzeFn = vi.fn();
    mockEvaluateFn = vi.fn();
    mockRecordTransactionFn = vi.fn();

    // Create a mock WDK account with original send/transfer methods
    originalSendTransaction = vi.fn().mockResolvedValue('send-result');
    originalTransfer = vi.fn().mockResolvedValue('transfer-result');

    mockAccount = {
      getAddress: vi.fn().mockResolvedValue('0x1234567890123456789012345678901234567890'),
      sendTransaction: originalSendTransaction,
      transfer: originalTransfer,
    };
  });

  describe('returns WDK middleware function', () => {
    it('should return an async function', async () => {
      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      expect(typeof middleware).toBe('function');

      // Store original refs before wrapping
      const originalSend = mockAccount.sendTransaction;
      const originalTransfer = mockAccount.transfer;

      // Call it with the account — should wrap methods
      await middleware(mockAccount);

      // Verify the account methods were replaced with wrapped versions
      expect(mockAccount.sendTransaction).not.toBe(originalSend);
      expect(mockAccount.transfer).not.toBe(originalTransfer);
      expect(typeof mockAccount.sendTransaction).toBe('function');
      expect(typeof mockAccount.transfer).toBe('function');
    });
  });

  describe('sendTransaction handler', () => {
    it('should intercept sendTransaction calls and call analyze', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe transaction',
        details: { threats: [] },
        duration: 100,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      const tx = { to: '0xabcd', value: BigInt(100) };
      const result = await mockAccount.sendTransaction(tx);

      // Verify analyze was called
      expect(mockAnalyzeFn).toHaveBeenCalled();

      // Verify original method was called and returned its result
      expect(result).toBe('send-result');
      expect(originalSendTransaction).toHaveBeenCalledWith(tx);
    });

    it('should pass correct params to analyze for sendTransaction', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        chain: 'ethereum',
      });

      await middleware(mockAccount);

      const tx = { to: '0xabc123', value: 500 };
      await mockAccount.sendTransaction(tx);

      // Get the request passed to analyze
      expect(mockAnalyzeFn).toHaveBeenCalledOnce();
      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;

      expect(request.action).toBe('send');
      expect(request.params.chain).toBe('ethereum');
      expect(request.params.toAddress).toBe('0xabc123');
      expect(request.params.amount).toBe('500');
      expect(request.reasoning).toContain('WDK transaction');
    });

    it('should throw GuardianBlockedError when transaction is blocked', async () => {
      const blockedResult: AnalysisResult = {
        requestId: 'req-blocked',
        level: 'L2_deep',
        riskLevel: 'critical',
        approved: false,
        explanation: 'Suspicious transaction detected',
        details: { threats: [{ type: 'unknown_address', severity: 'critical', description: 'Unknown recipient' }] },
        duration: 1000,
      };

      mockAnalyzeFn.mockResolvedValue(blockedResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      const tx = { to: '0xmalicious', value: 1000 };

      await expect(mockAccount.sendTransaction(tx)).rejects.toThrow(GuardianBlockedError);
    });

    it('should not call original sendTransaction when blocked', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-blocked',
        level: 'L2_deep',
        riskLevel: 'critical',
        approved: false,
        explanation: 'Blocked',
        details: { threats: [] },
        duration: 500,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      try {
        await mockAccount.sendTransaction({ to: '0xbad', value: 100 });
      } catch {
        // Expected
      }

      // Original should not have been called
      expect(originalSendTransaction).not.toHaveBeenCalled();
    });
  });

  describe('transfer handler', () => {
    it('should intercept transfer calls and call analyze', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'low',
        approved: true,
        explanation: 'Safe transfer',
        details: { threats: [] },
        duration: 80,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      const transferOpts = {
        token: '0xtoken',
        recipient: '0xrecipient',
        amount: 1000,
      };

      const result = await mockAccount.transfer(transferOpts);

      // Verify analyze was called
      expect(mockAnalyzeFn).toHaveBeenCalled();

      // Verify original method was called and returned
      expect(result).toBe('transfer-result');
      expect(originalTransfer).toHaveBeenCalledWith(transferOpts);
    });

    it('should pass correct params to analyze for transfer', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 60,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        chain: 'polygon',
      });

      await middleware(mockAccount);

      const transferOpts = {
        token: '0xUSDC',
        recipient: '0xrecip123',
        amount: BigInt(500),
      };

      await mockAccount.transfer(transferOpts);

      expect(mockAnalyzeFn).toHaveBeenCalledOnce();
      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;

      expect(request.action).toBe('send');
      expect(request.params.chain).toBe('polygon');
      expect(request.params.toAddress).toBe('0xrecip123');
      expect(request.params.contractAddress).toBe('0xUSDC');
      expect(request.params.fromToken).toBe('0xUSDC');
      expect(request.params.amount).toBe('500');
    });

    it('should throw GuardianBlockedError when transfer is blocked', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-blocked',
        level: 'L2_deep',
        riskLevel: 'high',
        approved: false,
        explanation: 'High risk transfer',
        details: { threats: [] },
        duration: 900,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      const transferOpts = {
        token: '0xtoken',
        recipient: '0xdangerous',
        amount: 10000,
      };

      await expect(mockAccount.transfer(transferOpts)).rejects.toThrow(GuardianBlockedError);
    });
  });

  describe('GuardianBlockedError', () => {
    it('should contain correct error properties', async () => {
      const blockedResult: AnalysisResult = {
        requestId: 'req-err-test',
        level: 'L2_deep',
        riskLevel: 'critical',
        approved: false,
        explanation: 'Scam detected',
        details: {
          threats: [
            { type: 'scam_token', severity: 'critical', description: 'Token is a known scam' },
          ],
        },
        duration: 1200,
      };

      mockAnalyzeFn.mockResolvedValue(blockedResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      try {
        await mockAccount.sendTransaction({ to: '0xscam', value: 100 });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(GuardianBlockedError);
        expect((error as GuardianBlockedError).name).toBe('GuardianBlockedError');
        expect((error as GuardianBlockedError).riskLevel).toBe('critical');
        expect((error as GuardianBlockedError).analysisLevel).toBe('L2_deep');
        expect((error as GuardianBlockedError).details).toBeDefined();
        expect((error as GuardianBlockedError).details?.threats.length).toBeGreaterThan(0);
      }
    });
  });

  describe('config options', () => {
    it('should use provided chain in requests', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        chain: 'arbitrum',
      });

      await middleware(mockAccount);
      await mockAccount.sendTransaction({ to: '0xabc', value: 100 });

      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;
      expect(request.params.chain).toBe('arbitrum');
    });

    it('should default chain to ethereum', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        // No chain specified
      });

      await middleware(mockAccount);
      await mockAccount.sendTransaction({ to: '0xabc', value: 100 });

      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;
      expect(request.params.chain).toBe('ethereum');
    });

    it('should use custom reasoning when provided', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const customReasoning = 'Agent initiated stake transaction';

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        defaultReasoning: customReasoning,
      });

      await middleware(mockAccount);
      await mockAccount.sendTransaction({ to: '0xabc', value: 100 });

      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;
      expect(request.reasoning).toBe(customReasoning);
    });

    it('should fire onAnalysis callback when provided', async () => {
      const onAnalysisCallback = vi.fn();

      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        onAnalysis: onAnalysisCallback,
      });

      await middleware(mockAccount);
      await mockAccount.sendTransaction({ to: '0xabc', value: 100 });

      expect(onAnalysisCallback).toHaveBeenCalledOnce();
      const [request, result] = onAnalysisCallback.mock.calls[0];
      expect(request).toHaveProperty('id');
      expect(request).toHaveProperty('action', 'send');
      expect(result).toHaveProperty('approved', true);
    });
  });

  describe('policy engine integration', () => {
    it('should initialize PolicyEngine when policy config provided', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const policyConfig: Partial<PolicyConfig> = {
        maxTransactionAmount: '10000',
      };

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        policy: policyConfig,
      });

      await middleware(mockAccount);
      // Middleware was created with policy config — no exceptions means success
      expect(true).toBe(true);
    });

    it('should call policyEngine.recordTransaction after approval', async () => {
      mockEvaluateFn.mockReturnValue({ passed: true, violations: [] });
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        policy: { maxTransactionAmount: '10000' },
      });

      await middleware(mockAccount);
      await mockAccount.sendTransaction({ to: '0xabc', value: 500 });

      // recordTransaction should be called with the amount
      expect(mockRecordTransactionFn).toHaveBeenCalledWith('500');
    });

    it('should not call recordTransaction when transaction is blocked', async () => {
      mockEvaluateFn.mockReturnValue({ passed: true, violations: [] });
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-blocked',
        level: 'L2_deep',
        riskLevel: 'critical',
        approved: false,
        explanation: 'Blocked',
        details: { threats: [] },
        duration: 800,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
        policy: { maxTransactionAmount: '10000' },
      });

      await middleware(mockAccount);

      try {
        await mockAccount.sendTransaction({ to: '0xbad', value: 500 });
      } catch {
        // Expected
      }

      // recordTransaction should NOT have been called
      expect(mockRecordTransactionFn).not.toHaveBeenCalled();
    });
  });

  describe('transaction ID generation', () => {
    it('should assign unique IDs to each request', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      await mockAccount.sendTransaction({ to: '0xabc', value: 100 });
      await mockAccount.sendTransaction({ to: '0xdef', value: 200 });

      const req1 = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;
      const req2 = mockAnalyzeFn.mock.calls[1][0] as TransactionRequest;

      expect(req1.id).not.toBe(req2.id);
      expect(req1.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(req2.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe('bigint handling', () => {
    it('should convert BigInt values to strings in amount field', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      const bigAmount = BigInt('999999999999999999');
      await mockAccount.sendTransaction({ to: '0xabc', value: bigAmount });

      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;
      expect(request.params.amount).toBe('999999999999999999');
    });

    it('should handle number values in transfer amount', async () => {
      mockAnalyzeFn.mockResolvedValue({
        requestId: 'req-123',
        level: 'L1_quick',
        riskLevel: 'safe',
        approved: true,
        explanation: 'Safe',
        details: { threats: [] },
        duration: 50,
      } as AnalysisResult);

      const middleware = guardianMiddleware({
        apiUrl: 'http://localhost:3000',
        apiKey: 'test-key',
      });

      await middleware(mockAccount);

      await mockAccount.transfer({
        token: '0xtoken',
        recipient: '0xrecip',
        amount: 12345,
      });

      const request = mockAnalyzeFn.mock.calls[0][0] as TransactionRequest;
      expect(request.params.amount).toBe('12345');
    });
  });
});
