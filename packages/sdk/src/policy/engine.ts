/**
 * PolicyEngine — Local rule evaluation (Level 0).
 *
 * Pure logic, no I/O, no network. Instant.
 * Checks hard rules before any AI analysis runs.
 * Budget tracking persists via audit log replay on construction.
 */

import type {
  PolicyConfig,
  PolicyResult,
  PolicyViolation,
  TransactionRequest,
  AuditEntry,
} from '@saaafe/shared';
import { DEFAULT_POLICY } from '@saaafe/shared';
import {
  checkAmount,
  checkBudget,
  checkWhitelist,
  checkBlacklist,
  checkRateLimit,
  checkAllowedAction,
} from './rules.js';

export class PolicyEngine {
  private config: PolicyConfig;
  private recentTimestamps: number[] = [];
  private spendLog: Array<{ amount: number; timestamp: number }> = [];

  /** Get total spend within the last 24 hours. */
  get dailySpend(): number {
    return this.getSpendSince(24 * 60 * 60 * 1000);
  }

  /** Get total spend within the last 7 days. */
  get weeklySpend(): number {
    return this.getSpendSince(7 * 24 * 60 * 60 * 1000);
  }

  /** Get total spend within a time window. */
  private getSpendSince(sinceMs: number): number {
    const cutoff = Date.now() - sinceMs;
    return this.spendLog
      .filter(e => e.timestamp > cutoff)
      .reduce((sum, e) => sum + e.amount, 0);
  }

  constructor(config?: Partial<PolicyConfig>) {
    this.config = deepMergePolicy(DEFAULT_POLICY, config);
  }

  /** Evaluate a transaction request against all policy rules. */
  evaluate(request: TransactionRequest): PolicyResult {
    const violations: PolicyViolation[] = [];

    // Check allowed action
    const actionResult = checkAllowedAction(request.action, this.config.allowedActions);
    if (actionResult) violations.push(actionResult);

    // Check max transaction amount (also validates amount format)
    const amountResult = checkAmount(request.params.amount, this.config.maxTransactionAmount);
    if (amountResult) violations.push(amountResult);

    // Check daily budget
    const dailyResult = checkBudget(
      request.params.amount,
      this.dailySpend,
      this.config.dailyBudget,
      'daily'
    );
    if (dailyResult) violations.push(dailyResult);

    // Check weekly budget
    const weeklyResult = checkBudget(
      request.params.amount,
      this.weeklySpend,
      this.config.weeklyBudget,
      'weekly'
    );
    if (weeklyResult) violations.push(weeklyResult);

    // Check rate limit (uses server time, not client timestamp)
    const rateResult = checkRateLimit(
      this.recentTimestamps,
      this.config.rateLimit,
    );
    if (rateResult) violations.push(rateResult);

    // Check blacklist (destination address)
    if (request.params.toAddress) {
      const blacklistResult = checkBlacklist(
        request.params.toAddress,
        this.config.blacklist.addresses
      );
      if (blacklistResult) violations.push(blacklistResult);
    }

    // Check whitelist (protocol)
    if (request.params.protocol) {
      const whitelistResult = checkWhitelist(
        request.params.protocol,
        this.config.whitelist.protocols,
        'protocol'
      );
      if (whitelistResult) violations.push(whitelistResult);
    }

    // Check whitelist (fromToken)
    if (request.params.fromToken) {
      const fromResult = checkWhitelist(
        request.params.fromToken,
        this.config.whitelist.tokens,
        'token'
      );
      if (fromResult) violations.push(fromResult);
    }

    // Check whitelist (toToken) — prevents swaps into scam tokens
    if (request.params.toToken) {
      const toResult = checkWhitelist(
        request.params.toToken,
        this.config.whitelist.tokens,
        'token'
      );
      if (toResult) violations.push(toResult);
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }

  /**
   * Record a transaction for budget/rate tracking.
   * Call after a transaction is approved and executed.
   * Uses server time for rate limiting.
   */
  recordTransaction(amount: string): void {
    const now = Date.now();
    const amountNum = Number(amount);
    if (Number.isFinite(amountNum) && amountNum > 0) {
      this.spendLog.push({ amount: amountNum, timestamp: now });
    }

    this.recentTimestamps.push(now);

    // Keep only last minute of timestamps for rate limiting
    const oneMinAgo = now - 60_000;
    this.recentTimestamps = this.recentTimestamps.filter((t) => t > oneMinAgo);

    // Prune spend entries older than the weekly window to prevent unbounded growth
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    if (this.spendLog.length > 0 && this.spendLog[0].timestamp < weekAgo) {
      this.spendLog = this.spendLog.filter((e) => e.timestamp > weekAgo);
    }
  }

  /**
   * Restore budget state from audit log entries.
   * Call on startup to prevent budget bypass via process restart.
   */
  restoreFromAuditLog(entries: AuditEntry[]): void {
    const now = Date.now();
    const weekStart = now - 7 * 24 * 60 * 60 * 1000;

    // Only keep entries within the weekly window (daily is a subset)
    this.spendLog = [];

    for (const entry of entries) {
      if (entry.finalStatus !== 'approved') continue;
      const amount = Number(entry.params.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      if (entry.timestamp > weekStart) {
        this.spendLog.push({ amount, timestamp: entry.timestamp });
      }
    }
  }

  /** Get a copy of the current policy config. */
  getConfig(): PolicyConfig {
    return structuredClone(this.config);
  }

  /**
   * Update policy config with deep merge.
   * Nested objects (whitelist, blacklist) are merged, not replaced.
   */
  updateConfig(updates: Partial<PolicyConfig>): void {
    this.config = deepMergePolicy(this.config, updates);
  }

  getBudgetStatus() {
    return {
      dailySpent: this.dailySpend,
      weeklySpent: this.weeklySpend,
      dailyLimit: Number(this.config.dailyBudget),
      weeklyLimit: Number(this.config.weeklyBudget),
    };
  }
}

/** Deep merge policy config, concatenating and deduplicating whitelist/blacklist arrays. */
function deepMergePolicy(base: PolicyConfig, overrides?: Partial<PolicyConfig>): PolicyConfig {
  if (!overrides) return { ...base };

  const merged = {
    ...base,
    ...overrides,
    whitelist: {
      addresses: [...new Set([...base.whitelist.addresses, ...(overrides.whitelist?.addresses ?? [])])],
      tokens: [...new Set([...base.whitelist.tokens, ...(overrides.whitelist?.tokens ?? [])])],
      protocols: [...new Set([...base.whitelist.protocols, ...(overrides.whitelist?.protocols ?? [])])],
    },
    blacklist: {
      addresses: [...new Set([...base.blacklist.addresses, ...(overrides.blacklist?.addresses ?? [])])],
    },
  };

  return merged;
}
