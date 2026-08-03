# astro-ssr-spike

A working spike: **Astro SSR deployed to Cloudflare Workers via [Alchemy](https://github.com/alchemy-run/alchemy)**,
using a `Cloudflare.Website.Astro` resource shaped as a peer of `Website.Vite`.

> [!WARNING]
> **This is 100% Claude-authored and has barely been human-reviewed.**
> Every line of `infra/`, `test/`, and the docs was written by Claude Code in a
> single exploratory session. It has not had a careful human pass. The *claims*
> are backed by tests that ran against real Cloudflare — see below for exactly
> what is and isn't verified — but the code quality, API design, and naming have
> not been scrutinised by anyone. Treat it as a detailed research artifact, not
> as a contribution ready to merge.

## What it demonstrates

`Cloudflare.Website.Vite` can't build Astro — Astro's build is driven by the
`astro` CLI, not a plain `vite build`. But the *output* of `@astrojs/cloudflare`
is an ordinary Workers-with-assets deployment, so a peer resource with the same
signature works:

```ts
export class Site extends Astro<Site>()("Site", {
  cache: { enabled: true },
  env: { SESSION: SessionKv, CACHE: Cache, UPLOADS: Uploads, API: ApiWorker },
}) {}

export type SiteEnv = Cloudflare.InferEnv<typeof Site>;
```

The load-bearing detail: **Alchemy never reads the `dist/server/wrangler.json`
that the adapter emits**, so every line of that contract — `no_bundle`,
`nodejs_compat`, the `SESSION` KV binding, `IMAGES` — has to be mirrored into
the resource explicitly, or it silently doesn't happen.

## Status

| | |
|---|---|
| Deploy path | **12 / 12** live tests against real Cloudflare |
| Local dev | **2 / 3** — service bindings to Alchemy's local Workers don't resolve |
| Versions | Astro `7.1.6`, `@astrojs/cloudflare` `14.1.7`, `alchemy@2.0.0-beta.67` |

Verified: per-request SSR · prerendered routes off the assets layer ·
`nodejs_compat` · Astro sessions over bound KV (cookie round-trip) · KV / R2 /
vars / service bindings · typed RPC via `toRpcAsync` into an Effect-native
Worker · `InferEnv` types · Svelte islands · content collections (prerendered
*and* request-time) · middleware · Astro Actions · `_redirects` · Workers Cache ·
idempotent redeploys · clean teardown.

**Not verified:** the dev service-binding bridge resolving live, Windows paths,
monorepo `cwd`, `auxiliaryWorkers`.

**[`ASTRO.md`](./ASTRO.md) is the real document** — the full adapter→Alchemy
mapping table, every verified capability with its evidence, the dev-mode limits,
and 11 footguns with the actual error strings they produce.

## Upstream bugs found

Four bugs in Alchemy surfaced while building this. All reproduced on latest
`main`, none duplicates; issues and PRs filed:

| Bug | Issue | PR |
|---|---|---|
| `StaticSite` passes an object as the assets hash → re-uploads every deploy | [#1056](https://github.com/alchemy-run/alchemy/issues/1056) | [#1057](https://github.com/alchemy-run/alchemy/pull/1057) |
| Output-valued `main` crashes pre-create in `isPythonMain` | [#1049](https://github.com/alchemy-run/alchemy/issues/1049) | [#1050](https://github.com/alchemy-run/alchemy/pull/1050) |
| `StaticSite` duplicates every `env` resource into its namespace | [#1052](https://github.com/alchemy-run/alchemy/issues/1052) | [#1053](https://github.com/alchemy-run/alchemy/pull/1053) (draft — breaking) |
| Tagged resource without its layer → opaque `news.name` TypeError | [#1054](https://github.com/alchemy-run/alchemy/issues/1054) | [#1055](https://github.com/alchemy-run/alchemy/pull/1055) |

The resource here sidesteps the two `StaticSite` bugs by construction, which is
also why it diverges from the shipped `Website.StaticSite`.

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

## Caveats worth repeating

- Not reviewed. Not hardened. Not a library.
- `infra/Astro.ts` is a *proposal* for what a `Cloudflare.Website.Astro` could
  look like, not a considered API.
- The dev-mode registry bridge is incomplete and left in deliberately, with its
  failure documented, so the next person doesn't re-derive it from scratch.
- One earlier finding (unreachable Svelte-compiler chunks bloating the worker)
  was **retracted** — it didn't reproduce on a cold Vite cache. Noted in
  `ASTRO.md` so nobody chases it again.
