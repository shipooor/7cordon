/**
 * Runtime validation for LLM-generated analysis responses.
 * Ensures the AI output conforms to the expected schema before use.
 */

import { VALID_RISK_LEVELS, VALID_THREAT_TYPES } from '@saaafe/shared';

const MAX_EXPLANATION_LENGTH = 1000;
const MAX_DESCRIPTION_LENGTH = 500;

interface ValidatedThreat {
  type: string;
  severity: string;
  description: string;
}

export interface ValidatedAIResponse {
  riskLevel: string;
  approved: boolean;
  explanation: string;
  threats: ValidatedThreat[];
}

/**
 * Validates a single threat object from the AI response.
 * Returns null if the threat doesn't conform to expected schema.
 */
function validateThreat(t: unknown): ValidatedThreat | null {
  if (!t || typeof t !== 'object') return null;
  const obj = t as Record<string, unknown>;
  if (typeof obj.type !== 'string' || !(VALID_THREAT_TYPES as readonly string[]).includes(obj.type)) return null;
  if (typeof obj.severity !== 'string' || !(VALID_RISK_LEVELS as readonly string[]).includes(obj.severity)) return null;
  if (typeof obj.description !== 'string') return null;
  return { type: obj.type, severity: obj.severity, description: obj.description.slice(0, MAX_DESCRIPTION_LENGTH) };
}

/**
 * Validates the parsed AI response has the required fields and correct types.
 * Returns a new object (never mutates input). Returns null if validation fails.
 * Enforces consistency: high/critical risk must have approved=false.
 */
export function validateAIResponse(parsed: unknown): ValidatedAIResponse | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.riskLevel !== 'string' || !(VALID_RISK_LEVELS as readonly string[]).includes(obj.riskLevel)) return null;
  if (typeof obj.approved !== 'boolean') return null;
  if (typeof obj.explanation !== 'string') return null;

  // Validate individual threats, filtering out malformed ones
  const threats: ValidatedThreat[] = [];
  if (Array.isArray(obj.threats)) {
    for (const t of obj.threats) {
      const valid = validateThreat(t);
      if (valid) threats.push(valid);
    }
  }

  // Enforce consistency: high/critical risk should never be approved
  const approved = (obj.riskLevel === 'high' || obj.riskLevel === 'critical')
    ? false
    : obj.approved;

  return {
    riskLevel: obj.riskLevel,
    approved,
    explanation: obj.explanation.slice(0, MAX_EXPLANATION_LENGTH),
    threats,
  };
}
