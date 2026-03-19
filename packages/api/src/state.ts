/**
 * Server-side state singleton.
 * Tracks analysis history for the dashboard endpoints.
 * Independent of the SDK's client-side audit log.
 */

import type {
  AnalysisResult,
  TransactionRequest,
  AuditStats,
  RiskLevel,
  TrustScore,
  PolicyConfig,
} from '@7cordon/shared';
import { DEFAULT_POLICY, calculateTrustScore } from '@7cordon/shared';

type FinalStatus = 'approved' | 'blocked' | 'pending_approval';

interface ServerAuditEntry {
  requestId: string;
  timestamp: number;
  action: string;
  amount: string;
  chain: string;
  riskLevel: RiskLevel;
  finalStatus: FinalStatus;
  level: string;
  explanation: string;
  duration: number;
  protocol?: string;
  fromToken?: string;
  toToken?: string;
  toAddress?: string;
  agentReasoning?: string;
}

/** Maximum entries kept in memory. */
const MAX_ENTRIES = 500;

class ServerState {
  private entries: ServerAuditEntry[] = [];
  /** Index for O(1) lookup by requestId in reportResult. */
  private entryIndex = new Map<string, number>();
  private startTime = Date.now();

  /**
   * Record a completed analysis for the dashboard (called from /analyze).
   * Note: only maps to approved/blocked here. The SDK's reportResult() will
   * overwrite with the final status (which may include pending_approval)
   * after the full Guardian pipeline runs.
   */
  record(request: TransactionRequest, result: AnalysisResult): void {
    const idx = this.entries.length;
    this.entries.push({
      requestId: request.id,
      timestamp: Date.now(),
      action: request.action,
      amount: request.params.amount,
      chain: request.params.chain,
      riskLevel: result.riskLevel,
      finalStatus: result.approved ? 'approved' : 'blocked',
      level: result.level,
      explanation: result.explanation,
      duration: result.duration,
      protocol: request.params.protocol,
      fromToken: request.params.fromToken,
      toToken: request.params.toToken,
      toAddress: request.params.toAddress,
      agentReasoning: request.reasoning
        ? request.reasoning.replace(/[\u0000-\u001F\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '').slice(0, 1000)
        : undefined,
    });
    this.entryIndex.set(request.id, idx);

    this.pruneEntries();
  }

  /**
   * Report the final Guardian decision (called from SDK after full pipeline).
   * Overwrites the analysis-only entry if one exists, or creates a new one
   * (for L0 policy blocks that never reached the API).
   */
  reportResult(report: {
    requestId: string;
    finalStatus: FinalStatus;
    riskLevel: RiskLevel;
    level: string;
    explanation: string;
    duration: number;
    action: string;
    amount: string;
    chain: string;
    protocol?: string;
    fromToken?: string;
    toToken?: string;
    toAddress?: string;
    agentReasoning?: string;
  }): void {
    // Try to update existing entry (from /analyze) — O(1) via index
    const existingIdx = this.entryIndex.get(report.requestId);
    if (existingIdx !== undefined && existingIdx < this.entries.length) {
      const existing = this.entries[existingIdx];
      if (existing.requestId === report.requestId) {
        existing.finalStatus = report.finalStatus;
        existing.riskLevel = report.riskLevel;
        existing.explanation = report.explanation;
        existing.duration = report.duration;
        existing.level = report.level;
        return;
      }
    }

    // New entry (L0 policy blocks never hit /analyze)
    const idx = this.entries.length;
    this.entries.push({
      requestId: report.requestId,
      timestamp: Date.now(),
      action: report.action,
      amount: report.amount,
      chain: report.chain,
      riskLevel: report.riskLevel,
      finalStatus: report.finalStatus,
      level: report.level,
      explanation: report.explanation,
      duration: report.duration,
      protocol: report.protocol,
      fromToken: report.fromToken,
      toToken: report.toToken,
      toAddress: report.toAddress,
      agentReasoning: report.agentReasoning,
    });
    this.entryIndex.set(report.requestId, idx);

    this.pruneEntries();
  }

