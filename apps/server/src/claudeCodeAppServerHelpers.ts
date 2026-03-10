/**
 * Claude Code App Server Helpers
 *
 * Pure utility functions and constants for the ClaudeCodeAppServerManager.
 * No dependency on session or process state.
 *
 * @module claudeCodeAppServerHelpers
 */
import { type ChildProcessWithoutNullStreams, spawnSync } from "node:child_process";

import type { RuntimeMode } from "@agents/contracts";

// ── Constants ──────────────────────────────────────────────────────────

export const CLAUDE_CODE_DEFAULT_MODEL = "claude-sonnet-4-6";
export const CLAUDE_CODE_OPUS_MODEL = "claude-opus-4-6";

// Tool name → provider item type mapping
const COMMAND_EXECUTION_TOOLS = new Set(["Bash"]);
const FILE_CHANGE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const FILE_READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

// ── Model helpers ──────────────────────────────────────────────────────

export function normalizeClaudeCodeModelSlug(model: string | undefined | null): string | undefined {
  if (!model) return undefined;
  const trimmed = model.trim();
  if (!trimmed) return undefined;
  // Accept short aliases as-is (claude CLI handles them)
  return trimmed;
}

// ── Permission mode helpers ────────────────────────────────────────────

/**
 * Maps our runtime mode to Claude CLI flags.
 * - full-access: use --dangerously-skip-permissions (no control protocol needed)
 * - approval-required: use default mode with control protocol for can_use_tool
 */
export function buildPermissionFlags(runtimeMode: RuntimeMode): ReadonlyArray<string> {
  if (runtimeMode === "full-access") {
    return ["--dangerously-skip-permissions"];
  }
  // approval-required: no extra flags; control protocol handles approval
  return [];
}

// ── Tool item type helpers ─────────────────────────────────────────────

export function itemTypeFromToolName(toolName: string): string {
  if (COMMAND_EXECUTION_TOOLS.has(toolName)) return "commandExecution";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "fileChange";
  if (FILE_READ_TOOLS.has(toolName)) return "dynamicToolCall";
  if (toolName.startsWith("mcp__")) return "dynamicToolCall";
  return "dynamicToolCall";
}

export function requestKindFromToolName(toolName: string): "command" | "file-read" | "file-change" {
  if (COMMAND_EXECUTION_TOOLS.has(toolName)) return "command";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "file-change";
  if (FILE_READ_TOOLS.has(toolName)) return "file-read";
  return "command";
}

// ── Tool detail helpers ────────────────────────────────────────────────

export function detailFromToolInput(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;

  if (toolName === "Bash") {
    const cmd = typeof record.command === "string" ? record.command : undefined;
    return cmd?.trim() || undefined;
  }

  if (FILE_CHANGE_TOOLS.has(toolName) || FILE_READ_TOOLS.has(toolName)) {
    const path =
      typeof record.file_path === "string"
        ? record.file_path
        : typeof record.path === "string"
          ? record.path
          : undefined;
    return path?.trim() || undefined;
  }

  return undefined;
}

export function pathFromToolInput(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (FILE_CHANGE_TOOLS.has(toolName) || FILE_READ_TOOLS.has(toolName)) {
    const path =
      typeof record.file_path === "string"
        ? record.file_path
        : typeof record.path === "string"
          ? record.path
          : undefined;
    return path?.trim() || undefined;
  }
  return undefined;
}

// ── Process helpers ────────────────────────────────────────────────────

export function killChildTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === "win32" && child.pid !== undefined) {
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
      return;
    } catch {
      // fallback to direct kill
    }
  }
  child.kill("SIGTERM");
}

// ── Stderr classification ──────────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

const BENIGN_STDERR_PATTERNS = [
  /^\s*$/, // empty lines
  /claude code cannot be launched inside another claude code session/i,
  /^\s*at\s+/i, // stack trace lines - handled separately
];

export function classifyClaudeCodeStderrLine(rawLine: string): { message: string } | null {
  const line = rawLine.replaceAll(ANSI_ESCAPE_REGEX, "").trim();
  if (!line) return null;

  for (const pattern of BENIGN_STDERR_PATTERNS) {
    if (pattern.test(line)) return null;
  }

  return { message: line };
}

// ── Control protocol helpers ───────────────────────────────────────────

export const CLAUDE_CODE_SDK_VERSION = "0.2.71";

export function buildControlInitializeMessage(requestId: string): string {
  return JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: {
      subtype: "initialize",
      sdk_version: CLAUDE_CODE_SDK_VERSION,
      hooks: {},
      sdk_mcp_servers: [],
    },
  });
}

export function buildControlAllowResponse(requestId: string): string {
  return JSON.stringify({
    type: "control_response",
    request_id: requestId,
    response: {
      subtype: "success",
      response: { behavior: "allow" },
    },
  });
}

export function buildControlBlockResponse(requestId: string, reason?: string): string {
  return JSON.stringify({
    type: "control_response",
    request_id: requestId,
    response: {
      subtype: "success",
      response: {
        behavior: "block",
        message: reason ?? "Permission denied.",
      },
    },
  });
}

// ── Message type guards ────────────────────────────────────────────────

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
