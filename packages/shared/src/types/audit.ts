import type { TransactionAction, TransactionParams } from './transaction.js';
import type { RiskLevel, AnalysisResult } from './analysis.js';
import type { PolicyResult } from './policy.js';

export interface AuditEntry {
  id: string;
  requestId: string;
  timestamp: number;
  action: TransactionAction;
  params: TransactionParams;
  agentReasoning: string;
  policyResult: PolicyResult;
  analysisResult?: AnalysisResult;
  finalStatus: 'approved' | 'blocked' | 'pending_approval';
  riskLevel: RiskLevel;
  explanation: string;
  txHash?: string;
  feePaid: string;
}

export interface AuditLog {
  entries: AuditEntry[];
  stats: AuditStats;
}

export interface AuditStats {
  totalRequests: number;
  approved: number;
  blocked: number;
  pending: number;
  totalFeesPaid: string;
  averageAnalysisTime: number;
}
