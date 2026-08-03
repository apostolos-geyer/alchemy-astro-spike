import type { Options as CloudflareAdapterOptions } from "@astrojs/cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import type {
  NormalizedBindings,
  WorkerAssetsConfig,
  WorkerBindingProps,
  WorkerProps,
} from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import type { InputProps } from "alchemy/Input";
import * as Namespace from "alchemy/Namespace";
import * as Output from "alchemy/Output";
import { effectClass } from "alchemy/Util/effect";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";

/**
 * Adapter options the stack owns and therefore cannot be passed through:
 * the binding names come from {@link AstroProps.sessionBinding} /
 * {@link AstroProps.imagesBinding}, and `configPath` is the dev wrangler
 * config this resource generates.
 */
type PassthroughAdapterOptions = Omit<
  CloudflareAdapterOptions,
  "sessionKVBindingName" | "imagesBindingName" | "configPath"
>;

export interface AstroProps<Bindings extends WorkerBindingProps = {}>
  extends
    Omit<
      WorkerProps<Bindings, WorkerAssetsConfig>,
      "assets" | "main" | "bundle" | "vite"
    >,
    Omit<Command.BuildProps, "env" | "outdir" | "command"> {
  /**
   * Absolute or relative path to the Astro project root — the directory
   * holding `astro.config.mjs`, `src/`, and the `node_modules` that has
   * `astro` and `@astrojs/cloudflare` installed.
   *
   * This is the ONLY path knob. Everything else (config file, out dir, build
   * runner, dev wrangler config) is resolved from it, and it is passed to
   * Astro as its `root`, so the stack file may live anywhere — a different
   * directory, a different package, a monorepo root.
   *
   * A relative value resolves against `process.cwd()`; prefer
   * `fileURLToPath(new URL("../app", import.meta.url))` if the stack should
   * not care where it was invoked from.
   *
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * Astro's `outDir`, resolved against {@link cwd}. The `@astrojs/cloudflare`
   * adapter splits it into `<outdir>/client` (static assets) and
   * `<outdir>/server` (the SSR Worker).
   *
   * The stack owns this: it is forced into Astro's config, so an `outDir` in
   * the app's `astro.config` is overridden rather than silently disagreeing
   * with where this resource looks for the build.
   *
   * @default "dist"
   */
  outdir?: string;
  /**
   * Path to the app's Astro config. Absolute, or relative to {@link cwd}.
   * Alchemy drives Astro's Node API and loads this config underneath its own
   * overrides — the same relationship `Website.Vite` has with your
   * `vite.config.ts`. Pass `false` to load no config file at all.
   *
   * @default "astro.config.mjs"
   */
  configFile?: string | false;
  /**
   * Name of the KV binding Astro's session driver uses. Injected into the
   * adapter, so it is declared HERE and nowhere else — put a KV namespace
   * under this key in `env`.
   *
   * To run with no session KV at all, set a non-Cloudflare driver in the
   * app's Astro config (`session: { driver: sessionDrivers.null() }`) and
   * leave the binding out of `env`; the adapter always installs *some*
   * session driver, but only the Cloudflare one demands a KV namespace.
   *
   * @default "SESSION"
   */
  sessionBinding?: string;
  /**
   * Name of the Cloudflare Images binding, or `false` to disable the
   * Images-backed image service. Injected into the adapter.
   * @default "IMAGES"
   */
  imagesBinding?: string | false;
  /**
   * The rest of the `@astrojs/cloudflare` adapter's options — `imageService`,
   * `prerenderEnvironment`, `persistState`, `remoteBindings`, `experimental`,
   * and so on. Merged UNDER the options this resource derives from the stack,
   * so the binding names always win.
   *
   * The build runs in a spawned `node` process and these cross as JSON, so
   * only serializable values survive. Function-valued options are not
   * supported.
   *
   * @example
   * ```ts
   * Astro("Site", { adapter: { imageService: "passthrough" } })
   * ```
   */
  adapter?: PassthroughAdapterOptions;
  /**
   * Escape hatch: run this instead of Alchemy's generated build runner. Doing
   * so gives up adapter injection, so anything the adapter needs must then be
   * configured in the app's astro.config by hand.
   */
  command?: string;
  /**
   * Escape hatch: run this instead of Alchemy's generated dev runner. Doing so
   * gives up adapter injection, so anything the adapter needs must then be
   * configured in the app's astro.config by hand.
   */
  devCommand?: string;
  /** Static-asset routing behavior (htmlHandling, notFoundHandling, ...). */
  assets?: Cloudflare.AssetsConfig;
}

