import { expect } from "bun:test";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";
import ApiWorker from "../infra/ApiWorker.ts";
import { Site } from "../infra/site.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
});

const Stack = Alchemy.Stack(
  "AstroSsrSpike",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    yield* ApiWorker;
    const site = yield* Site;
    return { url: site.url.as<string>() };
  }),
);

const stack = beforeAll(deploy(Stack), { timeout: 300_000 });
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), { timeout: 300_000 });

/** Fresh workers.dev URLs take ~30s to serve; retry through propagation. */
const get = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client.get(url).pipe(
      Effect.filterOrFail(
        (r) => r.status !== 404,
        () => new Error(`still propagating: ${url}`),
      ),
      Effect.retry({ schedule: Schedule.exponential("1 second"), times: 12 }),
    );
  });

const body = (url: string) => get(url).pipe(Effect.flatMap((r) => r.text));

test(
  "prerendered route is served by the ASSETS layer, not the Worker",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const a = yield* body(`${url}/`);
    const b = yield* body(`${url}/`);

    expect(a).toContain("static page");
    const stamp = (h: string) => h.match(/data-built-at="([^"]+)"/)?.[1];
    expect(stamp(a)).toBeDefined();
    expect(stamp(a)).toBe(stamp(b));
  }),
  { timeout: 180_000 },
);

test(
  "SSR route renders per-request on the edge",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const a = yield* body(`${url}/ssr`);
    const b = yield* body(`${url}/ssr`);

    const nonce = (h: string) => h.match(/data-nonce="([^"]+)"/)?.[1];
    expect(nonce(a)).toBeDefined();
    expect(nonce(a)).not.toBe(nonce(b));
    expect(a).toMatch(/data-colo="[A-Z]{3}"/);
  }),
  { timeout: 180_000 },
);

test(
  "nodejs_compat is applied by Alchemy (adapter's wrangler.json sets no flags)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${url}/api/hello?echo=spike`);
    expect(res.status).toBe(200);

    const json = (yield* res.json) as Record<string, unknown>;
    expect(json.echo).toBe("spike");
    expect(json.nodeBuffer).toBe("YXN0cm8=");
  }),
  { timeout: 180_000 },
);

test(
  "Astro.session works over the Alchemy-bound SESSION KV namespace",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const page = yield* body(`${url}/counter`);
    expect(page).toMatch(/data-count="1"/);
    expect(page).toMatch(/data-error="none"/);
  }),
  { timeout: 180_000 },
);

