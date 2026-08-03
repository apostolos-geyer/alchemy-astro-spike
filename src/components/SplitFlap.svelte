<script lang="ts">
  import { untrack } from "svelte";

  /**
   * A split-flap row. The initial render already shows the real value, so a
   * server-rendered page carries the answer in its HTML; the flipping is
   * enhancement layered on top once the island hydrates.
   */
  let {
    value = "",
    length = 0,
    size = "lg",
    animateOnMount = false,
    label = "",
  }: {
    value?: string;
    length?: number;
    size?: "lg" | "sm";
    animateOnMount?: boolean;
    label?: string;
  } = $props();

  const ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-·:/.";

  const pad = (v: string): string[] => {
    const chars = v.toUpperCase().split("");
    const width = length || chars.length;
    while (chars.length < width) chars.push(" ");
    return chars.slice(0, width);
  };

  // The first render shows the real value; `$effect` takes over from there.
  let tiles = $state(untrack(() => pad(value).map((ch, i) => ({ ch, step: i }))));

  let generation = 0;
  let previous = untrack(() => value);
  let mounted = false;

  const stillish = () =>
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  const advance = (ch: string) => {
    const at = ALPHABET.indexOf(ch);
    return ALPHABET[(at < 0 ? 0 : at + 1) % ALPHABET.length];
  };

  const put = (i: number, ch: string) => {
    tiles[i] = { ch, step: tiles[i].step + 1 };
  };

  /** Each tile runs its own short cascade, staggered left to right. */
  const flipTo = (target: string[]) => {
    generation += 1;
    const mine = generation;

    if (tiles.length !== target.length) {
      tiles = target.map((ch, i) => ({ ch, step: i }));
      return;
    }

    target.forEach((ch, i) => {
      const steps = 4 + i * 2;
      let n = 0;
      const run = () => {
        if (mine !== generation) return;
        n += 1;
        if (n >= steps) {
          put(i, ch);
          return;
        }
        put(i, advance(tiles[i].ch));
        setTimeout(run, 34 + n * 6);
      };
      setTimeout(run, i * 55);
    });
  };

  $effect(() => {
    const next = value;

    if (!mounted) {
      mounted = true;
      previous = next;
      if (animateOnMount && !stillish()) {
        const target = pad(next);
        tiles = target.map((_, i) => ({ ch: ALPHABET[i % ALPHABET.length], step: i }));
        flipTo(target);
      }
      return;
    }

    if (next === previous) return;
    previous = next;

    const target = pad(next);
    if (stillish()) {
      tiles = target.map((ch, i) => ({ ch, step: i }));
      return;
    }
    flipTo(target);
  });

  $effect(() => () => {
    generation += 1;
  });
</script>

<div class="flap flap--{size}" role="img" aria-label={label || value}>
  {#each tiles as tile, i (i)}
    <span class="flap__tile" aria-hidden="true">
      {#key tile.step}
        <span class="flap__glyph">{tile.ch === " " ? " " : tile.ch}</span>
      {/key}
      <span class="flap__seam"></span>
    </span>
  {/each}
</div>

<style>
  .flap {
    display: flex;
    gap: 0.2em;
    perspective: 420px;
    font-family: "DM Mono", ui-monospace, Menlo, monospace;
    line-height: 1;
  }

  .flap--lg {
    font-size: clamp(2rem, 6.5vw, 3.25rem);
  }

  .flap--sm {
    font-size: clamp(0.95rem, 2.6vw, 1.15rem);
    gap: 0.16em;
  }

  .flap__tile {
    position: relative;
    display: block;
    width: 0.84em;
    padding: 0.22em 0 0.26em;
    text-align: center;
    color: #f0a719;
    background: linear-gradient(180deg, #161d26 0%, #0b1016 49%, #070b0f 51%, #10161d 100%);
    border-radius: 0.06em;
    box-shadow:
      inset 0 0.02em 0 rgba(255, 255, 255, 0.09),
      inset 0 -0.02em 0 rgba(0, 0, 0, 0.6),
      0 0.06em 0.14em rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  .flap__glyph {
    display: block;
    animation: flap-drop 150ms cubic-bezier(0.2, 0.85, 0.3, 1);
    transform-origin: 50% 50%;
    backface-visibility: hidden;
  }

  /* The seam stays put while the glyph turns behind it. */
  .flap__seam {
    position: absolute;
    inset-inline: 0;
    top: 50%;
    height: 1px;
    background: rgba(0, 0, 0, 0.85);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.05);
    pointer-events: none;
  }

  @keyframes flap-drop {
    0% {
      transform: rotateX(-88deg);
      filter: brightness(0.45);
    }
    62% {
      transform: rotateX(7deg);
      filter: brightness(1.08);
    }
    100% {
      transform: rotateX(0deg);
      filter: brightness(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .flap__glyph {
      animation: none;
    }
  }
</style>
