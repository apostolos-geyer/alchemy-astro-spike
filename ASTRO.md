# Astro SSR on Cloudflare with Alchemy

Field guide · verified 3 Aug 2026 · Astro `7.1.6` · `@astrojs/cloudflare` `14.1.7` · `alchemy@2.0.0-beta.67`

| | |
|---|---|
| **Deploy path** | 12 / 12 live tests — at best, see the note below |
| **Local dev** | 2 / 3 — service bindings to Alchemy's local Workers don't resolve |
| **Browser** | verified — hydration 7 → 8, no console errors |

> [!NOTE]
> **12/12 is the best case.** On a busy account runs drop to ~10–11/15 from edge
> propagation, not from code. Established by control: the *previous CLI-based*
> resource scores the same on the same harness in the same session. Failures look
> like empty bodies, 500s while bindings propagate, and
> `"Alchemy worker is being deployed..."` — Alchemy's pre-create stub, which
> answers HTTP **200**, so a status-only retry sails straight past it.
> Re-run before believing a failure.

---

## The design: single source of truth

`Cloudflare.Website.Vite` cannot build Astro — Astro's build is driven by the
`astro` CLI, not a plain `vite build`. But Astro exposes a **Node API**
(`build` / `dev`, taking an `AstroInlineConfig extends AstroUserConfig`), so
Alchemy drives it directly and injects the Cloudflare adapter — exactly as
`Website.Vite` injects the Cloudflare vite plugin.

Your config holds app concerns only:

```js
// astro.config.mjs
export default defineConfig({ integrations: [svelte()] });
```

Alchemy loads it via `configFile` and layers its own overrides on top:

```js
// generated at .alchemy/astro-build.mjs — never hand-edited
import { build } from "astro";
import cloudflare from "@astrojs/cloudflare";

await build({
  configFile: "astro.config.mjs",   // MUST be relative — astro joins it onto `root`
  output: "server",
  adapter: cloudflare({ sessionKVBindingName: "SESSION" }),
});
```

No adapter, no `output`, no `configPath` in your config. `sessionBinding` and
`imagesBinding` are resource props injected into the adapter, so nothing
Cloudflare-facing is authored twice.

The resource is [`infra/Astro.ts`](./infra/Astro.ts).

---

## The contract

`@astrojs/cloudflare` v14 writes `dist/server/wrangler.json` at build time,
stating exactly what it needs:

```jsonc
{ "main": "entry.mjs", "no_bundle": true,
  "rules": [{ "type": "ESModule", "globs": ["**/*.js", "**/*.mjs"] }],
  "assets": { "binding": "ASSETS", "directory": "../client" },
  "compatibility_date": "2026-04-15", "compatibility_flags": [],
  "kv_namespaces": [{ "binding": "SESSION" }],   // no id — a Wrangler provisioning placeholder
  "images": { "binding": "IMAGES" } }
```

> [!IMPORTANT]
> **Alchemy never reads that file.** It is the single most important fact here.
> Every line must be mirrored into the resource or it simply doesn't happen —
> which is why `nodejs_compat`, the `SESSION` KV namespace, and the adapter's
> binding names are all supplied by the resource.

