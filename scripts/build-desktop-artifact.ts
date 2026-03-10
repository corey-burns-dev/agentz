#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Data, Effect, FileSystem, Layer, Logger, Option, Path, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";

const BuildPlatform = Schema.Literals(["linux", "win"]);
const BuildArch = Schema.Literals(["arm64", "x64"]);

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const ProductionLinuxIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionLinuxIconPng),
);
const ProductionWindowsIconSource = Effect.zipWith(
  RepoRoot,
  Effect.service(Path.Path),
  (repoRoot, path) => path.join(repoRoot, BRAND_ASSET_PATHS.productionWindowsIconIco),
);

interface PlatformConfig {
  readonly defaultTarget: string;
  readonly archChoices: ReadonlyArray<typeof BuildArch.Type>;
}

const PLATFORM_CONFIG: Record<typeof BuildPlatform.Type, PlatformConfig> = {
  linux: { defaultTarget: "AppImage", archChoices: ["x64", "arm64"] },
  win: { defaultTarget: "nsis", archChoices: ["x64", "arm64"] },
};

interface BuildCliInput {
  readonly platform: Option.Option<typeof BuildPlatform.Type>;
  readonly target: Option.Option<string>;
  readonly arch: Option.Option<typeof BuildArch.Type>;
  readonly buildVersion: Option.Option<string>;
  readonly outputDir: Option.Option<string>;
  readonly skipBuild: Option.Option<boolean>;
  readonly keepStage: Option.Option<boolean>;
  readonly signed: Option.Option<boolean>;
  readonly verbose: Option.Option<boolean>;
}

function detectHostBuildPlatform(hostPlatform: string): typeof BuildPlatform.Type | undefined {
  if (hostPlatform === "linux") return "linux";
  if (hostPlatform === "win32") return "win";
  return undefined;
}

function getDefaultArch(platform: typeof BuildPlatform.Type): typeof BuildArch.Type {
  const config = PLATFORM_CONFIG[platform];
  if (!config) {
    return "x64";
  }

  if (process.arch === "arm64" && config.archChoices.includes("arm64")) {
    return "arm64";
  }
  if (process.arch === "x64" && config.archChoices.includes("x64")) {
    return "x64";
  }

  return config.archChoices[0] ?? "x64";
}

class BuildScriptError extends Data.TaggedError("BuildScriptError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface ResolvedBuildOptions {
  readonly platform: typeof BuildPlatform.Type;
  readonly target: string;
  readonly arch: typeof BuildArch.Type;
  readonly version: string | undefined;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly keepStage: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
}

const optionWithLegacy = <A>(
  primary: string,
  legacy: string,
  parse: (key: string) => Config.Config<A>,
) =>
  Config.all({
    a: parse(primary).pipe(Config.option),
    b: parse(legacy).pipe(Config.option),
  }).pipe(Config.map(({ a, b }) => Option.getOrUndefined(a) ?? Option.getOrUndefined(b)));

const BuildEnvConfig = Config.all({
  platform: optionWithLegacy("AGENTS_DESKTOP_PLATFORM", "AGENTS_DESKTOP_PLATFORM", (k) =>
    Config.schema(BuildPlatform, k),
  ),
  target: optionWithLegacy("AGENTS_DESKTOP_TARGET", "AGENTS_DESKTOP_TARGET", (k) =>
    Config.string(k),
  ),
  arch: optionWithLegacy("AGENTS_DESKTOP_ARCH", "AGENTS_DESKTOP_ARCH", (k) =>
    Config.schema(BuildArch, k),
  ),
  version: optionWithLegacy("AGENTS_DESKTOP_VERSION", "AGENTS_DESKTOP_VERSION", (k) =>
    Config.string(k),
  ),
  outputDir: optionWithLegacy("AGENTS_DESKTOP_OUTPUT_DIR", "AGENTS_DESKTOP_OUTPUT_DIR", (k) =>
    Config.string(k),
  ),
  skipBuild: Config.all({
    a: Config.boolean("AGENTS_DESKTOP_SKIP_BUILD").pipe(Config.option),
    b: Config.boolean("AGENTS_DESKTOP_SKIP_BUILD").pipe(Config.option),
  }).pipe(Config.map(({ a, b }) => a ?? b ?? false)),
  keepStage: Config.all({
    a: Config.boolean("AGENTS_DESKTOP_KEEP_STAGE").pipe(Config.option),
    b: Config.boolean("AGENTS_DESKTOP_KEEP_STAGE").pipe(Config.option),
  }).pipe(Config.map(({ a, b }) => a ?? b ?? false)),
  signed: Config.all({
    a: Config.boolean("AGENTS_DESKTOP_SIGNED").pipe(Config.option),
    b: Config.boolean("AGENTS_DESKTOP_SIGNED").pipe(Config.option),
  }).pipe(Config.map(({ a, b }) => a ?? b ?? false)),
  verbose: Config.all({
    a: Config.boolean("AGENTS_DESKTOP_VERBOSE").pipe(Config.option),
    b: Config.boolean("AGENTS_DESKTOP_VERBOSE").pipe(Config.option),
  }).pipe(Config.map(({ a, b }) => a ?? b ?? false)),
});

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);
const mergeOptions = <A>(a: Option.Option<A>, b: Option.Option<A>, defaultValue: A) =>
  Option.getOrElse(a, () => Option.getOrElse(b, () => defaultValue));

