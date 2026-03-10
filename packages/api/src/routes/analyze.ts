import { Router } from 'express';
import { RiskAnalyzer } from '../analysis/analyzer.js';
import { VALID_ACTIONS, VALID_CHAINS, UUID_REGEX } from '@saaafe/shared';
import { serverState } from '../state.js';

import type { TransactionRequest } from '@saaafe/shared';

export const analyzeRouter = Router();

const analyzer = new RiskAnalyzer();

analyzeRouter.post('/', async (req, res) => {
  try {
    const { request, trustScore } = req.body as {
      request: TransactionRequest;
      trustScore?: number;
    };

    // Input validation
    if (!request?.id || typeof request.id !== 'string' || !UUID_REGEX.test(request.id)) {
      res.status(400).json({ error: 'Missing or invalid request.id (expected UUID)' });
      return;
    }
    if (!request?.action || !VALID_ACTIONS.includes(request.action)) {
      res.status(400).json({ error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
      return;
    }
    if (!request?.params || typeof request.params !== 'object') {
      res.status(400).json({ error: 'Missing request.params' });
      return;
    }
    if (!request.params.amount || typeof request.params.amount !== 'string' || !/^\d+(\.\d+)?$/.test(request.params.amount)) {
      res.status(400).json({ error: 'Missing or invalid request.params.amount (expected numeric string, e.g. "10.5")' });
      return;
    }
    if (!request.params.chain || !VALID_CHAINS.includes(request.params.chain)) {
      res.status(400).json({ error: `Invalid chain. Must be one of: ${VALID_CHAINS.join(', ')}` });
      return;
    }
    if (trustScore !== undefined && (typeof trustScore !== 'number' || trustScore < 0 || trustScore > 100)) {
      res.status(400).json({ error: 'trustScore must be a number between 0 and 100' });
      return;
    }

    // Ensure reasoning is a string
    request.reasoning = typeof request.reasoning === 'string' ? request.reasoning : '';

    console.log(`[Analyze] Request ${request.id}: ${request.action} ${request.params.amount} on ${request.params.chain}`);

    const result = await analyzer.analyze(request, trustScore);

    console.log(`[Analyze] Result ${request.id}: ${result.riskLevel} (${result.level}) — ${result.approved ? 'APPROVED' : 'BLOCKED'}`);

    // Record for dashboard
    serverState.record(request, result);

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Analyze] Error: ${message}`);
    res.status(500).json({
      error: 'Analysis failed',
      ...(process.env.NODE_ENV === 'development' && { message }),
    });
  }
});
