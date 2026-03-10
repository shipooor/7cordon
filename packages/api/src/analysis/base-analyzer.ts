/**
 * BaseLLMAnalyzer — Shared logic for L1 and L2 Claude-based analysis.
 *
 * Eliminates duplication between Level1Analyzer and Level2Analyzer.
 * Subclasses only need to provide configuration via abstract properties.
 */

import Anthropic from '@anthropic-ai/sdk';
import { validateAIResponse } from './validate.js';

import type { TransactionRequest, AnalysisResult, AnalysisLevel, GoPlusData, ProtocolData, ThreatInfo, RiskLevel } from '@saaafe/shared';
import type { PromptPair } from '../prompts/sanitize.js';

export interface AnalyzerConfig {
  model: string;
  maxTokens: number;
  level: AnalysisLevel;
  timeoutMs: number;
  /** Risk level returned when the LLM call fails. */
  failureRiskLevel: RiskLevel;
}

export abstract class BaseLLMAnalyzer {
  constructor(
    protected readonly client: Anthropic,
    protected readonly config: AnalyzerConfig,
  ) {}

  /** Build the prompt pair for this analysis level. */
  protected abstract buildPrompt(
    request: TransactionRequest,
    goplusData?: GoPlusData | null,
    trustScore?: number,
    protocolData?: ProtocolData | null,
    contractSource?: string | null,
  ): PromptPair;

  async analyze(
    request: TransactionRequest,
    goplusData?: GoPlusData | null,
    trustScore?: number,
    protocolData?: ProtocolData | null,
    contractSource?: string | null,
  ): Promise<AnalysisResult> {
    const startTime = Date.now();
    const { system, user } = this.buildPrompt(request, goplusData, trustScore, protocolData, contractSource);
    const label = this.config.level === 'L1_quick' ? 'L1' : 'L2';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

      let response: Anthropic.Message;
      try {
        response = await this.client.messages.create(
          {
            model: this.config.model,
            max_tokens: this.config.maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
          },
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timeout);
      }

      const duration = Date.now() - startTime;
      const { input_tokens, output_tokens } = response.usage;
      console.log(`[${label}] Tokens: ${input_tokens} in / ${output_tokens} out (model: ${this.config.model})`);

      // Parse AI response
      const textBlock = response.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      // Strip markdown code fences if present (some providers wrap JSON in ```json ... ```)
      let jsonText = textBlock.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }

      const raw = JSON.parse(jsonText);
      const parsed = validateAIResponse(raw);

      if (!parsed) {
        throw new Error('Invalid AI response structure');
      }

      return {
        requestId: request.id,
        level: this.config.level,
        riskLevel: parsed.riskLevel as RiskLevel,
        approved: parsed.approved,
        explanation: parsed.explanation,
        details: {
          goplus: goplusData ?? undefined,
          aiReasoning: parsed.explanation,
          threats: parsed.threats as ThreatInfo[],
        },
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`[${label}] Analysis timed out after ${duration}ms`);
      }

      const message = error instanceof Error ? error.message : `${label} analysis failed`;
      console.error(`[${label}] Error: ${message}`);

      return {
        requestId: request.id,
        level: this.config.level,
        riskLevel: this.config.failureRiskLevel,
        approved: false,
        explanation: `${label} analysis could not be completed. ${
          this.config.failureRiskLevel === 'medium'
            ? 'Escalating to L2 for safety.'
            : 'Transaction blocked for safety.'
        }`,
        details: {
          goplus: goplusData ?? undefined,
          threats: [],
        },
        duration,
      };
    }
  }
}
