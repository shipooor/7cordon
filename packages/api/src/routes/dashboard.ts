import { Router } from 'express';
import { VALID_ACTIONS, VALID_CHAINS, VALID_RISK_LEVELS, UUID_REGEX } from '@saaafe/shared';
import { authMiddleware } from '../middleware/auth.js';
import { jwtAuthMiddleware } from '../middleware/jwt.js';
import { serverState } from '../state.js';

export const dashboardRouter = Router();

// NOTE: GET endpoints are intentionally public (no auth) so the browser-based
// dashboard can fetch data without embedding API keys. This is acceptable for
// a single-tenant demo. In production, add auth or restrict via network rules.

/** GET /dashboard/stats — aggregated audit statistics. */
dashboardRouter.get('/stats', (_req, res) => {
  res.json(serverState.getStats());
});

/** GET /dashboard/entries — paginated audit entries, newest first. */
dashboardRouter.get('/entries', (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  res.json({
    entries: serverState.getEntries(limit, offset),
    total: serverState.getTotal(),
    limit,
    offset,
  });
});

/** GET /dashboard/trust — current trust score and breakdown. */
dashboardRouter.get('/trust', (_req, res) => {
  res.json(serverState.getTrustScore());
});

/** GET /dashboard/policy — active policy config and budget status. */
dashboardRouter.get('/policy', (_req, res) => {
  res.json(serverState.getPolicy());
});

const VALID_STATUSES = ['approved', 'blocked', 'pending_approval'] as const;
const VALID_LEVELS = ['L0_policy', 'L1_quick', 'L2_deep'] as const;
/**
 * POST /dashboard/report — SDK reports the final Guardian decision.
 * Covers all transactions including L0 policy blocks that never reach /analyze.
 */
dashboardRouter.post('/report', jwtAuthMiddleware, authMiddleware, (req, res) => {
  const r = req.body;

  if (!r?.requestId || typeof r.requestId !== 'string' || !UUID_REGEX.test(r.requestId)) {
    res.status(400).json({ error: 'Invalid requestId' });
    return;
  }
  if (!VALID_STATUSES.includes(r.finalStatus)) {
    res.status(400).json({ error: 'Invalid finalStatus' });
    return;
  }
  if (!VALID_ACTIONS.includes(r.action)) {
    res.status(400).json({ error: 'Invalid action' });
    return;
  }
  if (!VALID_CHAINS.includes(r.chain)) {
    res.status(400).json({ error: 'Invalid chain' });
    return;
  }
  if (r.riskLevel && !VALID_RISK_LEVELS.includes(r.riskLevel)) {
    res.status(400).json({ error: 'Invalid riskLevel' });
    return;
  }
  if (typeof r.amount === 'string' && !/^\d+(\.\d+)?$/.test(r.amount)) {
    res.status(400).json({ error: 'Invalid amount format' });
    return;
  }

  serverState.reportResult({
    requestId: r.requestId,
    finalStatus: r.finalStatus,
    riskLevel: r.riskLevel || 'safe',
    level: VALID_LEVELS.includes(r.level) ? r.level : 'L0_policy',
    explanation: typeof r.explanation === 'string' ? r.explanation.slice(0, 2000) : '',
    duration: typeof r.duration === 'number' ? r.duration : 0,
    action: r.action,
    amount: typeof r.amount === 'string' ? r.amount : '0',
    chain: r.chain,
    protocol: typeof r.protocol === 'string' ? r.protocol.slice(0, 100) : undefined,
    fromToken: typeof r.fromToken === 'string' ? r.fromToken.slice(0, 20) : undefined,
    toToken: typeof r.toToken === 'string' ? r.toToken.slice(0, 20) : undefined,
    toAddress: typeof r.toAddress === 'string' ? r.toAddress.slice(0, 42) : undefined,
    agentReasoning: typeof r.agentReasoning === 'string' ? r.agentReasoning.slice(0, 1000) : undefined,
  });

  res.json({ ok: true });
});