| Adapter emits | Alchemy equivalent | Notes |
|---|---|---|
| `main: entry.mjs` | `main: "dist/server/entry.mjs"` | must be a **static string** |
| `no_bundle: true` | `bundle: false` | **mandatory** — re-bundling breaks the route manifest |
| `assets.directory: ../client` | `assets.directory: "dist/client"` | server/client already split; no `.assetsignore` juggling |
| `compatibility_date` | `compatibility.date` | mirror it |
| `compatibility_flags: []` | `compatibility.flags` | adapter emits **none** — add `nodejs_compat` |
| `kv_namespaces: [SESSION]` | `env: { SESSION: KV.Namespace(…) }` | verified required |
| `images: { IMAGES }` | Images binding in `env` | verified **absent** unless bound |
| `client/_headers` | read automatically | `_headers` / `_redirects` come free |
| `sessionKVBindingName` | `sessionBinding` prop | injected into the adapter |
| `imagesBindingName` | `imagesBinding` prop | injected into the adapter |
| `cache: { enabled: true }` | `cache: { enabled: true }` | plain passthrough — [see below](#workers-cache) |
| `auxiliaryWorkers` | separate `Worker` resources | unmapped |

---

## Usage

```ts
// infra/site.ts — module-level resources referenced from env, exactly like the
// blessed Website.Vite pattern in examples/cloudflare-tanstack
import * as Cloudflare from "alchemy/Cloudflare";
import ApiWorker, { Uploads } from "./ApiWorker.ts";
import { Astro } from "./Astro.ts";

export const SessionKv = Cloudflare.KV.Namespace("SessionKv");
export const Cache = Cloudflare.KV.Namespace("Cache");

export class Site extends Astro<Site>()("Site", {
  cache: { enabled: true },
  env: {
    SESSION: SessionKv,          // Astro sessions
    CACHE: Cache,
    UPLOADS: Uploads,
    API: ApiWorker,              // service binding to an Effect-native Worker
    GREETING: "hello-from-alchemy",
  },
}) {}

/** Workerd `Env` for the app — derived, never hand-written. */
export type SiteEnv = Cloudflare.InferEnv<typeof Site>;
```

```ts
// alchemy.run.ts
export default Alchemy.Stack("MySite",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    yield* ApiWorker;
    const site = yield* Site;
    return { url: site.url.as<string>() };
  }).pipe(Effect.provide([/* Effect-native Worker layers */])),
);
```

### Reading bindings

```ts
import { env } from "cloudflare:workers";          // NOT Astro.locals.runtime.env
import type { SiteEnv } from "../infra/site.ts";

const e = env as unknown as SiteEnv;               // fully typed by InferEnv
await e.CACHE.put("k", "v");
```

Astro v6 **removed** the old accessors — the getters throw, naming the replacement:

| Removed | Use instead |
|---|---|
| `Astro.locals.runtime.env` | `import { env } from "cloudflare:workers"` |
| `Astro.locals.runtime.cf` | `Astro.request.cf` |
| `Astro.locals.runtime.caches` | global `caches` |
| `Astro.locals.runtime.ctx` | `Astro.locals.cfContext` |

This is an improvement for infrastructure code: `env` is a module import, so
*any* file reaches bindings, not just ones with `Astro` in scope.

### Calling an Effect-native Worker with typed RPC

`bundle: false` means Astro owns its entry and Alchemy never bundles it, so you
**cannot** `Effect.provide` capability layers onto Astro itself. Keep Effect
logic in a sibling Worker and reach it typed:

```ts
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";  // narrow entry, NOT alchemy/Cloudflare
import type ApiWorker from "../infra/ApiWorker.ts";

const api = toRpcAsync<typeof ApiWorker>(e.API);
await api.greet("astro");             // Effect method → Promise
await api.readUpload("probe.txt");    // through R2 ReadWriteBucket in the Effect worker
```

Live response from the deployed site:

```json
{ "kv": "kv-ok", "r2": "r2-ok",
  "serviceFetch":  { "from": "fetch-handler" },
  "rpcGreet":      "hello astro, from the Effect worker",
  "rpcReadUpload": "r2-ok",
  "plainVar":      "hello-from-alchemy" }
```

---

## Verified capabilities

`test/astro.test.ts`, deployed to real Cloudflare and torn down each run.

- SSR renders **per request** — nonce differs, live `cf-ray` and `colo`
- Prerendered routes served by the **ASSETS layer** — build stamp identical across requests
- `nodejs_compat` applied by Alchemy — `node:buffer` resolves
- **Astro sessions** over the bound `SESSION` KV — cookie round-trip `1 → 2 → 3`
- **Bindings** — KV, R2, plain vars, service-binding `fetch`, typed `toRpcAsync` RPC
- **`InferEnv`** yields real types, probed with `@ts-expect-error` negatives
- **Svelte** island SSR + hydration chunks from `/_astro/*` — and hydration
  **verified in a real browser**: clicking the island took the counter 7 → 8,
  with no console errors
- **Content collections** both ways ([below](#content-collections))
- **Middleware** runs on SSR routes, bypassed on prerendered ones
- **Astro Actions** — success and typed `ActionError` → 400
- **`_redirects`** — real 301 with `Location` (curl-verified)
- **`IMAGES` absent** unless Alchemy binds it
- **Workers Cache** fronts the Worker when `cache` is set ([below](#workers-cache))
- Idempotent redeploy → `Plan: N to noop`; clean teardown, zero leaks

> [!TIP]
> Two assertions that look right but silently pass for the wrong reason: a
> session test without a cookie jar (every request is a fresh session, so
> `count=1` always), and a redirect test through `HttpClient`, which follows 3xx
> at the transport level — assert the landing page, not the status.

### Workers Cache

Not a missing mapping — a **plain passthrough**. `AstroProps extends
Omit<WorkerProps, …>`, so `cache` already flows through `...props`. Alchemy's
own docs describe exactly Astro's situation — *"Workers whose `main` module
exports a plain async `fetch` handler enable the cache with the `cache` prop"* —
which is what `bundle: false` Astro is. `WorkerCache` accepts
`{ enabled, crossVersionCache }`.

> [!WARNING]
> **Enabling the cache silently disables SSR.** Workers Cache is a read-through
> cache in front of the *entire* Worker. Turning it on immediately started
> serving cached renders for `/ssr` and `/ssr-content` — identical nonces, SSR
> dead, nothing logged. With `output: "server"` most routes are dynamic, so each
> must opt out: `Astro.response.headers.set("Cache-Control", "no-store")`.

Verified behaviorally, not by config inspection: `/cached` sends
`Cache-Control: public, max-age=300` plus a `Cache-Tag`, and repeat requests
return an **identical** nonce — the edge answers without invoking the handler.

### Content collections

Where content lands depends on **when you read the collection**:

| Pattern | `dist/client` | `dist/server` |
|---|---|---|
| `prerender = true` + `getStaticPaths` | rendered HTML | **content absent** |
| request-time `getCollection()` | — | **+152K** `_astro_data-layer-content_*.mjs` |

Flipping the single SSR page to prerendered removed the data-layer chunk
entirely. For 12 posts + Svelte + collections: **952K server / 156K client /
21 assets** — comfortable against the 3 MB (free) / 10 MB (paid) script limit.
Watch it on a large content site that reads collections at request time.

---

## Local dev

`alchemy dev` skips the build, emits `.dev.wrangler.json` from the stack, runs a
generated module that calls astro's `dev()` directly, and puts the Worker in
`dev: { mode: "external" }`. Alchemy injects `configPath` into the adapter, so
your `astro.config` needs no dev wiring — and with no `astro` CLI in the loop
there is no daemon to outlive `alchemy destroy`.

| Binding | Status | Note |
|---|---|---|
| KV / R2 / D1 / vars | works | miniflare-local stores — names match, **state does not** |
| Service → Alchemy Worker | **broken** | bridge built, doesn't resolve |
| SESSION / IMAGES / ASSETS | works | adapter auto-provides |

**The env proxy is not needed.** Unlike TanStack Start, top-level
`import { env } from "cloudflare:workers"` works in `astro dev` — module-eval
and request-time reads return identical keys, and a Proxy changes nothing.

<details>
<summary><b>Why service bindings don't resolve</b></summary>

Alchemy runs **workerd directly, not miniflare**, and writes its dev registry to
`~/.local/state/alchemy/registry`. Same protocol generation as miniflare,
different JSON shape:

```jsonc
// alchemy
{ "scriptName": "…", "debugPortAddress": "127.0.0.1:53995",
  "services": [{ "kind": "worker", "fetchService": "user-worker", "rpcService": "user-worker" }] }

// miniflare (WorkerDefinition)
{ "debugPortAddress": "…", "defaultEntrypointService": "…", "userWorkerService": "…" }
```

`infra/Astro.ts` **implements that translation** and points `astro dev` at it via
`MINIFLARE_REGISTRY_PATH` (what the CF vite plugin reads, via miniflare's
`getDefaultDevRegistryPath()`; `wrangler dev` reads `WRANGLER_REGISTRY_PATH` —
both are set). The bridged file has the right fields and the env vars verifiably
reach the process, but miniflare still reports `Worker "…" not found`.
**Unresolved.** Call sibling Workers over HTTPS in dev until it is.

Dead ends, both tested: `experimental_remote: true` is silently ignored;
`remote: true` stops `astro dev` booting at all.

</details>

---

## Footguns

Each cost real debugging time. Most fail with no useful diagnostic.

| Symptom | Cause and fix |
|---|---|
| `TypeError: undefined is not an object (evaluating 'main.split("?")[0]')` | `main` must be a **static string**. Worker pre-create runs concurrently with `Command.Build`, so an `Output` is unresolved there. Ordering comes from the Output-valued `assets`. ([#1049](https://github.com/alchemy-run/alchemy/issues/1049)) |
| `ERR_SERVER_NOT_RUNNING` at end of build | Run the generated runner under **`node`, not `bun`**. The adapter's prerenderer disposes a miniflare instance at end-of-build; the CLI swallowed the throw, a top-level `await build()` propagates it. |
| `ConfigNotFound: Unable to resolve --config "/abs/path"` | `configFile` must be **relative** — astro does `path.join(root, configFile)`. |
| Every deploy rebuilds, nothing changed | Gitignore `.alchemy/`. `.alchemy/log/out` is rewritten each deploy, changing `Command.Build`'s input hash forever. |
| `astro dev: Failed to load url os` | Never import the `alchemy/Cloudflare` barrel in app code — it pulls `node:os`. Use `alchemy/Cloudflare/Bridge`. |
| `Dev server process exited before becoming ready` | R2 `bucket_name` must be **lowercase** in the dev config. That is the entire diagnostic you get. |
| Duplicate resources: `Site/ApiWorker` alongside `ApiWorker` | Namespace only the Build. Wrapping the whole resource in `Namespace.push(id)` resolves `env` inside that namespace and re-creates everything it references. ([#1052](https://github.com/alchemy-run/alchemy/issues/1052)) |
| Worker re-uploads on every deploy | `assets.hash` must be a string. `build.hash` is `{input, output}`; the object never compares equal after a state round-trip. ([#1056](https://github.com/alchemy-run/alchemy/issues/1056)) |
| SSR routes stop re-rendering | Workers Cache fronts the whole Worker. Every dynamic route needs `Cache-Control: no-store`. Nothing errors. |
| Action response isn't the object you expected | Astro Actions are devalue-encoded — `[{"echoed":1},"HI",…]`, not plain JSON. |
| Redirect test asserts 200 | `HttpClient` follows 3xx at the transport level — assert the outcome, not the status. |

---

## Upstream bugs

Four found while building this; all reproduced on latest `main`, none duplicates.

| Bug | Issue | PR | State |
|---|---|---|---|
| `StaticSite` passes an object as the assets hash → re-uploads every deploy | [#1056](https://github.com/alchemy-run/alchemy/issues/1056) | [#1057](https://github.com/alchemy-run/alchemy/pull/1057) | ready |
| Output-valued `main` crashes pre-create in `isPythonMain` | [#1049](https://github.com/alchemy-run/alchemy/issues/1049) | [#1050](https://github.com/alchemy-run/alchemy/pull/1050) | ready |
| `StaticSite` duplicates every `env` resource into its namespace | [#1052](https://github.com/alchemy-run/alchemy/issues/1052) | [#1053](https://github.com/alchemy-run/alchemy/pull/1053) | draft — breaking |
| Tagged resource without its layer → opaque `news.name` TypeError | [#1054](https://github.com/alchemy-run/alchemy/issues/1054) | [#1055](https://github.com/alchemy-run/alchemy/pull/1055) | ready |

A **fifth, not yet filed**: `Test.getWhenReady` retries the 404/5xx cold-start
window but not Alchemy's own pre-create stub, which answers HTTP **200**.
Measured on one busy-account session: `getWhenReady` alone scored **4/15** versus
**11/15** for a plain exponential retry, because the helper returns the stub
immediately instead of waiting it out.

This resource sidesteps the two `StaticSite` bugs by construction, which is also
why it diverges from the shipped `Website.StaticSite`.

---

## Files

| Path | What |
|---|---|
| `infra/Astro.ts` | the resource — `Website.Vite`-shaped, class + plain form, dev branch |
| `infra/site.ts` | the `Site` declaration + `SiteEnv` via `InferEnv` |
| `infra/ApiWorker.ts` | Effect-native sibling Worker with RPC methods |
| `test/astro.test.ts` | 12 live deploy tests |
| `test/astro.local.test.ts` | 3 dev tests (2 pass) |

```sh
bun test test/astro.test.ts     # deploys, asserts, destroys via alchemy/Test/Bun
NO_DESTROY=1 bun test …         # keep the stack up between runs
```

---

## Still unverified

- The dev service-binding bridge resolving live
- Windows paths — `main` is built with `"/"` joins
- `cwd` for a monorepo subdirectory: written, never exercised
- `auxiliaryWorkers` — would be separate `Worker` resources

> [!NOTE]
> One retraction worth recording: an earlier finding claimed 1.36 MB of
> unreachable Svelte-compiler chunks were bloating the worker. It was a one-off
> artifact of a single build and did not reproduce with a cold Vite cache. Clean
> builds are 952K / 25 files with zero dead chunks.
