/**
 * Shared trust score formula — single source of truth.
 * Used by both SDK TrustScorer and API ServerState.
 *
 * Weights: 40% approval ratio, 25% volume, 20% time, 15% streak
 */

import type { TrustScore, TrustLevel, TrustStats } from './types/trust.js';
import { TRUST_LEVELS } from './constants.js';

/**
 * Calculate trust score from pre-computed stats.
 * Pure function — no side effects, no I/O.
 */
export function calculateTrustScore(stats: TrustStats): TrustScore {
  if (stats.totalTransactions === 0) {
    return { score: 0, level: 'untrusted', stats };
  }

  // Approval ratio score (0-100)
  const approvalScore = (1 - stats.blockedRatio) * 100;

  // Volume score (log scale, 0-100): $0=0, $10=25, $100=50, $1000=75, $10000=100
  const volume = Number(stats.totalVolume);
  const volumeScore = Number.isFinite(volume) && volume > 0
    ? Math.min(100, (Math.log10(volume) / 4) * 100)
    : 0;

  // Time score (log scale, 0-100): 0s=0, ~31h=50, ~1000h=100
  const hours = stats.activeTime / 3600;
  const timeScore = hours > 0
    ? Math.min(100, (Math.log10(hours + 1) / 3) * 100)
    : 0;

  // Streak score (0-100): 0=0, 5=25, 10=50, 20=75, 50=100
  const streakScore = Math.min(100, (stats.consecutiveApproved / 50) * 100);

  // Weighted total
  const score = Math.max(0, Math.min(100, Math.round(
    approvalScore * 0.4 +
    volumeScore * 0.25 +
    timeScore * 0.2 +
    streakScore * 0.15,
  )));

  const level = scoreToLevel(score);
  return { score, level, stats };
}

function scoreToLevel(score: number): TrustLevel {
  for (const [level, range] of Object.entries(TRUST_LEVELS)) {
    if (score >= range.min && score <= range.max) {
      return level as TrustLevel;
    }
  }
  return 'untrusted';
}
