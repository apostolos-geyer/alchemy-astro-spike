import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import ApiWorker from "./infra/ApiWorker.ts";
import { Site } from "./infra/site.ts";

// Deliberately identical to the stack in test/astro.test.ts: `infra/site.ts`
// is the ONE declaration of the site and its bindings. Calling `Astro(...)`
// here instead would ship a worker with no `env` — which is exactly how
// /counter (SESSION) and /cached (cache) silently lost their bindings while
// the tests, which deploy `Site`, kept passing.
export default Alchemy.Stack(
  "AstroSsrSpike",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    yield* ApiWorker;
    const site = yield* Site;
    return { url: site.url };
  }),
);
