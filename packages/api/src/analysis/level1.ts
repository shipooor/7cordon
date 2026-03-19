import type Anthropic from '@anthropic-ai/sdk';
import { buildL1Prompt } from '../prompts/level1.js';
import { ANALYSIS_TIMEOUT } from '@7cordon/shared';
import { BaseLLMAnalyzer } from './base-analyzer.js';

import type { TransactionRequest, GoPlusData, ProtocolData } from '@7cordon/shared';
import type { PromptPair } from '../prompts/sanitize.js';

const DEFAULT_L1_MODEL = 'claude-haiku-4-5-20251001';

/**
 * L1 Quick Analysis using Claude Haiku.
 * Fast first-pass risk assessment (~2-5 seconds).
 * On failure, returns 'medium' risk to trigger L2 escalation.
 */
export class Level1Analyzer extends BaseLLMAnalyzer {
  constructor(client: Anthropic) {
    super(client, {
      model: process.env.CORDON7_L1_MODEL || DEFAULT_L1_MODEL,
      maxTokens: 1024,
      level: 'L1_quick',
      timeoutMs: ANALYSIS_TIMEOUT.L1_MAX_MS,
      failureRiskLevel: 'medium',
    });
  }

  protected buildPrompt(
    request: TransactionRequest,
    goplusData?: GoPlusData | null,
    trustScore?: number,
    protocolData?: ProtocolData | null,
  ): PromptPair {
    return buildL1Prompt(request, goplusData, trustScore, protocolData);
  }
}
