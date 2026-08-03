# Astro SSR on Cloudflare with Alchemy

Status: **deploy path verified end-to-end (12/12 live tests). Dev path partial (2/3).**
Verified against Astro `7.1.6`, `@astrojs/cloudflare` `14.1.7`, `alchemy@2.0.0-beta.67`.

`Cloudflare.Website.Vite` cannot build Astro — Astro's build is driven by the
`astro` CLI, not a plain `vite build`. But the *output* is an ordinary
Workers-with-assets deployment, so a peer resource shaped exactly like
`Website.Vite` works. That resource is [`infra/Astro.ts`](./infra/Astro.ts).

---

## 1. Why this works: the adapter tells you its contract

`@astrojs/cloudflare` v14 writes `dist/server/wrangler.json` at build time:

```jsonc
{ "main": "entry.mjs", "no_bundle": true,
  "rules": [{ "type": "ESModule", "globs": ["**/*.js", "**/*.mjs"] }],
  "assets": { "binding": "ASSETS", "directory": "../client" },
  "compatibility_date": "2026-04-15", "compatibility_flags": [],
  "kv_namespaces": [{ "binding": "SESSION" }],   // no id — a Wrangler provisioning placeholder
  "images": { "binding": "IMAGES" } }
```

**Alchemy never reads this file.** That is the single most important fact
here. Every line of it must be mirrored into the Alchemy resource, or it
simply doesn't happen.

| Adapter emits | Alchemy equivalent | Notes |
|---|---|---|
| `main: entry.mjs` | `main: "dist/server/entry.mjs"` | must be a **static string** (see §5) |
| `no_bundle: true` | `bundle: false` | **mandatory** — re-bundling breaks the route manifest |
| `assets.directory: ../client` | `assets.directory: "dist/client"` | server/client already split; no `.assetsignore` juggling |
| `compatibility_date` | `compatibility.date` | mirror it |
| `compatibility_flags: []` | `compatibility.flags` | **adapter emits none** — you must add `nodejs_compat` |
| `kv_namespaces: [{SESSION}]` | `env: { SESSION: KV.Namespace(...) }` | **verified required** (§3) |
| `images: {IMAGES}` | Images binding in `env` | verified **absent** unless you bind it |
| `client/_headers` | read automatically | `Assets.ts` picks up `_headers`/`_redirects` free |
| `cache: { enabled: true }` | `cache: { enabled: true }` | plain passthrough — see §3a |
| `auxiliaryWorkers` | separate `Worker` resources | unmapped |

---

## 2. Usage

```ts
// astro.config.mjs
import cloudflare from "@astrojs/cloudflare";
export default defineConfig({
  output: "server",
  adapter: cloudflare({ configPath: "./.dev.wrangler.json" }), // dev bindings, see §6
  integrations: [svelte()],
});
```

```ts
// infra/site.ts — module-level resources referenced from env, exactly like
// the blessed Website.Vite pattern in examples/cloudflare-tanstack
import * as Cloudflare from "alchemy/Cloudflare";
import ApiWorker, { Uploads } from "./ApiWorker.ts";
import { Astro } from "./Astro.ts";

export const SessionKv = Cloudflare.KV.Namespace("SessionKv");
export const Cache = Cloudflare.KV.Namespace("Cache");

export class Site extends Astro<Site>()("Site", {
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
  }).pipe(Effect.provide([/* any Effect-native Worker layers */])),
);
```

### Reading bindings in app code

```ts
import { env } from "cloudflare:workers";          // NOT Astro.locals.runtime.env
import type { SiteEnv } from "../infra/site.ts";

const e = env as unknown as SiteEnv;               // fully typed by InferEnv
await e.CACHE.put("k", "v");
```

Astro v6 **removed** the old accessors; the getters throw with the replacement named:

| removed | use |
|---|---|
| `Astro.locals.runtime.env` | `import { env } from "cloudflare:workers"` |
| `Astro.locals.runtime.cf` | `Astro.request.cf` |
| `Astro.locals.runtime.caches` | global `caches` |
| `Astro.locals.runtime.ctx` | `Astro.locals.cfContext` |

### Calling an Effect-native Worker with typed RPC

Astro's entry is owned by Astro and never bundled by Alchemy (`bundle: false`),
so you **cannot** `Effect.provide` capability layers onto it. Keep Effect logic
in a sibling Worker and reach it typed:

