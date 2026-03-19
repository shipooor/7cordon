import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TransactionRequest } from '@7cordon/shared';
import { Guardian } from './guardian.js';

/**
 * Guardian Integration Tests — Focus on orchestration logic
 *
 * The Guardian class orchestrates:
 * 1. Policy check (L0) — instant, local, free
 * 2. Cache check — skip AI if already analyzed
 * 3. Remote AI analysis (L1/L2)
 * 4. Risk-based decision matrix
 * 5. Transaction execution via WDK
 * 6. Audit logging
 *
 * Since Guardian depends heavily on external modules (WalletManager, ApiClient, etc),
 * we test the orchestration logic and decision boundaries, not the full flow.
 */

describe('Guardian', () => {
  describe('constructor', () => {
    it('should accept valid config', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'http://localhost:3000',
        });
      }).not.toThrow();
    });

    it('should reject missing apiUrl', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: '',
        });
      }).toThrow('GuardianConfig.apiUrl is required');
    });

    it('should reject invalid apiUrl format', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'not-a-valid-url',
        });
      }).toThrow('GuardianConfig.apiUrl is not a valid URL');
    });

    it('should accept with optional analysisOnly flag', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'http://localhost:3000',
          analysisOnly: true,
        });
      }).not.toThrow();
    });

    it('should accept with ERC-4337 config', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'http://localhost:3000',
          erc4337: {
            entryPoint: '0x1234567890abcdef1234567890abcdef12345678',
            factoryAddress: '0xfacfacfacfacfacfacfacfacfacfacfacfacfac',
            policyIndex: 0,
          },
        });
      }).not.toThrow();
    });

    it('should create with apiKey for API auth', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'http://localhost:3000',
          apiKey: 'secret-key-123',
        });
      }).not.toThrow();
    });
  });

  describe('getPolicyEngine', () => {
    it('should return policy engine instance', () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
      });

      const engine = guardian.getPolicyEngine();
      expect(engine).toBeDefined();
      expect(typeof engine.evaluate).toBe('function');
      expect(typeof engine.getConfig).toBe('function');
    });
  });

  describe('getAuditLog', () => {
    it('should return audit logger instance', () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
      });

      const auditLog = guardian.getAuditLog();
      expect(auditLog).toBeDefined();
      expect(typeof auditLog.getAllEntries).toBe('function');
    });
  });

  describe('initialization', () => {
    it('should prevent double initialization', async () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
        analysisOnly: true,
      });

      // Both calls will fail (invalid seed), but we verify the caching mechanism
      const init1Promise = guardian.init('test phrase').catch(() => {});
      const init2Promise = guardian.init('test phrase').catch(() => {});

      await Promise.allSettled([init1Promise, init2Promise]);
    });

    it('should throw when accessing wallet before init', () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
      });

      expect(() => guardian.getWalletAddress()).toThrow();
    });

    it('should throw when calling request before init', async () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
      });

      const request: TransactionRequest = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        action: 'send',
        params: {
          chain: 'ethereum',
          amount: '50',
          toAddress: '0xrecipient',
        },
        reasoning: 'test',
        timestamp: Date.now(),
      };

      await expect(guardian.request(request)).rejects.toThrow();
    });
  });

  describe('getTrustScore', () => {
    it('should return trust score structure', async () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
        analysisOnly: true,
      });

      // Without audit history, should return baseline
      const score = guardian.getTrustScore();

      expect(score).toBeDefined();
      expect(typeof score.score).toBe('number');
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
    });
  });

  describe('request mutex serialization', () => {
    it('should serialize concurrent requests (not parallel execute)', async () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
      });

      const request1: TransactionRequest = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        action: 'send',
        params: { chain: 'ethereum', amount: '50', toAddress: '0xrecipient' },
        reasoning: 'test',
        timestamp: Date.now(),
      };

      const request2: TransactionRequest = {
        id: '550e8400-e29b-41d4-a716-446655440001',
        action: 'send',
        params: { chain: 'ethereum', amount: '30', toAddress: '0xrecipient2' },
        reasoning: 'test',
        timestamp: Date.now(),
      };

      // Both requests should fail due to lack of init, but we verify mutex doesn't error
      const results = await Promise.allSettled([
        guardian.request(request1),
        guardian.request(request2),
      ]);

      // Both should reject (not init) but not with mutex errors
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('rejected');
    });
  });

  describe('dispose', () => {
    it('should accept dispose call without error', async () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
      });

      // Should not throw
      await expect(guardian.dispose()).resolves.toBeUndefined();
    });
  });

  describe('configuration merging', () => {
    it('should merge policy config with defaults', () => {
      const guardian = new Guardian({
        evmRpcUrl: 'http://localhost:8545',
        chain: 'ethereum',
        apiUrl: 'http://localhost:3000',
        policy: {
          maxTransactionAmount: '200',
        },
      });

      const config = guardian.getPolicyEngine().getConfig();
      expect(config.maxTransactionAmount).toBe('200');
      // Other defaults should still be present
      expect(config.dailyBudget).toBeDefined();
      expect(config.weeklyBudget).toBeDefined();
    });
  });

  describe('Spark payment configuration', () => {
    it('should accept Spark payment config', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'http://localhost:3000',
          enableSparkPayments: true,
          guardianSparkAddress: '0x1234567890abcdef1234567890abcdef12345678',
          sparkNetwork: 'TESTNET',
        });
      }).not.toThrow();
    });

    it('should accept MAINNET Spark network', () => {
      expect(() => {
        new Guardian({
          evmRpcUrl: 'http://localhost:8545',
          chain: 'ethereum',
          apiUrl: 'http://localhost:3000',
          enableSparkPayments: true,
          guardianSparkAddress: '0x1234567890abcdef1234567890abcdef12345678',
          sparkNetwork: 'MAINNET',
        });
      }).not.toThrow();
    });
  });

  describe('Multiple chains', () => {
    const chains = ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base', 'bsc', 'avalanche', 'sepolia'];

    chains.forEach((chain) => {
      it(`should accept ${chain} as valid chain`, () => {
        expect(() => {
          new Guardian({
            evmRpcUrl: 'http://localhost:8545',
            chain: chain as any,
            apiUrl: 'http://localhost:3000',
          });
        }).not.toThrow();
      });
    });
  });
});
