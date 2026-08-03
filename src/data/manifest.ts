/**
 * The site's content is the spike's own findings. Every row here maps to an
 * assertion in test/astro.test.ts or a documented gap in ASTRO.md — nothing is
 * placeholder copy.
 */

export type Status = "verified" | "partial" | "unverified";

export interface ManifestRow {
  /** Three-letter code, in the spirit of the colo codes this stack reports. */
  code: string;
  capability: string;
  /** A route you can hit, or null where there is nothing to visit. */
  route: string | null;
  status: Status;
  evidence: string;
  /**
   * Imports `cloudflare:workers`, a virtual module that only exists inside
   * workerd. Fine when deployed, and fine under Alchemy's dev runner — which
   * injects the adapter, and with it the Cloudflare vite plugin. A bare
   * `astro dev` reads app-only config, so it has no workerd and cannot
   * resolve the module at all.
   */
  cfOnly?: boolean;
}

export const MANIFEST: ManifestRow[] = [
  {
    code: "SSR",
    capability: "Per-request render inside the Worker",
    route: "/ssr",
    status: "verified",
    evidence: "nonce differs across two requests",
  },
  {
    code: "STA",
    capability: "Prerendered routes served off the assets layer",
    route: "/",
    status: "verified",
    evidence: "build stamp identical across requests",
  },
  {
    code: "NDC",
    capability: "node:buffer under nodejs_compat",
    route: "/api/hello",
    status: "verified",
    evidence: "Alchemy sets the flag; the adapter does not",
  },
  {
    code: "SES",
    capability: "Astro sessions over a bound KV namespace",
    route: "/counter",
    status: "verified",
    evidence: "cookie round-trip against SESSION",
  },
  {
    code: "BND",
    capability: "KV, R2, vars and service bindings",
    route: "/api/bindings",
    status: "verified",
    evidence: "six bindings present on the deployed Worker",
    cfOnly: true,
  },
  {
    code: "RPC",
    capability: "Typed RPC into an Effect-native Worker",
    route: "/api/bindings",
    status: "verified",
    evidence: "toRpcAsync calls resolve as promises",
    cfOnly: true,
  },
  {
    code: "CNT",
    capability: "Content collections at build time",
    route: "/blog",
    status: "verified",
    evidence: "12 entries, byte-identical HTML",
  },
  {
    code: "CRT",
    capability: "Content collections at request time",
    route: "/ssr-content",
    status: "verified",
    evidence: "content store resolved in the server bundle",
  },
  {
    code: "ISL",
    capability: "Svelte islands, server-rendered then hydrated",
    route: "/ssr-content",
    status: "verified",
    evidence: "real browser: 7 to 8, no console errors",
  },
  {
    code: "MDW",
    capability: "Middleware on SSR, bypassed by static assets",
    route: "/ssr",
    status: "verified",
    evidence: "header present on /ssr, absent on /blog",
  },
  {
    code: "ACT",
    capability: "Astro Actions, including typed ActionError",
    route: "/_actions/echo",
    status: "verified",
    evidence: "200 on echo, 400 on boom",
  },
  {
    code: "RDR",
    capability: "_redirects honored by the assets layer",
    route: "/gone",
    status: "verified",
    evidence: "301 to the prerendered target",
  },
  {
    code: "CCH",
    capability: "Workers Cache in front of the Worker",
    route: "/cached",
    status: "verified",
    evidence: "nonce stops changing once warm",
  },
  {
    code: "IMG",
    capability: "IMAGES binding",
    route: "/api/images",
    status: "partial",
    evidence: "present in dev, absent on deploy — the plugin honors the adapter, Alchemy does not",
    cfOnly: true,
  },
  {
    code: "DEV",
    capability: "Service bindings resolving under astro dev",
    route: null,
    status: "unverified",
    evidence: "registry bridge incomplete, left in deliberately",
  },
  {
    code: "ENV",
    capability: "Windows paths, monorepo cwd, auxiliaryWorkers",
    route: null,
    status: "unverified",
    evidence: "never exercised",
  },
];

export interface Snag {
  ref: string;
  title: string;
  issue: string | null;
  pr: string | null;
  prNote?: string;
}

export const SNAGS: Snag[] = [
  {
    ref: "1056",
    title: "StaticSite passes an object as the assets hash, so every deploy re-uploads",
    issue: "https://github.com/alchemy-run/alchemy/issues/1056",
    pr: "https://github.com/alchemy-run/alchemy/pull/1057",
  },
  {
    ref: "1049",
    title: "An output-valued main crashes pre-create inside isPythonMain",
    issue: "https://github.com/alchemy-run/alchemy/issues/1049",
    pr: "https://github.com/alchemy-run/alchemy/pull/1050",
  },
  {
    ref: "1052",
    title: "StaticSite duplicates every env resource into its own namespace",
    issue: "https://github.com/alchemy-run/alchemy/issues/1052",
    pr: "https://github.com/alchemy-run/alchemy/pull/1053",
    prNote: "draft, breaking",
  },
  {
    ref: "1054",
    title: "A tagged resource without its layer throws an opaque news.name TypeError",
    issue: "https://github.com/alchemy-run/alchemy/issues/1054",
    pr: "https://github.com/alchemy-run/alchemy/pull/1055",
  },
  {
    ref: "—",
    title:
      "Test.getWhenReady treats Alchemy's own pre-create stub as ready, because the stub answers 200. Measured 4/15 against 11/15 for a plain exponential retry.",
    issue: null,
    pr: null,
    prNote: "unfiled",
  },
];

export interface Gate {
  route: string;
  label: string;
  mode: "static" | "ssr" | "endpoint" | "workerd";
  note: string;
}

export const GATES: Gate[] = [
  { route: "/ssr", label: "Per-request render", mode: "ssr", note: "New nonce and colo on every load" },
  { route: "/counter", label: "Session counter", mode: "ssr", note: "Increments in KV, keyed by cookie" },
  { route: "/ssr-content", label: "Content plus island", mode: "ssr", note: "Collection read in the Worker" },
  { route: "/blog", label: "Blog index", mode: "static", note: "12 entries, resolved at build" },
  { route: "/cached", label: "Cached render", mode: "ssr", note: "Stops changing once the edge warms" },
  { route: "/api/hello", label: "Hello endpoint", mode: "endpoint", note: "JSON, proves node:buffer works" },
  {
    route: "/api/bindings",
    label: "Bindings probe",
    mode: "workerd",
    note: "KV, R2, vars, service and RPC — needs the Cloudflare runtime",
  },
  {
    route: "/api/images",
    label: "Images probe",
    mode: "workerd",
    note: "Reports the binding as absent — needs the Cloudflare runtime",
  },
];

export const FLEET = [
  { key: "astro", value: "7.1.6" },
  { key: "@astrojs/cloudflare", value: "14.1.7" },
  { key: "@astrojs/svelte", value: "9.0.1" },
  { key: "svelte", value: "5.56.8" },
  { key: "alchemy", value: "2.0.0-beta.67" },
  { key: "effect", value: "4.0.0-beta.102" },
];
