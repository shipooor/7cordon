/**
 * TrustScorer — Progressive agent trust score
 *
 * Computes stats from audit log, delegates formula to @saaafe/shared.
 * Higher score = more autonomy (higher limits, fewer manual approvals).
 */

import type { TrustScore, TrustStats, AuditEntry } from '@saaafe/shared';
import { calculateTrustScore } from '@saaafe/shared';

export class TrustScorer {
  /** Calculate trust score from audit entries. */
  calculate(entries: AuditEntry[]): TrustScore {
    const stats = this.computeStats(entries);
    return calculateTrustScore(stats);
  }

  private computeStats(entries: AuditEntry[]): TrustStats {
    const approved = entries.filter((e) => e.finalStatus === 'approved');
    const blocked = entries.filter((e) => e.finalStatus === 'blocked');

    const totalVolume = approved.reduce((sum, e) => {
      const amt = Number(e.params.amount || '0');
      return sum + (Number.isFinite(amt) ? amt : 0);
    }, 0);

    const highestAmount = approved.reduce((max, e) => {
      const amt = Number(e.params.amount || '0');
      return Number.isFinite(amt) ? Math.max(max, amt) : max;
    }, 0);

    // Calculate consecutive approved streak (from most recent)
    let streak = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].finalStatus === 'approved') {
        streak++;
      } else {
        break;
      }
    }

    // Active time: first tx to last tx
    const timestamps = entries.map((e) => e.timestamp).sort((a, b) => a - b);
    const activeTime = timestamps.length > 1
      ? (timestamps[timestamps.length - 1] - timestamps[0]) / 1000
      : 0;

    return {
      totalTransactions: entries.length,
      approvedCount: approved.length,
      blockedCount: blocked.length,
      blockedRatio: entries.length > 0 ? blocked.length / entries.length : 0,
      totalVolume: totalVolume.toFixed(2),
      activeTime,
      highestApprovedAmount: highestAmount.toFixed(2),
      consecutiveApproved: streak,
    };
  }
}
