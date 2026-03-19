/**
 * Dashboard API client.
 * Fetches data from the 7cordon API server's /dashboard/* endpoints.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const FETCH_TIMEOUT_MS = 8_000;

async function apiFetch<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Dashboard GET endpoints are public (read-only). No API key needed.
    const res = await fetch(`${API_URL}${path}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
    }

    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface DashboardStats {
  totalRequests: number;
  approved: number;
  blocked: number;
  pending: number;
  totalFeesPaid: string;
  averageAnalysisTime: number;
}

export interface DashboardEntry {
  requestId: string;
  timestamp: number;
  action: string;
  amount: string;
  chain: string;
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  finalStatus: 'approved' | 'blocked' | 'pending_approval';
  level: 'L0_policy' | 'L1_quick' | 'L2_deep';
  explanation: string;
  duration: number;
  protocol?: string;
  fromToken?: string;
  toToken?: string;
}

export interface DashboardTrust {
  score: number;
  level: 'untrusted' | 'cautious' | 'moderate' | 'trusted' | 'veteran';
  stats: {
    totalTransactions: number;
    approvedCount: number;
    blockedCount: number;
    blockedRatio: number;
    totalVolume: string;
    activeTime: number;
    highestApprovedAmount: string;
    consecutiveApproved: number;
  };
}

export interface DashboardPolicy {
  config: {
    maxTransactionAmount: string;
    dailyBudget: string;
    weeklyBudget: string;
    rateLimit: number;
    allowedActions: string[];
    whitelist: { addresses: string[]; protocols: string[]; tokens: string[] };
    blacklist: { addresses: string[] };
    autoApproveThreshold: string;
    manualApproveThreshold: string;
  };
  budget: {
    dailySpent: number;
    weeklySpent: number;
  };
}

export interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
}

export const api = {
  getStats: () => apiFetch<DashboardStats>('/dashboard/stats'),
  getEntries: (limit = 50, offset = 0) =>
    apiFetch<{ entries: DashboardEntry[]; total: number }>(`/dashboard/entries?limit=${limit}&offset=${offset}`),
  getTrust: () => apiFetch<DashboardTrust>('/dashboard/trust'),
  getPolicy: () => apiFetch<DashboardPolicy>('/dashboard/policy'),
  getHealth: () => apiFetch<HealthStatus>('/health'),
};
