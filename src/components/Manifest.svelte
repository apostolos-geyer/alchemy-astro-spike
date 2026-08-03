<script lang="ts">
  import { flip } from "svelte/animate";
  import type { ManifestRow, Status } from "../data/manifest";

  let { rows = [] }: { rows?: ManifestRow[] } = $props();

  type Filter = "all" | Status;

  let filter = $state<Filter>("all");

  const count = (s: Status) => rows.filter((r) => r.status === s).length;

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "all" },
    { id: "verified", label: "verified" },
    { id: "partial", label: "partial" },
    { id: "unverified", label: "unverified" },
  ];

  const shown = $derived(filter === "all" ? rows : rows.filter((r) => r.status === filter));
</script>

<div class="mf">
  <div class="mf__controls" role="group" aria-label="Filter by status">
    {#each filters as f (f.id)}
      <button
        class="mf__chip"
        data-on={filter === f.id}
        data-status={f.id}
        onclick={() => (filter = f.id)}
        aria-pressed={filter === f.id}
      >
        {f.label}
        <span class="mf__count">{f.id === "all" ? rows.length : count(f.id)}</span>
      </button>
    {/each}
  </div>

  <div class="mf__head" aria-hidden="true">
    <span>Code</span>
    <span>Capability</span>
    <span>Route</span>
    <span>Status</span>
  </div>

  <ul class="mf__list">
    {#each shown as row (row.code)}
      <li class="mf__row" animate:flip={{ duration: 220 }}>
        <span class="mf__code">{row.code}</span>
        <span class="mf__body">
          <span class="mf__cap">{row.capability}</span>
          <span class="mf__ev">{row.evidence}</span>
        </span>
        <span class="mf__route">
          {#if row.route}
            <a class="mf__link" href={row.route}>{row.route}</a>
            {#if row.cfOnly}<span class="mf__cf">cf</span>{/if}
          {:else}
            <span class="mf__none">no route</span>
          {/if}
        </span>
        <span class="mf__status" data-status={row.status}>{row.status}</span>
      </li>
    {/each}
  </ul>

  <p class="mf__foot">
    Showing {shown.length} of {rows.length} lines. Verified means a live test asserts it against real
    Cloudflare. Routes tagged <span class="mf__cf">cf</span> import
    <code>cloudflare:workers</code>, so they answer only under the Cloudflare runtime and return 500
    on a plain <code>astro dev</code> server.
  </p>
</div>

<style>
  .mf {
    font-family: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
  }

  .mf__controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 1.25rem;
  }

  .mf__chip {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.6875rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6d7580;
    background: transparent;
    border: 1px solid rgba(21, 28, 36, 0.2);
    border-radius: 2px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }

  .mf__chip:hover {
    color: #151c24;
    border-color: rgba(21, 28, 36, 0.45);
  }

  .mf__chip[data-on="true"] {
    color: #151c24;
    border-color: #151c24;
    background: rgba(21, 28, 36, 0.05);
  }

  .mf__chip[data-on="true"][data-status="verified"] {
    border-color: #2f7d62;
    color: #2f7d62;
    background: rgba(47, 125, 98, 0.08);
  }

  .mf__chip[data-on="true"][data-status="partial"] {
    border-color: #a5760f;
    color: #a5760f;
    background: rgba(240, 167, 25, 0.12);
  }

  .mf__chip[data-on="true"][data-status="unverified"] {
    border-color: #c8402c;
    color: #c8402c;
    background: rgba(200, 64, 44, 0.08);
  }

  .mf__count {
    font-size: 0.625rem;
    opacity: 0.65;
  }

  .mf__head,
  .mf__row {
    display: grid;
    grid-template-columns: 3.5rem minmax(0, 1fr) 9.5rem 6.5rem;
    gap: 1rem;
    align-items: baseline;
  }

  .mf__head {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #6d7580;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid rgba(21, 28, 36, 0.3);
  }

  .mf__list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .mf__row {
    padding-block: 0.85rem;
    border-bottom: 1px solid rgba(21, 28, 36, 0.14);
  }

  .mf__code {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.8125rem;
    letter-spacing: 0.06em;
    color: #151c24;
    background: rgba(240, 167, 25, 0.28);
    box-shadow: inset 0 0 0 1px rgba(165, 118, 15, 0.35);
    border-radius: 2px;
    padding: 0.1rem 0.3rem;
    justify-self: start;
  }

  .mf__body {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .mf__cap {
    font-size: 0.9375rem;
    line-height: 1.35;
  }

  .mf__ev {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.6875rem;
    line-height: 1.45;
    color: #6d7580;
  }

  .mf__route,
  .mf__none {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.75rem;
  }

  .mf__link {
    color: #151c24;
    text-decoration-color: rgba(21, 28, 36, 0.3);
    text-underline-offset: 3px;
  }

  .mf__link:hover {
    color: #a5760f;
    text-decoration-color: currentColor;
  }

  .mf__none {
    color: #a2a8b0;
  }

  .mf__cf {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.5625rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #c8402c;
    box-shadow: inset 0 0 0 1px rgba(200, 64, 44, 0.4);
    border-radius: 2px;
    padding: 0.05rem 0.25rem;
    margin-left: 0.3rem;
    white-space: nowrap;
  }

  .mf__foot code {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.875em;
    background: rgba(21, 28, 36, 0.07);
    padding: 0.1em 0.3em;
    border-radius: 2px;
  }

  .mf__status {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.625rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    justify-self: start;
    padding: 0.2rem 0.45rem;
    border-radius: 2px;
    white-space: nowrap;
  }

  .mf__status[data-status="verified"] {
    color: #2f7d62;
    box-shadow: inset 0 0 0 1px rgba(47, 125, 98, 0.45);
  }

  .mf__status[data-status="partial"] {
    color: #a5760f;
    box-shadow: inset 0 0 0 1px rgba(165, 118, 15, 0.45);
  }

  .mf__status[data-status="unverified"] {
    color: #c8402c;
    box-shadow: inset 0 0 0 1px rgba(200, 64, 44, 0.4);
  }

  .mf__foot {
    margin: 1.25rem 0 0;
    font-size: 0.8125rem;
    color: #6d7580;
    max-width: 52ch;
  }

  @media (max-width: 46rem) {
    .mf__head {
      display: none;
    }

    .mf__row {
      grid-template-columns: 3.5rem minmax(0, 1fr);
      gap: 0.35rem 0.85rem;
    }

    .mf__route {
      grid-column: 2;
    }

    .mf__status {
      grid-column: 2;
    }
  }
</style>
