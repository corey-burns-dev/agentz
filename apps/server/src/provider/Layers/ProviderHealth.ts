/**
 * ProviderHealthLive - Startup-time provider health checks.
 *
 * Performs one-time provider readiness probes when the server starts and
 * keeps the resulting snapshot in memory for `server.getConfig`.
 *
 * Uses effect's ChildProcessSpawner to run CLI probes natively.
 *
 * @module ProviderHealthLive
 */
import type {
  ServerProviderAuthStatus,
  ServerProviderStatus,
  ServerProviderStatusState,
} from "@agents/contracts";
import { Effect, Layer, Option, Result, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  formatClaudeCodeCliUpgradeMessage,
  isClaudeCodeCliVersionSupported,
  parseClaudeCodeCliVersion,
} from "../claudeCodeCliVersion";
import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "../codexCliVersion";
import {
  formatGeminiCliUpgradeMessage,
  isGeminiCliVersionSupported,
  parseGeminiCliVersion,
} from "../geminiCliVersion";
import { ProviderHealth, type ProviderHealthShape } from "../Services/ProviderHealth";

const DEFAULT_TIMEOUT_MS = 4_000;
const CODEX_PROVIDER = "codex" as const;
const GEMINI_PROVIDER = "gemini" as const;
const CLAUDE_CODE_PROVIDER = "claude-code" as const;

// ── Pure helpers ────────────────────────────────────────────────────

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isCommandMissingCause(binary: string, error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes(`command not found: ${binary}`) ||
    lower.includes(`spawn ${binary} enoent`) ||
    lower.includes("enoent") ||
    lower.includes("notfound")
  );
}

function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return "Timed out while running command.";
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

function extractAuthBoolean(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractAuthBoolean(entry);
      if (nested !== undefined) return nested;
    }
    return undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
    if (typeof record[key] === "boolean") return record[key];
  }
  for (const key of ["auth", "status", "session", "account"] as const) {
    const nested = extractAuthBoolean(record[key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

export function parseAuthStatusFromOutput(result: CommandResult): {
  readonly status: ServerProviderStatusState;
  readonly authStatus: ServerProviderAuthStatus;
  readonly message?: string;
} {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      status: "warning",
      authStatus: "unknown",
      message: "Codex CLI authentication status command is unavailable in this Codex version.",
    };
  }

  if (
    lowerOutput.includes("not logged in") ||
    lowerOutput.includes("login required") ||
    lowerOutput.includes("authentication required") ||
    lowerOutput.includes("run `codex login`") ||
    lowerOutput.includes("run codex login")
  ) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }

  const parsedAuth = (() => {
    const trimmed = result.stdout.trim();
    if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
      return {
        attemptedJsonParse: false as const,
        auth: undefined as boolean | undefined,
      };
    }
    try {
      return {
        attemptedJsonParse: true as const,
        auth: extractAuthBoolean(JSON.parse(trimmed)),
      };
    } catch {
      return {
        attemptedJsonParse: false as const,
        auth: undefined as boolean | undefined,
      };
    }
  })();

  if (parsedAuth.auth === true) {
    return { status: "ready", authStatus: "authenticated" };
  }
  if (parsedAuth.auth === false) {
    return {
      status: "error",
      authStatus: "unauthenticated",
      message: "Codex CLI is not authenticated. Run `codex login` and try again.",
    };
  }
  if (parsedAuth.attemptedJsonParse) {
    return {
      status: "warning",
      authStatus: "unknown",
      message:
        "Could not verify Codex authentication status from JSON output (missing auth marker).",
    };
  }
  if (result.code === 0) {
    return { status: "ready", authStatus: "authenticated" };
  }

  const detail = detailFromResult(result);
  return {
    status: "warning",
    authStatus: "unknown",
    message: detail
      ? `Could not verify Codex authentication status. ${detail}`
      : "Could not verify Codex authentication status.",
  };
}

// ── Effect-native command execution ─────────────────────────────────

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  Stream.runFold(
    stream,
    () => "",
    (acc, chunk) => acc + new TextDecoder().decode(chunk),
  );

const runCommand = (binary: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make(binary, [...args], {
      shell: process.platform === "win32",
    });

    const child = yield* spawner.spawn(command);

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode } satisfies CommandResult;
  }).pipe(Effect.scoped);