const resolveBuildOptions = Effect.fn("resolveBuildOptions")(function* (input: BuildCliInput) {
  const path = yield* Path.Path;
  const repoRoot = yield* RepoRoot;
  const env = yield* BuildEnvConfig.asEffect();

  const platform = mergeOptions(
    input.platform,
    Option.fromNullable(env.platform),
    detectHostBuildPlatform(process.platform),
  );

  if (!platform) {
    return yield* new BuildScriptError({
      message: `Unsupported host platform '${process.platform}'.`,
    });
  }

  const platformConfig = PLATFORM_CONFIG[platform];
  const target = mergeOptions(
    input.target,
    Option.fromNullable(env.target),
    platformConfig?.defaultTarget ?? "AppImage",
  );
  const arch = mergeOptions(input.arch, Option.fromNullable(env.arch), getDefaultArch(platform));
  const version = mergeOptions(input.buildVersion, Option.fromNullable(env.version), undefined);
  const outputDir = path.resolve(
    repoRoot,
    mergeOptions(input.outputDir, Option.fromNullable(env.outputDir), "release"),
  );

  const skipBuild = resolveBooleanFlag(input.skipBuild, env.skipBuild);
  const keepStage = resolveBooleanFlag(input.keepStage, env.keepStage);
  const signed = resolveBooleanFlag(input.signed, env.signed);
  const verbose = resolveBooleanFlag(input.verbose, env.verbose);

  return {
    platform,
    target,
    arch,
    version,
    outputDir,
    skipBuild,
    keepStage,
    signed,
    verbose,
  } satisfies ResolvedBuildOptions;
});

const commandOutputOptions = (verbose: boolean) =>
  ({
    stdout: verbose ? "inherit" : "ignore",
    stderr: "inherit",
  }) as const;

const runCommand = Effect.fn("runCommand")(function* (command: ChildProcess.Command) {
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* commandSpawner.spawn(command);
  const exitCode = yield* child.exitCode;

  if (exitCode !== 0) {
    return yield* new BuildScriptError({
      message: `Command exited with non-zero exit code (${exitCode})`,
    });
  }
});

function stageLinuxIcons(stageResourcesDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const iconSource = yield* ProductionLinuxIconSource;
    if (!(yield* fs.exists(iconSource))) {
      return yield* new BuildScriptError({
        message: `Production icon source is missing at ${iconSource}`,
      });
    }

    const iconPath = path.join(stageResourcesDir, "icon.png");
    yield* fs.copyFile(iconSource, iconPath);
  });
}

function stageWindowsIcons(stageResourcesDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const iconSource = yield* ProductionWindowsIconSource;
    if (!(yield* fs.exists(iconSource))) {
      return yield* new BuildScriptError({
        message: `Production Windows icon source is missing at ${iconSource}`,
      });
    }

    const iconPath = path.join(stageResourcesDir, "icon.ico");
    yield* fs.copyFile(iconSource, iconPath);
  });
}

function validateBundledClientAssets(clientDir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = path.join(clientDir, "index.html");
    const indexHtml = yield* fs.readFileString(indexPath);
    const refs = [...indexHtml.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined);
    const missing: string[] = [];

    for (const ref of refs) {
      const normalizedRef = ref.split("#")[0]?.split("?")[0] ?? "";
      if (!normalizedRef) continue;
      if (normalizedRef.startsWith("http://") || normalizedRef.startsWith("https://")) continue;
      if (normalizedRef.startsWith("data:") || normalizedRef.startsWith("mailto:")) continue;

      const ext = path.extname(normalizedRef);
      if (!ext) continue;

      const relativePath = normalizedRef.replace(/^\/+/, "");
      const assetPath = path.join(clientDir, relativePath);
      if (!(yield* fs.exists(assetPath))) {
        missing.push(normalizedRef);
      }
    }

    if (missing.length > 0) {
      const preview = missing.slice(0, 6).join(", ");
      const suffix = missing.length > 6 ? ` (+${missing.length - 6} more)` : "";
      return yield* new BuildScriptError({
        message: `Bundled client references missing files in ${indexPath}: ${preview}${suffix}. Rebuild web/server artifacts.`,
      });
    }
  });
}

