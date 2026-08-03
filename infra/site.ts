import * as Cloudflare from "alchemy/Cloudflare";
import { fileURLToPath } from "node:url";
import ApiWorker, { Uploads } from "./ApiWorker.ts";
import { Astro } from "./Astro.ts";

/**
 * The Astro app root, derived from this module rather than from `process.cwd()`
 * so the stack works regardless of where it is invoked from — and so it would
 * keep working if this file moved to another package.
 */
const appRoot = fileURLToPath(new URL("..", import.meta.url));

export const SessionKv = Cloudflare.KV.Namespace("SessionKv");
export const Cache = Cloudflare.KV.Namespace("Cache");

/**
 * Identical in shape to the blessed `Cloudflare.Website.Vite` declaration in
 * examples/cloudflare-tanstack — module-level resources referenced from `env`,
 * class form, `InferEnv` for the app-side types.
 */
export class Site extends Astro<Site>()("Site", {
  cwd: appRoot,
  // Workers Cache fronts the Worker. A Cloudflare concern, so it is declared
  // here rather than via astro's `cache.provider`.
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