type AstroWorker<Bindings extends WorkerBindingProps> = Cloudflare.Worker<{
  [b in keyof NormalizedBindings<
    Bindings,
    WorkerAssetsConfig
  >]: NormalizedBindings<Bindings, WorkerAssetsConfig>[b];
}>;

/**
 * An Astro SSR site (`output: "server"` + `@astrojs/cloudflare`) deployed as a
 * Cloudflare Worker with static assets.
 *
 * Mirrors `Cloudflare.Website.StaticSite` / `.Vite`: same call shapes (plain
 * and class form), same `const Bindings` inference, so `env` bindings are
 * typed and `Cloudflare.InferEnv<typeof Site>` yields the workerd `Env`.
 *
 * ## Who owns what
 *
 * Alchemy is the deployment authority: the stack declares the Worker, so
 * deploy involves no wrangler config in either direction. `main`,
 * `bundle: false`, `assets` and `compatibility` come straight from these
 * props. (The `dist/server/wrangler.json` the adapter's own toolchain emits is
 * an artifact of the `wrangler deploy` path, which Alchemy replaces; nothing
 * here reads it.)
 *
 * For `alchemy dev`, wrangler config is the format the Cloudflare Vite plugin
 * behind `astro dev` speaks, so this resource GENERATES it from the stack's
 * `env` — see the dev branch below. You never author it.
 *
 * What the resource does encode is the adapter's build OUTPUT layout, the same
 * way `Website.Vite` knows where Vite puts things:
 *
 *   main       -> <outdir>/server/entry.mjs
 *   assets     -> <outdir>/client
 *   bundle     -> false           (adapter pre-bundles; re-bundling breaks it)
 *   compat     -> nodejs_compat added (the adapter emits no flags of its own)
 *
 * @example Typed bindings + class form
 * ```ts
 * class Site extends Cloudflare.Website.Astro<Site>()("Site", {
 *   env: { CACHE: kv, API: apiWorker },
 * }) {}
 *
 * type Env = Cloudflare.InferEnv<typeof Site>;
 * ```
 *
 * @example App in a different directory from the stack
 * ```ts
 * class Site extends Cloudflare.Website.Astro<Site>()("Site", {
 *   cwd: fileURLToPath(new URL("../../apps/web", import.meta.url)),
 * }) {}
 * ```
 */
export const Astro: {
  <Self>(): {
    <const Bindings extends WorkerBindingProps = {}, Req = never>(
      id: string,
      propsEff?:
        | InputProps<AstroProps<Bindings>>
        | Effect.Effect<InputProps<AstroProps<Bindings>>, never, Req>,
    ): Effect.Effect<Self, never, Req | Cloudflare.Providers> & {
      new (): AstroWorker<Bindings>;
    };
  };
  <const Bindings extends WorkerBindingProps = {}, Req = never>(
    id: string,
    propsEff?:
      | InputProps<AstroProps<Bindings>>
      | Effect.Effect<InputProps<AstroProps<Bindings>>, never, Req>,
  ): Effect.Effect<AstroWorker<Bindings>, never, Req | Cloudflare.Providers>;
} = ((id?: any, propsEff?: any) =>
  id === undefined
    ? (id: string, propsEff: any) => effectClass(Astro(id, propsEff))
    : makeAstro(id, propsEff)) as any;

/**
 * Map one resolved `env` entry to a wrangler-config binding for `astro dev`.
 *
 * Alchemy's dev registry lives at `~/.local/state/alchemy/registry` and the
 * Cloudflare vite plugin behind `astro dev` does not read it, so an external
 * `astro dev` cannot see Alchemy's local Workers. Remote bindings don't bridge
 * it either (`remote: true` stops `astro dev` booting; `experimental_remote`
 * is silently ignored). So dev bindings are LOCAL emulations: correct names
 * and shapes, miniflare-backed state that is separate from both the cloud and
 * Alchemy's own local providers.
 */
type DevBinding =
  | { kind: "kv" | "r2" | "d1"; entry: Record<string, string> }
  | { kind: "var"; entry: string }
  | { kind: "worker"; entry: undefined }
  | { kind: "unsupported"; entry: undefined };

