#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { NetService } from "@agents/shared/Net";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Data, Effect, Hash, Layer, Logger, Option, Path, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess } from "effect/unstable/process";

const BASE_SERVER_PORT = 3773;
const BASE_WEB_PORT = 5733;
const MAX_HASH_OFFSET = 3000;
const MAX_PORT = 65535;

const ROOT = process.cwd();

export const DEFAULT_DEV_STATE_DIR = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(homedir(), ".agents", "dev"),
);

const DEV_MODES = ["dev", "dev:server", "dev:web", "dev:desktop", "dev:qt6"] as const;
type DevMode = (typeof DEV_MODES)[number];

/** For each mode: optional contracts build first, then one or more workspace dev commands (run in parallel when multiple). */
const MODE_DEV_COMMANDS: Record<
  DevMode,
  {
    buildContractsFirst: boolean;
    workspaces: ReadonlyArray<{
      cwd: string;
      script: string;
      extraArgsToServer?: boolean;
    }>;
  }
> = {
  dev: {
    buildContractsFirst: true,
    workspaces: [
      {
        cwd: path.join(ROOT, "apps/server"),
        script: "dev",
        extraArgsToServer: true,
      },
      { cwd: path.join(ROOT, "apps/web"), script: "dev" },
    ],
  },
  "dev:server": {
    buildContractsFirst: false,
    workspaces: [
      {
        cwd: path.join(ROOT, "apps/server"),
        script: "dev",
        extraArgsToServer: true,
      },
    ],
  },
  "dev:web": {
    buildContractsFirst: false,
    workspaces: [{ cwd: path.join(ROOT, "apps/web"), script: "dev" }],
  },
  "dev:desktop": {
    buildContractsFirst: true,
    workspaces: [
      {
        cwd: path.join(ROOT, "apps/server"),
        script: "dev",
        extraArgsToServer: true,
      },
      { cwd: path.join(ROOT, "apps/desktop/tauri"), script: "dev" },
      { cwd: path.join(ROOT, "apps/web"), script: "dev" },
    ],
  },
  "dev:qt6": {
    buildContractsFirst: true,
    workspaces: [
      {
        cwd: path.join(ROOT, "apps/server"),
        script: "dev",
        extraArgsToServer: true,
      },
      { cwd: path.join(ROOT, "apps/desktop/qt6"), script: "dev" },
      { cwd: path.join(ROOT, "apps/web"), script: "dev" },
    ],
  },
};

type PortAvailabilityCheck<R = never> = (port: number) => Effect.Effect<boolean, never, R>;

const DEV_RUNNER_MODES = [...DEV_MODES];

