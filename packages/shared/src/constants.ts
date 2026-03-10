import type { PolicyConfig } from './types/policy.js';
import type { TransactionAction, Chain } from './types/transaction.js';

/** Runtime arrays derived from union types — single source of truth for validation. */
export const VALID_ACTIONS: TransactionAction[] = ['send', 'swap', 'approve', 'lend', 'withdraw', 'bridge'];
export const VALID_CHAINS: Chain[] = [
  'ethereum', 'arbitrum', 'polygon', 'bsc', 'base', 'optimism', 'avalanche', 'sepolia',
];

/** Valid risk levels for AI response validation. */
export const VALID_RISK_LEVELS = ['safe', 'low', 'medium', 'high', 'critical'] as const;

/** UUID v4 regex for request ID validation. */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valid threat types for AI response validation. */
export const VALID_THREAT_TYPES = [
  'scam_token', 'malicious_contract', 'unknown_address', 'reasoning_mismatch',
  'overspending', 'unaudited_protocol', 'honeypot', 'unlimited_approval', 'rate_limit_exceeded',
] as const;

// Default policy configuration
export const DEFAULT_POLICY: PolicyConfig = {
  maxTransactionAmount: '100',
  dailyBudget: '500',
  weeklyBudget: '2000',
  rateLimit: 5,
  allowedActions: ['send', 'swap', 'lend', 'withdraw', 'approve', 'bridge'],
  whitelist: {
    addresses: [],
    protocols: ['aave', 'compound', 'uniswap'],
    tokens: ['USDT', 'ETH', 'WBTC', 'WETH', 'ARB', 'USDC'],
  },
  blacklist: {
    addresses: [],
  },
  autoApproveThreshold: '10',
  manualApproveThreshold: '500',
};

// Risk thresholds
export const RISK_THRESHOLDS = {
  L1_ESCALATE_TO_L2: 'medium' as const,
  AUTO_BLOCK: 'critical' as const,
  AUTO_APPROVE_MAX_RISK: 'low' as const,
};

// Spark streaming payments
export const SPARK_FEE_PER_SECOND = '0.001'; // $0.001 USDT/sec
export const SPARK_PAYMENT_INTERVAL_MS = 1000;

// Cache TTLs (ms)
export const CACHE_TTL = {
  TOKEN_ANALYSIS: 24 * 60 * 60 * 1000,    // 24h
  PROTOCOL_INFO: 30 * 24 * 60 * 60 * 1000, // 30d
  ADDRESS_CHECK: 7 * 24 * 60 * 60 * 1000,  // 7d
};

// Analysis timeouts
export const ANALYSIS_TIMEOUT = {
  L1_MAX_MS: 10_000,  // 10s
  L2_MAX_MS: 30_000,  // 30s
};

// Trust score thresholds
export const TRUST_LEVELS = {
  untrusted: { min: 0, max: 20 },
  cautious: { min: 21, max: 40 },
  moderate: { min: 41, max: 60 },
  trusted: { min: 61, max: 80 },
  veteran: { min: 81, max: 100 },
} as const;

// Known contract addresses (Arbitrum)
export const ARBITRUM_CONTRACTS = {
  USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  ARB: '0x912CE59144191C1204E64559FE8253a0e49E6548',
  AAVE_POOL: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

// Sepolia contracts (for testing)
export const SEPOLIA_CONTRACTS = {
  USDT: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
};

// Auth constants
export const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const AUTH_JWT_EXPIRY = '24h';
