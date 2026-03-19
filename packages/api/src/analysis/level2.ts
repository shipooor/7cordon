import type Anthropic from '@anthropic-ai/sdk';
import { buildL2Prompt } from '../prompts/level2.js';
import { ANALYSIS_TIMEOUT } from '@7cordon/shared';
import { BaseLLMAnalyzer } from './base-analyzer.js';

import type { TransactionRequest, GoPlusData, ProtocolData } from '@7cordon/shared';
import type { PromptPair } from '../prompts/sanitize.js';

const DEFAULT_L2_MODEL = 'claude-opus-4-6';

/**
 * L2 Deep Analysis using Claude Opus.
 * Thorough risk assessment for flagged transactions (~10-20 seconds).
 * On failure, returns 'high' risk to block the transaction.
 */
export class Level2Analyzer extends BaseLLMAnalyzer {
  constructor(client: Anthropic) {
    super(client, {
      model: process.env.CORDON7_L2_MODEL || DEFAULT_L2_MODEL,
      maxTokens: 2048,
      level: 'L2_deep',
      timeoutMs: ANALYSIS_TIMEOUT.L2_MAX_MS,
      failureRiskLevel: 'high',
    });
  }

  protected buildPrompt(
    request: TransactionRequest,
    goplusData?: GoPlusData | null,
    trustScore?: number,
    protocolData?: ProtocolData | null,
    contractSource?: string | null,
  ): PromptPair {
    return buildL2Prompt(request, goplusData, trustScore, protocolData, contractSource);
  }
}