class DevRunnerError extends Data.TaggedError("DevRunnerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const optionalStringConfig = (name: string): Config.Config<string | undefined> =>
  Config.string(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalBooleanConfig = (name: string): Config.Config<boolean | undefined> =>
  Config.boolean(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalPortConfig = (name: string): Config.Config<number | undefined> =>
  Config.port(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalIntegerConfig = (name: string): Config.Config<number | undefined> =>
  Config.int(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );
const optionalUrlConfig = (name: string): Config.Config<URL | undefined> =>
  Config.url(name).pipe(
    Config.option,
    Config.map((value) => Option.getOrUndefined(value)),
  );

const OffsetConfig = Config.all({
  portOffset: optionalIntegerConfig("AGENTS_PORT_OFFSET"),
  devInstance: optionalStringConfig("AGENTS_DEV_INSTANCE"),
});

export function resolveOffset(config: {
  readonly portOffset: number | undefined;
  readonly devInstance: string | undefined;
}): { readonly offset: number; readonly source: string } {
  if (config.portOffset !== undefined) {
    if (config.portOffset < 0) {
      throw new Error(`Invalid AGENTS_PORT_OFFSET: ${config.portOffset}`);
    }
    return {
      offset: config.portOffset,
      source: `AGENTS_PORT_OFFSET=${config.portOffset}`,
    };
  }

  const seed = config.devInstance?.trim();
  if (!seed) {
    return { offset: 0, source: "default ports" };
  }

  if (/^\d+$/.test(seed)) {
    return {
      offset: Number(seed),
      source: `numeric AGENTS_DEV_INSTANCE=${seed}`,
    };
  }

  const offset = ((Hash.string(seed) >>> 0) % MAX_HASH_OFFSET) + 1;
  return { offset, source: `hashed AGENTS_DEV_INSTANCE=${seed}` };
}

function resolveStateDir(stateDir: string | undefined): Effect.Effect<string, never, Path.Path> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const configured = stateDir?.trim();

    if (configured) {
      // Resolve relative paths against cwd (monorepo root) before we spawn workspace processes.
      return path.resolve(configured);
    }

    return yield* DEFAULT_DEV_STATE_DIR;
  });
}

interface CreateDevRunnerEnvInput {
  readonly mode: DevMode;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly serverOffset: number;
  readonly webOffset: number;
  readonly stateDir: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
}

export function createDevRunnerEnv({
  mode,
  baseEnv,
  serverOffset,
  webOffset,
  stateDir,
  authToken,
  noBrowser,
  autoBootstrapProjectFromCwd,
  logWebSocketEvents,
  host,
  port,
  devUrl,
}: CreateDevRunnerEnvInput): Effect.Effect<NodeJS.ProcessEnv, never, Path.Path> {
  return Effect.gen(function* () {
    const serverPort = port ?? BASE_SERVER_PORT + serverOffset;
    const webPort = BASE_WEB_PORT + webOffset;
    const resolvedStateDir = yield* resolveStateDir(stateDir);
    const wsUrl = `ws://localhost:${serverPort}`;

    const portStr = String(serverPort);
    const output: NodeJS.ProcessEnv = {
      ...baseEnv,
      AGENTS_PORT: portStr,
      PORT: String(webPort),
      VITE_DEV_SERVER_URL: devUrl?.toString() ?? `http://localhost:${webPort}`,
      AGENTS_STATE_DIR: resolvedStateDir,
    };

    if (mode === "dev:web") {
      delete output.VITE_WS_URL;
      output.VITE_NATIVE_API_DISABLED = "1";
    } else {
      output.VITE_WS_URL = wsUrl;
      delete output.VITE_NATIVE_API_DISABLED;
    }

    if (host !== undefined) {
      output.AGENTS_HOST = host;
      output.AGENTS_HOST = host;
    }

    if (authToken !== undefined) {
      output.AGENTS_AUTH_TOKEN = authToken;
      output.AGENTS_AUTH_TOKEN = authToken;
    } else {
      delete output.AGENTS_AUTH_TOKEN;
      delete output.AGENTS_AUTH_TOKEN;
    }

    if (noBrowser !== undefined) {
      const v = noBrowser ? "1" : "0";
      output.AGENTS_NO_BROWSER = v;
      output.AGENTS_NO_BROWSER = v;
    } else {
      delete output.AGENTS_NO_BROWSER;
      delete output.AGENTS_NO_BROWSER;
    }

    if (autoBootstrapProjectFromCwd !== undefined) {
      const v = autoBootstrapProjectFromCwd ? "1" : "0";
      output.AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = v;
      output.AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD = v;
    } else {
      delete output.AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
      delete output.AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD;
    }

    if (logWebSocketEvents !== undefined) {
      const v = logWebSocketEvents ? "1" : "0";
      output.AGENTS_LOG_WS_EVENTS = v;
      output.AGENTS_LOG_WS_EVENTS = v;
    } else {
      delete output.AGENTS_LOG_WS_EVENTS;
      delete output.AGENTS_LOG_WS_EVENTS;
    }

    if (mode === "dev") {
      output.AGENTS_MODE = "web";
      output.AGENTS_MODE = "web";
      delete output.AGENTS_DESKTOP_WS_URL;
      delete output.AGENTS_DESKTOP_WS_URL;
    }

    if (mode === "dev:server" || mode === "dev:web") {
      output.AGENTS_MODE = "web";
      output.AGENTS_MODE = "web";
      delete output.AGENTS_DESKTOP_WS_URL;
      delete output.AGENTS_DESKTOP_WS_URL;
    }

    if (mode === "dev:desktop" || mode === "dev:qt6") {
      output.AGENTS_MODE = "desktop";
      output.AGENTS_MODE = "desktop";
      output.AGENTS_DESKTOP_WS_URL = wsUrl;
      output.AGENTS_DESKTOP_WS_URL = wsUrl;
      // Server in desktop dev mode shouldn't open a browser
      output.AGENTS_NO_BROWSER = "1";
      output.AGENTS_NO_BROWSER = "1";
    }

    return output;
  });
}

function portPairForOffset(offset: number): {
  readonly serverPort: number;
  readonly webPort: number;
} {
  return {
    serverPort: BASE_SERVER_PORT + offset,
    webPort: BASE_WEB_PORT + offset,
  };
}

const defaultCheckPortAvailability: PortAvailabilityCheck<NetService> = (port) =>
  Effect.gen(function* () {
    const net = yield* NetService;
    return yield* net.isPortAvailableOnLoopback(port);
  });

interface FindFirstAvailableOffsetInput<R = NetService> {
  readonly startOffset: number;
  readonly requireServerPort: boolean;
  readonly requireWebPort: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function findFirstAvailableOffset<R = NetService>({
  startOffset,
  requireServerPort,
  requireWebPort,
  checkPortAvailability,
}: FindFirstAvailableOffsetInput<R>): Effect.Effect<number, DevRunnerError, R> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    for (let candidate = startOffset; ; candidate += 1) {
      const { serverPort, webPort } = portPairForOffset(candidate);
      const serverPortOutOfRange = serverPort > MAX_PORT;
      const webPortOutOfRange = webPort > MAX_PORT;

      if (
        (requireServerPort && serverPortOutOfRange) ||
        (requireWebPort && webPortOutOfRange) ||
        (!requireServerPort && !requireWebPort && (serverPortOutOfRange || webPortOutOfRange))
      ) {
        break;
      }

      const checks: Array<Effect.Effect<boolean, never, R>> = [];
      if (requireServerPort) {
        checks.push(checkPort(serverPort));
      }
      if (requireWebPort) {
        checks.push(checkPort(webPort));
      }

      if (checks.length === 0) {
        return candidate;
      }

      const availability = yield* Effect.all(checks);
      if (availability.every(Boolean)) {
        return candidate;
      }
    }

    return yield* new DevRunnerError({
      message: `No available dev ports found from offset ${startOffset}. Tried server=${BASE_SERVER_PORT}+n web=${BASE_WEB_PORT}+n up to port ${MAX_PORT}.`,
    });
  });
}

