# astro-ssr-spike

**Astro SSR deployed to Cloudflare Workers via [Alchemy](https://github.com/alchemy-run/alchemy)** —
a `Cloudflare.Website.Astro` resource shaped as a peer of `Website.Vite`.

> [!WARNING]
> **100% Claude-authored, barely human-reviewed.** Every line of `infra/`,
> `test/`, and the docs was written by Claude Code in a single exploratory
> session. The *claims* are backed by tests that ran against real Cloudflare —
> see exactly what is and isn't verified below — but the code quality, API
> design, and naming have not been scrutinised by anyone. A detailed research
> artifact, not a contribution ready to merge.

| | |
|---|---|
| **Deploy path** | 12 / 12 live tests at best; ~10–11/15 on a busy account (propagation, not code) |
| **Local dev** | 2 / 3 — service bindings to Alchemy's local Workers don't resolve |
| **Browser** | verified — Svelte hydration 7 → 8, no console errors |
| **Versions** | Astro `7.1.6` · `@astrojs/cloudflare` `14.1.7` · `alchemy@2.0.0-beta.67` |

**→ [`ASTRO.md`](./ASTRO.md) is the real document.** Full adapter→Alchemy mapping,
every capability with its evidence, dev-mode limits, and every footgun with the
actual error string it produces.

---

## What it demonstrates

`Cloudflare.Website.Vite` can't build Astro — Astro's build is driven by the
`astro` CLI, not a plain `vite build`. But Astro exposes a **Node API**, so
Alchemy drives it directly and injects the Cloudflare adapter, exactly as
`Website.Vite` injects the Cloudflare vite plugin.

Your Astro config stays app-only — no adapter, no `output`, no `configPath`:

```js
// astro.config.mjs
export default defineConfig({ integrations: [svelte()] });
```

Everything Cloudflare-facing is declared once, in the stack:

```ts
// infra/site.ts
export class Site extends Astro<Site>()("Site", {
  cache: { enabled: true },
  env: { SESSION: SessionKv, CACHE: Cache, UPLOADS: Uploads, API: ApiWorker },
}) {}

export type SiteEnv = Cloudflare.InferEnv<typeof Site>;   // workerd Env, derived
```

> [!IMPORTANT]
> **Alchemy is the deployment authority**, so deploy touches no wrangler config
> at all — `main`, `bundle`, `assets` and `compatibility` come straight from the
> stack. For `alchemy dev`, wrangler config is the format `astro dev` speaks, so
> the resource *generates* `.dev.wrangler.json` from the stack's `env`. One
> source of truth in both modes; you never author wrangler config either way.

The split has no exceptions: **Cloudflare concerns in the stack, Astro concerns
in `astro.config.mjs`.** Anything the resource doesn't set passes through
untouched, so `integrations`, `markdown`, `server.port`, `session` and the rest
stay where they belong. `cwd` is the only path knob — it's handed to Astro as
its `root`, so the stack can live in another directory entirely.

---

## Verified

Per-request SSR · prerendered routes off the assets layer · `nodejs_compat` ·
Astro sessions over bound KV (cookie round-trip) · KV / R2 / vars / service
bindings · typed RPC via `toRpcAsync` into an Effect-native Worker · `InferEnv`
types · Svelte islands **incl. real-browser hydration** · content collections
(prerendered *and* request-time) · middleware · Astro Actions · `_redirects` ·
Workers Cache · idempotent redeploys · clean teardown.

**Not verified:** the dev service-binding bridge resolving live, Windows paths,
monorepo `cwd`, `auxiliaryWorkers`.

---

## Upstream bugs found

Four surfaced while building this; all reproduced on latest `main`, none duplicates.

| Bug | Issue | PR |
|---|---|---|
| `StaticSite` passes an object as the assets hash → re-uploads every deploy | [#1056](https://github.com/alchemy-run/alchemy/issues/1056) | [#1057](https://github.com/alchemy-run/alchemy/pull/1057) |
| Output-valued `main` crashes pre-create in `isPythonMain` | [#1049](https://github.com/alchemy-run/alchemy/issues/1049) | [#1050](https://github.com/alchemy-run/alchemy/pull/1050) |
| `StaticSite` duplicates every `env` resource into its namespace | [#1052](https://github.com/alchemy-run/alchemy/issues/1052) | [#1053](https://github.com/alchemy-run/alchemy/pull/1053) *(draft — breaking)* |
| Tagged resource without its layer → opaque `news.name` TypeError | [#1054](https://github.com/alchemy-run/alchemy/issues/1054) | [#1055](https://github.com/alchemy-run/alchemy/pull/1055) |

A fifth is **unfiled**: `Test.getWhenReady` doesn't handle Alchemy's own
pre-create stub, which answers HTTP 200 — measured at 4/15 versus 11/15 for a
plain exponential retry.

This resource sidesteps the two `StaticSite` bugs by construction, which is also
why it diverges from the shipped `Website.StaticSite`.

---

## Layout

```
infra/Astro.ts            the resource — Vite-shaped, class + plain form, dev branch
infra/site.ts             the Site declaration + SiteEnv via InferEnv
infra/ApiWorker.ts        Effect-native sibling Worker with RPC methods
src/                      the Astro app (SSR, prerendered, collections, Svelte, actions)
test/astro.test.ts        12 live deploy tests
test/astro.local.test.ts  3 dev tests
ASTRO.md                  the guide
```

## Running it

Requires Cloudflare credentials (`alchemy` picks up its usual auth).

```sh
bun install
bun test test/astro.test.ts     # deploys, asserts, destroys
NO_DESTROY=1 bun test …         # keep the stack up between runs
```

Tests use `alchemy/Test/Bun`, so they run under plain `bun test` — no
`alchemy-test` CLI needed.

---

## Caveats worth repeating

- Not reviewed. Not hardened. Not a library.
- `infra/Astro.ts` is a *proposal* for what a `Cloudflare.Website.Astro` could
  look like, not a considered API.
- The dev-mode registry bridge is incomplete and left in deliberately, with its
  failure documented, so the next person doesn't re-derive it from scratch.
- One earlier finding — unreachable Svelte-compiler chunks bloating the worker —
  was **retracted**; it didn't reproduce on a cold Vite cache. Recorded in
  `ASTRO.md` so nobody chases it again.
