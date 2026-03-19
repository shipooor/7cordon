/**
 * Individual policy rules — pure functions.
 *
 * Each returns a PolicyViolation if the rule fails, or null if passed.
 * All amount comparisons use string-to-number conversion with NaN/negative guards.
 */

import type { PolicyViolation, TransactionAction } from '@7cordon/shared';

/**
 * Parse a string amount into a validated number.
 * Returns null if the amount is invalid (NaN, negative, empty).
 * Rejects hex (0x...) and scientific notation (1e3) to prevent type coercion bugs.
 */
function parseAmount(amount: string): number | null {
  if (!amount || amount.trim() === '') return null;
  // Reject hex notation (0x...) and scientific notation (1e3) — only allow decimal numbers
  if (/^0x/i.test(amount) || /[eE]/.test(amount)) return null;
  const num = Number(amount);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

/** Check that the transaction amount is a valid number and within the max limit. */
export function checkAmount(
  amount: string,
  maxAmount: string
): PolicyViolation | null {
  const amountNum = parseAmount(amount);
  if (amountNum === null) {
    return {
      rule: 'invalid_amount',
      message: `Invalid transaction amount: "${amount}"`,
      value: amount,
      limit: maxAmount,
    };
  }

  const maxNum = parseAmount(maxAmount);
  if (maxNum !== null && amountNum > maxNum) {
    return {
      rule: 'max_transaction_amount',
      message: `Transaction amount $${amount} exceeds maximum $${maxAmount}`,
      value: amount,
      limit: maxAmount,
    };
  }
  return null;
}

/** Check that the transaction would not exceed the budget for the given period. */
export function checkBudget(
  amount: string,
  currentSpend: number,
  budget: string,
  period: 'daily' | 'weekly'
): PolicyViolation | null {
  const amountNum = parseAmount(amount);
  if (amountNum === null) return null; // Invalid amount caught by checkAmount

  const budgetNum = parseAmount(budget);
  if (budgetNum === null) return null;

  const newTotal = currentSpend + amountNum;

  if (newTotal > budgetNum) {
    return {
      rule: `${period}_budget`,
      message: `This transaction would exceed ${period} budget: $${newTotal.toFixed(2)} > $${budget}`,
      value: newTotal.toFixed(2),
      limit: budget,
    };
  }
  return null;
}

/** Check that the value is in the whitelist. Empty whitelist = allow all. */
export function checkWhitelist(
  value: string,
  whitelist: string[],
  type: 'protocol' | 'token' | 'address'
): PolicyViolation | null {
  if (whitelist.length === 0) return null;

  const normalized = value.toLowerCase();
  const isWhitelisted = whitelist.some((w) => w.toLowerCase() === normalized);

  if (!isWhitelisted) {
    return {
      rule: `${type}_whitelist`,
      message: `${type} "${value}" is not in the whitelist`,
      value: value,
      limit: whitelist.join(', '),
    };
  }
  return null;
}

/** Check that the address is not blacklisted. */
export function checkBlacklist(
  address: string,
  blacklist: string[]
): PolicyViolation | null {
  const normalized = address.toLowerCase();
  const isBlacklisted = blacklist.some((b) => b.toLowerCase() === normalized);

  if (isBlacklisted) {
    return {
      rule: 'address_blacklist',
      message: `Address ${address} is blacklisted`,
      value: address,
      limit: 'blacklisted',
    };
  }
  return null;
}

/** Check that the request does not exceed the per-minute rate limit. Uses server time, not client timestamp. */
export function checkRateLimit(
  recentTimestamps: number[],
  maxPerMinute: number,
): PolicyViolation | null {
  const now = Date.now();
  const oneMinAgo = now - 60_000;
  const recentCount = recentTimestamps.filter((t) => t > oneMinAgo).length;

  if (recentCount >= maxPerMinute) {
    return {
      rule: 'rate_limit',
      message: `Rate limit exceeded: ${recentCount} transactions in the last minute (max: ${maxPerMinute})`,
      value: recentCount.toString(),
      limit: maxPerMinute.toString(),
    };
  }
  return null;
}

/** Check that the action type is allowed by policy. */
export function checkAllowedAction(
  action: TransactionAction,
  allowedActions: TransactionAction[]
): PolicyViolation | null {
  if (!allowedActions.includes(action)) {
    return {
      rule: 'allowed_action',
      message: `Action "${action}" is not allowed. Allowed: ${allowedActions.join(', ')}`,
      value: action,
      limit: allowedActions.join(', '),
    };
  }
  return null;
}