const assertPlatformBuildResources = Effect.fn("assertPlatformBuildResources")(function* (
  platform: typeof BuildPlatform.Type,
  stageResourcesDir: string,
) {
  if (platform === "linux") {
    yield* stageLinuxIcons(stageResourcesDir);
    return;
  }

  if (platform === "win") {
    yield* stageWindowsIcons(stageResourcesDir);
  }
});

const TAURI_BUNDLE_DIR = "src-tauri/target/release/bundle";

const buildDesktopArtifact = Effect.fn("buildDesktopArtifact")(function* (
  options: ResolvedBuildOptions,
) {
  const repoRoot = yield* RepoRoot;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;

  const platformConfig = PLATFORM_CONFIG[options.platform];
  if (!platformConfig) {
    return yield* new BuildScriptError({
      message: `Unsupported platform '${options.platform}'.`,
    });
  }

  const desktopDir = path.join(repoRoot, "apps/desktop/tauri");
  const desktopResourcesDir = path.join(desktopDir, "resources");
  const serverDistDir = path.join(repoRoot, "apps/server/dist");
  const bundledClientEntry = path.join(serverDistDir, "client/index.html");

  const isFlatpak = options.target === "flatpak";
  const buildCommand = isFlatpak ? "build:desktop:no-bundle" : "build:desktop";

  if (!options.skipBuild) {
    yield* assertPlatformBuildResources(options.platform, desktopResourcesDir);
    yield* Effect.log(
      `[desktop-artifact] Building desktop/server/web artifacts (${buildCommand})...`,
    );
    yield* runCommand(
      ChildProcess.make({
        cwd: repoRoot,
        env: {
          ...process.env,
          // Use extract-and-run so linuxdeploy (and its plugin AppImages) run without FUSE.
          // Fixes "failed to run linuxdeploy" when FUSE is unavailable (e.g. some containers).
          APPIMAGE_EXTRACT_AND_RUN: "1",
        },
        ...commandOutputOptions(options.verbose),
      })`bun run ${buildCommand}`,
    );
  }

  if (!(yield* fs.exists(serverDistDir))) {
    return yield* new BuildScriptError({
      message: `Missing server dist at ${serverDistDir}. Run 'bun run ${buildCommand}' first.`,
    });
  }
  if (!(yield* fs.exists(bundledClientEntry))) {
    return yield* new BuildScriptError({
      message: `Missing bundled server client at ${bundledClientEntry}. Run 'bun run ${buildCommand}' first.`,
    });
  }
  yield* validateBundledClientAssets(path.dirname(bundledClientEntry));

  if (isFlatpak) {
    const binaryPath = path.join(desktopDir, "src-tauri/target/release/agents");
    if (!(yield* fs.exists(binaryPath))) {
      return yield* new BuildScriptError({
        message: `Missing binary at ${binaryPath}. Run 'bun run ${buildCommand}' first.`,
      });
    }
    const flatpakManifest = path.join(repoRoot, "flatpak/com.agents.agents.yml");
    if (!(yield* fs.exists(flatpakManifest))) {
      return yield* new BuildScriptError({
        message: `Missing Flatpak manifest at ${flatpakManifest}.`,
      });
    }
    const flatpakBuildDir = path.join(repoRoot, "build");
    const flatpakRepoDir = path.join(repoRoot, "repo");
    yield* Effect.log("[desktop-artifact] Running flatpak-builder...");
    yield* runCommand(
      ChildProcess.make({
        cwd: repoRoot,
        ...commandOutputOptions(options.verbose),
      })`flatpak-builder --force-clean --repo=${flatpakRepoDir} ${flatpakBuildDir} ${flatpakManifest}`,
    );
    const bundleName = options.version ? `agents-${options.version}.flatpak` : "agents.flatpak";
    const flatpakBundlePath = path.join(options.outputDir, bundleName);
    yield* fs.makeDirectory(options.outputDir, { recursive: true });
    yield* runCommand(
      ChildProcess.make({
        cwd: repoRoot,
        ...commandOutputOptions(options.verbose),
      })`flatpak build-bundle ${flatpakRepoDir} ${flatpakBundlePath} com.agents.agents`,
    );
    yield* Effect.log("[desktop-artifact] Done. Artifacts:").pipe(
      Effect.annotateLogs({ artifacts: [flatpakBundlePath] }),
    );
    return;
  }

  const bundleDir = path.join(desktopDir, TAURI_BUNDLE_DIR);
  if (!(yield* fs.exists(bundleDir))) {
    return yield* new BuildScriptError({
      message: `Tauri bundle directory not found at ${bundleDir}. Run 'bun run ${buildCommand}' first.`,
    });
  }

  const bundleEntries = yield* fs.readDirectory(bundleDir);
  yield* fs.makeDirectory(options.outputDir, { recursive: true });

  const copiedArtifacts: string[] = [];
  for (const entry of bundleEntries) {
    const from = path.join(bundleDir, entry);
    const stat = yield* fs.stat(from).pipe(Effect.catch(() => Effect.succeed(null)));
    if (!stat) continue;
    if (stat.type === "File") {
      const to = path.join(options.outputDir, entry);
      yield* fs.copyFile(from, to);
      copiedArtifacts.push(to);
    } else if (stat.type === "Directory") {
      const subdir = path.join(options.outputDir, entry);
      yield* fs.makeDirectory(subdir, { recursive: true });
      const subEntries = yield* fs.readDirectory(from);
      for (const sub of subEntries) {
        const subFrom = path.join(from, sub);
        const subTo = path.join(subdir, sub);
        const subStat = yield* fs.stat(subFrom).pipe(Effect.catch(() => Effect.succeed(null)));
        if (subStat?.type === "File") {
          yield* fs.copyFile(subFrom, subTo);
          copiedArtifacts.push(subTo);
        }
      }
    }
  }

  if (copiedArtifacts.length === 0) {
    return yield* new BuildScriptError({
      message: `No bundle artifacts found in ${bundleDir}.`,
    });
  }

  yield* Effect.log("[desktop-artifact] Done. Artifacts:").pipe(
    Effect.annotateLogs({ artifacts: copiedArtifacts }),
  );
});