  private pruneEntries(): void {
    // Evict oldest entries to prevent memory growth
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
      // Rebuild index after pruning
      this.entryIndex.clear();
      this.entries.forEach((e, i) => this.entryIndex.set(e.requestId, i));
    }
  }

  /** Get paginated entries, newest first. Strips sensitive fields for public GET. */
  getEntries(limit = 50, offset = 0): Omit<ServerAuditEntry, 'toAddress' | 'agentReasoning'>[] {
    const reversed = [...this.entries].reverse();
    return reversed.slice(offset, offset + limit).map(({ toAddress, agentReasoning, ...rest }) => rest);
  }

  /** Get total entry count. */
  getTotal(): number {
    return this.entries.length;
  }

  /** Compute aggregate stats. */
  getStats(): AuditStats {
    const total = this.entries.length;
    const approved = this.entries.filter(e => e.finalStatus === 'approved').length;
    const blocked = this.entries.filter(e => e.finalStatus === 'blocked').length;
    const pending = this.entries.filter(e => e.finalStatus === 'pending_approval').length;
    const durations = this.entries.map(e => e.duration);
    const avgDuration = total > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / total)
      : 0;

    return {
      totalRequests: total,
      approved,
      blocked,
      pending,
      totalFeesPaid: '0', // Server-side does not track Spark fees (SDK-only)
      averageAnalysisTime: avgDuration,
    };
  }

  /** Compute trust score from server-side history using shared formula. */
  getTrustScore(): TrustScore {
    const total = this.entries.length;
    const approved = this.entries.filter(e => e.finalStatus === 'approved');
    const blocked = this.entries.filter(e => e.finalStatus === 'blocked');

    const totalVolume = approved.reduce((sum, e) => {
      const amt = Number(e.amount);
      return sum + (Number.isFinite(amt) ? amt : 0);
    }, 0);

    const maxAmount = approved.reduce((max, e) => {
      const amt = Number(e.amount);
      return Number.isFinite(amt) ? Math.max(max, amt) : max;
    }, 0);

    let streak = 0;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].finalStatus === 'approved') streak++;
      else break;
    }

    // Use span between first and last entry (consistent with SDK), fallback to uptime
    const activeTimeMs = this.entries.length >= 2
      ? this.entries[this.entries.length - 1].timestamp - this.entries[0].timestamp
      : Date.now() - this.startTime;

    return calculateTrustScore({
      totalTransactions: total,
      approvedCount: approved.length,
      blockedCount: blocked.length,
      blockedRatio: total > 0 ? blocked.length / total : 0,
      totalVolume: totalVolume.toFixed(2),
      activeTime: Math.round(activeTimeMs / 1000),
      highestApprovedAmount: maxAmount.toFixed(2),
      consecutiveApproved: streak,
    });
  }

  /** Get current policy config and budget status. */
  getPolicy(): { config: PolicyConfig; budget: { dailySpent: number; weeklySpent: number } } {
    // Server-side uses default policy (SDK can have custom config)
    return {
      config: DEFAULT_POLICY,
      budget: {
        dailySpent: this.getSpendSince(24 * 60 * 60 * 1000),
        weeklySpent: this.getSpendSince(7 * 24 * 60 * 60 * 1000),
      },
    };
  }

  private getSpendSince(ms: number): number {
    const cutoff = Date.now() - ms;
    return this.entries
      .filter(e => e.finalStatus === 'approved' && e.timestamp > cutoff)
      .reduce((sum, e) => { const amt = Number(e.amount); return sum + (Number.isFinite(amt) && amt > 0 ? amt : 0); }, 0);
  }

}

/** Singleton instance — used by both analyze and dashboard routes. */
export const serverState = new ServerState();
