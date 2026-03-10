export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export type AnalysisLevel = 'L0_policy' | 'L1_quick' | 'L2_deep';

export interface AnalysisResult {
  requestId: string;
  level: AnalysisLevel;
  riskLevel: RiskLevel;
  approved: boolean;
  explanation: string;
  details: AnalysisDetails;
  duration: number;
}

export interface AnalysisDetails {
  goplus?: GoPlusData;
  protocol?: ProtocolData;
  aiReasoning?: string;
  threats: ThreatInfo[];
}

export interface GoPlusData {
  isHoneypot: boolean;
  isOpenSource: boolean;
  holderCount: number;
  lpAmount: string;
  isMintable: boolean;
  isProxy: boolean;
  maliciousAddress: boolean;
}

export interface ProtocolData {
  name: string;
  tvl: number;
  category: string;
  chains: string[];
}

export interface ThreatInfo {
  type: ThreatType;
  severity: RiskLevel;
  description: string;
}

export type ThreatType =
  | 'scam_token'
  | 'malicious_contract'
  | 'unknown_address'
  | 'reasoning_mismatch'
  | 'overspending'
  | 'unaudited_protocol'
  | 'honeypot'
  | 'unlimited_approval'
  | 'rate_limit_exceeded';
