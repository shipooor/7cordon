/**
 * AuditLogger — Append-only local log of all Guardian decisions.
 *
 * JSON Lines format for easy reading and streaming.
 * File permissions restricted to owner-only (0o600).
 * Individual corrupted lines are skipped, not the entire log.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import path from 'path';
import type { AuditEntry, AuditStats } from '@7cordon/shared';

/** Directory permissions: owner only. */
const DIR_MODE = 0o700;
/** File permissions: owner read/write only. */
const FILE_MODE = 0o600;

/** Maximum entries kept in memory. Oldest are pruned on append. */
const MAX_ENTRIES = 10_000;

export class AuditLogger {
  private logPath: string;
  private entries: AuditEntry[] = [];

  constructor(logDir?: string) {
    const dir = logDir || path.join(process.cwd(), '.7cordon');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    }
    this.logPath = path.join(dir, 'audit.jsonl');
    this.loadExisting();
  }

  /**
   * Append an audit entry. Uses synchronous write to guarantee durability
   * for the security audit trail. Latency is acceptable since transactions
   * are rate-limited to 5/minute.
   */
  append(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    const line = JSON.stringify(entry) + '\n';
    try {
      appendFileSync(this.logPath, line, { mode: FILE_MODE });
    } catch (err) {
      // Entry exists in memory — visible in current session but lost on crash
      console.warn(`[7cordon] Audit log write failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  /** Get entries, newest first, with optional pagination. */
  getEntries(limit?: number, offset?: number): AuditEntry[] {
    // Reverse first so pagination operates on newest-first order
    const reversed = [...this.entries].reverse();
    const start = offset || 0;
    const end = limit ? start + limit : undefined;
    return reversed.slice(start, end);
  }

  /** Get all entries (oldest first) — used for budget restoration. */
  getAllEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /** Compute aggregate stats from all entries. */
  getStats(): AuditStats {
    const approved = this.entries.filter((e) => e.finalStatus === 'approved').length;
    const blocked = this.entries.filter((e) => e.finalStatus === 'blocked').length;
    const pending = this.entries.filter((e) => e.finalStatus === 'pending_approval').length;

    const totalFees = this.entries.reduce(
      (sum, e) => sum + Number(e.feePaid || 0),
      0
    );

    const durations = this.entries
      .filter((e) => e.analysisResult?.duration)
      .map((e) => e.analysisResult!.duration);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    return {
      totalRequests: this.entries.length,
      approved,
      blocked,
      pending,
      totalFeesPaid: totalFees.toFixed(6),
      averageAnalysisTime: Math.round(avgDuration),
    };
  }

  /** Clear all entries from memory and disk. Used to reset state between demo runs. */
  clear(): void {
    this.entries = [];
    try {
      writeFileSync(this.logPath, '', { mode: FILE_MODE });
    } catch {
      // Best effort — memory is already cleared
    }
  }

  getEntriesByStatus(status: 'approved' | 'blocked' | 'pending_approval'): AuditEntry[] {
    return this.entries.filter((e) => e.finalStatus === status).reverse();
  }

  /** Load existing entries, parsing line-by-line and skipping corrupted lines. */
  private loadExisting(): void {
    if (!existsSync(this.logPath)) return;

    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          this.entries.push(JSON.parse(line));
        } catch {
          // Skip corrupted line, keep the rest
        }
      }
      // Cap entries loaded from disk and truncate file to prevent unbounded growth
      if (this.entries.length > MAX_ENTRIES) {
        this.entries = this.entries.slice(-MAX_ENTRIES);
        try {
          const compacted = this.entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
          writeFileSync(this.logPath, compacted, { mode: FILE_MODE });
        } catch {
          // Best effort — memory is already capped
        }
      }
    } catch {
      this.entries = [];
    }
  }
}
