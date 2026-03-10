import type { AnalysisResult } from '@saaafe/shared';

export class GuardianBlockedError extends Error {
  public readonly riskLevel: string;
  public readonly analysisLevel: string;
  public readonly details?: AnalysisResult['details'];

  constructor(explanation: string, analysis: AnalysisResult) {
    super(`[saaafe] Transaction blocked: ${explanation}`);
    this.name = 'GuardianBlockedError';
    this.riskLevel = analysis.riskLevel;
    this.analysisLevel = analysis.level;
    this.details = analysis.details;
  }
}