```ts
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";  // narrow entry, NOT alchemy/Cloudflare
import type ApiWorker from "../infra/ApiWorker.ts";

const api = toRpcAsync<typeof ApiWorker>(e.API);
await api.greet("astro");             // Effect method -> Promise
await api.readUpload("probe.txt");    // goes through R2 ReadWriteBucket in the Effect worker
```

---

## 3. Verified capabilities (deploy path, 12/12 live)

`test/astro.test.ts`, run against real Cloudflare:

- SSR renders **per request** (nonce differs; live `cf-ray`/`colo`)
- Prerendered routes served by the **ASSETS layer** (build stamp identical across requests)
- `nodejs_compat` applied by Alchemy — `node:buffer` resolves
- **Astro sessions** over the Alchemy-bound `SESSION` KV — cookie round-trip `1 → 2 → 3`
- **Bindings**: KV, R2, plain vars, service-binding `fetch`, typed **`toRpcAsync`** RPC
- **`InferEnv`** produces real types (`KVNamespace`, `R2Bucket`) — probed with `@ts-expect-error` negatives
- **Svelte** island SSR + hydration chunks served from `/_astro/*`
- **Content collections** both ways (§4)
- **Middleware** runs on SSR routes, bypassed on prerendered ones
- **Astro Actions** — success + typed `ActionError` → 400 (devalue-encoded, not plain JSON)
- **`_redirects`** — real 301 with `Location` (curl-verified; `HttpClient` follows redirects, so assert the outcome)
- **`IMAGES` absent** unless Alchemy binds it
- **Workers Cache** fronts the Worker when `cache: { enabled: true }` is set (§3a)
- Idempotent redeploy → `Plan: N to noop`; clean teardown, zero leaks

### 3a. Workers Cache — and the trap that comes with it

`cache` is a **plain passthrough**: `AstroProps extends Omit<WorkerProps, …>`, so it
already flows through `...props` to the Worker. Alchemy's own docs describe exactly
Astro's situation — *"Workers whose `main` module exports a plain async `fetch`
handler enable the cache with the `cache` prop"* — which is what `bundle: false`
Astro is. `WorkerCache` accepts `{ enabled, crossVersionCache }`.

```ts
export class Site extends Astro<Site>()("Site", {
  cache: { enabled: true },   // the adapter would emit this; Alchemy never reads it
  env: { … },
});
```

**The trap:** Workers Cache is a read-through cache in front of the **entire**
Worker. Turning it on immediately started serving cached renders for `/ssr` and
`/ssr-content` — identical nonces, SSR silently dead. With `output: "server"` most
of your routes are dynamic, so each one must opt out explicitly:

```ts
Astro.response.headers.set("Cache-Control", "no-store");
```

Verified behaviorally, not just by config: `/cached` sets
`Cache-Control: public, max-age=300` + `Cache-Tag`, and repeat requests return an
**identical** nonce — the edge is serving without invoking the handler.

### Content collections: where does content go?

Both, depending on **when you read the collection**:

| pattern | `dist/client` | `dist/server` |
|---|---|---|
| `prerender = true` + `getStaticPaths` | rendered HTML | **content absent** |
| request-time `getCollection()` in an SSR page | — | **+152K `_astro_data-layer-content_*.mjs`** |

Flipping the one SSR page to prerendered removed the data-layer chunk entirely.
Size for 12 posts + Svelte + collections: **952K server / 156K client / 21 assets** —
comfortable against Cloudflare's 3 MB (free) / 10 MB (paid) script limit. Watch it
on a large content site that reads collections at request time.

---

## 4. Local dev (partial)

`alchemy dev` → skips the build → emits `.dev.wrangler.json` from the stack →
spawns `astro dev` in the foreground → Worker in `dev: { mode: "external" }`.

| binding | dev | note |
|---|---|---|
| KV / R2 / D1 / vars | ✅ | **miniflare-local stores — names match, state does NOT** |
| Service → Alchemy Worker | ❌ | see below |
| SESSION / IMAGES / ASSETS | ✅ | adapter auto-provides |

**The env proxy is NOT needed.** Unlike TanStack Start, top-level
`import { env } from "cloudflare:workers"` works in `astro dev` — module-eval and
request-time reads return identical keys, and a Proxy changes nothing.

