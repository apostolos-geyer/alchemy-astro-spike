// Import the NARROW runtime entry, never the `alchemy/Cloudflare` barrel:
// the barrel pulls in node:os and friends, which breaks `astro dev` with
// "Failed to load url os".
import { toRpcAsync } from "alchemy/Cloudflare/Bridge";
import type { APIRoute } from "astro";
// Astro v6+ removed `Astro.locals.runtime.env`; bindings come from workerd.
import { env as rawEnv } from "cloudflare:workers";
import type ApiWorker from "../../../infra/ApiWorker.ts";
import type { SiteEnv } from "../../../infra/site.ts";

export const prerender = false;

// Fully typed by `InferEnv<typeof Site>` — no hand-written Env interface.
const env = rawEnv as unknown as SiteEnv;

export const GET: APIRoute = async () => {
  const results: Record<string, unknown> = {
    bindingNames: Object.keys(env).sort(),
  };

  await env.CACHE.put("probe", "kv-ok");
  results.kv = await env.CACHE.get("probe");

  await env.UPLOADS.put("probe.txt", "r2-ok");
  results.r2 = await (await env.UPLOADS.get("probe.txt"))?.text();

  // option 1 — plain service-binding fetch
  results.serviceFetch = await (await env.API.fetch("https://api/x")).json();

  // option 2 — typed RPC into the Effect Worker. Effect methods surface as
  // promises; no Effect runtime needed here.
  const api = toRpcAsync<typeof ApiWorker>(env.API);
  results.rpcGreet = await api.greet("astro");
  // Reads R2 through the Effect worker's capability layer, which this
  // (non-Effect, un-bundled-by-alchemy) entry cannot use directly.
  results.rpcReadUpload = await api.readUpload("probe.txt");

  results.plainVar = env.GREETING ?? null;

  return new Response(JSON.stringify(results), {
    headers: { "content-type": "application/json" },
  });
};
