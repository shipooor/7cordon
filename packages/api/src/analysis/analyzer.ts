import Anthropic from '@anthropic-ai/sdk';
import { Level1Analyzer } from './level1.js';
import { Level2Analyzer } from './level2.js';
import { getTokenSecurity, getAddressSecurity } from '../data/goplus.js';
import { getProtocolData } from '../data/defillama.js';
import { getContractSource } from '../data/arbiscan.js';
import { RISK_THRESHOLDS, DEFAULT_POLICY } from '@saaafe/shared';

import type { TransactionRequest, AnalysisResult, GoPlusData, ProtocolData, RiskLevel } from '@saaafe/shared';

const RISK_SEVERITY: Record<RiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Orchestrates the multi-level analysis pipeline.
 * L1 (Haiku) → conditional escalation → L2 (Opus).
 */
export class RiskAnalyzer {
  private l1: Level1Analyzer | null = null;
  private l2: Level2Analyzer | null = null;

  /**
   * Lazily creates the Anthropic client and analyzers.
   * This avoids reading process.env at import time (before dotenv loads).
   */
  private getAnalyzers(): { l1: Level1Analyzer; l2: Level2Analyzer } {
    if (!this.l1 || !this.l2) {
      const client = new Anthropic({
        ...(process.env.ANTHROPIC_BASE_URL && { baseURL: process.env.ANTHROPIC_BASE_URL }),
      });
      this.l1 = new Level1Analyzer(client);
      this.l2 = new Level2Analyzer(client);
    }
    return { l1: this.l1, l2: this.l2 };
  }

  async analyze(
    request: TransactionRequest,
    trustScore?: number,
  ): Promise<AnalysisResult> {
    // Step 1: Fetch on-chain data in parallel (non-blocking)
    const [goplusData, protocolData] = await Promise.all([
      this.fetchGoPlusData(request),
      request.params.protocol ? getProtocolData(request.params.protocol) : Promise.resolve(null),
    ]);

    const { l1, l2 } = this.getAnalyzers();

    // Step 2: Run L1 quick analysis
    console.log(`[Analyzer] Running L1 analysis for ${request.id}`);
    const l1Result = await l1.analyze(request, goplusData, trustScore, protocolData);
    console.log(`[Analyzer] L1 result: ${l1Result.riskLevel} (${l1Result.duration}ms)`);

    // Step 3: Decide whether to escalate to L2
    const shouldEscalate = this.shouldEscalateToL2(l1Result, request);

    if (!shouldEscalate) {
      return l1Result;
    }

    // Step 4: Fetch contract source for deep analysis (only on escalation)
    const contractSource = request.params.contractAddress
      ? await getContractSource(request.params.contractAddress, request.params.chain)
      : null;

    // Step 5: Run L2 deep analysis with all available data
    console.log(`[Analyzer] Escalating to L2 for ${request.id}`);
    const l2Result = await l2.analyze(request, goplusData, trustScore, protocolData, contractSource);
    console.log(`[Analyzer] L2 result: ${l2Result.riskLevel} (${l2Result.duration}ms)`);

    // Total duration includes both L1 and L2
    return { ...l2Result, duration: l2Result.duration + l1Result.duration };
  }

  /**
   * Determines if a transaction should be escalated from L1 to L2.
   */
  private shouldEscalateToL2(
    l1Result: AnalysisResult,
    request: TransactionRequest,
  ): boolean {
    const l1Severity = RISK_SEVERITY[l1Result.riskLevel];
    const escalateThreshold = RISK_SEVERITY[RISK_THRESHOLDS.L1_ESCALATE_TO_L2];

    // Escalate if L1 risk >= medium
    if (l1Severity >= escalateThreshold) {
      console.log(`[Analyzer] Escalating: L1 risk ${l1Result.riskLevel} >= ${RISK_THRESHOLDS.L1_ESCALATE_TO_L2}`);
      return true;
    }

    // Escalate if amount exceeds manual approval threshold
    const amount = Number(request.params.amount);
    const threshold = Number(DEFAULT_POLICY.manualApproveThreshold);
    if (Number.isFinite(amount) && Number.isFinite(threshold) && amount > threshold) {
      console.log(`[Analyzer] Escalating: amount ${amount} > threshold ${threshold}`);
      return true;
    }

    return false;
  }

  /**
   * Fetches GoPlus security data for the transaction.
   * Runs token and address checks in parallel.
   * Never fails — returns best-effort data or null.
   */
  private async fetchGoPlusData(request: TransactionRequest): Promise<GoPlusData | null> {
    const { chain, contractAddress, toAddress } = request.params;

    try {
      const [tokenData, addressData] = await Promise.all([
        contractAddress ? getTokenSecurity(chain, contractAddress) : Promise.resolve(null),
        toAddress ? getAddressSecurity(toAddress) : Promise.resolve(null),
      ]);

      // Merge token and address data
      if (tokenData) {
        if (addressData) {
          tokenData.maliciousAddress = addressData.maliciousAddress;
        }
        return tokenData;
      }

      // If we only have address data, return partial GoPlusData
      if (addressData) {
        return {
          isHoneypot: false,
          isOpenSource: false,
          holderCount: 0,
          lpAmount: '0',
          isMintable: false,
          isProxy: false,
          maliciousAddress: addressData.maliciousAddress,
        };
      }

      return null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[Analyzer] GoPlus fetch failed: ${msg}`);
      return null;
    }
  }
}
