<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import type { DashboardStats, DashboardEntry, DashboardTrust, DashboardPolicy } from '$lib/api/client';
  import { timeAgo, formatDuration } from '$lib/utils/formatters';

  let stats: DashboardStats | null = $state(null);
  let entries: DashboardEntry[] = $state([]);
  let trust: DashboardTrust | null = $state(null);
  let policy: DashboardPolicy | null = $state(null);
  let error: string | null = $state(null);
  let loading = $state(true);
  let refreshTimeout: ReturnType<typeof setTimeout>;

  const riskColors: Record<string, string> = {
    safe: 'var(--color-safe)',
    low: 'var(--color-low)',
    medium: 'var(--color-medium)',
    high: 'var(--color-high)',
    critical: 'var(--color-critical)',
  };

  async function refresh() {
    const [sRes, eRes, tRes, pRes] = await Promise.allSettled([
      api.getStats(),
      api.getEntries(20),
      api.getTrust(),
      api.getPolicy(),
    ]);

    if (sRes.status === 'fulfilled') stats = sRes.value;
    if (eRes.status === 'fulfilled') entries = eRes.value.entries;
    if (tRes.status === 'fulfilled') trust = tRes.value;
    if (pRes.status === 'fulfilled') policy = pRes.value;

    const allFailed = [sRes, eRes, tRes, pRes].every(r => r.status === 'rejected');
    error = allFailed ? 'Unable to reach saaafe API' : null;
    loading = false;
  }

  let refreshInterval = 5_000;

  async function scheduleRefresh() {
    try {
      await refresh();
      refreshInterval = 5_000; // Reset on success
    } catch {
      refreshInterval = Math.min(refreshInterval * 2, 30_000); // Backoff up to 30s
    }
    refreshTimeout = setTimeout(scheduleRefresh, refreshInterval);
  }

  onMount(() => { scheduleRefresh(); });

  onDestroy(() => clearTimeout(refreshTimeout));

  function budgetPercent(spent: number, limit: string): number {
    const l = parseFloat(limit);
    if (l <= 0) return 0;
    return Math.min(100, (spent / l) * 100);
  }

  // Trust gauge arc calculation
  function gaugeArc(score: number): string {
    const angle = (score / 100) * 270;
    const rad = (angle - 135) * (Math.PI / 180);
    const r = 45;
    const cx = 55, cy = 55;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    const large = angle > 180 ? 1 : 0;
    // Start at -135 degrees
    const startRad = -135 * (Math.PI / 180);
    const sx = cx + r * Math.cos(startRad);
    const sy = cy + r * Math.sin(startRad);
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${x} ${y}`;
  }
</script>

{#if loading}
  <div class="loading-state">
    <div class="spinner"></div>
    <p>Connecting to saaafe API…</p>
  </div>
{:else}

{#if error}
  <div class="error-banner">
    <span>Unable to connect to saaafe API</span>
    <span class="error-detail">{error}</span>
  </div>
{/if}

<!-- Stats Cards -->
<section class="stats-grid">
  <div class="card stat-card">
    <span class="stat-label">Total Requests</span>
    <span class="stat-value">{stats?.totalRequests ?? '-'}</span>
  </div>
  <div class="card stat-card">
    <span class="stat-label">Approved</span>
    <span class="stat-value approved">{stats?.approved ?? '-'}</span>
  </div>
  <div class="card stat-card">
    <span class="stat-label">Blocked</span>
    <span class="stat-value blocked">{stats?.blocked ?? '-'}</span>
  </div>
  <div class="card stat-card">
    <span class="stat-label">Pending</span>
    <span class="stat-value pending">{stats?.pending ?? '-'}</span>
  </div>
  <div class="card stat-card">
    <span class="stat-label">Avg Analysis</span>
    <span class="stat-value">{stats ? formatDuration(stats.averageAnalysisTime) : '-'}</span>
  </div>
</section>

<!-- Trust + Budget Row -->
<section class="row">
  <div class="card trust-card">
    <h2>Trust Score</h2>
    {#if trust}
      <div class="trust-gauge">
        <svg viewBox="0 0 110 110" class="gauge-svg" role="img" aria-label="Trust score: {trust.score}, level: {trust.level}">
          <path d={gaugeArc(100)} class="gauge-bg" fill="none" stroke="var(--color-border)" stroke-width="8" stroke-linecap="round" />
          <path d={gaugeArc(trust.score)} class="gauge-fill" fill="none" stroke="var(--color-primary)" stroke-width="8" stroke-linecap="round" />
          <text x="55" y="52" text-anchor="middle" class="gauge-score">{trust.score}</text>
          <text x="55" y="68" text-anchor="middle" class="gauge-level">{trust.level}</text>
        </svg>
      </div>
      <div class="trust-stats">
        <div class="trust-stat">
          <span class="ts-label">Volume</span>
          <span class="ts-value">{trust.stats.totalTransactions} txs</span>
        </div>
        <div class="trust-stat">
          <span class="ts-label">Streak</span>
          <span class="ts-value">{trust.stats.consecutiveApproved}</span>
        </div>
        <div class="trust-stat">
          <span class="ts-label">Block ratio</span>
          <span class="ts-value">{(trust.stats.blockedRatio * 100).toFixed(0)}%</span>
        </div>
      </div>
    {:else}
      <p class="muted">No data</p>
    {/if}
  </div>

  <div class="card budget-card">
    <h2>Budget</h2>
    {#if policy}
      <div class="budget-row">
        <span class="budget-label">Daily</span>
        <div class="budget-bar-container">
          <div class="budget-bar" style="width: {budgetPercent(policy.budget.dailySpent, policy.config.dailyBudget)}%; background: {budgetPercent(policy.budget.dailySpent, policy.config.dailyBudget) > 80 ? 'var(--color-blocked)' : 'var(--color-primary)'}"></div>
        </div>
        <span class="budget-text">${policy.budget.dailySpent.toFixed(0)} / ${policy.config.dailyBudget}</span>
      </div>
      <div class="budget-row">
        <span class="budget-label">Weekly</span>
        <div class="budget-bar-container">
          <div class="budget-bar" style="width: {budgetPercent(policy.budget.weeklySpent, policy.config.weeklyBudget)}%; background: {budgetPercent(policy.budget.weeklySpent, policy.config.weeklyBudget) > 80 ? 'var(--color-blocked)' : 'var(--color-primary)'}"></div>
        </div>
        <span class="budget-text">${policy.budget.weeklySpent.toFixed(0)} / ${policy.config.weeklyBudget}</span>
      </div>

      <div class="policy-section">
        <h3>Policy Limits</h3>
        <div class="policy-grid">
          <span class="p-label">Max per tx</span><span class="p-value">${policy.config.maxTransactionAmount}</span>
          <span class="p-label">Auto-approve</span><span class="p-value">&le; ${policy.config.autoApproveThreshold}</span>
          <span class="p-label">Rate limit</span><span class="p-value">{policy.config.rateLimit}/min</span>
        </div>
      </div>

      <div class="policy-section">
        <h3>Whitelisted</h3>
        <div class="tags">
          {#each policy.config.whitelist.tokens as token}
            <span class="tag">{token}</span>
          {/each}
          {#each policy.config.whitelist.protocols as proto}
            <span class="tag proto">{proto}</span>
          {/each}
        </div>
      </div>
    {:else}
      <p class="muted">No data</p>
    {/if}
  </div>
</section>

<!-- Activity Feed -->
<section class="card activity-card">
  <h2>Recent Activity</h2>
  {#if entries.length === 0}
    <p class="muted">No transactions analyzed yet. Run the demo to see activity here.</p>
  {:else}
    <div class="entries">
      {#each entries as entry (entry.requestId)}
        <div class="entry">
          <div class="entry-header">
            <span class="entry-action">{entry.action}</span>
            <span class="entry-amount">{entry.amount} {entry.fromToken || ''}{entry.toToken ? ' -> ' + entry.toToken : ''}</span>
            <span class="badge" class:badge-approved={entry.finalStatus === 'approved'} class:badge-blocked={entry.finalStatus === 'blocked'} class:badge-pending={entry.finalStatus === 'pending_approval'}>
              {entry.finalStatus === 'approved' ? 'APPROVED' : entry.finalStatus === 'blocked' ? 'BLOCKED' : 'PENDING'}
            </span>
            <span class="risk-dot" aria-hidden="true" style="background: {riskColors[entry.riskLevel] || 'var(--color-text-muted)'}"></span>
            <span class="entry-risk" style="color: {riskColors[entry.riskLevel] || 'var(--color-text-muted)'}">{entry.riskLevel}</span>
          </div>
          <div class="entry-body">
            <span class="entry-explanation"><span class="reasoning-label">saaafe:</span> {entry.explanation.slice(0, 150)}{entry.explanation.length > 150 ? '…' : ''}</span>
          </div>
          <div class="entry-footer">
            <span class="entry-level">{entry.level}</span>
            <span class="entry-chain">{entry.chain}</span>
            {#if entry.protocol}
              <span class="entry-proto">{entry.protocol}</span>
            {/if}
            <span class="entry-duration">{formatDuration(entry.duration)}</span>
            <span class="entry-time">{timeAgo(entry.timestamp)}</span>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

{/if}

<style>
  .error-banner {
    background: var(--color-blocked);
    color: white;
    padding: 10px 16px;
    border-radius: var(--radius);
    margin-bottom: 20px;
    display: flex;
    justify-content: space-between;
    font-size: 14px;
  }
  .error-detail { opacity: 0.7; font-family: var(--font-mono); font-size: 12px; }

  .card {
    background: var(--color-card);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .card h2 {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 16px;
  }
  .card h3 {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    margin-top: 16px;
  }

  .muted { color: var(--color-text-muted); font-size: 14px; }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 14px;
    margin-bottom: 20px;
  }
  .stat-card {
    text-align: center;
    padding: 16px;
  }
  .stat-label {
    display: block;
    font-size: 12px;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
  }
  .stat-value {
    display: block;
    font-size: 28px;
    font-weight: 700;
    font-family: var(--font-mono);
  }
  .stat-value.approved { color: var(--color-approved); }
  .stat-value.blocked { color: var(--color-blocked); }
  .stat-value.pending { color: var(--color-pending); }

  /* Row layout */
  .row {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 14px;
    margin-bottom: 20px;
  }

  /* Trust Gauge */
  .trust-card { text-align: center; }
  .trust-gauge { margin: 0 auto; width: 130px; height: 130px; }
  .gauge-svg { width: 100%; height: 100%; }
  .gauge-score { font-size: 24px; font-weight: 700; fill: var(--color-text); font-family: var(--font-mono); }
  .gauge-level { font-size: 11px; fill: var(--color-text-muted); text-transform: uppercase; letter-spacing: 1px; }
  .trust-stats {
    display: flex;
    justify-content: center;
    gap: 20px;
    margin-top: 12px;
  }
  .trust-stat { text-align: center; }
  .ts-label { display: block; font-size: 11px; color: var(--color-text-muted); text-transform: uppercase; }
  .ts-value { display: block; font-size: 16px; font-weight: 600; font-family: var(--font-mono); }

  /* Budget */
  .budget-row {
    display: grid;
    grid-template-columns: 60px 1fr 120px;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .budget-label { font-size: 13px; color: var(--color-text-muted); }
  .budget-bar-container {
    height: 8px;
    background: var(--color-border);
    border-radius: 4px;
    overflow: hidden;
  }
  .budget-bar {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }
  .budget-text {
    font-size: 13px;
    font-family: var(--font-mono);
    color: var(--color-text-muted);
    text-align: right;
  }
  .policy-grid {
    display: grid;
    grid-template-columns: auto auto;
    gap: 4px 16px;
    font-size: 13px;
  }
  .p-label { color: var(--color-text-muted); }
  .p-value { font-family: var(--font-mono); }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(139, 92, 246, 0.15);
    color: var(--color-primary);
    font-family: var(--font-mono);
  }
  .tag.proto {
    background: rgba(16, 185, 129, 0.15);
    color: var(--color-approved);
  }

  /* Activity */
  .activity-card { margin-bottom: 20px; }
  .entries { display: flex; flex-direction: column; gap: 8px; }
  .entry {
    padding: 12px;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    background: var(--color-surface);
  }
  .entry-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .entry-action {
    font-weight: 600;
    font-size: 13px;
    text-transform: uppercase;
    color: var(--color-text);
  }
  .entry-amount {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--color-text);
  }
  .badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-left: auto;
  }
  .badge-approved { background: rgba(16, 185, 129, 0.15); color: var(--color-approved); }
  .badge-blocked { background: rgba(239, 68, 68, 0.15); color: var(--color-blocked); }
  .badge-pending { background: rgba(245, 158, 11, 0.15); color: var(--color-pending); }
  .risk-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .entry-risk {
    font-size: 12px;
    font-family: var(--font-mono);
  }
  .reasoning-label {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    opacity: 0.8;
  }
  .entry-body { margin-bottom: 6px; }
  .entry-explanation {
    font-size: 13px;
    color: var(--color-text-muted);
    line-height: 1.4;
  }
  .entry-footer {
    display: flex;
    gap: 10px;
    font-size: 11px;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }
  .entry-level {
    background: rgba(139, 92, 246, 0.1);
    color: var(--color-primary);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .entry-chain { opacity: 0.7; }
  .entry-proto { opacity: 0.7; }
  .entry-duration { opacity: 0.7; }
  .entry-time { margin-left: auto; }

  /* Loading */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 80px 20px;
    color: var(--color-text-muted);
    font-size: 14px;
  }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 768px) {
    .stats-grid { grid-template-columns: repeat(3, 1fr); }
    .row { grid-template-columns: 1fr; }
    .entry-header { flex-wrap: wrap; }
    .budget-row { grid-template-columns: 50px 1fr 100px; }
  }
  @media (max-width: 480px) {
    .stats-grid { grid-template-columns: 1fr 1fr; gap: 8px; }
    .stat-value { font-size: 22px; }
    .budget-row { grid-template-columns: 1fr; gap: 4px; }
    .budget-text { text-align: left; }
    .entry-footer { flex-wrap: wrap; }
  }
</style>
