import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RiskAnalyzer } from './analyzer.js';
import { Level1Analyzer } from './level1.js';
import { Level2Analyzer } from './level2.js';
import * as goplus from '../data/goplus.js';
import * as defillama from '../data/defillama.js';
import * as arbiscan from '../data/arbiscan.js';
import type { TransactionRequest, AnalysisResult, RiskLevel } from '@saaafe/shared';

// Mock dependencies
vi.mock('../data/goplus.js');
vi.mock('../data/defillama.js');
vi.mock('../data/arbiscan.js');
vi.mock('@anthropic-ai/sdk');

describe('RiskAnalyzer', () => {
  let analyzer: RiskAnalyzer;
  let mockL1Result: AnalysisResult;
  let mockL2Result: AnalysisResult;

  const createMockRequest = (overrides?: Partial<TransactionRequest>): TransactionRequest => ({
    id: '550e8400-e29b-41d4-a716-446655440000',
    action: 'swap',
    params: {
      chain: 'ethereum',
      amount: '100',
      contractAddress: '0x1234567890123456789012345678901234567890',
      toAddress: '0x0987654321098765432109876543210987654321',
      protocol: 'uniswap',
    },
    timestamp: Date.now(),
    ...overrides,
  });

  const createMockAnalysisResult = (
    overrides?: Partial<AnalysisResult>,
  ): AnalysisResult => ({
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    level: 'L1_quick',
    riskLevel: 'low',
    approved: true,
    explanation: 'Transaction appears safe',
    details: {
      threats: [],
    },
    duration: 1000,
    ...overrides,
  });

  beforeEach(() => {
    analyzer = new RiskAnalyzer();

    // Default mock responses
    mockL1Result = createMockAnalysisResult({
      level: 'L1_quick',
      riskLevel: 'low',
      approved: true,
    });

    mockL2Result = createMockAnalysisResult({
      level: 'L2_deep',
      riskLevel: 'medium',
      approved: false,
    });

    // Mock external data sources
    vi.mocked(goplus.getTokenSecurity).mockResolvedValue(null);
    vi.mocked(goplus.getAddressSecurity).mockResolvedValue(null);
    vi.mocked(defillama.getProtocolData).mockResolvedValue(null);
    vi.mocked(arbiscan.getContractSource).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('analyze', () => {
    it('should return L1 result when risk is low and amount is below threshold', async () => {
      // Arrange
      const request = createMockRequest({ params: { ...createMockRequest().params, amount: '50' } });
      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(mockL1Result),
        } as any,
        l2: {} as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result.level).toBe('L1_quick');
      expect(result.riskLevel).toBe('low');
      expect(result.approved).toBe(true);
    });

    it('should escalate to L2 when L1 risk is medium', async () => {
      // Arrange
      const request = createMockRequest();
      const l1WithMediumRisk = createMockAnalysisResult({
        level: 'L1_quick',
        riskLevel: 'medium',
        approved: false,
        duration: 1000,
      });

      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(l1WithMediumRisk),
        } as any,
        l2: {
          analyze: vi.fn().mockResolvedValue(mockL2Result),
        } as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result.level).toBe('L2_deep');
      expect(result.riskLevel).toBe('medium');
    });

    it('should escalate to L2 when L1 risk is high', async () => {
      // Arrange
      const request = createMockRequest();
      const l1WithHighRisk = createMockAnalysisResult({
        level: 'L1_quick',
        riskLevel: 'high',
        approved: false,
        duration: 1000,
      });

      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(l1WithHighRisk),
        } as any,
        l2: {
          analyze: vi.fn().mockResolvedValue(mockL2Result),
        } as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result.level).toBe('L2_deep');
    });

    it('should escalate to L2 when amount exceeds manual approval threshold', async () => {
      // Arrange
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '600' }, // Exceeds threshold of 500
      });

      const l1WithLowRisk = createMockAnalysisResult({
        level: 'L1_quick',
        riskLevel: 'low',
        approved: true,
        duration: 1000,
      });

      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(l1WithLowRisk),
        } as any,
        l2: {
          analyze: vi.fn().mockResolvedValue(mockL2Result),
        } as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result.level).toBe('L2_deep');
    });

    it('should not escalate when amount equals threshold (boundary)', async () => {
      // Arrange
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '500' }, // Exactly at threshold
      });

      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(mockL1Result),
        } as any,
        l2: {} as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result.level).toBe('L1_quick');
    });

    it('should combine L1 and L2 durations', async () => {
      // Arrange
      const request = createMockRequest();
      const l1 = createMockAnalysisResult({
        level: 'L1_quick',
        riskLevel: 'medium',
        duration: 1500,
      });

      const l2 = createMockAnalysisResult({
        level: 'L2_deep',
        riskLevel: 'high',
        duration: 2500,
      });

      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: { analyze: vi.fn().mockResolvedValue(l1) } as any,
        l2: { analyze: vi.fn().mockResolvedValue(l2) } as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result.duration).toBe(4000); // 1500 + 2500
      expect(result.level).toBe('L2_deep');
    });

    it('should fetch GoPlus data for both token and address', async () => {
      // Arrange
      const request = createMockRequest();
      const mockGoPlusData = {
        isHoneypot: false,
        isOpenSource: true,
        holderCount: 100,
        lpAmount: '1000',
        isMintable: false,
        isProxy: false,
        maliciousAddress: false,
      };

      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(mockGoPlusData);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue({ maliciousAddress: false });

      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(mockL1Result),
        } as any,
        l2: {} as any,
      });

      // Act
      await analyzer.analyze(request);

      // Assert
      expect(goplus.getTokenSecurity).toHaveBeenCalledWith(
        'ethereum',
        '0x1234567890123456789012345678901234567890',
      );
      expect(goplus.getAddressSecurity).toHaveBeenCalledWith(
        '0x0987654321098765432109876543210987654321',
      );
    });

    it('should handle GoPlus fetch failure gracefully', async () => {
      // Arrange
      const request = createMockRequest();
      vi.mocked(goplus.getTokenSecurity).mockRejectedValue(new Error('Network error'));
      vi.mocked(goplus.getAddressSecurity).mockRejectedValue(new Error('Network error'));

      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: {
          analyze: vi.fn().mockResolvedValue(mockL1Result),
        } as any,
        l2: {} as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result).toBeDefined();
      expect(result.level).toBe('L1_quick');
      // Analysis should complete even if GoPlus fails
    });

    it('should fetch contract source only on L2 escalation', async () => {
      // Arrange
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '600' },
      });

      const l1 = createMockAnalysisResult({
        level: 'L1_quick',
        riskLevel: 'low',
        duration: 1000,
      });

      const l2 = createMockAnalysisResult({
        level: 'L2_deep',
        riskLevel: 'medium',
        duration: 2000,
      });

      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: { analyze: vi.fn().mockResolvedValue(l1) } as any,
        l2: { analyze: vi.fn().mockResolvedValue(l2) } as any,
      });

      // Act
      await analyzer.analyze(request);

      // Assert
      expect(arbiscan.getContractSource).toHaveBeenCalledWith(
        '0x1234567890123456789012345678901234567890',
        'ethereum',
      );
    });

    it('should not fetch contract source on non-escalation', async () => {
      // Arrange
      const request = createMockRequest();
      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: { analyze: vi.fn().mockResolvedValue(mockL1Result) } as any,
        l2: {} as any,
      });

      // Act
      await analyzer.analyze(request);

      // Assert
      expect(arbiscan.getContractSource).not.toHaveBeenCalled();
    });

    it('should pass trust score to L1 analyzer', async () => {
      // Arrange
      const request = createMockRequest();
      const trustScore = 75;
      const l1Spy = vi.fn().mockResolvedValue(mockL1Result);

      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: { analyze: l1Spy } as any,
        l2: {} as any,
      });

      // Act
      await analyzer.analyze(request, trustScore);

      // Assert
      // Check that trustScore is passed as 3rd argument
      const calls = l1Spy.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toEqual(request);
      expect(calls[0][2]).toBe(trustScore);
    });
  });

  describe('shouldEscalateToL2', () => {
    it('should escalate for low risk and normal amount (false)', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '100' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(false);
    });

    it('should escalate for safe risk and normal amount (false)', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'safe',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '100' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(false);
    });

    it('should escalate for medium risk', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'medium',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '100' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(true);
    });

    it('should escalate for high risk', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'high',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '100' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(true);
    });

    it('should escalate for critical risk', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'critical',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '100' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(true);
    });

    it('should escalate when amount exceeds threshold regardless of risk level', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '600' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(true);
    });

    it('should not escalate when amount equals threshold', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '500' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(false);
    });

    it('should handle non-numeric amount gracefully', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: 'invalid' as any },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(false);
    });

    it('should handle missing amount gracefully', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: undefined as any },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(false);
    });

    it('should escalate for large decimal amounts', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '1000.5' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(true);
    });
  });

  describe('fetchGoPlusData', () => {
    it('should return token data when available', async () => {
      // Arrange
      const request = createMockRequest();
      const mockTokenData = {
        isHoneypot: false,
        isOpenSource: true,
        holderCount: 100,
        lpAmount: '1000',
        isMintable: false,
        isProxy: false,
        maliciousAddress: false,
      };

      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(mockTokenData);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue(null);

      // Act
      const result = (await (analyzer as any).fetchGoPlusData(request)) as any;

      // Assert
      expect(result).toEqual(mockTokenData);
    });

    it('should merge token and address data', async () => {
      // Arrange
      const request = createMockRequest();
      const mockTokenData = {
        isHoneypot: false,
        isOpenSource: true,
        holderCount: 100,
        lpAmount: '1000',
        isMintable: false,
        isProxy: false,
        maliciousAddress: false,
      };

      const mockAddressData = {
        maliciousAddress: true,
      };

      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(mockTokenData);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue(mockAddressData);

      // Act
      const result = (await (analyzer as any).fetchGoPlusData(request)) as any;

      // Assert
      expect(result.maliciousAddress).toBe(true);
    });

    it('should return address data when token data is unavailable', async () => {
      // Arrange
      const request = createMockRequest();
      const mockAddressData = {
        maliciousAddress: true,
      };

      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(null);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue(mockAddressData);

      // Act
      const result = (await (analyzer as any).fetchGoPlusData(request)) as any;

      // Assert
      expect(result.maliciousAddress).toBe(true);
      expect(result.isHoneypot).toBe(false);
    });

    it('should return null when no data is available', async () => {
      // Arrange
      const request = createMockRequest();
      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(null);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue(null);

      // Act
      const result = await (analyzer as any).fetchGoPlusData(request);

      // Assert
      expect(result).toBeNull();
    });

    it('should handle errors and return null', async () => {
      // Arrange
      const request = createMockRequest();
      vi.mocked(goplus.getTokenSecurity).mockRejectedValue(new Error('API error'));
      vi.mocked(goplus.getAddressSecurity).mockRejectedValue(new Error('API error'));

      // Act
      const result = await (analyzer as any).fetchGoPlusData(request);

      // Assert
      expect(result).toBeNull();
    });

    it('should skip fetches when contractAddress is missing', async () => {
      // Arrange
      const request = createMockRequest({
        params: { ...createMockRequest().params, contractAddress: undefined as any },
      });

      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(null);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue(null);

      // Act
      await (analyzer as any).fetchGoPlusData(request);

      // Assert
      expect(goplus.getTokenSecurity).not.toHaveBeenCalled();
    });

    it('should skip address fetch when toAddress is missing', async () => {
      // Arrange
      const request = createMockRequest({
        params: { ...createMockRequest().params, toAddress: undefined as any },
      });

      const mockTokenData = {
        isHoneypot: false,
        isOpenSource: true,
        holderCount: 100,
        lpAmount: '1000',
        isMintable: false,
        isProxy: false,
        maliciousAddress: false,
      };

      vi.mocked(goplus.getTokenSecurity).mockResolvedValue(mockTokenData);
      vi.mocked(goplus.getAddressSecurity).mockResolvedValue(null);

      // Act
      await (analyzer as any).fetchGoPlusData(request);

      // Assert
      expect(goplus.getAddressSecurity).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle request with no protocol specified', async () => {
      // Arrange
      const request = createMockRequest({
        params: { ...createMockRequest().params, protocol: undefined as any },
      });

      vi.spyOn(analyzer as any, 'shouldEscalateToL2').mockReturnValue(false);
      vi.spyOn(analyzer as any, 'getAnalyzers').mockReturnValue({
        l1: { analyze: vi.fn().mockResolvedValue(mockL1Result) } as any,
        l2: {} as any,
      });

      // Act
      const result = await analyzer.analyze(request);

      // Assert
      expect(result).toBeDefined();
      expect(defillama.getProtocolData).not.toHaveBeenCalled();
    });

    it('should handle very large amount correctly', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '999999999' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(true);
    });

    it('should handle zero amount correctly', () => {
      // Arrange
      const l1Result = createMockAnalysisResult({
        riskLevel: 'low',
      });
      const request = createMockRequest({
        params: { ...createMockRequest().params, amount: '0' },
      });

      // Act
      const shouldEscalate = (analyzer as any).shouldEscalateToL2(l1Result, request);

      // Assert
      expect(shouldEscalate).toBe(false);
    });
  });
});
