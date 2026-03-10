export interface TrustScore {
  score: number;
  level: TrustLevel;
  stats: TrustStats;
}

export type TrustLevel = 'untrusted' | 'cautious' | 'moderate' | 'trusted' | 'veteran';

export interface TrustStats {
  totalTransactions: number;
  approvedCount: number;
  blockedCount: number;
  blockedRatio: number;
  totalVolume: string;
  /** Active time in seconds (from first to last transaction). */
  activeTime: number;
  highestApprovedAmount: string;
  consecutiveApproved: number;
}