test(
  "bindings + typed RPC into the Effect Worker reach the Astro app",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${url}/api/bindings`);
    expect(res.status).toBe(200);

    const json = (yield* res.json) as Record<string, any>;
    expect(json.bindingNames).toEqual(
      expect.arrayContaining([
        "API",
        "ASSETS",
        "CACHE",
        "GREETING",
        "SESSION",
        "UPLOADS",
      ]),
    );
    expect(json.kv).toBe("kv-ok");
    expect(json.r2).toBe("r2-ok");
    expect(json.plainVar).toBe("hello-from-alchemy");
    expect(json.serviceFetch?.from).toBe("fetch-handler");
    // Typed RPC — Effect methods called as promises from non-Effect code.
    expect(json.rpcGreet).toBe("hello astro, from the Effect worker");
    // Read back through the Effect worker's R2 capability layer.
    expect(json.rpcReadUpload).toBe("r2-ok");
  }),
  { timeout: 180_000 },
);

test(
  "content collection: prerendered index + entry pages are static assets",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const index = yield* body(`${url}/blog`);
    expect(index).toMatch(/data-count="12"/);

    const post = yield* body(`${url}/blog/post-3`);
    expect(post).toMatch(/data-post-id="post-3"/);
    // Rendered markdown body made it into the static HTML.
    expect(post).toContain("Paragraph 40 of post 3");

    // Prerendered => byte-identical across requests.
    const again = yield* body(`${url}/blog/post-3`);
    expect(again).toBe(post);
  }),
  { timeout: 180_000 },
);

test(
  "content collection read at REQUEST time + Svelte island SSR",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const a = yield* body(`${url}/ssr-content`);
    const b = yield* body(`${url}/ssr-content`);

    // Collection resolved in the Worker, not at build time.
    expect(a).toMatch(/data-count="12"/);
    expect(a).toMatch(/data-chars="7\d{4}"/);
    // ...and it is genuinely per-request.
    const nonce = (h: string) => h.match(/data-nonce="([^"]+)"/)?.[1];
    expect(nonce(a)).not.toBe(nonce(b));

    // Svelte island server-rendered with its prop applied.
    expect(a).toContain("svelte count: 7");
    expect(a).toMatch(/data-svelte-counter/);
    // Astro 7 hydrates via an INLINE <script> with dynamic imports, so the
    // island's client chunk is referenced in the script body, not a src attr.
    const chunks = [...a.matchAll(/\/_astro\/[A-Za-z0-9_.-]+\.js/g)].map(
      (m) => m[0],
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.some((c) => c.includes("Counter"))).toBe(true);
    // ...and those chunks are really served by the ASSETS layer.
    for (const chunk of [...new Set(chunks)]) {
      const js = yield* get(`${url}${chunk}`);
      expect(js.status).toBe(200);
    }
  }),
  { timeout: 180_000 },
);

test(
  "middleware runs on SSR routes and is bypassed by prerendered assets",
  Effect.gen(function* () {
    const { url } = yield* stack;

    const ssr = yield* get(`${url}/ssr`);
    expect(ssr.headers["x-astro-middleware"]).toBe("ran");
    expect(ssr.headers["x-astro-path"]).toBe("/ssr");

    // A prerendered route is served by the ASSETS layer, so middleware
    // never sees it.
    const stat = yield* get(`${url}/blog`);
    expect(stat.headers["x-astro-middleware"]).toBeUndefined();
  }),
  { timeout: 180_000 },
);

test(
  "IMAGES binding is NOT present unless Alchemy binds it (adapter's wrangler.json is inert)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const res = yield* get(`${url}/api/images`);
    const json = (yield* res.json) as Record<string, unknown>;
    // Same class of gap as SESSION: the adapter declares IMAGES, Alchemy
    // never reads that declaration, so the binding is absent.
    expect(json.present).toBe(false);
  }),
  { timeout: 180_000 },
);

test(
  "Astro Actions run in the Worker (success + typed ActionError)",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;

    const ok = yield* client
      .post(`${url}/_actions/echo`, {
        headers: { "content-type": "application/json" },
        body: HttpBody.text(JSON.stringify({ msg: "hi" }), "application/json"),
      })
      .pipe(Effect.retry({ schedule: Schedule.exponential("1 second"), times: 8 }));
    expect(ok.status).toBe(200);
    // Astro Actions serialize with devalue, not plain JSON:
    //   [{"echoed":1,"at":2},"HI",1785711766674]
    const payload = yield* ok.text;
    expect(payload).toContain('"echoed"');
    expect(payload).toContain('"HI"');

    const bad = yield* client.post(`${url}/_actions/boom`, {
      headers: { "content-type": "application/json" },
      body: HttpBody.text("{}", "application/json"),
    });
    expect(bad.status).toBe(400);
  }),
  { timeout: 180_000 },
);

test(
  "_redirects is honored by the assets layer",
  Effect.gen(function* () {
    const { url } = yield* stack;
    const client = yield* HttpClient.HttpClient;

    // effect's HttpClient does NOT follow redirects unless you opt in with
    // `followRedirects`, so the 3xx is directly observable. `get` retries
    // through fresh-URL propagation.
    // The platform fetch under HttpClient follows redirects transparently, so
    // assert the OUTCOME: /old-post lands on post-1's prerendered page.
    // (Verified out-of-band with curl that the hop itself is a real 301 with
    //  Location: .../blog/post-1.)
    const landed = yield* body(`${url}/old-post`);
    expect(landed).toContain('data-post-id="post-3"'.replace("post-3", "post-1"));

    const home = yield* body(`${url}/gone`);
    expect(home).toContain("static page");
  }),
  { timeout: 180_000 },
);

test(
  "Workers Cache fronts the Worker when the cache prop is set",
  Effect.gen(function* () {
    const { url } = yield* stack;

    // Prime, then confirm repeat requests never reach the handler: the nonce
    // is generated per render, so an identical nonce means an edge cache hit.
    yield* get(`${url}/cached`);
    const nonceOf = (h: string) => h.match(/data-nonce="([^"]+)"/)?.[1];

    const stable = yield* body(`${url}/cached`).pipe(
      Effect.flatMap((first) =>
        body(`${url}/cached`).pipe(
          Effect.filterOrFail(
            (second) => nonceOf(first) === nonceOf(second),
            () => new Error("cache not warm yet"),
          ),
        ),
      ),
      Effect.retry({ schedule: Schedule.exponential("1 second"), times: 8 }),
    );
    expect(nonceOf(stable)).toBeDefined();
  }),
  { timeout: 180_000 },
);
