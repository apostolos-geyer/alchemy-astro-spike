import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import ApiWorker from "../../infra/ApiWorker.ts";
import { Site } from "../../infra/site.ts";

/**
 * Proves the split layout: this stack file lives in `stacks/site/`, the Astro
 * app root is somewhere else entirely, and `Site` anchors itself with
 * `import.meta.url`. Nothing here passes a path.
 *
 *   bun alchemy deploy  stacks/site/alchemy.run.ts
 *   bun alchemy destroy stacks/site/alchemy.run.ts
 */
export default Alchemy.Stack(
  "AstroSplitLayout",
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