const buildDesktopArtifactCli = Command.make("build-desktop-artifact", {
  platform: Flag.choice("platform", BuildPlatform.literals).pipe(
    Flag.withDescription("Build platform (env: AGENTS_DESKTOP_PLATFORM)."),
    Flag.optional,
  ),
  target: Flag.string("target").pipe(
    Flag.withDescription(
      "Artifact target, for example AppImage/nsis (env: AGENTS_DESKTOP_TARGET).",
    ),
    Flag.optional,
  ),
  arch: Flag.choice("arch", BuildArch.literals).pipe(
    Flag.withDescription("Build arch, for example arm64/x64 (env: AGENTS_DESKTOP_ARCH)."),
    Flag.optional,
  ),
  buildVersion: Flag.string("build-version").pipe(
    Flag.withDescription("Artifact version metadata (env: AGENTS_DESKTOP_VERSION)."),
    Flag.optional,
  ),
  outputDir: Flag.string("output-dir").pipe(
    Flag.withDescription("Output directory for artifacts (env: AGENTS_DESKTOP_OUTPUT_DIR)."),
    Flag.optional,
  ),
  skipBuild: Flag.boolean("skip-build").pipe(
    Flag.withDescription(
      "Skip `bun run build:desktop` and use existing dist artifacts (env: AGENTS_DESKTOP_SKIP_BUILD).",
    ),
    Flag.optional,
  ),
  keepStage: Flag.boolean("keep-stage").pipe(
    Flag.withDescription("Keep temporary staging files (env: AGENTS_DESKTOP_KEEP_STAGE)."),
    Flag.optional,
  ),
  signed: Flag.boolean("signed").pipe(
    Flag.withDescription(
      "Enable signing/notarization discovery; Windows uses Azure Trusted Signing (env: AGENTS_DESKTOP_SIGNED).",
    ),
    Flag.optional,
  ),
  verbose: Flag.boolean("verbose").pipe(
    Flag.withDescription("Stream subprocess stdout (env: AGENTS_DESKTOP_VERBOSE)."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription("Build a desktop artifact for Agents."),
  Command.withHandler((input) => Effect.flatMap(resolveBuildOptions(input), buildDesktopArtifact)),
);

const cliRuntimeLayer = Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer);

Command.run(buildDesktopArtifactCli, { version: "0.0.0" }).pipe(
  Effect.scoped,
  Effect.provide(cliRuntimeLayer),
  NodeRuntime.runMain,
);
