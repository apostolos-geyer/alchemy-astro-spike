<script lang="ts">
  let { start = 0 }: { start?: number } = $props();
  let count = $state(start);
</script>

<button class="counter" data-svelte-counter onclick={() => count++}>
  svelte count: {count}
</button>

<style>
  .counter {
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    font-size: 0.8125rem;
    letter-spacing: 0.08em;
    color: #f0a719;
    background: linear-gradient(180deg, #1b232d 0%, #0f151c 100%);
    border: 0;
    border-radius: 3px;
    padding: 0.85rem 1.1rem;
    cursor: pointer;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 6px 14px -6px rgba(11, 16, 22, 0.6);
    transition: transform 0.1s ease, box-shadow 0.15s ease;
  }

  .counter:hover {
    box-shadow:
      inset 0 0 0 1px rgba(240, 167, 25, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.12),
      0 8px 18px -8px rgba(11, 16, 22, 0.7);
  }

  .counter:active {
    transform: translateY(1px);
  }

  .counter:focus-visible {
    outline: 2px solid #151c24;
    outline-offset: 3px;
  }
</style>
