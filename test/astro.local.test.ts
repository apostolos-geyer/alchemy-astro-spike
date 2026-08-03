import { expect } from "bun:test";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schedule from "effect/Schedule";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { Site } from "../infra/site.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  state: Cloudflare.state(),
  dev: true,
});

const Stack = Alchemy.Stack(
  "AstroSsrSpikeDev",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const site = yield* Site;
    return { url: site.url.as<string>() };
  }),
);

const stack = beforeAll(deploy(Stack), { timeout: 300_000 });
afterAll.skipIf(!!process.env.NO_DESTROY)(destroy(Stack), { timeout: 300_000 });

const get = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* client
      .get(url)
      .pipe(
        Effect.retry({ schedule: Schedule.exponential("1 second"), times: 12 }),
      );
  });

test(
  "dev emits a wrangler config carrying the stack's bindings",
  Effect.gen(function* () {
    yield* stack;
    const fs = yield* FileSystem.FileSystem;
    const cfg = JSON.parse(yield* fs.readFileString(".dev.wrangler.json"));

    expect(cfg.compatibility_flags).toContain("nodejs_compat");
    expect((cfg.kv_namespaces ?? []).map((k: any) => k.binding).sort()).toEqual([
      "CACHE",
      "SESSION",
    ]);
    expect((cfg.r2_buckets ?? []).map((r: any) => r.binding)).toEqual([
      "UPLOADS",
    ]);
    expect(cfg.vars?.GREETING).toBe("hello-from-alchemy");
    // The sibling Alchemy Worker is now a real service binding.
    expect((cfg.services ?? []).map((s: any) => s.binding)).toEqual(["API"]);
  }),
  { timeout: 300_000 },
);

test(
  "dev bridges Alchemy's dev registry into miniflare's WorkerDefinition shape",
  Effect.gen(function* () {
    yield* stack;
    const fs = yield* FileSystem.FileSystem;

    const files = yield* fs.readDirectory(".dev.registry");
    expect(files.length).toBeGreaterThan(0);

    const entry = JSON.parse(
      yield* fs.readFileString(`.dev.registry/${files[0]}`),
    );
    // miniflare's WorkerDefinition fields, translated from Alchemy's
    // { scriptName, debugPortAddress, services:[{kind,fetchService,rpcService}] }
    expect(entry.debugPortAddress).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(typeof entry.defaultEntrypointService).toBe("string");
    expect(typeof entry.userWorkerService).toBe("string");
  }),
  { timeout: 300_000 },
);

test(
  "astro dev serves the app and reaches Alchemy's LOCAL worker over the bridged service binding",
  Effect.gen(function* () {
    const { url } = yield* stack;
    // `url` is the astro dev server's own address (external dev mode).
    expect(url).toMatch(/^http:\/\/localhost:\d+/);

    // SSR route renders through the dev server.
    const ssr = yield* get(`${url}/ssr`);
    expect(ssr.status).toBe(200);

    // KV + R2 + var come from the generated config; API is the bridged
    // service binding into Alchemy's own workerd process.
    const res = yield* get(`${url}/api/bindings`);
    const json = (yield* res.json) as Record<string, any>;
    expect(json.kv).toBe("kv-ok");
    expect(json.r2).toBe("r2-ok");
    expect(json.plainVar).toBe("hello-from-alchemy");
    expect(json.serviceFetch?.from).toBe("fetch-handler");
    expect(json.rpcGreet).toBe("hello astro, from the Effect worker");
  }),
  { timeout: 300_000 },
);
