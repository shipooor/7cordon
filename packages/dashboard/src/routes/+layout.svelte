<script lang="ts">
  import '../app.css';
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import type { HealthStatus } from '$lib/api/client';
  import { formatUptime } from '$lib/utils/formatters';

  let { children } = $props();

  let health: HealthStatus | null = $state(null);
  let connected = $state(false);
  let interval: ReturnType<typeof setInterval>;

  async function checkHealth() {
    try {
      health = await api.getHealth();
      connected = true;
    } catch {
      connected = false;
      health = null;
    }
  }

  onMount(() => {
    checkHealth();
    interval = setInterval(checkHealth, 10_000);
  });

  onDestroy(() => clearInterval(interval));
</script>

<div class="app">
  <header class="header">
    <div class="logo">
      <span class="shield">&#x1f6e1;</span>
      <h1>saaafe</h1>
    </div>
    <div class="status" role="status" aria-label={connected ? 'Server connected' : 'Server disconnected'}>
      {#if connected && health}
        <span class="dot online" aria-hidden="true"></span>
        <span class="status-text">v{health.version} &middot; {formatUptime(health.uptime)}</span>
      {:else}
        <span class="dot offline" aria-hidden="true"></span>
        <span class="status-text">Disconnected</span>
      {/if}
    </div>
  </header>

  <main class="main">
    {@render children()}
  </main>
</div>

<style>
  .app {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 20px;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 0;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 24px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .shield {
    font-size: 28px;
  }

  h1 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.5px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .dot.online {
    background: var(--color-approved);
    box-shadow: 0 0 6px var(--color-approved);
  }

  .dot.offline {
    background: var(--color-blocked);
    box-shadow: 0 0 6px var(--color-blocked);
  }

  .status-text {
    font-size: 13px;
    color: var(--color-text-muted);
    font-family: var(--font-mono);
  }

  .main {
    padding-bottom: 40px;
  }
</style>