function makeVersionOnlyProviderStatusChecker(input: {
  readonly provider: typeof GEMINI_PROVIDER | typeof CLAUDE_CODE_PROVIDER;
  readonly binary: string;
  readonly unavailableMessage: string;
  readonly parseVersion: (output: string) => string | null;
  readonly isVersionSupported: (version: string) => boolean;
  readonly formatUpgradeMessage: (version: string | null) => string;
}) {
  return Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const versionProbe = yield* runCommand(input.binary, ["--version"]).pipe(
      Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
      Effect.result,
    );

    if (Result.isFailure(versionProbe)) {
      const error = versionProbe.failure;
      return {
        provider: input.provider,
        status: "error" as const,
        available: false,
        authStatus: "unknown" as const,
        checkedAt,
        message: isCommandMissingCause(input.binary, error)
          ? input.unavailableMessage
          : `Failed to execute ${input.binary} CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      } satisfies ServerProviderStatus;
    }

    if (Option.isNone(versionProbe.success)) {
      return {
        provider: input.provider,
        status: "error" as const,
        available: false,
        authStatus: "unknown" as const,
        checkedAt,
        message: `${input.binary} CLI is installed but failed to run. Timed out while running command.`,
      } satisfies ServerProviderStatus;
    }

    const version = versionProbe.success.value;
    if (version.code !== 0) {
      const detail = detailFromResult(version);
      return {
        provider: input.provider,
        status: "error" as const,
        available: false,
        authStatus: "unknown" as const,
        checkedAt,
        message: detail
          ? `${input.binary} CLI is installed but failed to run. ${detail}`
          : `${input.binary} CLI is installed but failed to run.`,
      } satisfies ServerProviderStatus;
    }

    const parsedVersion = input.parseVersion(`${version.stdout}\n${version.stderr}`);
    if (parsedVersion !== null && !input.isVersionSupported(parsedVersion)) {
      return {
        provider: input.provider,
        status: "error" as const,
        available: false,
        authStatus: "unknown" as const,
        checkedAt,
        message: input.formatUpgradeMessage(parsedVersion),
      } satisfies ServerProviderStatus;
    }

    if (parsedVersion === null) {
      return {
        provider: input.provider,
        status: "warning" as const,
        available: true,
        authStatus: "unknown" as const,
        checkedAt,
        message: input.formatUpgradeMessage(null),
      } satisfies ServerProviderStatus;
    }

    return {
      provider: input.provider,
      status: "ready" as const,
      available: true,
      authStatus: "unknown" as const,
      checkedAt,
    } satisfies ServerProviderStatus;
  });
}

// ── Health check ────────────────────────────────────────────────────

export const checkCodexProviderStatus: Effect.Effect<
  ServerProviderStatus,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const checkedAt = new Date().toISOString();

  // Probe 1: `codex --version` — is the CLI reachable?
  const versionProbe = yield* runCommand("codex", ["--version"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: isCommandMissingCause("codex", error)
        ? "Codex CLI (`codex`) is not installed or not on PATH."
        : `Failed to execute Codex CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
    };
  }

  if (Option.isNone(versionProbe.success)) {
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: "Codex CLI is installed but failed to run. Timed out while running command.",
    };
  }

  const version = versionProbe.success.value;
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: detail
        ? `Codex CLI is installed but failed to run. ${detail}`
        : "Codex CLI is installed but failed to run.",
    };
  }

  const parsedVersion = parseCodexCliVersion(`${version.stdout}\n${version.stderr}`);
  if (parsedVersion && !isCodexCliVersionSupported(parsedVersion)) {
    return {
      provider: CODEX_PROVIDER,
      status: "error" as const,
      available: false,
      authStatus: "unknown" as const,
      checkedAt,
      message: formatCodexCliUpgradeMessage(parsedVersion),
    };
  }

  // Probe 2: `codex login status` — is the user authenticated?
  const authProbe = yield* runCommand("codex", ["login", "status"]).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(authProbe)) {
    const error = authProbe.failure;
    return {
      provider: CODEX_PROVIDER,
      status: "warning" as const,
      available: true,
      authStatus: "unknown" as const,
      checkedAt,
      message:
        error instanceof Error
          ? `Could not verify Codex authentication status: ${error.message}.`
          : "Could not verify Codex authentication status.",
    };
  }

  if (Option.isNone(authProbe.success)) {
    return {
      provider: CODEX_PROVIDER,
      status: "warning" as const,
      available: true,
      authStatus: "unknown" as const,
      checkedAt,
      message: "Could not verify Codex authentication status. Timed out while running command.",
    };
  }

  const parsed = parseAuthStatusFromOutput(authProbe.success.value);
  return {
    provider: CODEX_PROVIDER,
    status: parsed.status,
    available: true,
    authStatus: parsed.authStatus,
    checkedAt,
    ...(parsed.message ? { message: parsed.message } : {}),
  } satisfies ServerProviderStatus;
});