const toDevBinding = (name: string, value: unknown): DevBinding => {
  const type = (value as any)?.Type ?? (value as any)?.type;
  switch (type) {
    case "Cloudflare.KV.Namespace":
      return { kind: "kv" as const, entry: { binding: name, id: `dev-${name.toLowerCase()}` } };
    case "Cloudflare.R2.Bucket":
      return {
        kind: "r2" as const,
        entry: { binding: name, bucket_name: `dev-${name.toLowerCase()}` },
      };
    case "Cloudflare.D1.Database":
      return {
        kind: "d1" as const,
        entry: { binding: name, database_name: `dev-${name.toLowerCase()}`, database_id: `dev-${name.toLowerCase()}` },
      };
    case "Cloudflare.Worker":
      // Bridged into miniflare's dev registry — see the bridge below.
      return { kind: "worker" as const, entry: undefined };
    default:
      return typeof value === "string"
        ? { kind: "var" as const, entry: value }
        : { kind: "unsupported" as const, entry: undefined };
  }
};

/**
 * Emit the module Alchemy runs instead of shelling out to the `astro` CLI.
 *
 * This is the whole point of the design: Astro exposes a Node API
 * (`build` / `dev`, taking an `AstroInlineConfig extends AstroUserConfig`),
 * so Alchemy can load the app's own `astro.config` via `configFile` and
 * layer its own overrides on top — injecting the Cloudflare adapter with
 * options derived from the stack. Exactly how `Website.Vite` injects the
 * Cloudflare vite plugin rather than asking you to add it yourself.
 *
 * Consequence: adapter options live in ONE place (this resource's props).
 * Nothing about bindings, session/images binding names, or the dev wrangler
 * config is authored twice.
 *
 * The runner is written INSIDE the Astro project root on purpose: its bare
 * `astro` / `@astrojs/cloudflare` imports resolve from its own location, so it
 * must sit next to the app's `node_modules`, not next to the stack file.
 *
 * `root` is passed explicitly rather than inherited from the spawned process's
 * cwd, so nothing here depends on where `alchemy deploy` was invoked from.
 *
 * Runs under `node`, not `bun`: the adapter's prerenderer tears down a
 * miniflare instance at the end of the build, which throws
 * ERR_SERVER_NOT_RUNNING under bun. Astro is a Node tool; the CLI swallowed
 * this, a top-level `await build()` propagates it.
 */
const writeRunner = (opts: {
  mode: "build" | "dev";
  file: string;
  root: string;
  outDir: string;
  configFile: string | false;
  adapter: Record<string, unknown>;
}) => {
  const inline = JSON.stringify(
    {
      root: opts.root,
      configFile: opts.configFile,
      output: "server",
      outDir: opts.outDir,
    },
    null,
    2,
  );
  const adapter = JSON.stringify(opts.adapter, null, 2);
  const body =
    opts.mode === "build"
      ? `await build({ ...inline, adapter: cloudflare(adapterOptions) });`
      : `const server = await dev({ ...inline, adapter: cloudflare(adapterOptions) });
// Command.Dev scans stdout for an http(s) URL.
const url = server.resolvedUrls?.local?.[0]
  ?? \`http://localhost:\${server.address.port}\`;
console.log(\`astro dev ready at \${url}\`);
// Plain foreground process — no CLI daemon to outlive the stack.
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { server.stop().finally(() => process.exit(0)); });
}`;

  nodeFs.mkdirSync(nodePath.dirname(opts.file), { recursive: true });
  nodeFs.writeFileSync(
    opts.file,
    `// GENERATED by infra/Astro.ts — do not edit.\n` +
      `import { ${opts.mode} } from "astro";\n` +
      `import cloudflare from "@astrojs/cloudflare";\n\n` +
      `const inline = ${inline};\n` +
      `const adapterOptions = ${adapter};\n\n` +
      `${body}\n`,
  );
};

