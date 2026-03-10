import type { RiskLevel, AnalysisLevel } from './analysis.js';

export type TransactionAction =
  | 'send'
  | 'swap'
  | 'approve'
  | 'lend'
  | 'withdraw'
  | 'bridge';

export type Chain =
  | 'ethereum'
  | 'arbitrum'
  | 'polygon'
  | 'bsc'
  | 'base'
  | 'optimism'
  | 'avalanche'
  | 'sepolia';

export interface TransactionParams {
  chain: Chain;
  fromToken?: string;
  toToken?: string;
  toAddress?: string;
  amount: string;
  protocol?: string;
  contractAddress?: string;
  data?: string;
}

export interface TransactionRequest {
  id: string;
  action: TransactionAction;
  params: TransactionParams;
  reasoning: string;
  timestamp: number;
}

export interface TransactionResult {
  requestId: string;
  status: 'approved' | 'blocked' | 'pending_approval';
  riskLevel: RiskLevel;
  explanation: string;
  analysisLevel: AnalysisLevel;
  txHash?: string;
  feePaid: string;
  duration: number;
  timestamp: number;
}