export const checkGeminiProviderStatus = makeVersionOnlyProviderStatusChecker({
  provider: GEMINI_PROVIDER,
  binary: "gemini",
  unavailableMessage: "Gemini CLI (`gemini`) is not installed or not on PATH.",
  parseVersion: parseGeminiCliVersion,
  isVersionSupported: isGeminiCliVersionSupported,
  formatUpgradeMessage: formatGeminiCliUpgradeMessage,
});

export const checkClaudeCodeProviderStatus = makeVersionOnlyProviderStatusChecker({
  provider: CLAUDE_CODE_PROVIDER,
  binary: "claude",
  unavailableMessage: "Claude Code CLI (`claude`) is not installed or not on PATH.",
  parseVersion: parseClaudeCodeCliVersion,
  isVersionSupported: isClaudeCodeCliVersionSupported,
  formatUpgradeMessage: formatClaudeCodeCliUpgradeMessage,
});

const PLACEHOLDER_STATUSES = [
  {
    provider: CODEX_PROVIDER,
    status: "warning",
    available: false,
    authStatus: "unknown",
    checkedAt: new Date().toISOString(),
    message: "Checking Codex CLI availability...",
  },
  {
    provider: GEMINI_PROVIDER,
    status: "warning",
    available: false,
    authStatus: "unknown",
    checkedAt: new Date().toISOString(),
    message: "Checking Gemini CLI availability...",
  },
  {
    provider: CLAUDE_CODE_PROVIDER,
    status: "warning",
    available: false,
    authStatus: "unknown",
    checkedAt: new Date().toISOString(),
    message: "Checking Claude Code CLI availability...",
  },
] as const satisfies readonly [ServerProviderStatus, ServerProviderStatus, ServerProviderStatus];

const ERROR_FALLBACK_STATUSES = [
  {
    provider: CODEX_PROVIDER,
    status: "error",
    available: false,
    authStatus: "unknown",
    checkedAt: new Date().toISOString(),
    message: "Failed to check Codex CLI status.",
  },
  {
    provider: GEMINI_PROVIDER,
    status: "error",
    available: false,
    authStatus: "unknown",
    checkedAt: new Date().toISOString(),
    message: "Failed to check Gemini CLI status.",
  },
  {
    provider: CLAUDE_CODE_PROVIDER,
    status: "error",
    available: false,
    authStatus: "unknown",
    checkedAt: new Date().toISOString(),
    message: "Failed to check Claude Code CLI status.",
  },
] as const satisfies readonly [ServerProviderStatus, ServerProviderStatus, ServerProviderStatus];

const [
  CODEX_ERROR_FALLBACK_STATUS,
  GEMINI_ERROR_FALLBACK_STATUS,
  CLAUDE_CODE_ERROR_FALLBACK_STATUS,
] = ERROR_FALLBACK_STATUSES;

// ── Layer ───────────────────────────────────────────────────────────

export const ProviderHealthLive = Layer.effect(
  ProviderHealth,
  Effect.gen(function* () {
    let cachedStatuses: ReadonlyArray<ServerProviderStatus> = PLACEHOLDER_STATUSES;
    let ready = false;
    const readyListeners: Array<(statuses: ReadonlyArray<ServerProviderStatus>) => void> = [];

    const notifyReady = (statuses: ReadonlyArray<ServerProviderStatus>) => {
      ready = true;
      cachedStatuses = statuses;
      for (const cb of readyListeners) {
        try {
          cb(statuses);
        } catch (error) {
          console.warn("[ProviderHealth] onReady callback threw", error);
        }
      }
      readyListeners.length = 0;
    };

    // Run health checks in the background so they don't block server startup.
    const runCheck = (
      check: Effect.Effect<ServerProviderStatus, never, ChildProcessSpawner.ChildProcessSpawner>,
      fallback: ServerProviderStatus,
    ) => check.pipe(Effect.catchCause(() => Effect.succeed(fallback)));

    yield* Effect.forkDetach(
      Effect.all(
        [
          runCheck(checkCodexProviderStatus, CODEX_ERROR_FALLBACK_STATUS),
          runCheck(checkGeminiProviderStatus, GEMINI_ERROR_FALLBACK_STATUS),
          runCheck(checkClaudeCodeProviderStatus, CLAUDE_CODE_ERROR_FALLBACK_STATUS),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.tap((statuses) => Effect.sync(() => notifyReady(statuses))),
        Effect.catchCause(() => Effect.sync(() => notifyReady(ERROR_FALLBACK_STATUSES))),
      ),
    );

    return {
      getStatuses: Effect.sync(() => cachedStatuses),
      onReady: (cb) => {
        if (ready) {
          cb(cachedStatuses);
        } else {
          readyListeners.push(cb);
        }
      },
    } satisfies ProviderHealthShape;
  }),
);