const makeAstro = (id: string, propsEff?: any) =>
  Effect.gen(function* () {
    const props = ((yield* (Effect.isEffect(propsEff)
      ? propsEff
      : Effect.succeed(propsEff ?? {}))) ?? {}) as AstroProps<any>;

    const ctx = yield* AlchemyContext;
    const outdir = props.outdir ?? "dist";

    // The single path anchor. Absolute, so nothing below depends on where the
    // stack file lives or where `alchemy deploy` was run from.
    const root = nodePath.resolve(props.cwd ?? ".");

    // Astro does `path.join(root, configFile)`, so an absolute config path
    // would be concatenated rather than used. Normalize to root-relative
    // (`path.join` collapses any leading `..`, so configs outside the root
    // still resolve).
    const rawConfigFile = props.configFile ?? "astro.config.mjs";
    const configFile =
      rawConfigFile === false
        ? false
        : nodePath.isAbsolute(rawConfigFile)
          ? nodePath.relative(root, rawConfigFile)
          : rawConfigFile;

    // `main` MUST be a static string, not an Output derived from the build:
    // the Worker's pre-create phase runs CONCURRENTLY with Command.Build, so
    // an Output is unresolved there and crashes getCompatibility ->
    // isPythonMain. Ordering comes from the Output-valued `assets` below.
    // Absolute, matching `root`; Worker uses `main` as given.
    const main = nodePath.join(root, outdir, "server/entry.mjs");

    const runnerDir = nodePath.join(root, ".alchemy");

    /**
     * Adapter options DERIVED FROM THE STACK, layered over the caller's
     * passthrough so the stack-owned binding names always win.
     * The app's astro.config never mentions them, so they exist once.
     */
    const adapterOptions: Record<string, unknown> = {
      ...props.adapter,
      sessionKVBindingName: props.sessionBinding ?? "SESSION",
      ...(props.imagesBinding === undefined
        ? {}
        : { imagesBindingName: props.imagesBinding }),
    };

    // Props this resource consumes itself; everything else is Worker props.
    const {
      assets: _assets,
      adapter: _adapter,
      command: _command,
      configFile: _configFile,
      cwd: _cwd,
      devCommand: _devCommand,
      imagesBinding: _imagesBinding,
      memo: _memo,
      outdir: _outdir,
      sessionBinding: _sessionBinding,
      ...workerProps
    } = props;

    // ---- dev mode -------------------------------------------------------
    // Skip the build, generate the wrangler config the Cloudflare Vite plugin
    // behind `astro dev` needs in order to emulate the stack's bindings, and
    // hand the Worker over to the external dev server.
    if (ctx.dev) {
      const path = yield* Path.Path;

      const kv: unknown[] = [];
      const r2: unknown[] = [];
      const d1: unknown[] = [];
      const vars: Record<string, string> = {};
      const skipped: string[] = [];
      const workerBindings: Array<{ binding: string; name: any }> = [];

      for (const [name, raw] of Object.entries(props.env ?? {})) {
        // Module-level declarations (`Cloudflare.KV.Namespace("Cache")`) are
        // Effects, not resources — yield them so `Type` is inspectable. This
        // is the same resolution the deploy path's Worker does.
        const value = Effect.isEffect(raw)
          ? yield* (raw as Effect.Effect<any>)
          : raw;
        const { kind, entry } = toDevBinding(name, value);
        if (kind === "kv") kv.push(entry);
        else if (kind === "r2") r2.push(entry);
        else if (kind === "d1") d1.push(entry);
        else if (kind === "var") vars[name] = entry as string;
        else if (kind === "worker") {
          // A sibling Alchemy Worker running locally in Alchemy's own workerd.
          // Bridged below via the dev registry.
          // `workerName` is an Output — it only resolves at reconcile, which
          // is also exactly when the local worker is running and its registry
          // entry exists. Defer; the config is written from the mapper below.
          workerBindings.push({ binding: name, name: (value as any).workerName });
        } else skipped.push(name);
      }

      const configPath = path.join(root, ".dev.wrangler.json");
      const bridgeDir = path.join(root, ".dev.registry");
      const alchemyRegistry =
        process.env.ALCHEMY_REGISTRY_PATH ??
        path.join(process.env.HOME ?? ".", ".local", "state", "alchemy", "registry");

      const baseConfig = {
        name: `${id.toLowerCase()}-dev`,
        compatibility_date: props.compatibility?.date ?? "2026-04-15",
        compatibility_flags: [
          "nodejs_compat",
          ...(props.compatibility?.flags ?? []),
        ],
        ...(kv.length ? { kv_namespaces: kv } : {}),
        ...(r2.length ? { r2_buckets: r2 } : {}),
        ...(d1.length ? { d1_databases: d1 } : {}),
        vars,
      };

      // ---- dev registry bridge -------------------------------------------
      // Alchemy runs workerd DIRECTLY (no miniflare) and writes its dev
      // registry to `Paths.state("alchemy","registry")`:
      //   { scriptName, debugPortAddress, services:[{kind,fetchService,rpcService}] }
      // Miniflare reads a registry too, at `WRANGLER_REGISTRY_PATH`, shaped:
      //   { debugPortAddress, defaultEntrypointService, userWorkerService }
      // Same protocol generation (workerd debug port + service names), so a
      // mechanical translation lets `astro dev` bind to Alchemy's local
      // Workers with no upstream patch and no cloud round-trip.
      //
      // This runs inside `Output.map` because the physical worker names only
      // resolve at reconcile — which is also when the local workers are up and
      // their registry entries exist. Sync `node:fs` here is a deliberate wart:
      // the mapper is a plain function, not an Effect.
      const ready = Output.map(
        Output.all(...workerBindings.map((w) => w.name)) as any,
        (names: any) => {
          const resolved: string[] = Array.isArray(names)
            ? names
            : names === undefined
              ? []
              : [names];
          nodeFs.mkdirSync(bridgeDir, { recursive: true });
          const services: Array<{ binding: string; service: string }> = [];
          resolved.forEach((scriptName, i) => {
            const file = `${encodeURIComponent(scriptName)}.json`;
            const src = nodePath.join(alchemyRegistry, file);
            if (!nodeFs.existsSync(src)) return;
            const e = JSON.parse(nodeFs.readFileSync(src, "utf8"));
            const w = (e.services ?? []).find((x: any) => x.kind === "worker");
            if (!w) return;
            nodeFs.writeFileSync(
              nodePath.join(bridgeDir, file),
              `${JSON.stringify(
                {
                  debugPortAddress: e.debugPortAddress,
                  defaultEntrypointService: w.fetchService,
                  userWorkerService: w.rpcService,
                },
                null,
                2,
              )}\n`,
            );
            services.push({
              binding: workerBindings[i]!.binding,
              service: scriptName,
            });
          });
          nodeFs.writeFileSync(
            configPath,
            `${JSON.stringify(
              { ...baseConfig, ...(services.length ? { services } : {}) },
              null,
              2,
            )}\n`,
          );
          return bridgeDir;
        },
      );

      if (skipped.length > 0) {
        yield* Effect.logWarning(
          `[${id}] dev: no astro-dev equivalent for binding(s) ${skipped.join(", ")}`,
        );
      }

      // Alchemy owns the dev config path too — the app's astro.config no
      // longer needs a `configPath` line.
      const devRunner = nodePath.join(runnerDir, "astro-dev.mjs");
      writeRunner({
        mode: "dev",
        file: devRunner,
        root,
        outDir: outdir,
        configFile,
        adapter: { ...adapterOptions, configPath },
      });

      const devCmd = yield* Command.Dev("Dev", {
        command:
          props.devCommand ?? `node ${nodePath.relative(root, devRunner)}`,
        cwd: root,
        env: {
          // No ASTRO_DEV_BACKGROUND needed: the runner calls astro's `dev()`
          // directly, so there is no CLI to daemonize and outlive the stack.
          // Point miniflare's dev registry at the bridged Alchemy entries.
          // The CF vite plugin calls miniflare's getDefaultDevRegistryPath(),
          // which reads MINIFLARE_REGISTRY_PATH. `wrangler dev` reads
          // WRANGLER_REGISTRY_PATH instead — set both so either host works.
          MINIFLARE_REGISTRY_PATH: ready,
          WRANGLER_REGISTRY_PATH: ready,
        },
      }).pipe(Namespace.push(id));

      return yield* Cloudflare.Worker<any, WorkerAssetsConfig>(id, {
        ...workerProps,
        main: undefined!,
        // The external dev server owns the process; Alchemy starts no workerd.
        dev: { mode: "external", url: devCmd.url },
      });
    }

    // Namespace ONLY the Build. Wrapping the whole resource in
    // `Namespace.push(id)` (as Website.StaticSite does) resolves `env` inside
    // that namespace, so every resource referenced there is re-created as a
    // duplicate (`Site/ApiWorker` alongside the stack's `ApiWorker`).
    // Website.Vite avoids this by passing the caller's id straight to Worker.
    const buildRunner = nodePath.join(runnerDir, "astro-build.mjs");
    writeRunner({
      mode: "build",
      file: buildRunner,
      root,
      outDir: outdir,
      configFile,
      adapter: adapterOptions,
    });

    const build = yield* Command.Build("Build", {
      command: props.command ?? `node ${nodePath.relative(root, buildRunner)}`,
      cwd: root,
      outdir,
      memo: props.memo,
    }).pipe(Namespace.push(id));

    return yield* Cloudflare.Worker<any, WorkerAssetsConfig>(id, {
      ...workerProps,
      main,
      bundle: false,
      assets: {
        // `build.outdir` is relative to process.cwd() (Command.Build stores it
        // that way so state is portable across machines).
        directory: Output.map(build.outdir, (d) => `${d}/client`),
        // AssetsWithHash.hash is typed `string` — use the output-tree hash so
        // an unchanged build is a genuine no-op.
        hash: Output.map(build.hash, (h) => h.output ?? h.input ?? ""),
        ...props.assets,
      },
      compatibility: {
        date: props.compatibility?.date ?? "2026-04-15",
        flags: ["nodejs_compat", ...(props.compatibility?.flags ?? [])],
      },
    });
  });
