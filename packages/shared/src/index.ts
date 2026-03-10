// Types
export type {
  TransactionAction,
  Chain,
  TransactionParams,
  TransactionRequest,
  TransactionResult,
} from './types/transaction.js';

export type {
  RiskLevel,
  AnalysisLevel,
  AnalysisResult,
  AnalysisDetails,
  GoPlusData,
  ProtocolData,
  ThreatInfo,
  ThreatType,
} from './types/analysis.js';

export type {
  PolicyConfig,
  PolicyResult,
  PolicyViolation,
} from './types/policy.js';
// DEFAULT_POLICY is exported from constants.ts via the wildcard below

export type {
  AuditEntry,
  AuditLog,
  AuditStats,
} from './types/audit.js';

export type {
  TrustScore,
  TrustLevel,
  TrustStats,
} from './types/trust.js';

export type {
  ChallengeRequest,
  ChallengeResponse,
  VerifyRequest,
  VerifyResponse,
} from './types/auth.js';

// Constants
export * from './constants.js';

// Trust score formula (shared between SDK and API)
export { calculateTrustScore } from './trust-formula.js';