interface ResolveModePortOffsetsInput<R = NetService> {
  readonly mode: DevMode;
  readonly startOffset: number;
  readonly hasExplicitServerPort: boolean;
  readonly hasExplicitDevUrl: boolean;
  readonly checkPortAvailability?: PortAvailabilityCheck<R>;
}

export function resolveModePortOffsets<R = NetService>({
  mode,
  startOffset,
  hasExplicitServerPort,
  hasExplicitDevUrl,
  checkPortAvailability,
}: ResolveModePortOffsetsInput<R>): Effect.Effect<
  { readonly serverOffset: number; readonly webOffset: number },
  DevRunnerError,
  R
> {
  return Effect.gen(function* () {
    const checkPort = (checkPortAvailability ??
      defaultCheckPortAvailability) as PortAvailabilityCheck<R>;

    if (mode === "dev:web") {
      if (hasExplicitDevUrl) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const webOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: false,
        requireWebPort: true,
        checkPortAvailability: checkPort,
      });
      return { serverOffset: startOffset, webOffset };
    }

    if (mode === "dev:server") {
      if (hasExplicitServerPort) {
        return { serverOffset: startOffset, webOffset: startOffset };
      }

      const serverOffset = yield* findFirstAvailableOffset({
        startOffset,
        requireServerPort: true,
        requireWebPort: false,
        checkPortAvailability: checkPort,
      });
      return { serverOffset, webOffset: serverOffset };
    }

    const sharedOffset = yield* findFirstAvailableOffset({
      startOffset,
      requireServerPort: !hasExplicitServerPort,
      requireWebPort: !hasExplicitDevUrl,
      checkPortAvailability: checkPort,
    });

    return { serverOffset: sharedOffset, webOffset: sharedOffset };
  });
}

interface DevRunnerCliInput {
  readonly mode: DevMode;
  readonly stateDir: string | undefined;
  readonly authToken: string | undefined;
  readonly noBrowser: boolean | undefined;
  readonly autoBootstrapProjectFromCwd: boolean | undefined;
  readonly logWebSocketEvents: boolean | undefined;
  readonly host: string | undefined;
  readonly port: number | undefined;
  readonly devUrl: URL | undefined;
  readonly dryRun: boolean;
  readonly extraArgs: ReadonlyArray<string>;
}

const readOptionalBooleanEnv = (name: string): boolean | undefined => {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return undefined;
};

const resolveOptionalBooleanOverride = (
  explicitValue: boolean | undefined,
  envValue: boolean | undefined,
): boolean | undefined => {
  if (explicitValue === true) {
    return true;
  }

  if (explicitValue === false) {
    return envValue;
  }

  return envValue;
};

