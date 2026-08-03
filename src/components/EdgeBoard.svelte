<script lang="ts">
  import { untrack } from "svelte";
  import SplitFlap from "./SplitFlap.svelte";

  /**
   * The board has two modes, which is the whole argument of this spike:
   *
   *   live=false — the page was rendered in the Worker, so the values arrive
   *                in the HTML and the flaps just confirm them.
   *   live=true  — the page is a static asset, so the flaps sit blank until a
   *                probe to /api/hello reports where the Worker actually ran.
   */
  let {
    origin = "···",
    ray = "········",
    mode = "SSR",
    renderedAt = "",
    live = false,
  }: {
    origin?: string;
    ray?: string;
    mode?: string;
    renderedAt?: string;
    live?: boolean;
  } = $props();

  const RAY_WIDTH = 8;

  // Seeded from the server render, then owned by this component: a probe
  // replaces them, the props never change again.
  let colo = $state(untrack(() => origin));
  let rayId = $state(untrack(() => ray));
  let stamp = $state(untrack(() => renderedAt));
  let state = $state<"idle" | "probing" | "ok" | "failed">(
    untrack(() => (live ? "idle" : "ok")),
  );
  let trips = $state<number[]>([]);

  const latest = $derived(trips.length ? trips[trips.length - 1] : null);
  const peak = $derived(Math.max(60, ...trips));

  async function probe() {
    state = "probing";
    const began = performance.now();
    try {
      const res = await fetch("/api/hello?echo=board", { cache: "no-store" });
      const data = await res.json();
      const elapsed = Math.round(performance.now() - began);

      colo = (data.colo ?? "DEV").toString().slice(0, 3).toUpperCase();
      rayId = (res.headers.get("cf-ray") ?? "localdev")
        .slice(0, RAY_WIDTH)
        .toUpperCase();
      stamp = data.renderedAt ?? "";
      trips = [...trips, elapsed].slice(-14);
      state = "ok";
    } catch {
      colo = "ERR";
      rayId = "--------";
      state = "failed";
    }
  }

  $effect(() => {
    if (live) probe();
  });

  const statusWord = $derived(
    state === "probing" ? "probing" : state === "failed" ? "no answer" : live ? "probe" : "server render",
  );
</script>

<div class="board">
  <div class="board__strip">
    <span class="board__lamp" data-state={state}></span>
    <span class="board__label">{live ? "static shell · live probe" : "rendered in the worker"}</span>
    <span class="board__clock">{stamp ? stamp.slice(11, 19) + "Z" : "--:--:--"}</span>
  </div>

  <dl class="board__rows">
    <div class="board__row">
      <dt class="board__key">Origin</dt>
      <dd class="board__val">
        <SplitFlap value={colo} length={3} size="lg" animateOnMount={!live} label={`colo ${colo}`} />
      </dd>
    </div>
    <div class="board__row">
      <dt class="board__key">Ray</dt>
      <dd class="board__val">
        <SplitFlap value={rayId} length={RAY_WIDTH} size="sm" animateOnMount={!live} label={`ray ${rayId}`} />
      </dd>
    </div>
    <div class="board__row">
      <dt class="board__key">Mode</dt>
      <dd class="board__val">
        <SplitFlap value={mode} length={6} size="sm" animateOnMount={!live} label={`mode ${mode}`} />
      </dd>
    </div>
  </dl>

  <div class="board__foot">
    <div class="board__trace">
      {#if trips.length}
        <span class="board__ms">{latest} ms</span>
        <span class="board__bars" aria-hidden="true">
          {#each trips as ms, i (i)}
            <span class="board__bar" style="height: {Math.max(8, (ms / peak) * 100)}%"></span>
          {/each}
        </span>
      {:else}
        <span class="board__ms board__ms--quiet">{statusWord}</span>
      {/if}
    </div>

    {#if live}
      <button class="board__key-btn" onclick={probe} disabled={state === "probing"}>
        {state === "probing" ? "probing" : "probe again"}
      </button>
    {/if}
  </div>
</div>

<style>
  .board {
    background: linear-gradient(180deg, #1b232d 0%, #131a22 100%);
    border-radius: 5px;
    padding: 1.1rem 1.25rem 1rem;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.07),
      inset 0 1px 0 rgba(255, 255, 255, 0.1),
      0 26px 50px -26px rgba(11, 16, 22, 0.75),
      0 2px 6px rgba(11, 16, 22, 0.2);
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
  }

  .board__strip {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding-bottom: 0.9rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 0.625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(233, 236, 240, 0.45);
  }

  .board__lamp {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: #2f7d62;
    box-shadow: 0 0 0 3px rgba(47, 125, 98, 0.2);
    flex: none;
  }

  .board__lamp[data-state="probing"] {
    background: #f0a719;
    box-shadow: 0 0 0 3px rgba(240, 167, 25, 0.22);
    animation: board-pulse 900ms ease-in-out infinite;
  }

  .board__lamp[data-state="failed"] {
    background: #c8402c;
    box-shadow: 0 0 0 3px rgba(200, 64, 44, 0.22);
  }

  .board__clock {
    margin-left: auto;
    color: rgba(240, 167, 25, 0.75);
  }

  .board__rows {
    margin: 0;
    padding: 1.1rem 0 0.9rem;
    display: grid;
    gap: 0.7rem;
  }

  .board__row {
    display: grid;
    grid-template-columns: 4.25rem 1fr;
    align-items: center;
    gap: 0.9rem;
  }

  .board__key {
    font-size: 0.625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(233, 236, 240, 0.38);
  }

  .board__val {
    margin: 0;
    min-width: 0;
  }

  .board__foot {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding-top: 0.85rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    min-height: 2.4rem;
  }

  .board__trace {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    flex: 1;
  }

  .board__ms {
    font-size: 0.6875rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(240, 167, 25, 0.85);
    white-space: nowrap;
  }

  .board__ms--quiet {
    color: rgba(233, 236, 240, 0.35);
  }

  .board__bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 1.15rem;
    flex: 1;
    min-width: 0;
  }

  .board__bar {
    flex: 1;
    max-width: 5px;
    background: rgba(240, 167, 25, 0.4);
    border-radius: 1px;
  }

  .board__bar:last-child {
    background: #f0a719;
  }

  .board__key-btn {
    font: inherit;
    font-size: 0.625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: #e9ecf0;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
    padding: 0.45rem 0.7rem;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
  }

  .board__key-btn:hover:not(:disabled) {
    background: rgba(240, 167, 25, 0.16);
    border-color: rgba(240, 167, 25, 0.5);
  }

  .board__key-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .board__key-btn:focus-visible {
    outline: 2px solid #f0a719;
    outline-offset: 2px;
  }

  @keyframes board-pulse {
    50% {
      opacity: 0.35;
    }
  }
</style>
