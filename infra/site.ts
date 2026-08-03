import * as Cloudflare from "alchemy/Cloudflare";
import ApiWorker, { Uploads } from "./ApiWorker.ts";
import { Astro } from "./Astro.ts";

export const SessionKv = Cloudflare.KV.Namespace("SessionKv");
export const Cache = Cloudflare.KV.Namespace("Cache");

/**
 * Identical in shape to the blessed `Cloudflare.Website.Vite` declaration in
 * examples/cloudflare-tanstack — module-level resources referenced from `env`,
 * class form, `InferEnv` for the app-side types.
 */
export class Site extends Astro<Site>()("Site", {
  // Workers Cache fronts the Worker. The Astro adapter would emit
  // `cache: { enabled: true }` into its wrangler.json when astro's
  // `cache.provider` is cloudflare — Alchemy never reads that, so set it here.
  cache: { enabled: true },
  env: {
    SESSION: SessionKv,
    CACHE: Cache,
    UPLOADS: Uploads,
    API: ApiWorker,
    GREETING: "hello-from-alchemy",
  },
}) {}

/** The workerd `Env` for the Astro app, derived from the declaration above. */
export type SiteEnv = Cloudflare.InferEnv<typeof Site>;
