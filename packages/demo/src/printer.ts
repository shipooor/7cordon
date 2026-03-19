/**
 * Console output formatter for the demo.
 * ANSI colors and structured layout for terminal and video recording.
 */

import type { TransactionResult, AuditStats, TrustScore } from '@7cordon/shared';
import type { Scenario } from './scenarios.js';

// ANSI color codes
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

const STATUS_COLORS: Record<string, string> = {
  approved: C.green,
  blocked: C.red,
  pending_approval: C.yellow,
};

const RISK_COLORS: Record<string, string> = {
  safe: C.green,
  low: C.green,
  medium: C.yellow,
  high: C.red,
  critical: C.red,
};

export function printBanner(): void {
  console.log(`
${C.magenta}${C.bold}${'='.repeat(58)}${C.reset}
${C.magenta}${C.bold}              7cordon — Live Demo${C.reset}
${C.magenta}${C.bold}${'='.repeat(58)}${C.reset}
${C.dim}  AI-powered trust layer for autonomous financial agents${C.reset}
${C.dim}  Three-level defense: L0 Policy -> L1 Quick -> L2 Deep${C.reset}
`);
}

export function printScenarioHeader(index: number, total: number, scenario: Scenario): void {
  const req = scenario.request;
  console.log(`
${C.cyan}${C.bold}--- Scenario ${index + 1}/${total}: ${scenario.name} ${'─'.repeat(Math.max(0, 35 - scenario.name.length))}${C.reset}
${C.dim}  ${scenario.description}${C.reset}

  ${C.white}Action:${C.reset}  ${req.action} ${req.params.amount} ${req.params.fromToken || ''}${req.params.toToken ? ' -> ' + req.params.toToken : ''}${req.params.toAddress ? ' -> ' + truncAddr(req.params.toAddress) : ''}
  ${C.white}Chain:${C.reset}   ${req.params.chain}${req.params.protocol ? '  |  Protocol: ' + req.params.protocol : ''}
  ${C.white}Reason:${C.reset}  ${C.dim}${req.reasoning.slice(0, 70)}${req.reasoning.length > 70 ? '...' : ''}${C.reset}
`);
}

export function printResult(result: TransactionResult): void {
  const statusColor = STATUS_COLORS[result.status] || C.white;
  const riskColor = RISK_COLORS[result.riskLevel] || C.white;

  console.log(`  ${C.white}[${result.analysisLevel}]${C.reset}  ${riskColor}${result.riskLevel}${C.reset} — ${result.explanation.slice(0, 80)}`);
  console.log(`
  ${C.bold}Result:${C.reset}  ${statusColor}${C.bold}${result.status.toUpperCase()}${C.reset}`);
  console.log(`  ${C.dim}Duration: ${result.duration}ms  |  Fee: $${result.feePaid}${result.txHash ? '  |  Tx: ' + truncAddr(result.txHash) : ''}${C.reset}`);
}

export function printPolicyBlock(result: TransactionResult): void {
  console.log(`  ${C.red}[L0 Policy]${C.reset}  ${C.red}BLOCKED${C.reset} — ${result.explanation.slice(0, 80)}`);
  console.log(`
  ${C.bold}Result:${C.reset}  ${C.red}${C.bold}BLOCKED${C.reset}  ${C.dim}(${result.duration}ms, no AI cost)${C.reset}`);
}

export function printSummary(
  stats: AuditStats,
  trustScore: TrustScore,
  totalDuration: number,
): void {
  const trustColor = trustScore.score >= 60 ? C.green : trustScore.score >= 30 ? C.yellow : C.red;

  console.log(`
${C.magenta}${C.bold}${'='.repeat(58)}${C.reset}
${C.magenta}${C.bold}  Summary${C.reset}
${C.magenta}${C.bold}${'='.repeat(58)}${C.reset}

  ${C.white}Trust Score:${C.reset}  ${trustColor}${C.bold}${trustScore.score}/100${C.reset}  (${trustScore.level})
  ${C.white}Requests:${C.reset}    ${stats.totalRequests} total
  ${C.green}Approved:${C.reset}    ${stats.approved}
  ${C.red}Blocked:${C.reset}     ${stats.blocked}
  ${C.white}Avg Time:${C.reset}    ${stats.averageAnalysisTime}ms
  ${C.white}Total Time:${C.reset}  ${(totalDuration / 1000).toFixed(1)}s
  ${C.dim}Fees Paid:   $${stats.totalFeesPaid}${C.reset}

${C.magenta}${C.bold}${'='.repeat(58)}${C.reset}
`);
}

export function printError(scenario: Scenario, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.log(`  ${C.red}ERROR:${C.reset} ${msg}`);
}

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
