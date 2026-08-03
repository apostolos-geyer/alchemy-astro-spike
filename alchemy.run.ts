import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { Astro } from "./infra/Astro.ts";

export default Alchemy.Stack(
  "AstroSsrSpike",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Astro("Website");
    return { url: site.url };
  }),
);