**Service bindings do not resolve in dev.** Alchemy runs **workerd directly, not
miniflare**, and writes its dev registry to `~/.local/state/alchemy/registry`:

```jsonc
// alchemy
{ "scriptName": "...", "debugPortAddress": "127.0.0.1:53995",
  "services": [{ "kind": "worker", "fetchService": "user-worker", "rpcService": "user-worker" }] }
// miniflare (WorkerDefinition)
{ "debugPortAddress": "...", "defaultEntrypointService": "...", "userWorkerService": "..." }
```

Same protocol generation, different shape. `infra/Astro.ts` **implements the
translation** and points `astro dev` at it via `MINIFLARE_REGISTRY_PATH` (the CF
vite plugin reads that, via miniflare's `getDefaultDevRegistryPath()`; `wrangler dev`
reads `WRANGLER_REGISTRY_PATH` — both are set). The bridged file is written with the
correct fields and the env vars verifiably reach the process, **but miniflare still
reports `Worker "…" not found`**. Unresolved. Until then, call sibling Workers over
HTTPS in dev.

Also dead ends, tested: `experimental_remote: true` is silently ignored;
`remote: true` stops `astro dev` booting entirely.

---

## 5. Footguns (each one cost real debugging time)

1. **`main` must be a static string.** Worker pre-create runs *concurrently* with
   `Command.Build`, so an `Output` is unresolved there and crashes
   `getCompatibility → isPythonMain`. Ordering comes from the Output-valued `assets`.
   (Upstream: [#1049](https://github.com/alchemy-run/alchemy/issues/1049))
2. **Gitignore `.alchemy/`** or `Command.Build` never memoizes — `.alchemy/log/out`
   is rewritten every deploy, changing the input hash, causing infinite rebuilds.
3. **Never import the `alchemy/Cloudflare` barrel in app code** — it pulls `node:os`
   and breaks `astro dev` with `Failed to load url os`. Use `alchemy/Cloudflare/Bridge`.
4. **R2 `bucket_name` must be lowercase** in the dev config, or `astro dev` dies with
   only "Dev server process exited before becoming ready" — no diagnostic.
5. **Namespace only the Build.** Wrapping the whole resource in `Namespace.push(id)`
   (what `Website.StaticSite` does) resolves `env` inside that namespace and
   **duplicates every referenced resource**. (Upstream: [#1052](https://github.com/alchemy-run/alchemy/issues/1052))
6. **`assets.hash` must be a string.** `build.hash` is `{input, output}`; passing the
   object makes every deploy re-upload. (Upstream: [#1056](https://github.com/alchemy-run/alchemy/issues/1056))
7. **`ASTRO_DEV_BACKGROUND=1`** on the dev command — Astro 7 daemonizes when it
   detects an agent-run terminal, and a daemonized server survives `alchemy destroy`.
8. **`bun test` doesn't put `node_modules/.bin` on the spawn PATH** — use
   `command: "bun run build"`, not `"astro build"`, in tests.
9. **Astro Actions are devalue-encoded** (`[{"echoed":1},"HI",...]`), not plain JSON.
10. **`HttpClient` follows redirects** at the transport level — assert the outcome,
    not the 3xx status.
11. **Enabling `cache` silently disables SSR** on every dynamic route that doesn't
    send `Cache-Control: no-store`. Nothing errors; the page just stops re-rendering.

---

## 6. Files

| path | what |
|---|---|
| `infra/Astro.ts` | the resource — `Website.Vite`-shaped, class + plain form, dev branch |
| `infra/site.ts` | the `Site` declaration + `SiteEnv` via `InferEnv` |
| `infra/ApiWorker.ts` | Effect-native sibling Worker with RPC methods |
| `test/astro.test.ts` | 11 live deploy tests |
| `test/astro.local.test.ts` | 3 dev tests (2 pass) |

Run: `bun test test/astro.test.ts` (deploys + destroys via `alchemy/Test/Bun`).
Set `NO_DESTROY=1` to keep the stack up between runs.

---

## 7. Still unverified

- The dev service-binding bridge resolving live (§4)
- Windows paths — `main` is built with `"/"` joins
- `cwd` for a monorepo subdirectory: written, never exercised
- `auxiliaryWorkers` (would be separate `Worker` resources)
