import type { TransactionAction } from './transaction.js';

export interface PolicyConfig {
  maxTransactionAmount: string;
  dailyBudget: string;
  weeklyBudget: string;
  rateLimit: number;
  allowedActions: TransactionAction[];
  whitelist: {
    addresses: string[];
    protocols: string[];
    tokens: string[];
  };
  blacklist: {
    addresses: string[];
  };
  autoApproveThreshold: string;
  manualApproveThreshold: string;
}

export interface PolicyResult {
  passed: boolean;
  violations: PolicyViolation[];
}

export interface PolicyViolation {
  rule: string;
  message: string;
  value: string;
  limit: string;
}