export function runDevRunnerWithInput(input: DevRunnerCliInput) {
  const program = Effect.gen(function* () {
    const { portOffset, devInstance } = yield* OffsetConfig.asEffect().pipe(
      Effect.mapError(
        (cause) =>
          new DevRunnerError({
            message: "Failed to read AGENTS_PORT_OFFSET/AGENTS_DEV_INSTANCE configuration.",
            cause,
          }),
      ),
    );

    const { offset, source } = yield* Effect.try({
      try: () => resolveOffset({ portOffset, devInstance }),
      catch: (cause) =>
        new DevRunnerError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    const envOverrides = {
      noBrowser:
        readOptionalBooleanEnv("AGENTS_NO_BROWSER") ?? readOptionalBooleanEnv("AGENTS_NO_BROWSER"),
      autoBootstrapProjectFromCwd:
        readOptionalBooleanEnv("AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD") ??
        readOptionalBooleanEnv("AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD"),
      logWebSocketEvents:
        readOptionalBooleanEnv("AGENTS_LOG_WS_EVENTS") ??
        readOptionalBooleanEnv("AGENTS_LOG_WS_EVENTS"),
    };

    const { serverOffset, webOffset } = yield* resolveModePortOffsets({
      mode: input.mode,
      startOffset: offset,
      hasExplicitServerPort: input.port !== undefined,
      hasExplicitDevUrl: input.devUrl !== undefined,
    });

    const env = yield* createDevRunnerEnv({
      mode: input.mode,
      baseEnv: process.env,
      serverOffset,
      webOffset,
      stateDir: input.stateDir,
      authToken: input.authToken,
      noBrowser: resolveOptionalBooleanOverride(input.noBrowser, envOverrides.noBrowser),
      autoBootstrapProjectFromCwd: resolveOptionalBooleanOverride(
        input.autoBootstrapProjectFromCwd,
        envOverrides.autoBootstrapProjectFromCwd,
      ),
      logWebSocketEvents: resolveOptionalBooleanOverride(
        input.logWebSocketEvents,
        envOverrides.logWebSocketEvents,
      ),
      host: input.host,
      port: input.port,
      devUrl: input.devUrl,
    });

    const selectionSuffix =
      serverOffset !== offset || webOffset !== offset
        ? ` selectedOffset(server=${serverOffset},web=${webOffset})`
        : "";

    yield* Effect.logInfo(
      `[dev-runner] mode=${input.mode} source=${source}${selectionSuffix} serverPort=${String(env.AGENTS_PORT)} webPort=${String(env.PORT)} stateDir=${String(env.AGENTS_STATE_DIR)}`,
    );

    if (input.dryRun) {
      return;
    }

    const config = MODE_DEV_COMMANDS[input.mode];

    if (config.buildContractsFirst) {
      const result = spawnSync("bun", ["run", "build"], {
        cwd: path.join(ROOT, "packages/contracts"),
        env,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        return yield* new DevRunnerError({
          message: `Contracts build exited with code ${result.status ?? "signal"}`,
        });
      }
    }

    const workspaces = config.workspaces;
    if (workspaces.length === 1) {
      const w = workspaces[0];
      const args = ["run", w.script];
      if (w.extraArgsToServer && input.extraArgs.length > 0) {
        args.push("--", ...input.extraArgs);
      }
      const child = yield* ChildProcess.make("bun", args, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env,
        extendEnv: false,
        cwd: w.cwd,
        detached: false,
        forceKillAfter: "1500 millis",
      });
      const exitCode = yield* child.exitCode;
      if (exitCode !== 0) {
        return yield* new DevRunnerError({
          message: `Dev process exited with code ${exitCode}`,
        });
      }
      return;
    }

    // Multiple workspaces: run in parallel, exit when the first exits and kill the rest
    const runParallelDev = (): Promise<number> => {
      const children: ReturnType<typeof spawn>[] = [];
      for (const w of workspaces) {
        const args = ["run", w.script];
        if (w.extraArgsToServer && input.extraArgs.length > 0) {
          args.push("--", ...input.extraArgs);
        }
        const child = spawn("bun", args, {
          cwd: w.cwd,
          env,
          stdio: "inherit",
          detached: false,
        });
        children.push(child);
      }
      const killAll = () => {
        for (const c of children) {
          try {
            c.kill("SIGTERM");
          } catch {
            /* ignore */
          }
        }
      };
      return new Promise<number>((resolve, reject) => {
        let settled = false;
        const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
          if (settled) return;
          settled = true;
          killAll();
          resolve(code ?? (signal === "SIGTERM" ? 0 : 1));
        };
        for (const c of children) {
          c.on("exit", (code, signal) => onExit(code, signal));
          c.on("error", (err) => {
            if (settled) return;
            settled = true;
            killAll();
            reject(err);
          });
        }
      });
    };
    yield* Effect.promise(runParallelDev).pipe(
      Effect.flatMap((exitCode) =>
        exitCode !== 0
          ? Effect.fail(
              new DevRunnerError({
                message: `Dev process exited with code ${exitCode}`,
              }),
            )
          : Effect.void,
      ),
    );
  });
  return program.pipe(
    Effect.mapError((cause) =>
      cause instanceof DevRunnerError
        ? cause
        : new DevRunnerError({
            message: cause instanceof Error ? cause.message : "dev-runner failed",
            cause,
          }),
    ),
  );
}

const devRunnerCli = Command.make("dev-runner", {
  mode: Argument.choice("mode", DEV_RUNNER_MODES).pipe(
    Argument.withDescription("Development mode to run."),
  ),
  stateDir: Flag.string("state-dir").pipe(
    Flag.withDescription("State directory path (forwards to AGENTS_STATE_DIR)."),
    Flag.withFallbackConfig(optionalStringConfig("AGENTS_STATE_DIR")),
  ),
  authToken: Flag.string("auth-token").pipe(
    Flag.withDescription("Auth token (forwards to AGENTS_AUTH_TOKEN)."),
    Flag.withAlias("token"),
    Flag.withFallbackConfig(optionalStringConfig("AGENTS_AUTH_TOKEN")),
  ),
  noBrowser: Flag.boolean("no-browser").pipe(
    Flag.withDescription("Browser auto-open toggle (equivalent to AGENTS_NO_BROWSER)."),
    Flag.withFallbackConfig(optionalBooleanConfig("AGENTS_NO_BROWSER")),
  ),
  autoBootstrapProjectFromCwd: Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
    Flag.withDescription(
      "Auto-bootstrap toggle (equivalent to AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD).",
    ),
    Flag.withFallbackConfig(optionalBooleanConfig("AGENTS_AUTO_BOOTSTRAP_PROJECT_FROM_CWD")),
  ),
  logWebSocketEvents: Flag.boolean("log-websocket-events").pipe(
    Flag.withDescription("WebSocket event logging toggle (equivalent to AGENTS_LOG_WS_EVENTS)."),
    Flag.withAlias("log-ws-events"),
    Flag.withFallbackConfig(optionalBooleanConfig("AGENTS_LOG_WS_EVENTS")),
  ),
  host: Flag.string("host").pipe(
    Flag.withDescription("Server host/interface override (forwards to AGENTS_HOST)."),
    Flag.withFallbackConfig(optionalStringConfig("AGENTS_HOST")),
  ),
  port: Flag.integer("port").pipe(
    Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }))),
    Flag.withDescription("Server port override (forwards to AGENTS_PORT)."),
    Flag.withFallbackConfig(optionalPortConfig("AGENTS_PORT")),
  ),
  devUrl: Flag.string("dev-url").pipe(
    Flag.withSchema(Schema.URLFromString),
    Flag.withDescription("Web dev URL override (forwards to VITE_DEV_SERVER_URL)."),
    Flag.withFallbackConfig(optionalUrlConfig("VITE_DEV_SERVER_URL")),
  ),
  dryRun: Flag.boolean("dry-run").pipe(
    Flag.withDescription("Resolve mode/ports/env and print, but do not spawn dev processes."),
    Flag.withDefault(false),
  ),
  extraArgs: Argument.string("extra-arg").pipe(
    Argument.withDescription("Extra args for the server dev script (pass after `--`)."),
    Argument.variadic(),
  ),
}).pipe(
  Command.withDescription("Run monorepo development modes with deterministic port/env wiring."),
  Command.withHandler((input) => runDevRunnerWithInput(input)),
);

const cliRuntimeLayer = Layer.mergeAll(
  Logger.layer([Logger.consolePretty()]),
  NodeServices.layer,
  NetService.layer,
);

const runtimeProgram = Command.run(devRunnerCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
);

if (import.meta.main) {
  NodeRuntime.runMain(runtimeProgram);
}
